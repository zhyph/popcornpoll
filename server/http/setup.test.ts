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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-setup-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const fakePlex: Partial<PlexClient> = {
  createPin: vi.fn().mockResolvedValue({ id: 1, code: 'ABCD' }),
  checkPin: vi.fn().mockResolvedValue({ authToken: 'tok-123' }),
  getResources: vi.fn().mockResolvedValue([
    { name: 'Living Room', clientIdentifier: 'srv-1', connections: [{ uri: 'http://10.0.0.5:32400' }] },
  ]),
  getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
}

function handlers() {
  return createSetupHandlers(db, KEY, 'correct-token', fakePlex as PlexClient, CLIENT_ID)
}

describe('createSetupHandlers', () => {
  it('rejects a pin request without the correct ADMIN_SETUP_TOKEN', async () => {
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await handlers().pin(req)
    expect(res.status).toBe(401)
  })

  it('accepts a pin request with the correct token and returns id/code/clientIdentifier', async () => {
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer correct-token' },
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
        headers: { Authorization: 'Bearer correct-token' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authToken: 'tok-123' })
    expect(fakePlex.checkPin).toHaveBeenCalledWith(1, CLIENT_ID)
  })

  it('rejects a pin-status request with a non-numeric pinId', async () => {
    const res = await handlers().pinStatus(
      new Request('http://localhost/api/setup/plex/pin-status?pinId=nope', {
        headers: { Authorization: 'Bearer correct-token' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('lists servers for an authenticated token', async () => {
    const res = await handlers().resources(
      new Request('http://localhost/api/setup/plex/resources?authToken=tok-123', {
        headers: { Authorization: 'Bearer correct-token' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { name: 'Living Room', clientIdentifier: 'srv-1', connections: [{ uri: 'http://10.0.0.5:32400' }] },
    ])
  })

  it('rejects a resources request without an authToken', async () => {
    const res = await handlers().resources(
      new Request('http://localhost/api/setup/plex/resources', {
        headers: { Authorization: 'Bearer correct-token' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('lists movie library sections for a chosen server', async () => {
    const res = await handlers().librarySections(
      new Request(
        'http://localhost/api/setup/plex/library-sections?serverUrl=http%3A%2F%2F10.0.0.5%3A32400&authToken=tok-123',
        { headers: { Authorization: 'Bearer correct-token' } },
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: '1', title: 'Movies', type: 'movie' }])
  })

  it('rejects a library-sections request missing serverUrl or authToken', async () => {
    const res = await handlers().librarySections(
      new Request('http://localhost/api/setup/plex/library-sections?authToken=tok-123', {
        headers: { Authorization: 'Bearer correct-token' },
      }),
    )
    expect(res.status).toBe(400)
  })
})
