import type Database from 'better-sqlite3'
import type { AppConfig } from '../config'
import { createTokenBucket, getClientIp } from '../rateLimit'
import { isValidThreshold } from '../room/matchThreshold'
import { MAX_CONCURRENT_ROOMS, type RoomStore } from '../room/roomStore'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../room/types'

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

export function createRoomsHandler(
  store: RoomStore,
  _db: Database.Database,
  _encryptionKey: string,
  config: AppConfig,
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
      parsed.tmdbFilters ?? {},
    )
    return Response.json({ roomCode: code, hostClaimToken })
  }
}
