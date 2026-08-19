// server/room/tmdbFilters.ts
import type { TmdbFilters } from './types'

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

export function validateTmdbFilters(raw: TmdbFilters): { ok: true; filters: TmdbFilters } | { ok: false } {
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
