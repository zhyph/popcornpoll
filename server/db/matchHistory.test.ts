// server/db/matchHistory.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import { insertMatch, nightsSettled, recentMatches } from './matchHistory'
import type Database from 'better-sqlite3'

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-matchhistory-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

// match_history.movie_id has a FOREIGN KEY REFERENCES movies(id) (see
// server/db/migrations/002_match_history.sql), enforced because openDb()
// turns on `PRAGMA foreign_keys`. In production this always holds — movies
// come from cached DB rows — so tests must seed a matching movies row before
// inserting a match_history row for that movie id.
function seedMovie(id: number): void {
  db.prepare(
    `INSERT INTO movies (id, title, poster_source, cached_at) VALUES (?, ?, 'plex', ?)`,
  ).run(id, `Seed Movie ${id}`, new Date().toISOString())
}

describe('insertMatch + recentMatches + nightsSettled', () => {
  it('records a match and reads it back via recentMatches, newest first', () => {
    seedMovie(1)
    seedMovie(2)
    insertMatch(db, {
      movieId: 1,
      roomCode: 'BLUE-FOX-427',
      title: 'Rear Window',
      posterPath: null,
      posterSource: 'plex',
      year: 1954,
    })
    insertMatch(db, {
      movieId: 2,
      roomCode: 'RED-CAT-118',
      title: 'Vertigo',
      posterPath: '/vertigo.jpg',
      posterSource: 'tmdb',
      year: 1958,
    })
    const rows = recentMatches(db, 12)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.title).toBe('Vertigo') // inserted second, so newest
    expect(rows[1]!.title).toBe('Rear Window')
  })

  it('caps recentMatches at the given limit', () => {
    for (let i = 0; i < 15; i++) {
      seedMovie(i)
      insertMatch(db, {
        movieId: i,
        roomCode: `ROOM-${i}`,
        title: `Movie ${i}`,
        posterPath: null,
        posterSource: 'plex',
        year: 2000 + i,
      })
    }
    expect(recentMatches(db, 12)).toHaveLength(12)
  })

  it('counts nightsSettled as the number of distinct rooms with at least one match', () => {
    seedMovie(1)
    seedMovie(2)
    seedMovie(3)
    insertMatch(db, { movieId: 1, roomCode: 'ROOM-A', title: 'A', posterPath: null, posterSource: 'plex', year: null })
    insertMatch(db, { movieId: 2, roomCode: 'ROOM-A', title: 'B', posterPath: null, posterSource: 'plex', year: null }) // same room, second match — should NOT double-count
    insertMatch(db, { movieId: 3, roomCode: 'ROOM-B', title: 'C', posterPath: null, posterSource: 'plex', year: null })
    expect(nightsSettled(db)).toBe(2)
  })

  it('returns an empty array and zero when no matches have happened yet', () => {
    expect(recentMatches(db, 12)).toEqual([])
    expect(nightsSettled(db)).toBe(0)
  })
})
