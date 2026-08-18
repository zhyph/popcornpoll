// server/ws/server.ts
import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type Database from 'better-sqlite3'
import type { AppConfig } from '../config'
import { recomputeExhaustion, type SyncWaiter } from '../room/activeActions'
import type { RoomStore } from '../room/roomStore'
import type { TmdbClient } from '../tmdb/client'
import { handleMessage, stateUpdate, topCandidatesFor, type ConnectionState } from './router'
import { WS_CLOSE_TERMINAL, type ClientMessage, type ServerMessage } from './protocol'
import { createTokenBucket, getClientIp } from '../rateLimit'

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

export function attachWebSocketServer(
  httpServer: Server,
  store: RoomStore,
  db: Database.Database,
  tmdb: TmdbClient,
  librarySync: SyncWaiter,
  config: AppConfig,
): WsServerHandle {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES })
  const sockets = new Map<WebSocket, SocketMeta>()
  const upgradeBucket = createTokenBucket(10, 10 / 60)

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
    if (!room || room.status !== 'active') return
    const participant = room.participants.get(participantId)
    if (!participant || participant.connectionStatus !== 'disconnected') return
    const exhaustedNow = recomputeExhaustion(room)
    const toRoom: ServerMessage[] = [stateUpdate(room)]
    if (exhaustedNow && room.matches.length === 0) {
      toRoom.push({ type: 'exhausted', topCandidates: topCandidatesFor(room) })
    }
    broadcastToRoom(roomCode, toRoom)
  }

  function markDisconnected(state: ConnectionState): void {
    if (!state.roomCode || !state.participantId) return
    const roomCode = state.roomCode
    const participantId = state.participantId
    const room = store.get(roomCode)
    const participant = room?.participants.get(participantId)
    if (!room || !participant || participant.connectionStatus === 'disconnected') return
    participant.connectionStatus = 'disconnected'
    participant.disconnectedAt = Date.now()
    broadcastToRoom(roomCode, [stateUpdate(room)])
    setTimeout(() => finalizeDisconnect(roomCode, participantId), RECONNECT_GRACE_MS).unref()
  }

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy()
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
      let message: ClientMessage
      try {
        message = JSON.parse(raw.toString())
      } catch {
        send(ws, { type: 'error', code: 'bad_token', message: 'malformed message' })
        return
      }

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
