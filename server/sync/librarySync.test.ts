import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { findByTmdbId, upsertPlexRow } from '../db/movies'
import { savePlexLink } from '../plex/link'
import { createLibrarySync } from './librarySync'
import type Database from 'better-sqlite3'
import type { PlexClient, PlexItem } from '../plex/client'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-sync-'))
  db = openDb(dir)
  savePlexLink(db, KEY, {
    clientIdentifier: 'client-1',
    serverUrl: 'http://plex.local:32400',
    authToken: 'token',
    librarySectionIds: ['1'],
    linkedAt: '2026-08-17T00:00:00.000Z',
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fakePlexItem(overrides: Partial<PlexItem> = {}): PlexItem {
  return {
    ratingKey: 'pk-1',
    title: 'Movie',
    year: 2020,
    guid: 'plex://movie/x',
    Guid: [],
    genres: [],
    ...overrides,
  }
}

describe('createLibrarySync', () => {
  it('upserts items from Plex and stamps a shared runId', async () => {
    const plex: Partial<PlexClient> = {
      getLibraryItems: vi.fn().mockResolvedValue([fakePlexItem({ ratingKey: 'pk-1' })]),
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
    }
    const tmdb: Partial<TmdbClient> = {
      findByImdbId: vi.fn(),
      getMovieDetails: vi.fn(),
    }
    const sync = createLibrarySync({
      db,
      plex: plex as PlexClient,
      tmdb: tmdb as TmdbClient,
      encryptionKey: KEY,
    })
    const result = await sync.run()
    expect(result.itemCount).toBe(1)
    const row = db.prepare('SELECT * FROM movies WHERE plex_rating_key = ?').get('pk-1')
    expect(row).toBeDefined()
  })

  it('upserts every item in a chunk, not just the first — regression test for a real dropped-items bug', async () => {
    const plex: Partial<PlexClient> = {
      getLibraryItems: vi.fn().mockResolvedValue([
        fakePlexItem({ ratingKey: 'multi-1' }),
        fakePlexItem({ ratingKey: 'multi-2' }),
        fakePlexItem({ ratingKey: 'multi-3' }),
      ]),
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({
      db,
      plex: plex as PlexClient,
      tmdb: tmdb as TmdbClient,
      encryptionKey: KEY,
      chunkSize: 2, // forces a chunk boundary mid-batch (2 items, then 1)
    })
    const result = await sync.run()
    expect(result.itemCount).toBe(3)
    for (const key of ['multi-1', 'multi-2', 'multi-3']) {
      const row = db.prepare('SELECT * FROM movies WHERE plex_rating_key = ?').get(key)
      expect(row).toBeDefined()
    }
  })

  it('sweeps items missing from the current scan to in_library=0', async () => {
    upsertPlexRow(db, 0, {
      plexRatingKey: 'gone',
      tmdbId: null,
      imdbId: null,
      title: 'Removed',
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
    const plex: Partial<PlexClient> = {
      getLibraryItems: vi.fn().mockResolvedValue([]),
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })
    await sync.run()
    const raw = db.prepare('SELECT in_library FROM movies WHERE plex_rating_key = ?').get('gone') as {
      in_library: number
    }
    expect(raw.in_library).toBe(0)
  })

  it('concurrent run() calls share one in-flight sync (single-flight)', async () => {
    let resolveFetch: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveFetch = resolve
    })
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockImplementation(async () => {
        await gate
        return [fakePlexItem()]
      }),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })

    const first = sync.run()
    const second = sync.run()
    expect(sync.isRunning()).toBe(true)
    resolveFetch()
    const [a, b] = await Promise.all([first, second])
    expect(a.runId).toBe(b.runId)
    expect(plex.getLibraryItems).toHaveBeenCalledTimes(1)
  })

  it('backfills tmdb_id from imdb_id via findByImdbId, capped at imdbBackfillCap', async () => {
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockResolvedValue([
        fakePlexItem({ ratingKey: 'a', guid: 'com.plexapp.agents.imdb://tt0111161' }),
      ]),
    }
    const tmdb: Partial<TmdbClient> = {
      findByImdbId: vi.fn().mockResolvedValue(278),
      getMovieDetails: vi.fn().mockResolvedValue({ rating: 9.3, voteCount: 25000 }),
    }
    const sync = createLibrarySync({
      db,
      plex: plex as PlexClient,
      tmdb: tmdb as TmdbClient,
      encryptionKey: KEY,
      imdbBackfillCap: 50,
    })
    await sync.run()
    const found = findByTmdbId(db, 278)
    expect(found?.plexRatingKey).toBe('a')
  })

  it('merges a backfilled tmdb_id into an existing TMDB-only row for the same film', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, tmdb_id, title, poster_source, rating, vote_count, cached_at)
       VALUES (NULL, 278, 'Shawshank (tmdb-only)', 'tmdb', 9.3, 25000, '2026-01-01')`,
    ).run()
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockResolvedValue([
        fakePlexItem({ ratingKey: 'a', guid: 'com.plexapp.agents.imdb://tt0111161' }),
      ]),
    }
    const tmdb: Partial<TmdbClient> = {
      findByImdbId: vi.fn().mockResolvedValue(278),
      getMovieDetails: vi.fn(),
    }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })
    await sync.run()
    const rows = db.prepare('SELECT * FROM movies WHERE tmdb_id = 278').all()
    expect(rows).toHaveLength(1) // merged, not duplicated
    const merged = rows[0] as { plex_rating_key: string; rating: number }
    expect(merged.plex_rating_key).toBe('a')
    expect(merged.rating).toBe(9.3)
  })

  it('lastSyncAt reflects the completion time of the most recent successful run, null before any run', async () => {
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockResolvedValue([]),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })
    expect(sync.lastSyncAt()).toBeNull()
    const before = Date.now()
    await sync.run()
    expect(sync.lastSyncAt()).toBeGreaterThanOrEqual(before)
  })
})
