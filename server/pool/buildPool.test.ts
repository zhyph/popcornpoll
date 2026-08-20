// server/pool/buildPool.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { buildPool, getPoolCap } from './buildPool'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-pool-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedPlexRows(count: number, opts: { genres?: string[] } = {}) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: `/thumb/${i}`,
      posterSource: 'plex',
      overview: null,
      year: 2000 + (i % 20),
      genres: opts.genres ?? ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
  getPosterImage: vi.fn(),
}

describe('buildPool', () => {
  it('builds a plex-only pool capped at 100, with in_library=true for every entry', async () => {
    seedPlexRows(150)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.pool.length).toBe(getPoolCap())
    expect(result.pool.every((e) => e.inLibrary)).toBe(true)
    expect(result.tooSmall).toBe(false)
  })

  it('returns tooSmall: true when fewer than 5 eligible candidates exist', async () => {
    seedPlexRows(3)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.tooSmall).toBe(true)
  })

  it('sets tooSmallReason to library_empty when a plex-only room has zero eligible rows at all', async () => {
    // No seedPlexRows call — the library genuinely has nothing in it.
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.tooSmall).toBe(true)
    expect(result.tooSmallReason).toBe('library_empty')
  })

  it('does not set tooSmallReason when the library has movies but a filter excludes all of them', async () => {
    seedPlexRows(10) // non-empty library
    const result = await buildPool(db, noOpTmdb, 'plex', { genre: 'Nonexistent Genre XYZ' }, 1)
    expect(result.tooSmall).toBe(true)
    expect(result.tooSmallReason).toBeUndefined()
  })

  it('does not set tooSmallReason for a plex+tmdb room even with zero Plex rows', async () => {
    // plex+tmdb can still fill a valid pool from TMDB alone — an empty Plex
    // library isn't the same dead end there that it is for a plex-only room.
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          tmdbId: 5000 + i,
          title: `TMDB Movie ${i}`,
          overview: 'desc',
          posterPath: '/p.jpg',
          year: 2020,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        })),
      ),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
      getPosterImage: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    expect(result.tooSmall).toBe(false)
    expect(result.tooSmallReason).toBeUndefined()
  })

  it('dedups a film that appears in both the Plex sample and the TMDB discover results', async () => {
    seedPlexRows(10)
    // Give one Plex row a resolved tmdb_id matching a TMDB discover result.
    db.prepare('UPDATE movies SET tmdb_id = 999 WHERE plex_rating_key = ?').run('pk-0')
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue([
        {
          tmdbId: 999,
          title: 'Movie 0',
          overview: 'desc',
          posterPath: '/p.jpg',
          year: 2000,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        },
      ]),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
      getPosterImage: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    const matchingIds = result.pool.filter((e) => e.title === 'Movie 0')
    expect(matchingIds).toHaveLength(1)
    expect(matchingIds[0]!.inLibrary).toBe(true) // resolved via the merged row, not the TMDB-only fallback
  })

  it('backfills from the other source when one falls short of its 70/30 target share', async () => {
    seedPlexRows(3) // far short of a 70-candidate target
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue(
        Array.from({ length: 40 }, (_, i) => ({
          tmdbId: 2000 + i,
          title: `TMDB ${i}`,
          overview: '',
          posterPath: null,
          year: 2010,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        })),
      ),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
      getPosterImage: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    // 3 Plex + up to 40 TMDB should backfill toward the 100 cap, not stay
    // capped at 30% (30) just because Plex only contributed 3.
    expect(result.pool.length).toBeGreaterThan(33)
  })

  it('targets ~70% of the cap from Plex and the remainder from TMDB, not the other way around — regression for an inverted split', async () => {
    seedPlexRows(200) // plenty of Plex supply so Plex is never the shortfall source
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({
          tmdbId: 5000 + i,
          title: `TMDB ${i}`,
          overview: '',
          posterPath: null,
          year: 2010,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        })),
      ),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
      getPosterImage: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    const plexCount = result.pool.filter((e) => e.posterSource === 'plex').length
    const tmdbCount = result.pool.filter((e) => e.posterSource === 'tmdb').length
    expect(plexCount).toBeGreaterThan(tmdbCount) // ~70 vs ~30, not ~30 vs ~70
    expect(plexCount).toBeGreaterThanOrEqual(65)
    expect(plexCount).toBeLessThanOrEqual(75)
  })

  it('resolves the free-text genre filter into a numeric TMDB genre id before calling discoverMovies', async () => {
    seedPlexRows(10)
    const discoverMovies = vi.fn().mockResolvedValue([])
    const tmdb: TmdbClient = { discoverMovies, getMovieDetails: vi.fn(), findByImdbId: vi.fn(), getPosterImage: vi.fn() }
    await buildPool(db, tmdb, 'plex+tmdb', { genre: 'Sci-Fi' }, 1)
    expect(discoverMovies).toHaveBeenCalledWith(expect.objectContaining({ genreId: 878 }), expect.any(Number))
  })

  it('omits genreId (rather than failing) when the free-text genre has no TMDB mapping', async () => {
    seedPlexRows(10)
    const discoverMovies = vi.fn().mockResolvedValue([])
    const tmdb: TmdbClient = { discoverMovies, getMovieDetails: vi.fn(), findByImdbId: vi.fn(), getPosterImage: vi.fn() }
    await buildPool(db, tmdb, 'plex+tmdb', { genre: 'Not A Real Genre' }, 1)
    expect(discoverMovies).toHaveBeenCalledWith(expect.objectContaining({ genreId: undefined }), expect.any(Number))
  })

  it('dedupes duplicate tmdbIds within a single discover call before resolving rows', async () => {
    seedPlexRows(2)
    const dup = {
      tmdbId: 42, title: 'Dup', overview: '', posterPath: null, year: 2000, genreIds: [], rating: 7, voteCount: 1000,
    }
    const discoverMovies = vi.fn().mockResolvedValue([dup, dup])
    const tmdb: TmdbClient = { discoverMovies, getMovieDetails: vi.fn(), findByImdbId: vi.fn(), getPosterImage: vi.fn() }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    expect(result.pool.filter((e) => e.title === 'Dup')).toHaveLength(1)
  })

  it('is deterministic for a fixed rngSeed', async () => {
    seedPlexRows(150)
    const a = await buildPool(db, noOpTmdb, 'plex', {}, 42)
    const b = await buildPool(db, noOpTmdb, 'plex', {}, 42)
    expect(a.pool.map((e) => e.movieId)).toEqual(b.pool.map((e) => e.movieId))
  })

  it('degrades to a plex-only pool and reports degraded: true when discoverMovies rejects', async () => {
    seedPlexRows(20)
    const failingTmdb: TmdbClient = {
      discoverMovies: vi.fn().mockRejectedValue(new Error('TMDB is down')),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
      getPosterImage: vi.fn(),
    }
    const result = await buildPool(db, failingTmdb, 'plex+tmdb', {}, 1)
    expect(result.degraded).toBe(true)
    expect(result.tooSmall).toBe(false)
    expect(result.pool.every((e) => e.inLibrary)).toBe(true) // no TMDB-only entries made it in
  })

  it('reports degraded: false on a normal successful build', async () => {
    seedPlexRows(150)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.degraded).toBe(false)
  })
})
