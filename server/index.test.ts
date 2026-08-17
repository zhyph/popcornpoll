// server/index.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './index'
import type { AppConfig } from './config'

let dir: string
let app: ReturnType<typeof createApp>

beforeEach(() => {
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
  app = createApp(config)
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
})
