// server/index.ts
import { createServer } from 'node:http'
import next from 'next'
import { loadConfig, type AppConfig } from './config'
import { openDb } from './db'
import { createPlexClient } from './plex/client'
import { createFakePlexClient } from './plex/fakeClient'
import { createTmdbClient } from './tmdb/client'
import { createRoomStore } from './room/roomStore'
import { sweepEvictions, sweepInactiveRooms } from './room/lifecycle'
import { createLibrarySync } from './sync/librarySync'
import { createEnrichmentWorker } from './sync/enrichment'
import { attachWebSocketServer } from './ws/server'
import { createRoomsHandler } from './http/rooms'
import { createSetupHandlers } from './http/setup'
import { createImageProxyHandler } from './http/imageProxy'
import { createHealthHandler } from './http/health'
import { getPlexLink, savePlexLink } from './plex/link'

const SWEEP_INTERVAL_MS = 60_000

export async function createApp(config: AppConfig, opts: { skipFrontend?: boolean } = {}) {
  const db = openDb(config.dataDir)
  const store = createRoomStore()
  if (process.env.FAKE_EXTERNAL_APIS === 'true' && !getPlexLink(db, config.authEncryptionKey)) {
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
  const clientIdentifier = getPlexLink(db, config.authEncryptionKey)?.clientIdentifier ?? 'popcornpoll-instance'
  const plex =
    process.env.FAKE_EXTERNAL_APIS === 'true' ? createFakePlexClient() : createPlexClient(clientIdentifier)
  const tmdb = createTmdbClient(config.tmdbApiKey)
  const librarySync = createLibrarySync({ db, plex, tmdb, encryptionKey: config.authEncryptionKey })
  const enrichment = createEnrichmentWorker(db, tmdb)
  enrichment.start()

  const roomsHandler = createRoomsHandler(store, db, config.authEncryptionKey)
  const setupHandlers = createSetupHandlers(db, config.authEncryptionKey, config.adminSetupToken, plex)
  const imageProxyHandler = createImageProxyHandler(db, config.authEncryptionKey, plex)
  const healthHandler = createHealthHandler(config.dataDir)

  const nextApp = opts.skipFrontend ? null : next({ dev: process.env.NODE_ENV !== 'production' })
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
    req.on('error', () => res.destroy())
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      try {
        const webReq = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        })
        let webRes: Response
        if (url.pathname === '/api/health') webRes = await healthHandler(webReq)
        else if (url.pathname === '/api/rooms' && req.method === 'POST') webRes = await roomsHandler(webReq)
        else if (url.pathname === '/api/setup/plex/pin') webRes = await setupHandlers.pin(webReq)
        else if (url.pathname === '/api/setup/plex/callback') webRes = await setupHandlers.callback(webReq)
        else if (url.pathname === '/api/setup/plex/resync') {
          webRes = await setupHandlers.resync(webReq)
          if (webRes.status === 200) {
            if (process.env.FAKE_EXTERNAL_APIS === 'true') {
              await librarySync.run() // e2e fixture mode: block so the caller can create a room immediately after
            } else {
              void librarySync.run()
            }
          }
        } else if (url.pathname === '/api/plex-image') webRes = await imageProxyHandler(webReq)
        else {
          res.writeHead(404).end()
          return
        }
        const responseHeaders: Record<string, string> = {}
        webRes.headers.forEach((value, key) => {
          responseHeaders[key] = value
        })
        res.writeHead(webRes.status, responseHeaders)
        res.end(webRes.body ? Buffer.from(await webRes.arrayBuffer()) : undefined)
      } catch {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    })
  })

  attachWebSocketServer(httpServer, store, db, tmdb, config)

  const sweepTimer = setInterval(() => {
    const now = Date.now()
    sweepInactiveRooms(store, now)
    sweepEvictions(store, now)
  }, SWEEP_INTERVAL_MS)

  async function shutdown(): Promise<void> {
    clearInterval(sweepTimer)
    enrichment.stop()
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
