import { timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { savePlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'
import { createTokenBucket } from '../rateLimit'

// The Plex auth token is a long-lived credential for the owner's whole Plex
// account. It travels in this header rather than a query parameter because
// reverse proxies (which the documented docker-compose deployment sits behind)
// log full request URLs by default, which would put it in plaintext access
// logs — somewhere with wider read access and longer retention than the
// AES-256-GCM-encrypted column it otherwise lives in.
const PLEX_TOKEN_HEADER = 'x-plex-token'

function requireAdmin(req: Request, adminSetupToken: string): boolean {
  const header = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${adminSetupToken}`)
  if (header.length !== expected.length) return false
  return timingSafeEqual(header, expected)
}

function badRequest(code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status: 400 })
}

// The browser picks serverUrl out of the connection list getResources returned,
// so the server can re-derive that same list and reject anything absent from
// it. Without this check serverUrl is an arbitrary fetch target: `callback`
// persists it, and /api/plex-image then streams whatever the target returns
// back to the browser whenever its content-type looks like an image — a read
// primitive against localhost and the rest of the LAN, not just a blind SSRF.
async function isKnownServerUrl(plex: PlexClient, authToken: string, serverUrl: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(serverUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const resources = await plex.getResources(authToken)
  return resources.some((r) => r.connections.some((c) => c.uri === serverUrl))
}

export function createSetupHandlers(
  db: Database.Database,
  encryptionKey: string,
  adminSetupToken: string,
  plex: PlexClient,
  clientIdentifier: string,
) {
  // config.ts enforces a minimum ADMIN_SETUP_TOKEN length, but that's a floor
  // on entropy, not a limit on attempts — without a bucket these endpoints
  // accept unlimited guesses. Keyed per-instance rather than per-IP on
  // purpose: this gate protects one shared secret, so a distributed guessing
  // attempt should drain the same budget a single-source one does. 30/minute
  // costs a legitimate owner nothing, because only failed attempts consume a
  // token at all — see denyAdmin.
  const ADMIN_ATTEMPT_CAPACITY = 30
  const adminAttemptBucket = createTokenBucket(ADMIN_ATTEMPT_CAPACITY, ADMIN_ATTEMPT_CAPACITY / 60)
  const ADMIN_BUCKET_KEY = 'admin-setup'

  // Returns null when the caller is authorized, or the response to send back
  // when they aren't. Only *failed* attempts consume a token, so a legitimate
  // owner polling pin-status every 2 seconds can never lock themselves out.
  function denyAdmin(req: Request): Response | null {
    if (requireAdmin(req, adminSetupToken)) return null
    if (!adminAttemptBucket.tryConsume(ADMIN_BUCKET_KEY)) {
      return Response.json(
        { error: { code: 'rate_limited', message: 'too many attempts, please slow down' } },
        { status: 429 },
      )
    }
    return new Response(null, { status: 401 })
  }

  return {
    async pin(req: Request): Promise<Response> {
      const denied = denyAdmin(req)
      if (denied) return denied
      const pin = await plex.createPin()
      // The browser needs this instance's own X-Plex-Client-Identifier to build
      // the app.plex.tv/auth URL and to echo back in the callback body. It's
      // the same identifier `pinStatus` below closes over server-side, so the
      // PIN can never desync from the identifier polling it.
      return Response.json({ ...pin, clientIdentifier })
    },

    async pinStatus(req: Request): Promise<Response> {
      const denied = denyAdmin(req)
      if (denied) return denied
      const url = new URL(req.url)
      const pinIdParam = url.searchParams.get('pinId')
      const pinId = pinIdParam ? Number.parseInt(pinIdParam, 10) : NaN
      if (Number.isNaN(pinId)) return badRequest('invalid_pin', 'pinId is required')
      const result = await plex.checkPin(pinId, clientIdentifier)
      return Response.json(result)
    },

    async resources(req: Request): Promise<Response> {
      const denied = denyAdmin(req)
      if (denied) return denied
      const authToken = req.headers.get(PLEX_TOKEN_HEADER)
      if (!authToken) return badRequest('missing_auth_token', `${PLEX_TOKEN_HEADER} header is required`)
      const resources = await plex.getResources(authToken)
      return Response.json(resources)
    },

    async librarySections(req: Request): Promise<Response> {
      const denied = denyAdmin(req)
      if (denied) return denied
      const url = new URL(req.url)
      // serverUrl stays in the query string — it's not a credential, and
      // isKnownServerUrl below constrains it to a server Plex actually
      // reported for this account.
      const serverUrl = url.searchParams.get('serverUrl')
      const authToken = req.headers.get(PLEX_TOKEN_HEADER)
      if (!serverUrl || !authToken) {
        return badRequest('missing_params', `serverUrl and the ${PLEX_TOKEN_HEADER} header are required`)
      }
      if (!(await isKnownServerUrl(plex, authToken, serverUrl))) {
        return badRequest('unknown_server', 'serverUrl is not a known Plex server for this account')
      }
      const sections = await plex.getLibrarySections(serverUrl, authToken)
      return Response.json(sections)
    },

    async callback(req: Request): Promise<Response> {
      const denied = denyAdmin(req)
      if (denied) return denied
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
      // Re-checked here and not just in librarySections: this is the call that
      // *persists* serverUrl, and nothing stops a client from skipping
      // straight to it with a URL that never passed the earlier check.
      if (!(await isKnownServerUrl(plex, authToken, serverUrl))) {
        return badRequest('unknown_server', 'serverUrl is not a known Plex server for this account')
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
      const denied = denyAdmin(req)
      if (denied) return denied
      // Actual sync invocation is wired in server/index.ts, which holds the
      // shared `createLibrarySync` instance — this handler just needs the
      // admin gate demonstrated and tested here.
      return Response.json({ triggered: true })
    },
  }
}
