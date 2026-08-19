import type Database from 'better-sqlite3'
import { findEligiblePlexRows } from '../db/movies'
import { getPoolCap } from '../pool/buildPool'
import { validateTmdbFilters } from '../room/tmdbFilters'
import type { TmdbFilters } from '../room/types'

function numOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

export function createEligibleCountHandler(db: Database.Database): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const raw: TmdbFilters = {
      genre: url.searchParams.get('genre') ?? undefined,
      yearMin: numOrUndefined(url.searchParams.get('yearMin')),
      yearMax: numOrUndefined(url.searchParams.get('yearMax')),
      ratingMin: numOrUndefined(url.searchParams.get('ratingMin')),
    }
    const result = validateTmdbFilters(raw)
    if (!result.ok) {
      return Response.json(
        { error: { code: 'invalid_filters', message: 'yearMin must be <= yearMax' } },
        { status: 400 },
      )
    }
    // Plex-only count: 'plex+tmdb' candidateSource pulls additional TMDB-discover
    // results in at room-start time (see startRoom/buildPool), which can't be
    // known ahead of that live call — this endpoint intentionally undercounts
    // for that source rather than guess.
    //
    // Capped at getPoolCap(): this is "in the pool" (the actual session pool
    // that would be built tonight), distinct from the uncapped "in library"
    // count elsewhere (server/http/stats.ts) — without the cap the two
    // numbers are identical whenever the filtered library is smaller than
    // the cap, which is the common case, making the distinction invisible.
    const count = Math.min(findEligiblePlexRows(db, result.filters).length, getPoolCap())
    return Response.json({ count })
  }
}
