import { describe, expect, it } from 'vitest'
import { joinRoom } from './actions'
import {
  EVICTION_DELAY_MS,
  INACTIVITY_TIMEOUT_MS,
  endRoom,
  sweepEvictions,
  sweepInactiveRooms,
  touchActivity,
} from './lifecycle'
import { createRoomStore } from './roomStore'

describe('endRoom', () => {
  it('a non-host caller is rejected', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    expect(endRoom(store, code, false)).toEqual({ ok: false, code: 'not_host' })
  })

  it('sets status to ended and stamps endedAt', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const before = Date.now()
    endRoom(store, code, true)
    const room = store.get(code)!
    expect(room.status).toBe('ended')
    expect(room.endedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('sweepInactiveRooms', () => {
  it('ends a lobby room whose lastActivityAt is past the inactivity timeout', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const room = store.get(code)!
    room.lastActivityAt = Date.now() - INACTIVITY_TIMEOUT_MS - 1000

    const ended = sweepInactiveRooms(store, Date.now())
    expect(ended).toEqual([code])
    expect(room.status).toBe('ended')
  })

  it('does not end a room whose activity is within the timeout', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const ended = sweepInactiveRooms(store, Date.now())
    expect(ended).toEqual([])
  })

  it('does not re-end an already-ended room', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    endRoom(store, code, true)
    const ended = sweepInactiveRooms(store, Date.now() + INACTIVITY_TIMEOUT_MS * 2)
    expect(ended).toEqual([])
  })
})

describe('touchActivity', () => {
  it('advances lastActivityAt to the current time', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const room = store.get(code)!
    room.lastActivityAt = 0
    touchActivity(room)
    expect(room.lastActivityAt).toBeGreaterThan(0)
  })
})

describe('sweepEvictions', () => {
  it('deletes a room 10+ minutes after it ended', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    endRoom(store, code, true)
    const room = store.get(code)!
    room.endedAt = Date.now() - EVICTION_DELAY_MS - 1000

    const evicted = sweepEvictions(store, Date.now())
    expect(evicted).toEqual([code])
    expect(store.get(code)).toBeUndefined()
  })

  it('leaves a recently-ended room alone until the delay passes', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    endRoom(store, code, true)
    const evicted = sweepEvictions(store, Date.now())
    expect(evicted).toEqual([])
    expect(store.get(code)).toBeDefined()
  })

  it('ignores rooms that are not yet ended', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const evicted = sweepEvictions(store, Date.now() + EVICTION_DELAY_MS * 10)
    expect(evicted).toEqual([])
    expect(store.get(code)).toBeDefined()
  })
})
