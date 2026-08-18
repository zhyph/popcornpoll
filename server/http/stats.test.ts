// server/http/stats.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { insertMatch } from '../db/matchHistory'
import { savePlexLink } from '../plex/link'
import { createStatsHandler } from './stats'
import type Database from 'better-sqlite3'

const KEY = 'a'.repeat(32)
let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-stats-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createStatsHandler', () => {
  it('returns libraryCount, nightsSettled, recentMatches, plexLinked, lastSyncAt', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, cached_at)
       VALUES ('pk1', 'Rear Window', 'plex', 1, '2026-01-01T00:00:00.000Z')`,
    ).run()
    insertMatch(db, { movieId: 1, roomCode: 'BLUE-FOX-427', title: 'Rear Window', posterPath: null, posterSource: 'plex', year: 1954 })
    savePlexLink(db, KEY, {
      clientIdentifier: 'client-1',
      serverUrl: 'http://plex.local',
      authToken: 'tok',
      librarySectionIds: ['1'],
      linkedAt: new Date().toISOString(),
    })

    const handler = createStatsHandler(db, KEY, { lastSyncAt: () => 1_700_000_000_000 })
    const res = await handler(new Request('http://localhost/api/stats'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.libraryCount).toBe(1)
    expect(body.nightsSettled).toBe(1)
    expect(body.recentMatches).toEqual([{ title: 'Rear Window', posterPath: null, posterSource: 'plex', year: 1954 }])
    expect(body.plexLinked).toBe(true)
    expect(body.lastSyncAt).toBe(1_700_000_000_000)
  })

  it('returns plexLinked: false and empty stats on a fresh, unlinked instance', async () => {
    const handler = createStatsHandler(db, KEY, { lastSyncAt: () => null })
    const res = await handler(new Request('http://localhost/api/stats'))
    const body = await res.json()
    expect(body.libraryCount).toBe(0)
    expect(body.nightsSettled).toBe(0)
    expect(body.recentMatches).toEqual([])
    expect(body.plexLinked).toBe(false)
    expect(body.lastSyncAt).toBeNull()
  })
})
