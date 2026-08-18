import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import type { AppConfig } from '../config'
import { createRoomStore, MAX_CONCURRENT_ROOMS } from '../room/roomStore'
import { createRoomsHandler } from './rooms'
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
const validBody = { candidateSource: 'plex', matchThreshold: { kind: 'all' } }

function createRoomRequest(body: unknown, origin = config.appOrigin): Request {
  return new Request('http://localhost/api/rooms', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(body),
  })
}

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-rooms-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fakeLibrarySync(
  overrides: Partial<ReturnType<typeof createLibrarySync>> = {},
): ReturnType<typeof createLibrarySync> {
  return {
    run: vi.fn().mockResolvedValue({ runId: 1, itemCount: 0 }),
    isRunning: vi.fn().mockReturnValue(false),
    waitForCurrent: vi.fn().mockResolvedValue(undefined),
    lastSyncAt: vi.fn().mockReturnValue(Date.now()),
    ...overrides,
  } as ReturnType<typeof createLibrarySync>
}

describe('createRoomsHandler', () => {
  it('creates a room and returns roomCode + hostClaimToken', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const res = await handler(createRoomRequest(validBody), '127.0.0.1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)
    expect(typeof body.hostClaimToken).toBe('string')
  })

  it('rejects a malformed body with a 400 and an error code', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const req = new Request('http://localhost/api/rooms', {
      method: 'POST',
      headers: { origin: config.appOrigin },
      body: 'not json',
    })
    const res = await handler(req, '127.0.0.1')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_threshold')
  })

  it('rejects a request whose Origin does not match APP_ORIGIN', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const res = await handler(createRoomRequest(validBody, 'http://evil.example'), '127.0.0.1')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('forbidden_origin')
  })

  it('does not enforce Origin when APP_ORIGIN is empty (test-mode escape hatch, matches ws/server.ts)', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', { ...config, appOrigin: '' }, fakeLibrarySync())
    const res = await handler(createRoomRequest(validBody, 'http://anything.example'), '127.0.0.1')
    expect(res.status).toBe(200)
  })

  it('rate-limits room creation past 10 requests/minute from one client IP', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const res = await handler(createRoomRequest(validBody), '203.0.113.5')
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200))
    expect(statuses[10]).toBe(429)
  })

  it('tracks rate-limit buckets independently per client IP', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    for (let i = 0; i < 10; i++) await handler(createRoomRequest(validBody), '203.0.113.10')
    const res = await handler(createRoomRequest(validBody), '203.0.113.11')
    expect(res.status).toBe(200)
  })

  it('rejects room creation once MAX_CONCURRENT_ROOMS is reached', async () => {
    const store = createRoomStore()
    for (let i = 0; i < MAX_CONCURRENT_ROOMS; i++) store.create({ kind: 'all' }, 'plex', {})
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const res = await handler(createRoomRequest(validBody), '198.51.100.1')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.code).toBe('room_cap_reached')
  })

  it('rejects tmdbFilters with yearMin > yearMax', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const res = await handler(
      createRoomRequest({
        candidateSource: 'plex+tmdb',
        matchThreshold: { kind: 'all' },
        tmdbFilters: { yearMin: 2020, yearMax: 2000 },
      }),
      '127.0.0.1',
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_filters')
  })

  it("clamps an out-of-range ratingMin to TMDB's 0-10 scale instead of rejecting", async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, db, 'key', config, fakeLibrarySync())
    const res = await handler(
      createRoomRequest({ candidateSource: 'plex+tmdb', matchThreshold: { kind: 'all' }, tmdbFilters: { ratingMin: 99 } }),
      '127.0.0.1',
    )
    expect(res.status).toBe(200)
  })

  it('blocks room creation on a cold cache until the first sync completes', async () => {
    const store = createRoomStore()
    let responseResolved = false
    let resolveRun: (v: { runId: number; itemCount: number }) => void = () => {}
    const gate = new Promise<{ runId: number; itemCount: number }>((resolve) => {
      resolveRun = resolve
    })
    const run = vi.fn().mockReturnValue(gate)
    const librarySync = fakeLibrarySync({ run })
    const handler = createRoomsHandler(store, db, 'key', config, librarySync)

    const pending = handler(createRoomRequest(validBody), '127.0.0.1').then((res) => {
      responseResolved = true
      return res
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(responseResolved).toBe(false)
    expect(run).toHaveBeenCalledTimes(1)

    resolveRun({ runId: 1, itemCount: 0 })
    const res = await pending
    expect(responseResolved).toBe(true)
    expect(res.status).toBe(200)
  })

  it('does not await a sync when the library is already populated and fresh', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, cached_at) VALUES ('pk-1', 'X', 'plex', 1, '2026-01-01')`,
    ).run()
    const store = createRoomStore()
    const run = vi.fn().mockResolvedValue({ runId: 1, itemCount: 1 })
    const librarySync = fakeLibrarySync({ run, lastSyncAt: vi.fn().mockReturnValue(Date.now()) })
    const handler = createRoomsHandler(store, db, 'key', config, librarySync)
    const res = await handler(createRoomRequest(validBody), '127.0.0.1')
    expect(res.status).toBe(200)
    expect(run).not.toHaveBeenCalled()
  })

  it('fire-and-forget triggers a sync when the library is populated but stale (>6h)', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, cached_at) VALUES ('pk-1', 'X', 'plex', 1, '2026-01-01')`,
    ).run()
    const store = createRoomStore()
    const run = vi.fn().mockResolvedValue({ runId: 2, itemCount: 1 })
    const staleTimestamp = Date.now() - 7 * 60 * 60 * 1000
    const librarySync = fakeLibrarySync({ run, lastSyncAt: vi.fn().mockReturnValue(staleTimestamp) })
    const handler = createRoomsHandler(store, db, 'key', config, librarySync)
    const res = await handler(createRoomRequest(validBody), '127.0.0.1')
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a rejected staleness-triggered sync does not crash the process and the room is still created', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, cached_at) VALUES ('pk-1', 'X', 'plex', 1, '2026-01-01')`,
    ).run()
    const store = createRoomStore()
    // Deliberately a plain function, not vi.fn().mockRejectedValueOnce(...):
    // vitest's mock wrapper attaches its own internal .then() to track
    // mock.results, which marks the returned promise as "handled" from
    // Node's perspective and hides a real unhandled-rejection bug even when
    // the code under test never adds a .catch() of its own. A plain
    // Promise.reject is the only way this test can actually catch the bug.
    let runCallCount = 0
    const run: ReturnType<typeof fakeLibrarySync>['run'] = () => {
      runCallCount++
      return Promise.reject(new Error('Plex unreachable'))
    }
    const staleTimestamp = Date.now() - 7 * 60 * 60 * 1000
    const librarySync = fakeLibrarySync({ run, lastSyncAt: vi.fn().mockReturnValue(staleTimestamp) })
    const handler = createRoomsHandler(store, db, 'key', config, librarySync)

    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)

    const res = await handler(createRoomRequest(validBody), '127.0.0.1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)

    // The fire-and-forget sync rejects on a microtask queued after the
    // response is already built — give it a turn of the event loop before
    // asserting no unhandled rejection ever fired.
    await new Promise((resolve) => setTimeout(resolve, 10))
    process.removeListener('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
    expect(runCallCount).toBe(1)
  })
})
