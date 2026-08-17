import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-db-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDb', () => {
  it('creates the sqlite file and applies migrations', () => {
    const db = openDb(dir)
    expect(existsSync(join(dir, 'popcornpoll.db'))).toBe(true)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('movies')
    expect(names).toContain('plex_link')
    expect(names).toContain('schema_version')
    db.close()
  })

  it('is idempotent — reopening does not re-apply or fail', () => {
    openDb(dir).close()
    const db = openDb(dir)
    const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }
    expect(version.v).toBe(1)
    db.close()
  })

  it('enforces movies_tmdb_only_uq — two NULL-plex_rating_key rows with the same tmdb_id collide', () => {
    const db = openDb(dir)
    const insert = db.prepare(
      `INSERT INTO movies (plex_rating_key, tmdb_id, title, poster_source, cached_at)
       VALUES (NULL, 42, 'A', 'tmdb', '2026-01-01')`,
    )
    insert.run()
    expect(() => insert.run()).toThrow()
    db.close()
  })
})
