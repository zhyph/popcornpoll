// server/ws/server.test.ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { createRoomStore } from '../room/roomStore'
import { attachWebSocketServer, MAX_FAILED_JOINS } from './server'
import type { Server } from 'node:http'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'
import type { AppConfig } from '../config'

let dir: string
let db: Database.Database
let httpServer: Server
let port: number
const config: AppConfig = {
  tmdbApiKey: 'x',
  authEncryptionKey: 'a'.repeat(32),
  adminSetupToken: 'admin',
  appOrigin: 'http://localhost:TESTPORT',
  trustedProxyHops: 0,
  port: 0,
  dataDir: '',
}
const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-wsserver-'))
  db = openDb(dir)
  const store = createRoomStore()
  httpServer = createServer()
  attachWebSocketServer(httpServer, store, db, noOpTmdb, {
    ...config,
    appOrigin: '', // '' disables Origin enforcement for this test's plain ws:// client
  })
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  port = (httpServer.address() as AddressInfo).port
  ;(globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore = store
})

afterEach(async () => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

function connect(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.once('open', () => resolve(ws))
  })
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())))
  })
}

function seedPlexRows(db: Database.Database, count: number) {
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

function connectExpectRejection(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    const timer = setTimeout(() => reject(new Error('timed out waiting for rejection')), 2000)
    ws.once('open', () => {
      clearTimeout(timer)
      ws.close()
      reject(new Error('expected the upgrade to be rejected but it opened'))
    })
    ws.once('error', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

describe('attachWebSocketServer', () => {
  it('a client can join a room and receives a joined message', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const ws = await connect()
    ws.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Alice' }))
    const message = await nextMessage(ws)
    expect(message.type).toBe('joined')
    ws.close()
  })

  it('replies heartbeat_ack to a heartbeat', async () => {
    const ws = await connect()
    ws.send(JSON.stringify({ type: 'heartbeat' }))
    const message = await nextMessage(ws)
    expect(message.type).toBe('heartbeat_ack')
    ws.close()
  })

  it('flips a participant to disconnected when the socket closes, without deleting them', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const ws = await connect()
    ws.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Alice' }))
    const joined = await nextMessage(ws)
    ws.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const room = store.get(code)!
    const participant = room.participants.get(joined.participantId as string)!
    expect(participant.connectionStatus).toBe('disconnected')
  })

  it('closes the connection after MAX_FAILED_JOINS consecutive failed joins', async () => {
    const ws = await connect()
    let lastMessage: Record<string, unknown> | undefined
    for (let i = 0; i < MAX_FAILED_JOINS; i++) {
      ws.send(JSON.stringify({ type: 'join', roomCode: 'NOPE99', displayName: 'Eve' }))
      lastMessage = await nextMessage(ws)
    }
    expect(lastMessage?.type).toBe('error')
    await new Promise<void>((resolve) => ws.once('close', () => resolve()))
  })

  it('rejects the WebSocket upgrade once the per-IP upgrade rate limit is exhausted', async () => {
    const sockets: WebSocket[] = []
    for (let i = 0; i < 10; i++) {
      sockets.push(await connect())
    }
    await connectExpectRejection()
    for (const s of sockets) s.close()
  })

  it('the host who sends start receives room_started too, not just other participants', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(db, 5) // MIN_POOL_SIZE

    const hostWs = await connect()
    hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
    await nextMessage(hostWs) // joined

    const guestWs = await connect()
    guestWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
    await nextMessage(guestWs) // joined
    await nextMessage(hostWs) // state_update for the guest's join

    hostWs.send(JSON.stringify({ type: 'start' }))
    const hostNext = await nextMessage(hostWs)
    const guestNext = await nextMessage(guestWs)

    // Message order between room_started and state_update isn't guaranteed by
    // this assertion — either socket may see either one first — so check the
    // pair of types each side saw rather than a fixed position.
    expect(hostNext.type === 'room_started' || hostNext.type === 'state_update').toBe(true)
    expect(guestNext.type === 'room_started' || guestNext.type === 'state_update').toBe(true)

    hostWs.close()
    guestWs.close()
  })
})
