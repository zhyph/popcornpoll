import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import type { AppConfig } from '../config'
import { createFakeTmdbClient } from '../tmdb/fakeClient'
import { createSoloHandlers } from './solo'
import type Database from 'better-sqlite3'
import type { createLibrarySync } from '../sync/librarySync'

const config: AppConfig = {
  tmdbApiKey: 'x',
  authEncryptionKey: 'a'.repeat(32),
  adminSetupToken: 'admin',
  appOrigin: 'http://localhost:3100',
  trustedProxyHops: 0,
  port: 0,
  dataDir: '',
}

function fakeLibrarySync(): ReturnType<typeof createLibrarySync> {
  return {
    run: vi.fn().mockResolvedValue({ runId: 1, itemCount: 0 }),
    isRunning: vi.fn().mockReturnValue(false),
    waitForCurrent: vi.fn().mockResolvedValue(undefined),
    lastSyncAt: vi.fn().mockReturnValue(Date.now()),
  } as ReturnType<typeof createLibrarySync>
}

let db: Database.Database
let dir: string

function insertMovie(overrides: Partial<{ ratingKey: string; title: string; rating: number; voteCount: number; genres: string; year: number }> = {}) {
  const o = { ratingKey: `pk-${Math.random()}`, title: 'Fixture Title', rating: 7.5, voteCount: 500, genres: '["Drama"]', year: 1955, ...overrides }
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, year, rating, vote_count, genres, cached_at)
     VALUES (@ratingKey, @title, 'plex', 1, @year, @rating, @voteCount, @genres, '2026-01-01T00:00:00.000Z')`,
  ).run(o)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-solo-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('pool', () => {
  it('returns a pool ranked by reputation score (highest first)', async () => {
    insertMovie({ title: 'Low Rep', rating: 6.0, voteCount: 50 })
    insertMovie({ title: 'High Rep', rating: 9.0, voteCount: 5000 })
    insertMovie({ title: 'Mid Rep', rating: 7.5, voteCount: 500 })
    insertMovie({ title: 'Fourth', rating: 7.0, voteCount: 300 })
    insertMovie({ title: 'Fifth', rating: 8.0, voteCount: 800 })

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool'), '127.0.0.1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pool).toHaveLength(5)
    expect(body.pool[0].title).toBe('High Rep')
    expect(body.degraded).toBe(false)
  })

  it('returns 422 pool_too_small when fewer than POOL_MIN_SIZE titles are eligible', async () => {
    insertMovie()
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool'), '127.0.0.1')
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('pool_too_small')
  })

  it('returns 422 library_empty when the unfiltered library has zero eligible rows', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool'), '127.0.0.1')
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('library_empty')
  })

  it('rejects yearMin > yearMax with 400 invalid_filters', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool?yearMin=2000&yearMax=1990'), '127.0.0.1')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_filters')
  })
})

describe('surprise', () => {
  it('picks one of the given movieIds and excludes ids in `exclude`', async () => {
    insertMovie({ title: 'A' })
    insertMovie({ title: 'B' })
    const rows = db.prepare('SELECT id, title FROM movies ORDER BY title').all() as { id: number; title: string }[]
    const aId = rows.find((r) => r.title === 'A')!.id
    const bId = rows.find((r) => r.title === 'B')!.id

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', {
        method: 'POST',
        body: JSON.stringify({ movieIds: [aId, bId], exclude: [aId] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entry.movieId).toBe(bId)
  })

  it('falls back to the full candidate set when exclude would empty it', async () => {
    insertMovie({ title: 'Only One' })
    const row = db.prepare('SELECT id FROM movies').get() as { id: number }

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', {
        method: 'POST',
        body: JSON.stringify({ movieIds: [row.id], exclude: [row.id] }),
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).entry.movieId).toBe(row.id)
  })

  it('rejects a malformed body with 400 invalid_body', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', { method: 'POST', body: JSON.stringify({ movieIds: 'nope' }) }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_body')
  })

  it('returns 422 pool_too_small when none of the given movieIds resolve to a real row', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', {
        method: 'POST',
        body: JSON.stringify({ movieIds: [999999] }),
      }),
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('pool_too_small')
  })
})

describe('pick', () => {
  it('writes match_history with a fresh solo-XXXX code and returns it', async () => {
    insertMovie({ title: 'Picked One' })
    const row = db.prepare('SELECT id FROM movies').get() as { id: number }

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: config.appOrigin },
        body: JSON.stringify({ movieId: row.id }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^solo-[A-HJ-NP-Z2-9]{4}$/)

    const history = db.prepare('SELECT title, room_code FROM match_history').get() as { title: string; room_code: string }
    expect(history.title).toBe('Picked One')
    expect(history.room_code).toBe(body.roomCode)
  })

  it('returns 404 movie_not_found for an unknown movieId', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: config.appOrigin },
        body: JSON.stringify({ movieId: 999999 }),
      }),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('movie_not_found')
  })

  it('rejects a cross-origin request with 403 forbidden_origin', async () => {
    insertMovie()
    const row = db.prepare('SELECT id FROM movies').get() as { id: number }
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: 'http://evil.example' },
        body: JSON.stringify({ movieId: row.id }),
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden_origin')
  })

  it('rejects a malformed body with 400 invalid_body', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: config.appOrigin },
        body: 'not json',
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_body')
  })
})
