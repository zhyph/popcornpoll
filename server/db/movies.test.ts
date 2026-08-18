import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import {
  findEligiblePlexRows,
  findRowsNeedingEnrichment,
  mergeTmdbOnlyIntoPlexRow,
  pruneStaleTmdbOnlyRows,
  stampLastUsed,
  sweepRemoved,
  upsertPlexRow,
  upsertTmdbOnlyRow,
} from './movies'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-movies-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('upsertPlexRow + sweepRemoved', () => {
  it('upserts by plex_rating_key and re-upserting updates in place', () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-1',
      tmdbId: null,
      imdbId: null,
      title: 'Arrival',
      posterPath: '/thumb/pk-1',
      posterSource: 'plex',
      overview: null,
      year: 2016,
      genres: ['Sci-Fi'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const again = upsertPlexRow(db, 2, { ...row, title: 'Arrival (renamed)' })
    expect(again.id).toBe(row.id)
    expect(again.title).toBe('Arrival (renamed)')
  })

  it('sweepRemoved sets in_library=0 for rows not touched by the given runId', () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-2',
      tmdbId: null,
      imdbId: null,
      title: 'Gone',
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
    sweepRemoved(db, 2) // run 2 didn't touch row (stamped with runId 1)
    const raw = db.prepare('SELECT in_library FROM movies WHERE id = ?').get(row.id) as {
      in_library: number
    }
    expect(raw.in_library).toBe(0)
  })
})

describe('upsertTmdbOnlyRow + mergeTmdbOnlyIntoPlexRow', () => {
  it('merges a TMDB-only row into a Plex row sharing the same tmdb_id and deletes the duplicate', () => {
    const tmdbOnly = upsertTmdbOnlyRow(db, {
      tmdbId: 99,
      imdbId: null,
      title: 'Dune',
      posterPath: '/dune.jpg',
      posterSource: 'tmdb',
      overview: 'desc',
      year: 2021,
      genres: ['Sci-Fi'],
      rating: 8.1,
      voteCount: 12000,
      lastUsedAt: null,
    })
    const plexRow = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-3',
      tmdbId: null,
      imdbId: null,
      title: 'Dune',
      posterPath: '/thumb/pk-3',
      posterSource: 'plex',
      overview: null,
      year: 2021,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })

    mergeTmdbOnlyIntoPlexRow(db, plexRow.id, tmdbOnly.id)

    const merged = db.prepare('SELECT * FROM movies WHERE id = ?').get(plexRow.id) as {
      tmdb_id: number
      rating: number
    }
    expect(merged.tmdb_id).toBe(99)
    expect(merged.rating).toBe(8.1)
    const deleted = db.prepare('SELECT * FROM movies WHERE id = ?').get(tmdbOnly.id)
    expect(deleted).toBeUndefined()
  })
})

describe('findRowsNeedingEnrichment', () => {
  it('returns rows with a tmdb_id but NULL rating, up to the limit', () => {
    for (let i = 0; i < 3; i++) {
      upsertPlexRow(db, 1, {
        plexRatingKey: `pk-e${i}`,
        tmdbId: 100 + i,
        imdbId: null,
        title: `Movie ${i}`,
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
    const rows = findRowsNeedingEnrichment(db, 2)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.tmdbId !== null && r.rating === null)).toBe(true)
  })
})

describe('pruneStaleTmdbOnlyRows', () => {
  it('deletes TMDB-only rows past the age cutoff, except excluded ids', () => {
    const old = upsertTmdbOnlyRow(db, {
      tmdbId: 200,
      imdbId: null,
      title: 'Old',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    db.prepare("UPDATE movies SET last_used_at = '2020-01-01' WHERE id = ?").run(old.id)

    const keep = upsertTmdbOnlyRow(db, {
      tmdbId: 201,
      imdbId: null,
      title: 'KeepMeLive',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    db.prepare("UPDATE movies SET last_used_at = '2020-01-01' WHERE id = ?").run(keep.id)

    const deletedCount = pruneStaleTmdbOnlyRows(db, 30, new Set([keep.id]))
    expect(deletedCount).toBe(1)
    expect(db.prepare('SELECT * FROM movies WHERE id = ?').get(old.id)).toBeUndefined()
    expect(db.prepare('SELECT * FROM movies WHERE id = ?').get(keep.id)).toBeDefined()
  })
})

describe('findEligiblePlexRows', () => {
  it('filters by genre, year range, and rating, only among in_library rows', () => {
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-f1',
      tmdbId: null,
      imdbId: null,
      title: 'Match',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2015,
      genres: ['Comedy'],
      rating: 7.5,
      voteCount: 500,
      inLibrary: true,
      lastUsedAt: null,
    })
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-f2',
      tmdbId: null,
      imdbId: null,
      title: 'WrongGenre',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2015,
      genres: ['Horror'],
      rating: 7.5,
      voteCount: 500,
      inLibrary: true,
      lastUsedAt: null,
    })
    const results = findEligiblePlexRows(db, { genre: 'Comedy', yearMin: 2010, yearMax: 2020, ratingMin: 7 })
    expect(results.map((r) => r.title)).toEqual(['Match'])
  })

  it('excludes rows with in_library=0', () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-f3',
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
    sweepRemoved(db, 999)
    const results = findEligiblePlexRows(db, {})
    expect(results.find((r) => r.id === row.id)).toBeUndefined()
  })
})
