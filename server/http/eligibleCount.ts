import type Database from 'better-sqlite3'
import { findEligiblePlexRows } from '../db/movies'
import { validateTmdbFilters } from './rooms'
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
    const count = findEligiblePlexRows(db, result.filters).length
    return Response.json({ count })
  }
}
