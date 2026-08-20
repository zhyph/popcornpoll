// server/http/setup.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { createSetupHandlers } from './setup'
import type Database from 'better-sqlite3'
import type { PlexClient } from '../plex/client'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)
const CLIENT_ID = 'popcornpoll-test-client'
// >= MIN_ADMIN_SETUP_TOKEN_LENGTH in server/config.ts.
const ADMIN_TOKEN = 'correct-token-correct-token'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-setup-'))
  db = openDb(dir)
  // fakePlex's vi.fn()s are module-level, so call counts would otherwise leak
  // across tests and break the `not.toHaveBeenCalled()` assertions below.
  vi.clearAllMocks()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const fakePlex: Partial<PlexClient> = {
  createPin: vi.fn().mockResolvedValue({ id: 1, code: 'ABCD' }),
  checkPin: vi.fn().mockResolvedValue({ authToken: 'tok-123' }),
  getResources: vi.fn().mockResolvedValue([
    { name: 'Living Room', clientIdentifier: 'srv-1', connections: [{ uri: 'http://10.0.0.5:32400', local: true }] },
  ]),
  getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
}

function handlers() {
  return createSetupHandlers(db, KEY, ADMIN_TOKEN, fakePlex as PlexClient, CLIENT_ID)
}

describe('createSetupHandlers', () => {
  it('rejects a pin request without the correct ADMIN_SETUP_TOKEN', async () => {
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await handlers().pin(req)
    expect(res.status).toBe(401)
  })

  it('rejects a token of a different length than the real one without throwing', async () => {
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer short' },
    })
    const res = await handlers().pin(req)
    expect(res.status).toBe(401)
  })

  it('accepts a pin request with the correct token and returns id/code/clientIdentifier', async () => {
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    const res = await handlers().pin(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1, code: 'ABCD', clientIdentifier: CLIENT_ID })
  })

  it('rejects a pin-status request without the admin token', async () => {
    const res = await handlers().pinStatus(new Request('http://localhost/api/setup/plex/pin-status?pinId=1'))
    expect(res.status).toBe(401)
  })

  it("polls checkPin with this instance's own clientIdentifier and returns authToken", async () => {
    const res = await handlers().pinStatus(
      new Request('http://localhost/api/setup/plex/pin-status?pinId=1', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authToken: 'tok-123' })
    expect(fakePlex.checkPin).toHaveBeenCalledWith(1, CLIENT_ID)
  })

  it('rejects a pin-status request with a non-numeric pinId', async () => {
    const res = await handlers().pinStatus(
      new Request('http://localhost/api/setup/plex/pin-status?pinId=nope', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('lists servers for an authenticated token', async () => {
    const res = await handlers().resources(
      new Request('http://localhost/api/setup/plex/resources', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-Plex-Token': 'tok-123' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { name: 'Living Room', clientIdentifier: 'srv-1', connections: [{ uri: 'http://10.0.0.5:32400', local: true }] },
    ])
  })

  it('rejects a resources request without an authToken', async () => {
    const res = await handlers().resources(
      new Request('http://localhost/api/setup/plex/resources', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('lists movie library sections for a chosen server', async () => {
    const res = await handlers().librarySections(
      new Request('http://localhost/api/setup/plex/library-sections?serverUrl=http%3A%2F%2F10.0.0.5%3A32400', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-Plex-Token': 'tok-123' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: '1', title: 'Movies', type: 'movie' }])
  })

  it('rejects a library-sections serverUrl that Plex never reported for this account', async () => {
    const res = await handlers().librarySections(
      new Request('http://localhost/api/setup/plex/library-sections?serverUrl=http%3A%2F%2F169.254.169.254', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-Plex-Token': 'tok-123' },
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('unknown_server')
    expect(fakePlex.getLibrarySections).not.toHaveBeenCalled()
  })

  it('rejects a non-http(s) serverUrl scheme', async () => {
    const res = await handlers().librarySections(
      new Request('http://localhost/api/setup/plex/library-sections?serverUrl=file%3A%2F%2F%2Fetc%2Fpasswd', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-Plex-Token': 'tok-123' },
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('unknown_server')
  })

  it('refuses to persist a callback serverUrl that Plex never reported', async () => {
    const res = await handlers().callback(
      new Request('http://localhost/api/setup/plex/callback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken: 'tok-123',
          serverUrl: 'http://127.0.0.1:8080',
          librarySectionIds: ['1'],
          clientIdentifier: CLIENT_ID,
        }),
      }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('unknown_server')
    // The whole point of the check: nothing reached the database.
    expect(db.prepare('SELECT COUNT(*) AS n FROM plex_link').get()).toEqual({ n: 0 })
  })

  it('persists a callback serverUrl that is on the account, and stores it', async () => {
    const res = await handlers().callback(
      new Request('http://localhost/api/setup/plex/callback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken: 'tok-123',
          serverUrl: 'http://10.0.0.5:32400',
          librarySectionIds: ['1'],
          clientIdentifier: CLIENT_ID,
        }),
      }),
    )
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT server_url FROM plex_link WHERE id = 1').get() as { server_url: string }
    expect(row.server_url).toBe('http://10.0.0.5:32400')
  })

  it('rate-limits repeated wrong-token attempts with 429 once the bucket drains', async () => {
    const h = handlers()
    const guess = () =>
      h.pin(new Request('http://localhost/api/setup/plex/pin', { headers: { Authorization: 'Bearer wrong-token' } }))

    // ADMIN_ATTEMPT_CAPACITY is 30; the 31st consecutive failure has no token.
    for (let i = 0; i < 30; i++) expect((await guess()).status).toBe(401)
    expect((await guess()).status).toBe(429)
  })

  it('does not spend attempt budget on successful calls', async () => {
    const h = handlers()
    const good = () =>
      h.pin(new Request('http://localhost/api/setup/plex/pin', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }))

    // 40 successes exceeds ADMIN_ATTEMPT_CAPACITY — a legitimate owner polling
    // must never be able to lock themselves out.
    for (let i = 0; i < 40; i++) expect((await good()).status).toBe(200)
  })

  it('rejects a library-sections request missing serverUrl or authToken', async () => {
    const res = await handlers().librarySections(
      new Request('http://localhost/api/setup/plex/library-sections', {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-Plex-Token': 'tok-123' },
      }),
    )
    expect(res.status).toBe(400)
  })
})
