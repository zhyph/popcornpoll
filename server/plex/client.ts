import type { PlexGuidSource } from './guid'

export interface PlexItem extends PlexGuidSource {
  ratingKey: string
  title: string
  year: number | null
  genres: string[]
}

export interface PlexResource {
  name: string
  clientIdentifier: string
  connections: { uri: string }[]
}

export interface PlexClient {
  createPin(): Promise<{ id: number; code: string }>
  checkPin(pinId: number, clientIdentifier: string): Promise<{ authToken: string | null }>
  getResources(authToken: string): Promise<PlexResource[]>
  getLibrarySections(
    serverUrl: string,
    authToken: string,
  ): Promise<{ id: string; title: string; type: string }[]>
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
      return body.MediaContainer.Directory.filter((d) => d.type === 'movie').map((d) => ({
        id: d.key,
        title: d.title,
        type: d.type,
      }))
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
