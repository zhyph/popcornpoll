// server/http/solo.ts
import type Database from 'better-sqlite3'
import { generateSoloCode } from '../auth/tokens'
import { findById } from '../db/movies'
import { insertMatch } from '../db/matchHistory'
import { buildPool, toEntry, type PoolEntry } from '../pool/buildPool'
import { computeCAndM, reputationScore } from '../ranking/reputation'
import { createRng, weightedSample } from '../ranking/rng'
import { createDefaultRateLimitBucket, getClientIp } from '../rateLimit'
import { validateTmdbFilters } from '../room/tmdbFilters'
import type { CandidateSource, TmdbFilters } from '../room/types'
import type { AppConfig } from '../config'
import type { TmdbClient } from '../tmdb/client'
import type { createLibrarySync } from '../sync/librarySync'

function numOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function isSurpriseBody(v: unknown): v is { movieIds: number[]; exclude?: number[] } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.movieIds) || o.movieIds.length === 0 || !o.movieIds.every((x) => typeof x === 'number')) return false
  if (o.exclude !== undefined && (!Array.isArray(o.exclude) || !o.exclude.every((x) => typeof x === 'number'))) return false
  return true
}

function isPickBody(v: unknown): v is { movieId: number } {
  return typeof v === 'object' && v !== null && typeof (v as { movieId?: unknown }).movieId === 'number'
}

export function createSoloHandlers(
  db: Database.Database,
  tmdb: TmdbClient,
  config: AppConfig,
  librarySync: ReturnType<typeof createLibrarySync>,
) {
  // Only `pool` calls buildPool (the one call that can hit TMDB) — see
  // Global Constraints for why surprise/pick don't get a bucket.
  const poolRateLimitBucket = createDefaultRateLimitBucket()

  async function pool(req: Request, remoteAddress: string | undefined): Promise<Response> {
    const clientIp = getClientIp(req.headers.get('x-forwarded-for'), remoteAddress, config.trustedProxyHops)
    if (!poolRateLimitBucket.tryConsume(clientIp)) {
      return Response.json(
        { error: { code: 'rate_limited', message: 'too many requests, please slow down' } },
        { status: 429 },
      )
    }

    const url = new URL(req.url)
    const candidateSource: CandidateSource = url.searchParams.get('candidateSource') === 'plex+tmdb' ? 'plex+tmdb' : 'plex'
    const raw: TmdbFilters = {
      genre: url.searchParams.get('genre') ?? undefined,
      yearMin: numOrUndefined(url.searchParams.get('yearMin')),
      yearMax: numOrUndefined(url.searchParams.get('yearMax')),
      ratingMin: numOrUndefined(url.searchParams.get('ratingMin')),
    }
    const filterResult = validateTmdbFilters(raw)
    if (!filterResult.ok) {
      return Response.json(
        { error: { code: 'invalid_filters', message: 'yearMin must be <= yearMax' } },
        { status: 400 },
      )
    }

    await librarySync.waitForCurrent()
    const result = await buildPool(db, tmdb, candidateSource, filterResult.filters, Date.now())
    if (result.tooSmall) {
      const code = result.tooSmallReason === 'library_empty' ? 'library_empty' : 'pool_too_small'
      return Response.json({ error: { code, message: 'not enough eligible titles' } }, { status: 422 })
    }

    const { c, m } = computeCAndM(result.pool)
    const ranked = [...result.pool].sort((a, b) => reputationScore(b, c, m) - reputationScore(a, c, m))
    return Response.json({ pool: ranked, degraded: result.degraded })
  }

  async function surprise(req: Request): Promise<Response> {
    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_body', message: 'malformed JSON' } }, { status: 400 })
    }
    if (!isSurpriseBody(parsed)) {
      return Response.json(
        { error: { code: 'invalid_body', message: 'movieIds must be a non-empty number array' } },
        { status: 400 },
      )
    }

    const rows = parsed.movieIds.map((id) => findById(db, id)).filter((r) => r !== null)
    if (rows.length === 0) {
      return Response.json({ error: { code: 'pool_too_small', message: 'no eligible titles to shuffle' } }, { status: 422 })
    }

    const exclude = new Set(parsed.exclude ?? [])
    const fresh = rows.filter((r) => !exclude.has(r.id))
    const candidates = fresh.length > 0 ? fresh : rows

    const { c, m } = computeCAndM(rows)
    const rng = createRng(Date.now())
    const picked = weightedSample(candidates, (row) => reputationScore(row, c, m), rng)
    return Response.json({ entry: toEntry(picked) })
  }

  async function pick(req: Request): Promise<Response> {
    if (config.appOrigin && req.headers.get('origin') !== config.appOrigin) {
      return Response.json({ error: { code: 'forbidden_origin', message: 'request origin not allowed' } }, { status: 403 })
    }
    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_body', message: 'malformed JSON' } }, { status: 400 })
    }
    if (!isPickBody(parsed)) {
      return Response.json({ error: { code: 'invalid_body', message: 'movieId must be a number' } }, { status: 400 })
    }

    const row = findById(db, parsed.movieId)
    if (!row) {
      return Response.json({ error: { code: 'movie_not_found', message: 'movie not found' } }, { status: 404 })
    }

    const roomCode = generateSoloCode()
    insertMatch(db, {
      movieId: row.id,
      roomCode,
      title: row.title,
      posterPath: row.posterPath,
      posterSource: row.posterSource,
      year: row.year,
    })
    return Response.json({ roomCode })
  }

  return { pool, surprise, pick }
}
