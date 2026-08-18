import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { findByTmdbId, upsertTmdbOnlyRow } from '../db/movies'
import { createRoomStore } from '../room/roomStore'
import { createTmdbPruneWorker, TMDB_ONLY_STALE_DAYS } from './tmdbPrune'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-prune-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('createTmdbPruneWorker', () => {
  it('runOnce deletes tmdb-only rows unused for more than the stale-days cutoff', () => {
    const stale = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'Old',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: 2000,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: isoDaysAgo(TMDB_ONLY_STALE_DAYS + 1),
    })
    const store = createRoomStore()
    const worker = createTmdbPruneWorker(db, store)
    expect(worker.runOnce()).toBe(1)
    expect(findByTmdbId(db, stale.tmdbId!)).toBeNull()
  })

  it('runOnce keeps a stale row if its id is referenced by a currently-live room pool', () => {
    const stale = upsertTmdbOnlyRow(db, {
      tmdbId: 2,
      imdbId: null,
      title: 'Old but live',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: 2000,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: isoDaysAgo(TMDB_ONLY_STALE_DAYS + 1),
    })
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex+tmdb', {})
    const room = store.get(code)!
    room.pool = [
      {
        movieId: stale.id,
        title: stale.title,
        posterPath: null,
        posterSource: 'tmdb',
        overview: null,
        genres: [],
        year: null,
        inLibrary: false,
        rating: null,
        voteCount: null,
      },
    ]
    const worker = createTmdbPruneWorker(db, store)
    expect(worker.runOnce()).toBe(0)
    expect(findByTmdbId(db, 2)).not.toBeNull()
  })

  it('runOnce keeps a fresh tmdb-only row (recently dealt into a pool)', () => {
    upsertTmdbOnlyRow(db, {
      tmdbId: 3,
      imdbId: null,
      title: 'Fresh',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: 2000,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: isoDaysAgo(1),
    })
    const store = createRoomStore()
    const worker = createTmdbPruneWorker(db, store)
    expect(worker.runOnce()).toBe(0)
    expect(findByTmdbId(db, 3)).not.toBeNull()
  })
})
