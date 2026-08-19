import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { createGenresHandler } from './genres'
import type Database from 'better-sqlite3'

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-genres-'))
  db = openDb(dir)
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, genres, cached_at)
     VALUES ('pk1', 'Rear Window', 'plex', 1, '["Thriller","Mystery"]', '2026-01-01T00:00:00.000Z')`,
  ).run()
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, genres, cached_at)
     VALUES ('pk2', 'Some Like It Hot', 'plex', 1, '["Comedy"]', '2026-01-01T00:00:00.000Z')`,
  ).run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createGenresHandler', () => {
  it('returns the deduped, sorted genre list from the linked library', async () => {
    const handler = createGenresHandler(db)
    const res = await handler(new Request('http://localhost/api/genres'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ genres: ['Comedy', 'Mystery', 'Thriller'] })
  })
})
