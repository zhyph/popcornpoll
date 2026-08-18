import { describe, expect, it } from 'vitest'
import type { AppConfig } from '../config'
import { createRoomStore, MAX_CONCURRENT_ROOMS } from '../room/roomStore'
import { createRoomsHandler } from './rooms'

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

describe('createRoomsHandler', () => {
  it('creates a room and returns roomCode + hostClaimToken', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key', config)
    const res = await handler(createRoomRequest(validBody), '127.0.0.1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)
    expect(typeof body.hostClaimToken).toBe('string')
  })

  it('rejects a malformed body with a 400 and an error code', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key', config)
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
    const handler = createRoomsHandler(store, {} as never, 'key', config)
    const res = await handler(createRoomRequest(validBody, 'http://evil.example'), '127.0.0.1')
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('forbidden_origin')
  })

  it('does not enforce Origin when APP_ORIGIN is empty (test-mode escape hatch, matches ws/server.ts)', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key', { ...config, appOrigin: '' })
    const res = await handler(createRoomRequest(validBody, 'http://anything.example'), '127.0.0.1')
    expect(res.status).toBe(200)
  })

  it('rate-limits room creation past 10 requests/minute from one client IP', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key', config)
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
    const handler = createRoomsHandler(store, {} as never, 'key', config)
    for (let i = 0; i < 10; i++) await handler(createRoomRequest(validBody), '203.0.113.10')
    const res = await handler(createRoomRequest(validBody), '203.0.113.11')
    expect(res.status).toBe(200)
  })

  it('rejects room creation once MAX_CONCURRENT_ROOMS is reached', async () => {
    const store = createRoomStore()
    for (let i = 0; i < MAX_CONCURRENT_ROOMS; i++) store.create({ kind: 'all' }, 'plex', {})
    const handler = createRoomsHandler(store, {} as never, 'key', config)
    const res = await handler(createRoomRequest(validBody), '198.51.100.1')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.code).toBe('room_cap_reached')
  })
})
