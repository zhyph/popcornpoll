import { afterEach, describe, expect, it, vi } from 'vitest'
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
      'https://plex.tv/api/v2/pins?strong=true',
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
      {
        name: 'Remote Player',
        clientIdentifier: 'player-1',
        provides: 'player',
        connections: [{ uri: 'http://192.168.1.5:3000' }],
      },
      {
        name: 'Orphaned Server',
        clientIdentifier: 'server-2',
        provides: 'server',
        connections: [],
      },
    ])
    const client = createPlexClient('client-id')
    const resources = await client.getResources('token')
    expect(resources).toHaveLength(1)
    expect(resources[0]!.connections[0]!.uri).toBe('http://192.168.1.10:32400')
  })

  it('getResources passes through owned/product/local instead of discarding them', async () => {
    mockFetchOnce([
      {
        name: 'Shared Vault',
        clientIdentifier: 'server-1',
        provides: 'server',
        owned: false,
        product: 'Plex Media Server',
        productVersion: '1.40.2',
        connections: [{ uri: 'https://shared.example.net:32400', local: false }],
      },
    ])
    const client = createPlexClient('client-id')
    const resources = await client.getResources('token')
    expect(resources[0]).toMatchObject({
      owned: false,
      product: 'Plex Media Server',
      productVersion: '1.40.2',
    })
    expect(resources[0]!.connections[0]!.local).toBe(false)
  })

  it('getLibrarySections fetches each movie section\'s item count with a zero-size page request', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/library/sections')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MediaContainer: {
              Directory: [
                { key: '1', title: 'Movies', type: 'movie' },
                { key: '2', title: 'TV Shows', type: 'show' },
              ],
            },
          }),
        }
      }
      if (url.includes('/library/sections/1/all')) {
        return { ok: true, status: 200, json: async () => ({ MediaContainer: { totalSize: 412 } }) }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const client = createPlexClient('client-id')
    const sections = await client.getLibrarySections('http://192.168.1.10:32400', 'token')
    expect(sections).toEqual([{ id: '1', title: 'Movies', type: 'movie', count: 412 }])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('X-Plex-Container-Size=0'),
      expect.anything(),
    )
  })

  it('getLibrarySections degrades a single section to count 0 instead of failing the whole list', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/library/sections')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            MediaContainer: {
              Directory: [
                { key: '1', title: 'Movies', type: 'movie' },
                { key: '2', title: 'Classics', type: 'movie' },
              ],
            },
          }),
        }
      }
      if (url.includes('/library/sections/1/all')) {
        return { ok: true, status: 200, json: async () => ({ MediaContainer: { totalSize: 412 } }) }
      }
      if (url.includes('/library/sections/2/all')) {
        // Simulates a transient network failure on just this section's count request.
        throw new Error('network error')
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const client = createPlexClient('client-id')
    const sections = await client.getLibrarySections('http://192.168.1.10:32400', 'token')
    expect(sections).toEqual([
      { id: '1', title: 'Movies', type: 'movie', count: 412 },
      { id: '2', title: 'Classics', type: 'movie', count: 0 },
    ])
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
    expect(items[0]!.ratingKey).toBe('100')
    expect(items[0]!.genres).toEqual(['Sci-Fi'])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('includeGuids=1'),
      expect.anything(),
    )
  })

  it('getThumb sends a request with a bounded AbortSignal timeout', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      body: null,
      status: 200,
      headers: { get: () => 'image/jpeg' },
    }) as unknown as typeof fetch
    const client = createPlexClient('client-id')
    await client.getThumb('http://192.168.1.10:32400', 'token', '100')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/library/metadata/100/thumb'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  // Without a width Plex streams the original artwork, which on a real
  // library measured 0.4-3.4MB per poster for images rendered ~150px tall.
  // The photo transcoder resizes server-side (3293KB -> 47KB at width=342).
  it('getThumb resizes through the photo transcoder when a width is given', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      body: null,
      status: 200,
      headers: { get: () => 'image/jpeg' },
    }) as unknown as typeof fetch
    const client = createPlexClient('client-id')
    await client.getThumb('http://192.168.1.10:32400', 'token', '100', 342)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const url = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(url).toContain('/photo/:/transcode')
    expect(url).toContain('width=342')
    expect(url).toContain(`url=${encodeURIComponent('/library/metadata/100/thumb')}`)
  })

  // The photo transcoder can be unavailable (disabled, or withheld on a
  // shared server). An oversized poster still beats a broken one.
  it('getThumb falls back to the original artwork when the transcoder refuses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ body: null, status: 404, headers: { get: () => 'text/html' } })
      .mockResolvedValueOnce({ body: null, status: 200, headers: { get: () => 'image/jpeg' } })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const client = createPlexClient('client-id')
    const res = await client.getThumb('http://192.168.1.10:32400', 'token', '100', 342)
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toContain('/library/metadata/100/thumb?X-Plex-Token=')
  })
})
