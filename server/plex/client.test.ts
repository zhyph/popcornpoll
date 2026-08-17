import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlexClient } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('createPlexClient', () => {
  it('createPin posts to plex.tv and returns id/code', async () => {
    mockFetchOnce({ id: 123, code: 'ABCD' })
    const client = createPlexClient('client-id')
    const result = await client.createPin()
    expect(result).toEqual({ id: 123, code: 'ABCD' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://plex.tv/api/v2/pins',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('checkPin returns authToken: null while unclaimed, and the token once claimed', async () => {
    mockFetchOnce({ authToken: null })
    const client = createPlexClient('client-id')
    const pending = await client.checkPin(123, 'client-id')
    expect(pending.authToken).toBeNull()

    mockFetchOnce({ authToken: 'plex-token-xyz' })
    const claimed = await client.checkPin(123, 'client-id')
    expect(claimed.authToken).toBe('plex-token-xyz')
  })

  it('getResources filters to Plex Media Server resources with connections', async () => {
    mockFetchOnce([
      {
        name: 'Home Server',
        clientIdentifier: 'server-1',
        provides: 'server',
        connections: [{ uri: 'http://192.168.1.10:32400' }],
      },
    ])
    const client = createPlexClient('client-id')
    const resources = await client.getResources('token')
    expect(resources).toHaveLength(1)
    expect(resources[0].connections[0].uri).toBe('http://192.168.1.10:32400')
  })

  it('getLibraryItems requests with includeGuids=1 and maps fields', async () => {
    mockFetchOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '100',
            title: 'Arrival',
            year: 2016,
            guid: 'plex://movie/abc',
            Genre: [{ tag: 'Sci-Fi' }],
            Guid: [{ id: 'tmdb://329865' }],
          },
        ],
      },
    })
    const client = createPlexClient('client-id')
    const items = await client.getLibraryItems('http://192.168.1.10:32400', 'token', '1')
    expect(items).toHaveLength(1)
    expect(items[0].ratingKey).toBe('100')
    expect(items[0].genres).toEqual(['Sci-Fi'])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('includeGuids=1'),
      expect.anything(),
    )
  })
})
