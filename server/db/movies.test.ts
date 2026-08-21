import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import { insertMatch } from './matchHistory'
import {
  countEligiblePlexRows,
  findDistinctGenres,
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

  it('does not throw FOREIGN KEY constraint failed when merging a TMDB-only row that has a match_history entry', () => {
    const tmdbOnly = upsertTmdbOnlyRow(db, {
      tmdbId: 300,
      imdbId: null,
      title: 'Matched',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: 2019,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    insertMatch(db, {
      movieId: tmdbOnly.id,
      roomCode: 'REG-TEST-1',
      title: 'Matched',
      posterPath: null,
      posterSource: 'tmdb',
      year: 2019,
    })
    const plexRow = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-reg-1',
      tmdbId: null,
      imdbId: null,
      title: 'Matched',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2019,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    expect(() => mergeTmdbOnlyIntoPlexRow(db, plexRow.id, tmdbOnly.id)).not.toThrow()
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

  it('does not throw FOREIGN KEY constraint failed when pruning a stale TMDB-only row that has a match_history entry', () => {
    const stale = upsertTmdbOnlyRow(db, {
      tmdbId: 301,
      imdbId: null,
      title: 'StaleMatched',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: 2018,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    insertMatch(db, {
      movieId: stale.id,
      roomCode: 'REG-TEST-2',
      title: 'StaleMatched',
      posterPath: null,
      posterSource: 'tmdb',
      year: 2018,
    })
    db.prepare("UPDATE movies SET last_used_at = '2020-01-01' WHERE id = ?").run(stale.id)
    expect(() => pruneStaleTmdbOnlyRows(db, 30, new Set())).not.toThrow()
    expect(db.prepare('SELECT * FROM movies WHERE id = ?').get(stale.id)).toBeUndefined()
  })
})

describe('findDistinctGenres', () => {
  it('returns the deduped, sorted union of genres across in-library rows only', () => {
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-g1',
      tmdbId: null,
      imdbId: null,
      title: 'A',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2015,
      genres: ['Comedy', 'Crime'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-g2',
      tmdbId: null,
      imdbId: null,
      title: 'B',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2016,
      genres: ['Crime', 'Noir'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-g3',
      tmdbId: null,
      imdbId: null,
      title: 'Removed',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2017,
      genres: ['Western'],
      rating: null,
      voteCount: null,
      inLibrary: false,
      lastUsedAt: null,
    })
    expect(findDistinctGenres(db)).toEqual(['Comedy', 'Crime', 'Noir'])
  })

  it('skips a row with malformed genres JSON instead of throwing', () => {
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-good',
      tmdbId: null,
      imdbId: null,
      title: 'Good Row',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2015,
      genres: ['Comedy'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    // Simulates data that somehow bypassed the JSON.stringify writers (e.g.
    // a hand-edited DB row) — findDistinctGenres must not let one bad row
    // 500 the whole /api/genres response.
    db.prepare(
      `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, genres, cached_at)
       VALUES ('pk-bad', 'Bad Row', 'plex', 1, 'not-json', '2026-01-01T00:00:00.000Z')`,
    ).run()
    expect(findDistinctGenres(db)).toEqual(['Comedy'])
  })
})

describe('countEligiblePlexRows', () => {
  // countEligiblePlexRows exists purely so the count-only callers stop
  // materialising every matching row. That is only safe while it selects the
  // exact same set findEligiblePlexRows does, so every case here asserts
  // parity against the row query rather than a hardcoded number — a
  // hardcoded number would keep passing if the two predicates drifted apart.
  const base = {
    tmdbId: null,
    imdbId: null,
    posterPath: null,
    posterSource: 'plex' as const,
    overview: null,
    voteCount: 500,
    lastUsedAt: null,
  }

  beforeEach(() => {
    upsertPlexRow(db, 1, { ...base, plexRatingKey: 'pk-c1', title: 'A', genres: ['Comedy'], year: 2015, rating: 7.5, inLibrary: true })
    upsertPlexRow(db, 1, { ...base, plexRatingKey: 'pk-c2', title: 'B', genres: ['Horror'], year: 1999, rating: 6.0, inLibrary: true })
    upsertPlexRow(db, 1, { ...base, plexRatingKey: 'pk-c3', title: 'C', genres: ['Comedy', 'Drama'], year: 2021, rating: null, inLibrary: true })
    upsertPlexRow(db, 1, { ...base, plexRatingKey: 'pk-c4', title: 'D', genres: ['Comedy'], year: 2015, rating: 9.0, inLibrary: false })
    upsertTmdbOnlyRow(db, {
      tmdbId: 4242,
      imdbId: null,
      title: 'TmdbOnly',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: 2015,
      genres: ['Comedy'],
      rating: 8.0,
      voteCount: 10,
      lastUsedAt: null,
    })
  })

  it.each([
    ['no filters', {}],
    ['genre', { genre: 'Comedy' }],
    ['year range', { yearMin: 2000, yearMax: 2020 }],
    ['rating floor', { ratingMin: 7 }],
    ['every filter at once', { genre: 'Comedy', yearMin: 2010, yearMax: 2020, ratingMin: 7 }],
    ['a genre that matches nothing', { genre: 'Documentary' }],
    ['LIKE wildcard as a literal', { genre: '%' }],
    ['LIKE single-char wildcard as a literal', { genre: 'Comed_' }],
  ])('matches findEligiblePlexRows().length for %s', (_label, filters) => {
    expect(countEligiblePlexRows(db, filters)).toBe(findEligiblePlexRows(db, filters).length)
  })

  it('counts only in-library Plex rows, excluding TMDB-only and in_library=0 rows', () => {
    // Guards the two exclusions the shared predicate carries: the fixture
    // above has 4 Plex rows (one with in_library=0) plus a TMDB-only row.
    expect(countEligiblePlexRows(db, {})).toBe(3)
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

  it('treats LIKE wildcards in genre as literal characters, not patterns', () => {
    const base = {
      tmdbId: null,
      imdbId: null,
      posterPath: null,
      posterSource: 'plex' as const,
      overview: null,
      year: 2015,
      rating: 7.5,
      voteCount: 500,
      inLibrary: true,
      lastUsedAt: null,
    }
    upsertPlexRow(db, 1, { ...base, plexRatingKey: 'pk-w1', title: 'Comedy One', genres: ['Comedy'] })
    upsertPlexRow(db, 1, { ...base, plexRatingKey: 'pk-w2', title: 'Horror One', genres: ['Horror'] })

    // Unescaped, `%` would make the pattern %"%"% and match every row; `_`
    // would make Comed_ match Comedy. Both must now match nothing.
    expect(findEligiblePlexRows(db, { genre: '%' })).toHaveLength(0)
    expect(findEligiblePlexRows(db, { genre: 'Comed_' })).toHaveLength(0)
    // A literal genre still matches, i.e. the escaping didn't break the filter.
    expect(findEligiblePlexRows(db, { genre: 'Comedy' }).map((r) => r.title)).toEqual(['Comedy One'])
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
