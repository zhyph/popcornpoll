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
}

describe('createSetupHandlers', () => {
  it('rejects a pin request without the correct ADMIN_SETUP_TOKEN', async () => {
    const handlers = createSetupHandlers(db, KEY, 'correct-token', fakePlex as PlexClient)
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await handlers.pin(req)
    expect(res.status).toBe(401)
  })

  it('accepts a pin request with the correct token and returns id/code', async () => {
    const handlers = createSetupHandlers(db, KEY, 'correct-token', fakePlex as PlexClient)
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer correct-token' },
    })
    const res = await handlers.pin(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 1, code: 'ABCD' })
  })
})
