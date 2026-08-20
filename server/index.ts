// server/index.ts
import { createServer } from 'node:http'
import next from 'next'
import type Database from 'better-sqlite3'
import { loadConfig, type AppConfig } from './config'
import { openDb } from './db'
import { createPlexClient } from './plex/client'
import { createFakePlexClient } from './plex/fakeClient'
import { createTmdbClient } from './tmdb/client'
import { createFakeTmdbClient } from './tmdb/fakeClient'
import { createRoomStore } from './room/roomStore'
import { sweepEvictions, sweepInactiveRooms } from './room/lifecycle'
import { createLibrarySync } from './sync/librarySync'
import { createEnrichmentWorker } from './sync/enrichment'
import { createTmdbPruneWorker } from './sync/tmdbPrune'
import { attachWebSocketServer } from './ws/server'
import { createRoomsHandler } from './http/rooms'
import { createSetupHandlers } from './http/setup'
import { createImageProxyHandler } from './http/imageProxy'
import { createHealthHandler } from './http/health'
import { createStatsHandler } from './http/stats'
import { createEligibleCountHandler } from './http/eligibleCount'
import { createGenresHandler } from './http/genres'
import { createSoloHandlers } from './http/solo'
import { DecryptionError, getPlexLink, savePlexLink } from './plex/link'
// Shared with next.config.js's headers() — /api/* is dispatched below without
// ever reaching Next, so its headers() never runs for these routes. See
// lib/securityHeaders.mjs for why the keys are lowercase.
import { SECURITY_HEADERS } from '../lib/securityHeaders.mjs'

const SWEEP_INTERVAL_MS = 60_000

// Every /api/* body is accumulated in memory below, and that happens *before*
// routing, origin checks, admin auth, and rate limiting — so this cap is the
// only thing between an unauthenticated POST of arbitrary size and this
// single-replica process's RSS. Mirrors WS_MAX_PAYLOAD_BYTES in ws/server.ts,
// which already caps the WebSocket half. Sized well above the largest real
// request (a solo/surprise movieIds array, itself capped at
// MAX_SURPRISE_MOVIE_IDS entries).
const MAX_REQUEST_BODY_BYTES = 256 * 1024

// getPlexLink throws DecryptionError when AUTH_ENCRYPTION_KEY has changed
// since the stored link was encrypted. That must not take the whole
// process down at boot — treat it the same as "not linked yet" so the
// setup/relink flow (not a crash loop) is the actual recovery path.
function safeGetPlexLink(db: Database.Database, key: string) {
  try {
    return getPlexLink(db, key)
  } catch (err) {
    if (err instanceof DecryptionError) {
      console.error(
        'Failed to decrypt stored Plex link — AUTH_ENCRYPTION_KEY may have changed. ' +
          'Continuing boot as if no Plex link were saved; re-link via setup to recover.',
        err,
      )
      return null
    }
    throw err
  }
}

