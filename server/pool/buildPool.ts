// server/pool/buildPool.ts
import type Database from 'better-sqlite3'
import {
  countEligiblePlexRows,
  findByTmdbId,
  findEligiblePlexRows,
  mergeTmdbOnlyIntoPlexRow,
  stampLastUsed,
  upsertTmdbOnlyRow,
} from '../db/movies'
import type { MovieRow } from '../db/movies'
import { computeCAndM, reputationScore } from '../ranking/reputation'
import { createRng, weightedSampleWithoutReplacement } from '../ranking/rng'
import { TMDB_DISCOVER_PAGE_CAP, type TmdbClient, type TmdbMovie } from '../tmdb/client'
import { resolveGenreId } from '../tmdb/genres'

export function getPoolCap(): number {
  if (process.env.FAKE_EXTERNAL_APIS === 'true' && process.env.POOL_SIZE_CAP) {
    return Number.parseInt(process.env.POOL_SIZE_CAP, 10)
  }
  return 100
}
export const POOL_MIN_SIZE = 5
const PLEX_SHARE = 0.7 // spec: "up to 70% of the cap is targeted from the Plex sample and the remainder from TMDB discover results"

export interface PoolEntry {
  movieId: number
  title: string
  posterPath: string | null
  posterSource: 'plex' | 'tmdb'
  overview: string | null
  genres: string[]
  year: number | null
  inLibrary: boolean
  rating: number | null
  voteCount: number | null
}

export interface PoolFilters {
  genre?: string
  yearMin?: number
  yearMax?: number
  ratingMin?: number
}

export interface BuildPoolResult {
  pool: PoolEntry[]
  tooSmall: boolean
  tooSmallReason?: 'library_empty'
  degraded: boolean
}

export function toEntry(row: MovieRow): PoolEntry {
  return {
    movieId: row.id,
    title: row.title,
    posterPath: row.posterPath,
    posterSource: row.posterSource,
    overview: row.overview,
    genres: row.genres,
    year: row.year,
    inLibrary: row.inLibrary,
    rating: row.rating,
    voteCount: row.voteCount,
  }
}

function dedupeByTmdbId(movies: TmdbMovie[]): TmdbMovie[] {
  const seen = new Set<number>()
  const deduped: TmdbMovie[] = []
  for (const m of movies) {
    if (seen.has(m.tmdbId)) continue
    seen.add(m.tmdbId)
    deduped.push(m)
  }
  return deduped
}

async function resolveTmdbCandidatesIntoRows(
  db: Database.Database,
  tmdbResults: Awaited<ReturnType<TmdbClient['discoverMovies']>>,
): Promise<MovieRow[]> {
  const rows: MovieRow[] = []
  for (const result of tmdbResults) {
    const existing = findByTmdbId(db, result.tmdbId)
    if (existing) {
      rows.push(existing)
      continue
    }
    const created = upsertTmdbOnlyRow(db, {
      tmdbId: result.tmdbId,
      imdbId: null,
      title: result.title,
      posterPath: result.posterPath,
      posterSource: 'tmdb',
      overview: result.overview,
      year: result.year,
      genres: [], // genre IDs are TMDB-numeric; name mapping happens client-side for filters, not stored here
      rating: result.rating,
      voteCount: result.voteCount,
      lastUsedAt: null,
    })
    rows.push(created)
  }
  return rows
}

