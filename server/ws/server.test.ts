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
import { attachWebSocketServer, MAX_FAILED_JOINS, RECONNECT_GRACE_MS } from './server'
import { WS_CLOSE_TERMINAL } from './protocol'
import type { Server } from 'node:http'
import type Database from 'better-sqlite3'
import type { SyncWaiter } from '../room/activeActions'
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
const noOpLibrarySync: SyncWaiter = { async waitForCurrent() {} }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-wsserver-'))
  db = openDb(dir)
  const store = createRoomStore()
  httpServer = createServer()
  attachWebSocketServer(httpServer, store, db, noOpTmdb, noOpLibrarySync, {
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

// A single 'start' round-trip can now emit several messages to the same
// socket (a transitional "starting" state_update from notifyStarting, then
// room_started + the "active" state_update, then next_card) with no real
// async gap between them when the pool build has no actual I/O to await
// (e.g. a 'plex'-only room) — they arrive back-to-back on the same
// underlying TCP read, and 'ws' parses/emits all of them synchronously in
// one burst. A sequence of `await nextMessage(ws)` calls loses every message
// after the first in that burst, because each call only attaches its
// listener after the previous one already resolved — by which point the
// rest of the burst has already been emitted with nobody listening. Collect
// with one persistent listener instead so every message in the burst is
// captured regardless of arrival timing.
function collectMessages(ws: WebSocket, count: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const messages: Record<string, unknown>[] = []
    function onMessage(raw: Buffer) {
      messages.push(JSON.parse(raw.toString()))
      if (messages.length >= count) {
        ws.off('message', onMessage)
        resolve(messages)
      }
    }
    ws.on('message', onMessage)
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

  it('a participant who joined with a non-canonical-case room code still receives room broadcasts', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(db, 5) // MIN_POOL_SIZE

    const hostWs = await connect()
    const guestWs = await connect()
    try {
      hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
      await nextMessage(hostWs) // joined

      // Manually-typed lowercase URL — the store is case-insensitive so the
      // join itself succeeds, but the connection's stored roomCode must
      // still end up canonical or this socket is excluded from every
      // subsequent broadcast to its own room. (Note: the guest's own join
      // also broadcasts a state_update to the room using the *guest's own*
      // just-set connection state as the filter key — against the bug, that
      // broadcast itself never reaches the host either, since it'd be keyed
      // by the guest's non-canonical code. Race with a timeout rather than
      // await it directly so a hang here doesn't take down the whole test.)
      guestWs.send(JSON.stringify({ type: 'join', roomCode: code.toLowerCase(), displayName: 'Guest' }))
      await nextMessage(guestWs) // joined
      await Promise.race([nextMessage(hostWs), new Promise((resolve) => setTimeout(resolve, 500))])

      // Trigger a broadcast keyed by the HOST's connection state, which is
      // always canonical — isolating the assertion to whether the GUEST's
      // socket (the potentially-mis-cased one) receives it.
      hostWs.send(JSON.stringify({ type: 'start' }))
      const guestNext = await Promise.race([
        nextMessage(guestWs),
        new Promise<Record<string, unknown>>((resolve) =>
          setTimeout(() => resolve({ type: 'TIMED_OUT_WAITING_FOR_BROADCAST' }), 1000),
        ),
      ])

      expect(guestNext.type === 'room_started' || guestNext.type === 'state_update').toBe(true)
    } finally {
      hostWs.close()
      guestWs.close()
    }
  })

  it('broadcasts a state_update immediately on disconnect, and only recomputes exhaustion after the reconnect grace period', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(db, 5)

    const hostWs = await connect()
    hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
    const hostJoined = await nextMessage(hostWs)

    const guestWs = await connect()
    guestWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
    await nextMessage(guestWs) // joined
    await nextMessage(hostWs) // state_update for the guest's join

    hostWs.send(JSON.stringify({ type: 'start' }))
    // starting state_update (notifyStarting), room_started, active state_update, next_card
    await collectMessages(hostWs, 4)
    await collectMessages(guestWs, 4)

    const room = store.get(code)!
    room.participants.get(hostJoined.participantId as string)!.finished = true // only the guest is blocking

    // Node's socket I/O runs on libuv's real event loop, not on setTimeout —
    // so real network traffic keeps working under fake timers, letting us
    // fast-forward the internal grace-period setTimeout without a real wait.
    vi.useFakeTimers()
    try {
      const immediateUpdate = nextMessage(hostWs)
      guestWs.close()
      await vi.advanceTimersByTimeAsync(0)
      const immediate = await immediateUpdate
      expect(immediate.type).toBe('state_update')
      expect(room.exhausted).toBe(false) // grace period — not finalized yet

      const finalizedUpdate = nextMessage(hostWs)
      await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS)
      const finalized = await finalizedUpdate
      expect(finalized.type).toBe('state_update')
      expect(room.exhausted).toBe(true)
    } finally {
      vi.useRealTimers()
    }

    hostWs.close()
  })

  it("closes a kicked participant's socket with the terminal close code", async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})

    const hostWs = await connect()
    hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
    await nextMessage(hostWs)

    const guestWs = await connect()
    guestWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
    const guestJoined = await nextMessage(guestWs)
    await nextMessage(hostWs) // state_update for the guest's join

    const closeEvent = new Promise<number>((resolve) => guestWs.once('close', (closeCode) => resolve(closeCode)))
    hostWs.send(JSON.stringify({ type: 'kick', participantId: guestJoined.participantId }))
    await nextMessage(guestWs) // kicked
    expect(await closeEvent).toBe(WS_CLOSE_TERMINAL)

    hostWs.close()
  })
})

