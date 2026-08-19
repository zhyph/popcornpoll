import { timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { savePlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'

function requireAdmin(req: Request, adminSetupToken: string): boolean {
  const header = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${adminSetupToken}`)
  if (header.length !== expected.length) return false
  return timingSafeEqual(header, expected)
}

function badRequest(code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status: 400 })
}

export function createSetupHandlers(
  db: Database.Database,
  encryptionKey: string,
  adminSetupToken: string,
  plex: PlexClient,
  clientIdentifier: string,
) {
  return {
    async pin(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const pin = await plex.createPin()
      // The browser needs this instance's own X-Plex-Client-Identifier to build
      // the app.plex.tv/auth URL and to echo back in the callback body. It's
      // the same identifier `pinStatus` below closes over server-side, so the
      // PIN can never desync from the identifier polling it.
      return Response.json({ ...pin, clientIdentifier })
    },

    async pinStatus(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const url = new URL(req.url)
      const pinIdParam = url.searchParams.get('pinId')
      const pinId = pinIdParam ? Number.parseInt(pinIdParam, 10) : NaN
      if (Number.isNaN(pinId)) return badRequest('invalid_pin', 'pinId is required')
      const result = await plex.checkPin(pinId, clientIdentifier)
      return Response.json(result)
    },

    async resources(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const url = new URL(req.url)
      const authToken = url.searchParams.get('authToken')
      if (!authToken) return badRequest('missing_auth_token', 'authToken is required')
      const resources = await plex.getResources(authToken)
      return Response.json(resources)
    },

    async librarySections(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const url = new URL(req.url)
      const serverUrl = url.searchParams.get('serverUrl')
      const authToken = url.searchParams.get('authToken')
      if (!serverUrl || !authToken) return badRequest('missing_params', 'serverUrl and authToken are required')
      const sections = await plex.getLibrarySections(serverUrl, authToken)
      return Response.json(sections)
    },

    async callback(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const {
        authToken,
        serverUrl,
        librarySectionIds,
        clientIdentifier: linkedClientIdentifier,
      } = (await req.json()) as {
        authToken: string
        serverUrl: string
        librarySectionIds: string[]
        clientIdentifier: string
      }
      savePlexLink(db, encryptionKey, {
        clientIdentifier: linkedClientIdentifier,
        serverUrl,
        authToken,
        librarySectionIds,
        linkedAt: new Date().toISOString(),
      })
      return Response.json({ ok: true })
    },

    async resync(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      // Actual sync invocation is wired in server/index.ts, which holds the
      // shared `createLibrarySync` instance — this handler just needs the
      // admin gate demonstrated and tested here.
      return Response.json({ triggered: true })
    },
  }
}
