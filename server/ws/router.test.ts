// server/ws/router.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { createRoomStore } from '../room/roomStore'
import { handleMessage } from './router'
import type Database from 'better-sqlite3'
import type { RoomStore } from '../room/roomStore'
import type { TmdbClient } from '../tmdb/client'
import type { ConnectionState } from './router'

let dir: string
let db: Database.Database
let store: RoomStore
const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-router-'))
  db = openDb(dir)
  store = createRoomStore()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function freshState(): ConnectionState {
  return { roomCode: null, participantId: null, isHost: false }
}

function seedPlexRows(count: number) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2020,
      genres: ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

describe('handleMessage: join', () => {
  it('a successful join returns a joined message on toSender and a state_update on toRoom', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const result = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Alice',
      hostClaimToken,
    })
    expect(result.toSender[0]!.type).toBe('joined')
    expect(result.toRoom[0]!.type).toBe('state_update')
    expect(result.newState.roomCode).toBe(code)
    expect(result.newState.isHost).toBe(true)
  })

  it('joining an unknown room returns an error and does not bind connection state', async () => {
    const result = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: 'NOPE-NOPE-000',
      displayName: 'Alice',
    })
    expect(result.toSender).toEqual([{ type: 'error', code: 'room_not_found', message: expect.any(String) }])
    expect(result.newState.roomCode).toBeNull()
  })
})

describe('handleMessage: start + room_started', () => {
  it('a successful start emits room_started to the whole room, accompanied by a same-seq state_update', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    let state = freshState()
    const joined = await handleMessage(store, db, noOpTmdb, state, {
      type: 'join',
      roomCode: code,
      displayName: 'Host',
      hostClaimToken,
    })
    state = joined.newState
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Other' })
    seedPlexRows(20)

    const result = await handleMessage(store, db, noOpTmdb, state, { type: 'start' })
    const started = result.toRoom.find((m) => m.type === 'room_started')
    const stateUpdate = result.toRoom.find((m) => m.type === 'state_update' && m.status === 'active')
    expect(started).toBeDefined()
    expect(stateUpdate).toBeDefined()
    if (started?.type === 'room_started' && stateUpdate?.type === 'state_update') {
      expect(started.seq).toBe(stateUpdate.seq)
    }

    const room = store.get(code)!
    const hostId = state.participantId!
    const otherId = Array.from(room.participants.keys()).find((id) => id !== hostId)!
    const hostCard = result.toParticipant.find((t) => t.participantId === hostId)
    const otherCard = result.toParticipant.find((t) => t.participantId === otherId)
    expect(hostCard?.messages).toEqual([{ type: 'next_card', movieId: room.participants.get(hostId)!.pendingCardId }])
    expect(otherCard?.messages).toEqual([{ type: 'next_card', movieId: room.participants.get(otherId)!.pendingCardId }])
  })

  it('emits a degraded_to_plex_only notice to the room when TMDB fails during start', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex+tmdb', {})
    let state = freshState()
    const joined = await handleMessage(store, db, noOpTmdb, state, {
      type: 'join',
      roomCode: code,
      displayName: 'Host',
      hostClaimToken,
    })
    state = joined.newState
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Other' })
    seedPlexRows(20)

    const failingTmdb: TmdbClient = {
      discoverMovies: vi.fn().mockRejectedValue(new Error('TMDB is down')),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
    }
    const result = await handleMessage(store, db, failingTmdb, state, { type: 'start' })
    const notice = result.toRoom.find((m) => m.type === 'notice')
    expect(notice).toEqual({
      type: 'notice',
      level: 'warning',
      code: 'degraded_to_plex_only',
      message: expect.any(String),
    })
  })

  it('a non-host start attempt returns not_host and does not change room status', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Host', hostClaimToken })
    const otherJoined = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Other',
    })
    const result = await handleMessage(store, db, noOpTmdb, otherJoined.newState, { type: 'start' })
    expect(result.toSender).toEqual([{ type: 'error', code: 'not_host', message: expect.any(String) }])
    expect(store.get(code)!.status).toBe('lobby')
  })
})

describe('handleMessage: swipe -> next_card', () => {
  it('a consumed swipe sends next_card only to the swiping participant, not the whole room', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const hostJoined = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Host',
      hostClaimToken,
    })
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Other' })
    seedPlexRows(20)
    const started = await handleMessage(store, db, noOpTmdb, hostJoined.newState, { type: 'start' })
    const hostState = started.newState
    const room = store.get(code)!
    const pending = room.participants.get(hostState.participantId!)!.pendingCardId!

    const result = await handleMessage(store, db, noOpTmdb, hostState, {
      type: 'swipe',
      movieId: pending,
      vote: 'yes',
    })
    expect(result.toSender.some((m) => m.type === 'next_card')).toBe(true)
    expect(result.toRoom.some((m) => m.type === 'next_card')).toBe(false)
  })
})

describe('handleMessage: reconnect', () => {
  it('reconnect with a valid sessionToken rebinds connection state', async () => {
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const joined = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Alice',
    })
    const sessionToken = (joined.toSender[0] as { type: 'joined'; sessionToken: string }).sessionToken
    const result = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'reconnect',
      roomCode: code,
      sessionToken,
    })
    expect(result.toSender[0]!.type).toBe('joined')
    expect(result.newState.participantId).toBe(joined.newState.participantId)
  })
})
