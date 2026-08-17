// lib/wsClient.test.ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWsClient } from './wsClient'
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