export async function createApp(config: AppConfig, opts: { skipFrontend?: boolean } = {}) {
  const db = openDb(config.dataDir)
  const store = createRoomStore()
  if (process.env.FAKE_EXTERNAL_APIS === 'true' && !safeGetPlexLink(db, config.authEncryptionKey)) {
    // e2e/dev fixture mode: seed a fake link so librarySync can run without a
    // real OAuth flow — the fake client below ignores serverUrl/authToken.
    savePlexLink(db, config.authEncryptionKey, {
      clientIdentifier: 'fake-client',
      serverUrl: 'http://fake-plex.local',
      authToken: 'fake-token',
      librarySectionIds: ['1'],
      linkedAt: new Date().toISOString(),
    })
  }
  const clientIdentifier = safeGetPlexLink(db, config.authEncryptionKey)?.clientIdentifier ?? 'popcornpoll-instance'
  const plex =
    process.env.FAKE_EXTERNAL_APIS === 'true' ? createFakePlexClient() : createPlexClient(clientIdentifier)
  const tmdb =
    process.env.FAKE_EXTERNAL_APIS === 'true' ? createFakeTmdbClient() : createTmdbClient(config.tmdbApiKey)
  const librarySync = createLibrarySync({ db, plex, tmdb, encryptionKey: config.authEncryptionKey })
  const enrichment = createEnrichmentWorker(db, tmdb)
  enrichment.start()
  const tmdbPrune = createTmdbPruneWorker(db, store)
  tmdbPrune.start()

  const roomsHandler = createRoomsHandler(store, db, config.authEncryptionKey, config, librarySync)
  const setupHandlers = createSetupHandlers(db, config.authEncryptionKey, config.adminSetupToken, plex, clientIdentifier)
  const imageProxyHandler = createImageProxyHandler(db, config.authEncryptionKey, plex, tmdb)
  const healthHandler = createHealthHandler(config.dataDir)
  const statsHandler = createStatsHandler(db, config.authEncryptionKey, librarySync)
  const eligibleCountHandler = createEligibleCountHandler(db)
  const genresHandler = createGenresHandler(db)
  const soloHandlers = createSoloHandlers(db, tmdb, config, librarySync)

  const dev = process.env.NODE_ENV !== 'production'
  const nextApp = opts.skipFrontend ? null : next({ dev })
  const handleNextRequest = nextApp?.getRequestHandler()
  if (nextApp) await nextApp.prepare()

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    if (!url.pathname.startsWith('/api/')) {
      if (handleNextRequest) {
        void handleNextRequest(req, res)
      } else {
        res.writeHead(404).end()
      }
      return
    }
    const chunks: Buffer[] = []
    let received = 0
    let aborted = false
    req.on('error', () => res.destroy())
    req.on('data', (c) => {
      if (aborted) return
      received += c.length
      // Checked as chunks arrive, not against Content-Length: a chunked
      // request carries no Content-Length to check, and a declared one is
      // just a claim. Destroying the request is what stops the sender.
      if (received > MAX_REQUEST_BODY_BYTES) {
        aborted = true
        if (!res.headersSent) res.writeHead(413)
        res.end()
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', async () => {
      if (aborted) return
      try {
        const webReq = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        })
        let webRes: Response
        if (url.pathname === '/api/health') webRes = await healthHandler(webReq)
        else if (url.pathname === '/api/rooms' && req.method === 'POST')
          webRes = await roomsHandler(webReq, req.socket.remoteAddress)
        else if (url.pathname === '/api/setup/plex/pin') webRes = await setupHandlers.pin(webReq)
        else if (url.pathname === '/api/setup/plex/pin-status') webRes = await setupHandlers.pinStatus(webReq)
        else if (url.pathname === '/api/setup/plex/resources') webRes = await setupHandlers.resources(webReq)
        else if (url.pathname === '/api/setup/plex/library-sections') webRes = await setupHandlers.librarySections(webReq)
        else if (url.pathname === '/api/setup/plex/callback') webRes = await setupHandlers.callback(webReq)
        else if (url.pathname === '/api/setup/plex/resync') {
          webRes = await setupHandlers.resync(webReq)
          if (webRes.status === 200) {
            if (process.env.FAKE_EXTERNAL_APIS === 'true') {
              // e2e fixture mode: block so the caller can create a room
              // immediately after — but a failure here must not turn a
              // successful 200 resync response into a 500, so catch and log
              // rather than let it reach the outer try/catch.
              await librarySync.run().catch((err) => console.error('librarySync.run failed', err))
            } else {
              void librarySync.run().catch((err) => console.error('librarySync.run failed', err))
            }
          }
        }
        // /api/plex-image and /api/tmdb-image are the pre-unification names,
        // kept as aliases: poster responses are cached `immutable` for 24h, so
        // a browser still holding a page from before this change keeps asking
        // for whichever old path that page was built with.
        else if (
          (url.pathname === '/api/poster' ||
            url.pathname === '/api/plex-image' ||
            url.pathname === '/api/tmdb-image') &&
          req.method === 'GET'
        )
          webRes = await imageProxyHandler(webReq)
        else if (url.pathname === '/api/stats' && req.method === 'GET') webRes = await statsHandler(webReq)
        else if (url.pathname === '/api/eligible-count' && req.method === 'GET') webRes = await eligibleCountHandler(webReq)
        else if (url.pathname === '/api/genres' && req.method === 'GET') webRes = await genresHandler(webReq)
        else if (url.pathname === '/api/solo/pool' && req.method === 'GET')
          webRes = await soloHandlers.pool(webReq, req.socket.remoteAddress)
        else if (url.pathname === '/api/solo/surprise' && req.method === 'POST')
          webRes = await soloHandlers.surprise(webReq, req.socket.remoteAddress)
        else if (url.pathname === '/api/solo/pick' && req.method === 'POST')
          webRes = await soloHandlers.pick(webReq, req.socket.remoteAddress)
        else {
          res.writeHead(404).end()
          return
        }
        // /api/* never reaches Next, so next.config.js's headers() can't cover
        // it — the same shared list is applied here instead. Spread first so a
        // handler that sets its own (imageProxy's stricter CSP) wins; see
        // lib/securityHeaders.mjs for why that only works in lowercase.
        const responseHeaders: Record<string, string> = { ...SECURITY_HEADERS }
        webRes.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value
        })
        res.writeHead(webRes.status, responseHeaders)
        res.end(webRes.body ? Buffer.from(await webRes.arrayBuffer()) : undefined)
      } catch {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    })
  })

  // Next's dev HMR runs over a WebSocket on /_next/hmr, and the room server's
  // 'upgrade' listener is the only one on this http server — without this
  // delegate it destroys that socket and the dev client never boots (dead,
  // unhydrated pages). Only wired up in dev: `next start`'s handleUpgrade is
  // an empty method, so delegating in production would just leak the socket.
  const handleNextUpgrade = dev ? nextApp?.getUpgradeHandler() : undefined
  const wsHandle = attachWebSocketServer(httpServer, store, db, tmdb, librarySync, config, {
    handleForeignUpgrade: handleNextUpgrade
      ? (req, socket, head) => {
          void handleNextUpgrade(req, socket, head).catch((err) => {
            console.error('Next upgrade handler failed', err)
            socket.destroy()
          })
        }
      : undefined,
  })

  const sweepTimer = setInterval(() => {
    const now = Date.now()
    const endedCodes = sweepInactiveRooms(store, now)
    for (const code of endedCodes) wsHandle.broadcastRoomEnded(code, 'inactivity_timeout')
    sweepEvictions(store, now)
  }, SWEEP_INTERVAL_MS)

  async function shutdown(): Promise<void> {
    clearInterval(sweepTimer)
    enrichment.stop()
    tmdbPrune.stop()
    wsHandle.stopHeartbeatSweep()
    for (const room of store.all()) {
      if (room.status !== 'ended') wsHandle.broadcastRoomEnded(room.code, 'server_restarting')
    }
    wsHandle.terminateAllSockets()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    db.close()
  }

  return { httpServer, store, db, shutdown }
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const config = loadConfig(process.env)
  void (async () => {
    const app = await createApp(config)
    app.httpServer.listen(config.port, () => {
      console.log(`PopcornPoll listening on :${config.port}`)
    })
    process.on('SIGTERM', async () => {
      await app.shutdown()
      process.exit(0)
    })
  })()
}
