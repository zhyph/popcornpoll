// lib/wsClient.test.ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWsClient } from './wsClient'
import { WS_CLOSE_TERMINAL } from '../server/ws/protocol'
import type { Server } from 'node:http'

let httpServer: Server
let wss: WebSocketServer
let url: string

beforeEach(async () => {
  httpServer = createServer()
  wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const port = (httpServer.address() as AddressInfo).port
  url = `ws://localhost:${port}/ws`
})

afterEach(async () => {
  wss.close()
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

describe('createWsClient', () => {
  it('sends a message and dispatches a typed response to the matching handler', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => ws.send(JSON.stringify({ type: 'heartbeat_ack' })))
    })
    const client = createWsClient(url)
    const received = new Promise((resolve) => {
      client.on('heartbeat_ack', (msg) => resolve(msg))
    })
    await new Promise((resolve) => setTimeout(resolve, 50)) // let the socket open
    client.send({ type: 'heartbeat' })
    const msg = await received
    expect(msg).toEqual({ type: 'heartbeat_ack' })
    client.close()
  })

  it('unsubscribing via the returned function stops further dispatch', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => {
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
      })
    })
    const client = createWsClient(url)
    let count = 0
    const unsubscribe = client.on('heartbeat_ack', () => {
      count++
      unsubscribe()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    client.send({ type: 'heartbeat' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(count).toBe(1)
    client.close()
  })
})

describe('createWsClient: terminal-close reconnect handling', () => {
  // Node's socket I/O runs on libuv's real event loop, not on setTimeout —
  // so real network traffic (the server-initiated close, and any reconnect
  // handshake) keeps working under fake timers, letting us fast-forward the
  // client's internal backoff `setTimeout` without a real wait.
  it('reconnects after an ordinary close', async () => {
    let connectionCount = 0
    wss.on('connection', () => {
      connectionCount++
    })
    const client = createWsClient(url)
    await new Promise((resolve) => setTimeout(resolve, 50)) // let the first connection open
    expect(connectionCount).toBe(1)

    vi.useFakeTimers()
    try {
      for (const ws of wss.clients) ws.close(1000, 'ordinary')
      await vi.advanceTimersByTimeAsync(0) // let the close reach the client and schedule a reconnect
      await vi.advanceTimersByTimeAsync(5000) // past the initial backoff — reconnect's WebSocket() is now constructed
    } finally {
      vi.useRealTimers()
    }
    // The reconnect handshake itself (DNS/TCP/WS upgrade) is real async I/O
    // that needs real event-loop turns beyond what fake-timer advancement
    // guarantees — poll for it under real timers instead of a fixed wait.
    const deadline = Date.now() + 2000
    while (connectionCount < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(connectionCount).toBe(2)
    client.close()
  })

  it('does not reconnect after a close carrying WS_CLOSE_TERMINAL', async () => {
    let connectionCount = 0
    wss.on('connection', () => {
      connectionCount++
    })
    const client = createWsClient(url)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(connectionCount).toBe(1)

    vi.useFakeTimers()
    try {
      for (const ws of wss.clients) ws.close(WS_CLOSE_TERMINAL, 'kicked')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(35_000) // well past the max backoff
    } finally {
      vi.useRealTimers()
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(connectionCount).toBe(1)
    client.close()
  })

  it('does not reconnect after the caller closes the client', async () => {
    let connectionCount = 0
    wss.on('connection', () => {
      connectionCount++
    })
    const client = createWsClient(url)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(connectionCount).toBe(1)

    vi.useFakeTimers()
    try {
      client.close()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(35_000)
    } finally {
      vi.useRealTimers()
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(connectionCount).toBe(1)
  })
})
