import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { createEnrichmentWorker } from './enrichment'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-enrich-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createEnrichmentWorker', () => {
  it('runOnce enriches every row missing rating/vote_count that has a tmdb_id', async () => {
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-1',
      tmdbId: 42,
      imdbId: null,
      title: 'X',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const tmdb: Partial<TmdbClient> = {
      getMovieDetails: vi.fn().mockResolvedValue({ rating: 7.8, voteCount: 5000 }),
    }
    const worker = createEnrichmentWorker(db, tmdb as TmdbClient)
    const enrichedCount = await worker.runOnce()
    expect(enrichedCount).toBe(1)
    const row = db.prepare('SELECT rating, vote_count FROM movies WHERE tmdb_id = 42').get() as {
      rating: number
      vote_count: number
    }
    expect(row.rating).toBe(7.8)
    expect(row.vote_count).toBe(5000)
  })

  it('runOnce enriches every row in a multi-row batch, not just the first', async () => {
    for (const [key, tmdbId] of [['pk-multi-1', 101], ['pk-multi-2', 102]] as const) {
      upsertPlexRow(db, 1, {
        plexRatingKey: key,
        tmdbId,
        imdbId: null,
        title: key,
        posterPath: null,
        posterSource: 'plex',
        overview: null,
        year: null,
        genres: [],
        rating: null,
        voteCount: null,
        inLibrary: true,
        lastUsedAt: null,
      })
    }
    const tmdb: Partial<TmdbClient> = {
      getMovieDetails: vi.fn().mockResolvedValue({ rating: 6.5, voteCount: 1000 }),
    }
    const worker = createEnrichmentWorker(db, tmdb as TmdbClient)
    const enrichedCount = await worker.runOnce()
    expect(enrichedCount).toBe(2)
    for (const tmdbId of [101, 102]) {
      const row = db.prepare('SELECT rating FROM movies WHERE tmdb_id = ?').get(tmdbId) as { rating: number }
      expect(row.rating).toBe(6.5)
    }
  })

  it('runOnce is a no-op when nothing needs enrichment', async () => {
    const tmdb: Partial<TmdbClient> = { getMovieDetails: vi.fn() }
    const worker = createEnrichmentWorker(db, tmdb as TmdbClient)
    expect(await worker.runOnce()).toBe(0)
    expect(tmdb.getMovieDetails).not.toHaveBeenCalled()
  })
})
