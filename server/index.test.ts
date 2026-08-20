// server/index.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createApp } from './index'
import { openDb } from './db'
import { savePlexLink } from './plex/link'
import type { AppConfig } from './config'

let dir: string
let app: Awaited<ReturnType<typeof createApp>>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-app-'))
  const config: AppConfig = {
    tmdbApiKey: 'x',
    authEncryptionKey: 'a'.repeat(32),
    adminSetupToken: 'admin',
    appOrigin: '',
    trustedProxyHops: 0,
    port: 0,
    dataDir: dir,
  }
  app = await createApp(config, { skipFrontend: true })
})

afterEach(async () => {
  await app.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe('createApp', () => {
  it('serves /api/health over plain HTTP', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/health`)
    expect(res.status).toBe(200)
  })

  it('serves POST /api/rooms', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      body: JSON.stringify({ candidateSource: 'plex', matchThreshold: { kind: 'all' } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toBeDefined()
  })

  it('rejects an over-cap request body with 413 instead of buffering it', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    // Sent to /api/health specifically: it needs no auth, no origin, and no
    // rate-limit token, which is exactly why the cap has to bite in the data
    // handler rather than anywhere downstream of routing.
    const res = await fetch(`http://localhost:${port}/api/health`, {
      method: 'POST',
      body: 'x'.repeat(512 * 1024),
    })
    expect(res.status).toBe(413)
  })

  it('still accepts a body under the cap', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      body: JSON.stringify({ candidateSource: 'plex', matchThreshold: { kind: 'all' } }),
    })
    expect(res.status).toBe(200)
  })

  it('sets the shared security headers on /api responses', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/health`)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('rejects /api/setup/plex/pin without the admin token', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/setup/plex/pin`)
    expect(res.status).toBe(401)
  })

  it('survives a malformed-JSON POST to /api/setup/plex/callback without crashing', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/setup/plex/callback`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin' },
      body: '{not valid json',
    })
    expect(res.status).toBe(500)

    // The server process must still be alive and serving other requests.
    const healthRes = await fetch(`http://localhost:${port}/api/health`)
    expect(healthRes.status).toBe(200)
  })

  it('boots successfully when the stored Plex link cannot be decrypted (AUTH_ENCRYPTION_KEY rotated)', async () => {
    const rotDir = mkdtempSync(join(tmpdir(), 'popcornpoll-rotate-'))
    const seedDb = openDb(rotDir)
    savePlexLink(seedDb, 'b'.repeat(32), {
      clientIdentifier: 'old-client',
      serverUrl: 'http://old-plex.local',
      authToken: 'old-token',
      librarySectionIds: ['1'],
      linkedAt: new Date().toISOString(),
    })
    seedDb.close()

    const rotatedConfig: AppConfig = {
      tmdbApiKey: 'x',
      authEncryptionKey: 'c'.repeat(32), // different key than the one the link above was encrypted with
      adminSetupToken: 'admin',
      appOrigin: '',
      trustedProxyHops: 0,
      port: 0,
      dataDir: rotDir,
    }
    const rotatedApp = await createApp(rotatedConfig, { skipFrontend: true })
    try {
      await new Promise<void>((resolve) => rotatedApp.httpServer.listen(0, resolve))
      const port = (rotatedApp.httpServer.address() as { port: number }).port
      const res = await fetch(`http://localhost:${port}/api/health`)
      expect(res.status).toBe(200)
    } finally {
      await rotatedApp.shutdown()
      rmSync(rotDir, { recursive: true, force: true })
    }
  })
})

describe('shutdown', () => {
  it('resolves promptly even while a WebSocket connection is still open', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    await new Promise<void>((resolve) => ws.once('open', () => resolve()))

    const start = Date.now()
    await app.shutdown()
    expect(Date.now() - start).toBeLessThan(5000)
  })
})
