import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { createEligibleCountHandler } from './eligibleCount'
import type Database from 'better-sqlite3'

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-eligible-'))
  db = openDb(dir)
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, year, rating, genres, cached_at)
     VALUES ('pk1', 'Rear Window', 'plex', 1, 1954, 8.5, '["Thriller"]', '2026-01-01T00:00:00.000Z')`,
  ).run()
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, year, rating, genres, cached_at)
     VALUES ('pk2', 'Some Like It Hot', 'plex', 1, 1959, 8.2, '["Comedy"]', '2026-01-01T00:00:00.000Z')`,
  ).run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createEligibleCountHandler', () => {
  it('returns the count of movies matching the given filters', async () => {
    const handler = createEligibleCountHandler(db)
    const res = await handler(new Request('http://localhost/api/eligible-count?genre=Thriller'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
  })

  it('returns the full library count with no filters', async () => {
    const handler = createEligibleCountHandler(db)
    const res = await handler(new Request('http://localhost/api/eligible-count'))
    expect(await res.json()).toEqual({ count: 2 })
  })

  it('rejects yearMin > yearMax with 400 invalid_filters', async () => {
    const handler = createEligibleCountHandler(db)
    const res = await handler(new Request('http://localhost/api/eligible-count?yearMin=2000&yearMax=1990'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_filters')
  })
})
