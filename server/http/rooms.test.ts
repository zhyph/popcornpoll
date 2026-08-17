import { describe, expect, it } from 'vitest'
import { createRoomStore } from '../room/roomStore'
import { createRoomsHandler } from './rooms'

describe('createRoomsHandler', () => {
  it('creates a room and returns roomCode + hostClaimToken', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key')
    const req = new Request('http://localhost/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ candidateSource: 'plex', matchThreshold: { kind: 'all' } }),
    })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)
    expect(typeof body.hostClaimToken).toBe('string')
  })

  it('rejects a malformed body with a 400 and an error code', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key')
    const req = new Request('http://localhost/api/rooms', { method: 'POST', body: 'not json' })
    const res = await handler(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_threshold')
  })
})
