import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { DecryptionError, clearPlexLink, getPlexLink, savePlexLink } from './link'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-link-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const sampleLink = {
  clientIdentifier: 'client-abc',
  serverUrl: 'http://192.168.1.10:32400',
  authToken: 'plex-secret-token',
  librarySectionIds: ['1', '2'],
  linkedAt: '2026-08-17T00:00:00.000Z',
}

describe('savePlexLink / getPlexLink', () => {
  it('round-trips the link, decrypting the token back to the original value', () => {
    savePlexLink(db, KEY, sampleLink)
    const loaded = getPlexLink(db, KEY)
    expect(loaded).toEqual(sampleLink)
  })

  it('stores the token encrypted, not in plaintext, in the raw column', () => {
    savePlexLink(db, KEY, sampleLink)
    const raw = db.prepare('SELECT auth_token FROM plex_link WHERE id = 1').get() as {
      auth_token: string
    }
    expect(raw.auth_token).not.toContain('plex-secret-token')
  })

  it('re-saving overwrites the single row (CHECK id=1 invariant)', () => {
    savePlexLink(db, KEY, sampleLink)
    savePlexLink(db, KEY, { ...sampleLink, serverUrl: 'http://10.0.0.5:32400' })
    const count = db.prepare('SELECT COUNT(*) as c FROM plex_link').get() as { c: number }
    expect(count.c).toBe(1)
    expect(getPlexLink(db, KEY)?.serverUrl).toBe('http://10.0.0.5:32400')
  })

  it('returns null when no link has been saved', () => {
    expect(getPlexLink(db, KEY)).toBeNull()
  })

  it('throws DecryptionError when read with the wrong key', () => {
    savePlexLink(db, KEY, sampleLink)
    expect(() => getPlexLink(db, 'b'.repeat(32))).toThrow(DecryptionError)
  })
})

describe('clearPlexLink', () => {
  it('removes the row', () => {
    savePlexLink(db, KEY, sampleLink)
    clearPlexLink(db)
    expect(getPlexLink(db, KEY)).toBeNull()
  })
})
