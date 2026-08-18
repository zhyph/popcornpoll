// lib/wsClient.ts
import { WS_CLOSE_TERMINAL } from '../server/ws/protocol'
import type { ClientMessage, ServerMessage } from '../server/ws/protocol'

export interface WsClient {
  send(message: ClientMessage): void
  on<T extends ServerMessage['type']>(
    type: T,
    handler: (msg: Extract<ServerMessage, { type: T }>) => void,
  ): () => void
  onOpen(handler: () => void): () => void
  close(): void
}

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

export function createWsClient(url: string): WsClient {
  let socket: WebSocket
  let backoff = INITIAL_BACKOFF_MS
  let closedByCaller = false
  const handlers = new Map<string, Set<(msg: ServerMessage) => void>>()
  const openHandlers = new Set<() => void>()
  const queue: ClientMessage[] = []

  function dispatch(message: ServerMessage) {
    const set = handlers.get(message.type)
    if (!set) return
    for (const handler of [...set]) handler(message)
  }

  function connect() {
    socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      backoff = INITIAL_BACKOFF_MS
      // Notify onOpen subscribers (typically: "(re)send join/reconnect")
      // before flushing anything queued while offline, so re-establishing
      // identity goes out first on this fresh socket.
      for (const handler of [...openHandlers]) handler()
      const pending = queue.splice(0, queue.length)
      for (const msg of pending) socket.send(JSON.stringify(msg))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      dispatch(message)
    })
    socket.addEventListener('close', (event) => {
      // A terminal close (kicked, or the room itself ending) is a deliberate
      // server-side decision, not a transient network drop — reconnecting
      // would just rejoin a room the client was explicitly told to leave.
      if (closedByCaller || event.code === WS_CLOSE_TERMINAL) return
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    })
  }
  connect()

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message))
      } else {
        queue.push(message)
      }
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set()
      set.add(handler as (msg: ServerMessage) => void)
      handlers.set(type, set)
      return () => set.delete(handler as (msg: ServerMessage) => void)
    },
    onOpen(handler) {
      openHandlers.add(handler)
      return () => openHandlers.delete(handler)
    },
    close() {
      closedByCaller = true
      socket.close()
    },
  }
}
