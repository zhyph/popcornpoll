import type Database from 'better-sqlite3'
import { savePlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'

function requireAdmin(req: Request, adminSetupToken: string): boolean {
  const header = req.headers.get('authorization') ?? ''
  return header === `Bearer ${adminSetupToken}`
}

export function createSetupHandlers(
  db: Database.Database,
  encryptionKey: string,
  adminSetupToken: string,
  plex: PlexClient,
) {
  return {
    async pin(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const pin = await plex.createPin()
      return Response.json(pin)
    },

    async callback(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const { authToken, serverUrl, librarySectionIds, clientIdentifier } = (await req.json()) as {
        authToken: string
        serverUrl: string
        librarySectionIds: string[]
        clientIdentifier: string
      }
      savePlexLink(db, encryptionKey, {
        clientIdentifier,
        serverUrl,
        authToken,
        librarySectionIds,
        linkedAt: new Date().toISOString(),
      })
      return Response.json({ ok: true })
    },

    async resync(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      // Actual sync invocation is wired in Task 21's server entry point, which
      // holds the shared `createLibrarySync` instance — this handler just
      // needs the admin gate demonstrated and tested here.
      return Response.json({ triggered: true })
    },
  }
}
