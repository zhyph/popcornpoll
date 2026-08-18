import type Database from 'better-sqlite3'
import type { AppConfig } from '../config'
import { createTokenBucket, getClientIp } from '../rateLimit'
import { isValidThreshold } from '../room/matchThreshold'
import { MAX_CONCURRENT_ROOMS, type RoomStore } from '../room/roomStore'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../room/types'
import type { createLibrarySync } from '../sync/librarySync'

interface CreateRoomBody {
  candidateSource: CandidateSource
  matchThreshold: MatchThreshold
  tmdbFilters?: TmdbFilters
}

function isCreateRoomBody(value: unknown): value is CreateRoomBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.candidateSource === 'plex' || v.candidateSource === 'plex+tmdb') &&
    typeof v.matchThreshold === 'object' &&
    v.matchThreshold !== null
  )
}

// Spec: sync procedure is "triggered automatically if stale >6h at room creation".
const SYNC_STALE_MS = 6 * 60 * 60 * 1000
// 1888: Roundhay Garden Scene, the earliest surviving motion picture — a sane
// lower bound. Upper bound allows near-future/announced titles TMDB may list.
const MIN_YEAR = 1888
const MAX_RATING = 10 // TMDB's vote_average scale

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function numOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function validateTmdbFilters(raw: TmdbFilters): { ok: true; filters: TmdbFilters } | { ok: false } {
  const maxYear = new Date().getFullYear() + 1
  const filters: TmdbFilters = { genre: raw.genre }

  const yearMin = numOrUndefined(raw.yearMin)
  const yearMax = numOrUndefined(raw.yearMax)
  if (yearMin !== undefined) filters.yearMin = clamp(Math.trunc(yearMin), MIN_YEAR, maxYear)
  if (yearMax !== undefined) filters.yearMax = clamp(Math.trunc(yearMax), MIN_YEAR, maxYear)
  if (filters.yearMin !== undefined && filters.yearMax !== undefined && filters.yearMin > filters.yearMax) {
    return { ok: false }
  }

  const ratingMin = numOrUndefined(raw.ratingMin)
  if (ratingMin !== undefined) filters.ratingMin = clamp(ratingMin, 0, MAX_RATING)

  // Genre stays free text here on purpose — it's also used verbatim as the
  // Plex-side LIKE filter (findEligiblePlexRows), which has no fixed enum.
  // resolveGenreId (server/tmdb/genres.ts) already silently omits the
  // TMDB-side genreId when there's no match — that's the "ignore" behavior
  // for the TMDB-facing half of the spec sentence.
  return { ok: true, filters }
}

export function createRoomsHandler(
  store: RoomStore,
  db: Database.Database,
  _encryptionKey: string,
  config: AppConfig,
  librarySync: ReturnType<typeof createLibrarySync>,
): (req: Request, remoteAddress: string | undefined) => Promise<Response> {
  // Same 10/minute-per-IP shape as the WS upgrade bucket in ws/server.ts —
  // this is the HTTP half of Network exposure's rate-limiting requirement.
  // Join attempts are already covered separately by the WS upgrade bucket
  // and the per-connection failedJoins guard (Task 19); joining doesn't go
  // through this HTTP route.
  const rateLimitBucket = createTokenBucket(10, 10 / 60)

  return async (req, remoteAddress) => {
    // The client currently POSTs without a Content-Type header (app/page.tsx),
    // making this a CORS-simple request reachable cross-origin without a
    // preflight — Origin validation is the real defense here, not CORS
    // headers, so it's checked first and unconditionally.
    if (config.appOrigin && req.headers.get('origin') !== config.appOrigin) {
      return Response.json(
        { error: { code: 'forbidden_origin', message: 'request origin not allowed' } },
        { status: 403 },
      )
    }

    const clientIp = getClientIp(req.headers.get('x-forwarded-for'), remoteAddress, config.trustedProxyHops)
    if (!rateLimitBucket.tryConsume(clientIp)) {
      return Response.json(
        { error: { code: 'rate_limited', message: 'too many requests, please slow down' } },
        { status: 429 },
      )
    }

    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_threshold', message: 'malformed body' } }, { status: 400 })
    }
    if (!isCreateRoomBody(parsed)) {
      return Response.json({ error: { code: 'invalid_threshold', message: 'malformed body' } }, { status: 400 })
    }
    // At creation time there's no participant count yet — atLeast is validated
    // for real once real participants exist, at Start (Task 16). Here we only
    // reject the structurally-impossible case, n < 1.
    if (!isValidThreshold(parsed.matchThreshold, Number.MAX_SAFE_INTEGER)) {
      return Response.json({ error: { code: 'invalid_threshold', message: 'invalid threshold' } }, { status: 400 })
    }

    const filterResult = validateTmdbFilters(parsed.tmdbFilters ?? {})
    if (!filterResult.ok) {
      return Response.json(
        { error: { code: 'invalid_filters', message: 'yearMin must be <= yearMax' } },
        { status: 400 },
      )
    }

    // Spec (Library metadata cache, Sync procedure): a cold cache blocks room
    // creation on the first sync so a client never creates a room against an
    // empty library; a merely-stale (>6h) cache instead fires the sync in the
    // background without blocking creation.
    const movieCount = (db.prepare('SELECT COUNT(*) AS n FROM movies').get() as { n: number }).n
    if (movieCount === 0) {
      try {
        await librarySync.run()
      } catch {
        // Swallowed: a Plex outage shouldn't 500 room creation. The room is
        // still created against a (still-empty) cache, and Start's existing
        // pool_too_small failure is what surfaces the real problem to the
        // host.
      }
    } else if (!librarySync.isRunning()) {
      const lastSync = librarySync.lastSyncAt()
      if (lastSync === null || Date.now() - lastSync > SYNC_STALE_MS) {
        void librarySync.run() // fire-and-forget — creation does NOT await a staleness-triggered sync
      }
    }

    // Synchronous with store.create() below, no await between them — per
    // the Concurrency invariant, that's what keeps this a real cap instead
    // of a check-then-act race.
    if (store.all().length >= MAX_CONCURRENT_ROOMS) {
      return Response.json(
        {
          error: {
            code: 'room_cap_reached',
            message: 'the server has reached its maximum number of concurrent rooms',
          },
        },
        { status: 503 },
      )
    }

    const { code, hostClaimToken } = store.create(
      parsed.matchThreshold,
      parsed.candidateSource,
      filterResult.filters,
    )
    return Response.json({ roomCode: code, hostClaimToken })
  }
}
