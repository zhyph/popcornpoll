// server/ws/server.ts
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type Database from 'better-sqlite3'
import type { AppConfig } from '../config'
import { recomputeExhaustion, type SyncWaiter } from '../room/activeActions'
import type { RoomStore } from '../room/roomStore'
import type { TmdbClient } from '../tmdb/client'
import { handleMessage, stateUpdate, topCandidatesFor, type ConnectionState } from './router'
import { WS_CLOSE_TERMINAL, type ServerMessage } from './protocol'
import { isClientMessage } from './validateMessage'
import { createDefaultRateLimitBucket, getClientIp } from '../rateLimit'

export const HEARTBEAT_INTERVAL_MS = 15_000
export const HEARTBEAT_TIMEOUT_MS = 45_000
export const RECONNECT_GRACE_MS = 2 * 60_000
export const WS_MAX_PAYLOAD_BYTES = 16 * 1024
export const MAX_FAILED_JOINS = 5

interface SocketMeta {
  state: ConnectionState
  lastHeartbeatAt: number
  failedJoins: number
}

export interface WsServerHandle {
  wss: WebSocketServer
  broadcastToRoom(roomCode: string, messages: ServerMessage[]): void
  broadcastRoomEnded(roomCode: string, reason: string): void
  terminateAllSockets(): void
  stopHeartbeatSweep(): void
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

export interface WsServerOptions {
  // Called for upgrade requests this server doesn't own (i.e. anything but
  // /ws). Only Next.js's dev HMR endpoint needs this — see the upgrade
  // listener below for why it exists at all.
  handleForeignUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
}

export function attachWebSocketServer(
  httpServer: Server,
  store: RoomStore,
  db: Database.Database,
  tmdb: TmdbClient,
  librarySync: SyncWaiter,
  config: AppConfig,
  options: WsServerOptions = {},
): WsServerHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES })
  const sockets = new Map<WebSocket, SocketMeta>()
  const upgradeBucket = createDefaultRateLimitBucket()

  function broadcastToRoom(roomCode: string, messages: ServerMessage[]): void {
    for (const [otherWs, otherMeta] of sockets) {
      if (otherMeta.state.roomCode !== roomCode) continue
      for (const m of messages) send(otherWs, m)
    }
  }

  function closeRoomSockets(roomCode: string, code: number, reason: string): void {
    for (const [otherWs, otherMeta] of sockets) {
      if (otherMeta.state.roomCode !== roomCode) continue
      otherWs.close(code, reason)
    }
  }

  function terminateAllSockets(): void {
    for (const otherWs of sockets.keys()) otherWs.terminate()
    sockets.clear()
  }

  function broadcastRoomEnded(roomCode: string, reason: string): void {
    const room = store.get(roomCode)
    if (!room) return
    if (room.status !== 'ended') {
      room.status = 'ended'
      room.endedAt = Date.now()
    }
    const update = stateUpdate(room)
    broadcastToRoom(roomCode, [update, { type: 'room_ended', reason, seq: update.seq }])
    closeRoomSockets(roomCode, WS_CLOSE_TERMINAL, reason)
  }

  function finalizeDisconnect(roomCode: string, participantId: string): void {
    const room = store.get(roomCode)
    if (!room) return
    const participant = room.participants.get(participantId)
    if (!participant || participant.connectionStatus !== 'disconnected') return

    if (room.status === 'lobby') {
      // joinRoom rejects new joins once the room leaves 'lobby', so this is
      // the only place a lobby-phase disconnect ever gets cleaned up. Without
      // this, ordinary pre-Start join/leave churn (someone joins, closes
      // their tab, never comes back) permanently occupies a seat in
      // room.participants forever, and MAX_PARTICIPANTS_PER_ROOM's raw
      // Map.size check eventually rejects everyone even though nobody is
      // actually still there. The host is exempt — their lobby-disconnect
      // timeout is handled by finalizeHostDisconnect, which ends the room
      // instead and needs the participant record to still exist when its own
      // timer (scheduled alongside this one) fires.
      if (room.hostParticipantId !== participantId) {
        room.participants.delete(participantId)
        room.lastActivityAt = Date.now()
        broadcastToRoom(roomCode, [stateUpdate(room)])
      }
      return
    }

    if (room.status !== 'active') return
    const exhaustedNow = recomputeExhaustion(room)
    const toRoom: ServerMessage[] = [stateUpdate(room)]
    if (exhaustedNow && room.matches.length === 0) {
      toRoom.push({ type: 'exhausted', topCandidates: topCandidatesFor(room) })
    }
    broadcastToRoom(roomCode, toRoom)
  }

  function finalizeHostDisconnect(roomCode: string, participantId: string, disconnectedAt: number): void {
    const room = store.get(roomCode)
    if (!room || room.status === 'ended') return
    if (room.hostParticipantId !== participantId) return
    const participant = room.participants.get(participantId)
    if (!participant || participant.connectionStatus !== 'disconnected') return
    if (participant.disconnectedAt !== disconnectedAt) return // stale timer from an earlier disconnect — a later disconnect (and its own timer) supersedes this one
    broadcastRoomEnded(roomCode, 'host_disconnected_timeout')
  }

  function markDisconnected(state: ConnectionState): void {
    if (!state.roomCode || !state.participantId) return
    const roomCode = state.roomCode
    const participantId = state.participantId
    const room = store.get(roomCode)
    const participant = room?.participants.get(participantId)
    if (!room || !participant || participant.connectionStatus === 'disconnected') return
    participant.connectionStatus = 'disconnected'
    const disconnectedAt = Date.now()
    participant.disconnectedAt = disconnectedAt
    const isHost = room.hostParticipantId === participantId
    const toRoom: ServerMessage[] = [stateUpdate(room)]
    if (isHost) toRoom.push({ type: 'host_disconnected' })
    broadcastToRoom(roomCode, toRoom)
    setTimeout(() => finalizeDisconnect(roomCode, participantId), RECONNECT_GRACE_MS).unref()
    if (isHost) {
      // Capture disconnectedAt as a local value now, not a lazy
      // `participant.disconnectedAt` read inside the closure — `participant`
      // is the same mutable object across reconnect/disconnect cycles, so a
      // property read deferred to fire-time would always see whatever the
      // *current* value is (defeating the staleness check in
      // finalizeHostDisconnect, which compares against that same live
      // object). This local const freezes the value this specific
      // disconnect actually happened at.
      setTimeout(() => finalizeHostDisconnect(roomCode, participantId, disconnectedAt), RECONNECT_GRACE_MS).unref()
    }
  }

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      // This is the only 'upgrade' listener on the server, so destroying
      // everything else here also killed Next.js's dev HMR socket
      // (/_next/hmr, see node_modules/next/dist/server/lib/router-server.js).
      // Turbopack's client treats that socket as part of its bootstrap: with
      // it closed mid-handshake the dev client never runs, nothing hydrates,
      // and every button on every page is inert — with no error beyond the
      // WebSocket failure itself. Hand those requests to Next instead when a
      // delegate is supplied (dev only; `next start`'s handleUpgrade is a
      // no-op that would leak the socket open, so production still destroys).
      const foreign = options.handleForeignUpgrade
      if (foreign && req.url?.startsWith('/_next/')) foreign(req, socket, head)
      else socket.destroy()
      return
    }
    if (config.appOrigin && req.headers.origin !== config.appOrigin) {
      socket.destroy()
      return
    }
    const forwardedFor = req.headers['x-forwarded-for']
    const clientIp = getClientIp(
      typeof forwardedFor === 'string' ? forwardedFor : null,
      req.socket.remoteAddress,
      config.trustedProxyHops,
    )
    if (!upgradeBucket.tryConsume(clientIp)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    const meta: SocketMeta = {
      state: { roomCode: null, participantId: null, isHost: false },
      lastHeartbeatAt: Date.now(),
      failedJoins: 0,
    }
    sockets.set(ws, meta)

    ws.on('message', async (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        send(ws, { type: 'error', code: 'bad_token', message: 'malformed message' })
        return
      }
      // parsed is `unknown` here on purpose — JSON.parse only proves it's
      // valid JSON, not that it matches ClientMessage. isClientMessage is
      // the actual runtime boundary check; a bare `as ClientMessage` cast
      // would let a client send any shape (e.g. a swipe with movieId: null,
      // or an unrecognized type) straight into the router, which trusts
      // every field as typed.
      if (!isClientMessage(parsed)) {
        send(ws, { type: 'error', code: 'bad_token', message: 'malformed message' })
        return
      }
      const message = parsed

      if (message.type === 'heartbeat') meta.lastHeartbeatAt = Date.now()

      let result: Awaited<ReturnType<typeof handleMessage>>
      try {
        result = await handleMessage(store, db, tmdb, librarySync, meta.state, message, (messages) => {
          if (meta.state.roomCode) broadcastToRoom(meta.state.roomCode, messages)
        })
      } catch (err) {
        // A thrown/rejected error anywhere inside handleMessage (e.g. a
        // database error reached through startRoom) is otherwise an
        // unhandled rejection in this async listener, which crashes the
        // whole single-replica process over one bad message. Catch, log,
        // tell the client, and keep this connection and the process alive.
        console.error('unhandled error in handleMessage', err)
        send(ws, { type: 'error', code: 'internal_error', message: 'internal error' })
        return
      }
      meta.state = result.newState
      for (const m of result.toSender) send(ws, m)

      if (message.type === 'join' && result.toSender.some((m) => m.type === 'error')) {
        meta.failedJoins++
        if (meta.failedJoins >= MAX_FAILED_JOINS) {
          ws.close()
          return
        }
      }

      if (result.toRoom.length > 0 && meta.state.roomCode) {
        const room = store.get(meta.state.roomCode)
        if (room) broadcastToRoom(meta.state.roomCode, result.toRoom)
      }

      for (const target of result.toParticipant) {
        for (const [otherWs, otherMeta] of sockets) {
          if (otherMeta.state.participantId === target.participantId) {
            for (const m of target.messages) send(otherWs, m)
            if (target.messages.some((m) => m.type === 'kicked')) otherWs.close(WS_CLOSE_TERMINAL, 'kicked')
          }
        }
      }

      if (result.closeSender) ws.close()
    })

    ws.on('close', () => {
      const closedMeta = sockets.get(ws)
      sockets.delete(ws)
      if (closedMeta) markDisconnected(closedMeta.state)
    })
  })

  const heartbeatTimer = setInterval(() => {
    const now = Date.now()
    for (const [ws, meta] of sockets) {
      if (now - meta.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        markDisconnected(meta.state)
        ws.terminate()
        sockets.delete(ws)
      }
    }
  }, HEARTBEAT_INTERVAL_MS)

  return {
    wss,
    broadcastToRoom,
    broadcastRoomEnded,
    terminateAllSockets,
    stopHeartbeatSweep: () => clearInterval(heartbeatTimer),
  }
}