export async function buildPool(
  db: Database.Database,
  tmdb: TmdbClient,
  candidateSource: 'plex' | 'plex+tmdb',
  filters: PoolFilters,
  rngSeed: number,
): Promise<BuildPoolResult> {
  const plexRows = findEligiblePlexRows(db, filters)

  let tmdbRows: MovieRow[] = []
  let degraded = false
  if (candidateSource === 'plex+tmdb') {
    try {
      const discovered = await tmdb.discoverMovies(
        {
          genreId: resolveGenreId(filters.genre),
          yearMin: filters.yearMin,
          yearMax: filters.yearMax,
          ratingMin: filters.ratingMin,
        },
        TMDB_DISCOVER_PAGE_CAP,
      )
      tmdbRows = await resolveTmdbCandidatesIntoRows(db, dedupeByTmdbId(discovered))
    } catch (err) {
      // TMDB is down/rate-limited/misconfigured — degrade to a Plex-only
      // pool for this room instead of letting the failure propagate up
      // through startRoom and crash the WS message handler. The
      // shortfall-backfill logic below naturally fills the pool from Plex
      // alone once tmdbEligible is empty. The caller (startRoom) surfaces
      // `degraded` to the room as a notice.
      console.error('buildPool: tmdb.discoverMovies failed, degrading to plex-only pool', err)
      tmdbRows = []
      degraded = true
    }
  }

  // Merge: a row that started as TMDB-only but actually matches a Plex row
  // (same tmdb_id, resolved after this pool's own upserts above) collapses.
  const byMovieId = new Map<number, MovieRow>()
  for (const row of plexRows) byMovieId.set(row.id, row)
  for (const row of tmdbRows) {
    const asPlexRow = plexRows.find((p) => p.tmdbId === row.tmdbId && row.tmdbId !== null)
    if (asPlexRow && row.plexRatingKey === null) {
      mergeTmdbOnlyIntoPlexRow(db, asPlexRow.id, row.id)
      byMovieId.set(asPlexRow.id, asPlexRow)
    } else {
      byMovieId.set(row.id, row)
    }
  }

  const eligible = [...byMovieId.values()]
  const { c, m } = computeCAndM(eligible)
  const rng = createRng(rngSeed)

  const poolCap = getPoolCap()
  let targetPlexCount = candidateSource === 'plex+tmdb' ? Math.round(poolCap * PLEX_SHARE) : poolCap
  let targetTmdbCount = candidateSource === 'plex+tmdb' ? poolCap - targetPlexCount : 0

  const plexEligible = eligible.filter((r) => r.plexRatingKey !== null)
  const tmdbEligible = eligible.filter((r) => r.plexRatingKey === null)

  // Shortfall backfill: whichever source has fewer eligible rows than its
  // target share, the other source picks up the difference, up to the cap.
  const plexShortfall = Math.max(0, targetPlexCount - plexEligible.length)
  const tmdbShortfall = Math.max(0, targetTmdbCount - tmdbEligible.length)
  targetPlexCount = Math.min(plexEligible.length, targetPlexCount + tmdbShortfall)
  targetTmdbCount = Math.min(tmdbEligible.length, targetTmdbCount + plexShortfall)

  const weight = (row: MovieRow) => reputationScore(row, c, m)
  const pickedPlex = weightedSampleWithoutReplacement(plexEligible, weight, targetPlexCount, rng)
  const pickedTmdb = weightedSampleWithoutReplacement(tmdbEligible, weight, targetTmdbCount, rng)

  const finalRows = [...pickedPlex, ...pickedTmdb].slice(0, poolCap)
  stampLastUsed(db, finalRows.map((r) => r.id), new Date().toISOString())

  const tooSmall = finalRows.length < POOL_MIN_SIZE
  let tooSmallReason: 'library_empty' | undefined
  if (tooSmall && candidateSource === 'plex') {
    // plexRows above is already filtered — check the UNFILTERED count to
    // tell "library has nothing in it" apart from "filters excluded
    // everything". Only a hard 0 counts as library_empty; a non-empty but
    // sparse library still gets the generic pool_too_small treatment (its
    // advice — widen filters, add TMDB — still applies).
    const unfilteredCount = countEligiblePlexRows(db, {})
    if (unfilteredCount === 0) tooSmallReason = 'library_empty'
  }

  return {
    pool: finalRows.map(toEntry),
    tooSmall,
    tooSmallReason,
    degraded,
  }
}
