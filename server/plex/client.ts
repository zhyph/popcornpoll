import type { PlexGuidSource } from './guid'

export interface PlexItem extends PlexGuidSource {
  ratingKey: string
  title: string
  year: number | null
  genres: string[]
}

export interface PlexResourceConnection {
  uri: string
  // Plex marks each connection as reachable over the LAN or not — the setup
  // screen's "Owned · local · v1.41.3" meta line reads straight off this.
  local: boolean
}

export interface PlexResource {
  name: string
  clientIdentifier: string
  // Whether this Plex account owns the server vs. it being shared with them
  // — drives the owner/shared badge next to each server row.
  owned: boolean
  product: string
  productVersion: string
  connections: PlexResourceConnection[]
}

export interface PlexLibrarySection {
  id: string
  title: string
  type: string
  count: number
}

export interface PlexClient {
  createPin(): Promise<{ id: number; code: string }>
  checkPin(pinId: number, clientIdentifier: string): Promise<{ authToken: string | null }>
  getResources(authToken: string): Promise<PlexResource[]>
  getLibrarySections(serverUrl: string, authToken: string): Promise<PlexLibrarySection[]>
  getLibraryItems(serverUrl: string, authToken: string, sectionId: string): Promise<PlexItem[]>
  getThumb(
    serverUrl: string,
    authToken: string,
    ratingKey: string,
  ): Promise<{ body: ReadableStream | null; contentType: string | null; status: number }>
}

function headers(clientIdentifier: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientIdentifier,
    'X-Plex-Product': 'PopcornPoll',
  }
}

export function createPlexClient(clientIdentifier: string): PlexClient {
  return {
    async createPin() {
      // strong=true is required for the app.plex.tv/auth#?...&code=... URL
      // flow used below in app/setup/page.tsx. Without it Plex issues a
      // short "weak" code meant for manual entry at plex.tv/link, which the
      // auth page silently rejects at sign-in with a 403 "We were unable to
      // complete this request" — the PIN itself still gets created fine, so
      // this only surfaces once the owner actually tries to log in.
      const res = await fetch('https://plex.tv/api/v2/pins?strong=true', {
        method: 'POST',
        headers: headers(clientIdentifier),
      })
      const body = (await res.json()) as { id: number; code: string }
      return { id: body.id, code: body.code }
    },

    async checkPin(pinId, clientId) {
      const res = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
        headers: headers(clientId),
      })
      const body = (await res.json()) as { authToken: string | null }
      return { authToken: body.authToken ?? null }
    },

    async getResources(authToken) {
      const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
        headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken },
      })
      const body = (await res.json()) as (PlexResource & { provides: string })[]
      return body.filter((r) => r.provides === 'server' && r.connections.length > 0)
    },

    async getLibrarySections(serverUrl, authToken) {
      const res = await fetch(`${serverUrl}/library/sections`, {
        headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken },
      })
      const body = (await res.json()) as {
        MediaContainer: { Directory: { key: string; title: string; type: string }[] }
      }
      const movieSections = body.MediaContainer.Directory.filter((d) => d.type === 'movie')
      // Plex's /library/sections listing doesn't carry a per-section item
      // count, so the setup screen's "412 titles" line needs one extra call
      // per section — X-Plex-Container-Size=0 asks for zero rows and just
      // reads the container's totalSize header back.
      return Promise.all(
        movieSections.map(async (d) => {
          const countRes = await fetch(
            `${serverUrl}/library/sections/${d.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`,
            { headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken } },
          )
          const countBody = (await countRes.json()) as {
            MediaContainer: { totalSize?: number; size?: number }
          }
          return {
            id: d.key,
            title: d.title,
            type: d.type,
            count: countBody.MediaContainer.totalSize ?? countBody.MediaContainer.size ?? 0,
          }
        }),
      )
    },

    async getLibraryItems(serverUrl, authToken, sectionId) {
      const res = await fetch(
        `${serverUrl}/library/sections/${sectionId}/all?includeGuids=1`,
        { headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken } },
      )
      const body = (await res.json()) as {
        MediaContainer: {
          Metadata: {
            ratingKey: string
            title: string
            year?: number
            guid: string
            Genre?: { tag: string }[]
            Guid?: { id: string }[]
          }[]
        }
      }
      return body.MediaContainer.Metadata.map((m) => ({
        ratingKey: m.ratingKey,
        title: m.title,
        year: m.year ?? null,
        guid: m.guid,
        Guid: m.Guid,
        genres: (m.Genre ?? []).map((g) => g.tag),
      }))
    },

    async getThumb(serverUrl, authToken, ratingKey) {
      const res = await fetch(
        `${serverUrl}/library/metadata/${ratingKey}/thumb?X-Plex-Token=${authToken}`,
        { signal: AbortSignal.timeout(10_000) },
      )
      return {
        body: res.body,
        contentType: res.headers.get('content-type'),
        status: res.status,
      }
    },
  }
}
