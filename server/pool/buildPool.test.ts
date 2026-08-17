// server/pool/buildPool.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { buildPool } from './buildPool'
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
}

describe('buildPool', () => {
  it('builds a plex-only pool capped at 100, with in_library=true for every entry', async () => {
    seedPlexRows(150)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.pool.length).toBe(100)
    expect(result.pool.every((e) => e.inLibrary)).toBe(true)
    expect(result.tooSmall).toBe(false)
  })

  it('returns tooSmall: true when fewer than 5 eligible candidates exist', async () => {
    seedPlexRows(3)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.tooSmall).toBe(true)
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
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    // 3 Plex + up to 40 TMDB should backfill toward the 100 cap, not stay
    // capped at 30% (30) just because Plex only contributed 3.
    expect(result.pool.length).toBeGreaterThan(33)
  })

  it('is deterministic for a fixed rngSeed', async () => {
    seedPlexRows(150)
    const a = await buildPool(db, noOpTmdb, 'plex', {}, 42)
    const b = await buildPool(db, noOpTmdb, 'plex', {}, 42)
    expect(a.pool.map((e) => e.movieId)).toEqual(b.pool.map((e) => e.movieId))
  })
})
