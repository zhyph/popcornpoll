// server/ws/server.ts
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type Database from 'better-sqlite3'
import type { AppConfig } from '../config'
import type { RoomStore } from '../room/roomStore'
import type { TmdbClient } from '../tmdb/client'
import { handleMessage, type ConnectionState } from './router'
import type { ClientMessage, ServerMessage } from './protocol'
import { createTokenBucket } from '../rateLimit'

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

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

function getClientIp(req: IncomingMessage, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') {
      const ips = forwarded.split(',').map((ip) => ip.trim())
      const index = ips.length - trustedProxyHops
      const candidate = index >= 0 ? ips[index] : undefined
      if (candidate) return candidate
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function attachWebSocketServer(
  httpServer: Server,
  store: RoomStore,
  db: Database.Database,
  tmdb: TmdbClient,
  config: AppConfig,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES })
  const sockets = new Map<WebSocket, SocketMeta>()
  const upgradeBucket = createTokenBucket(10, 10 / 60)

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy()
      return
    }
    if (config.appOrigin && req.headers.origin !== config.appOrigin) {
      socket.destroy()
      return
    }
    const clientIp = getClientIp(req, config.trustedProxyHops)
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

      const result = await handleMessage(store, db, tmdb, meta.state, message)
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
        if (room) {
          for (const [otherWs, otherMeta] of sockets) {
            if (otherMeta.state.roomCode !== meta.state.roomCode) continue
            if (otherWs === ws) continue
            for (const m of result.toRoom) send(otherWs, m)
          }
        }
      }

      for (const target of result.toParticipant) {
        for (const [otherWs, otherMeta] of sockets) {
          if (otherMeta.state.participantId === target.participantId) {
            for (const m of target.messages) send(otherWs, m)
            if (target.messages.some((m) => m.type === 'kicked')) otherWs.close()
          }
        }
      }

      if (result.closeSender) ws.close()
    })

    ws.on('close', () => {
      const closedMeta = sockets.get(ws)
      sockets.delete(ws)
      if (closedMeta?.state.roomCode && closedMeta.state.participantId) {
        const room = store.get(closedMeta.state.roomCode)
        const participant = room?.participants.get(closedMeta.state.participantId)
        if (participant) participant.connectionStatus = 'disconnected'
      }
    })
  })

  setInterval(() => {
    const now = Date.now()
    for (const [ws, meta] of sockets) {
      if (now - meta.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        if (meta.state.roomCode && meta.state.participantId) {
          const room = store.get(meta.state.roomCode)
          const participant = room?.participants.get(meta.state.participantId)
          if (participant) participant.connectionStatus = 'disconnected'
        }
        ws.terminate()
        sockets.delete(ws)
      }
    }
  }, HEARTBEAT_INTERVAL_MS)

  return wss
}
