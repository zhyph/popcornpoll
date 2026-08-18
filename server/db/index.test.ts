import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-db-'))
})

afterEach(() => {
  if (db) {
    db.close()
    db = null
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('openDb', () => {
  it('creates the sqlite file and applies migrations', () => {
    db = openDb(dir)
    expect(existsSync(join(dir, 'popcornpoll.db'))).toBe(true)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('movies')
    expect(names).toContain('plex_link')
    expect(names).toContain('schema_version')
  })

  it('is idempotent — reopening does not re-apply or fail', () => {
    db = openDb(dir)
    db.close()
    db = openDb(dir)
    const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }
    expect(version.v).toBe(3)
    const count = db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number }
    expect(count.c).toBe(3)
  })

  it('enforces movies_tmdb_only_uq — two NULL-plex_rating_key rows with the same tmdb_id collide', () => {
    db = openDb(dir)
    const insert = db.prepare(
      `INSERT INTO movies (plex_rating_key, tmdb_id, title, poster_source, cached_at)
       VALUES (NULL, 42, 'A', 'tmdb', '2026-01-01')`,
    )
    insert.run()
    expect(() => insert.run()).toThrow()
  })
})

describe('migrations', () => {
  it('creates the match_history table with the expected columns', () => {
    db = openDb(dir)
    const columns = (db.prepare('PRAGMA table_info(match_history)').all() as { name: string }[]).map((c) => c.name)
    expect(columns.sort()).toEqual(
      ['id', 'movie_id', 'room_code', 'title', 'poster_path', 'poster_source', 'year', 'matched_at'].sort(),
    )
  })

  it('inserts and reads back a match_history row', () => {
    db = openDb(dir)
    db.prepare(
      `INSERT INTO movies (title, poster_source, cached_at) VALUES ('Rear Window', 'plex', '2026-01-01T00:00:00.000Z')`,
    ).run()
    const movieId = (db.prepare('SELECT id FROM movies WHERE title = ?').get('Rear Window') as { id: number }).id
    db.prepare(
      `INSERT INTO match_history (movie_id, room_code, title, poster_path, poster_source, year, matched_at)
       VALUES (?, 'BLUE-FOX-427', 'Rear Window', NULL, 'plex', 1954, '2026-01-01T00:00:00.000Z')`,
    ).run(movieId)
    const row = db.prepare('SELECT * FROM match_history WHERE room_code = ?').get('BLUE-FOX-427') as {
      title: string
      year: number
    }
    expect(row.title).toBe('Rear Window')
    expect(row.year).toBe(1954)
  })
})