describe('attachWebSocketServer: handleMessage failures do not crash the process', () => {
  let crashDir: string
  let crashDb: Database.Database
  let crashServer: Server
  let crashPort: number

  beforeEach(async () => {
    crashDir = mkdtempSync(join(tmpdir(), 'popcornpoll-wscrash-'))
    crashDb = openDb(crashDir)
    const store = createRoomStore()
    crashServer = createServer()
    attachWebSocketServer(crashServer, store, crashDb, noOpTmdb, noOpLibrarySync, { ...config, appOrigin: '' })
    await new Promise<void>((resolve) => crashServer.listen(0, resolve))
    crashPort = (crashServer.address() as AddressInfo).port
    ;(globalThis as { __crashStore?: ReturnType<typeof createRoomStore> }).__crashStore = store
  })

  afterEach(async () => {
    rmSync(crashDir, { recursive: true, force: true })
    await new Promise<void>((resolve) => crashServer.close(() => resolve()))
    // crashDb is deliberately closed inside the test itself, not here.
  })

  it('sends an error message and keeps the connection alive when handleMessage throws synchronously', async () => {
    const store = (globalThis as { __crashStore?: ReturnType<typeof createRoomStore> }).__crashStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const ws = new WebSocket(`ws://localhost:${crashPort}/ws`)
    await new Promise<void>((resolve) => ws.once('open', () => resolve()))
    ws.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
    await new Promise<void>((resolve) => ws.once('message', () => resolve())) // joined

    const guest = new WebSocket(`ws://localhost:${crashPort}/ws`)
    await new Promise<void>((resolve) => guest.once('open', () => resolve()))
    guest.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
    // Guest's join broadcasts a state_update to the whole room, including the
    // host — drain that on ws (host) concurrently with guest's own reply so
    // it can't race with (and get mistaken for) the 'start' reply awaited below.
    await Promise.all([
      new Promise<void>((resolve) => guest.once('message', () => resolve())),
      new Promise<void>((resolve) => ws.once('message', () => resolve())),
    ])

    crashDb.close() // simulates a database failure mid-request

    ws.send(JSON.stringify({ type: 'start' }))
    // The room synchronously flips to 'starting' (and broadcasts that, via
    // notifyStarting) before the async pool build even runs — which is where
    // the closed-DB failure actually occurs. startRoom's own catch then
    // reverts the room to 'lobby' (broadcasting that too, via the same
    // notifyStarting callback) before rethrowing, so the sender sees a
    // transitional state_update, a revert-to-lobby state_update, and finally
    // the error surfaced by the crash-hardening catch — proving the room
    // isn't left wedged in 'starting'. All three arrive in the same burst (no
    // real async gap for a 'plex'-only pool build), so collect rather than
    // await them one at a time.
    const [started, reverted, reply] = await collectMessages(ws, 3)
    expect(started?.type).toBe('state_update')
    expect(started?.status).toBe('starting')
    expect(reverted?.type).toBe('state_update')
    expect(reverted?.status).toBe('lobby')
    expect(reply?.type).toBe('error')
    expect(reply?.code).toBe('internal_error')

    // The connection (and process) must still be alive and responsive afterward.
    ws.send(JSON.stringify({ type: 'heartbeat' }))
    const heartbeatReply = await new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (raw) => resolve(JSON.parse(raw.toString())))
    })
    expect(heartbeatReply.type).toBe('heartbeat_ack')

    ws.close()
    guest.close()
  })
})
