import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow, upsertTmdbOnlyRow } from '../db/movies'
import { savePlexLink } from '../plex/link'
import { createImageProxyHandler } from './imageProxy'
import type Database from 'better-sqlite3'
import type { PlexClient } from '../plex/client'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-imgproxy-'))
  db = openDb(dir)
  savePlexLink(db, KEY, {
    clientIdentifier: 'c',
    serverUrl: 'http://plex.local:32400',
    authToken: 'token',
    librarySectionIds: ['1'],
    linkedAt: '2026-08-17T00:00:00.000Z',
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createImageProxyHandler', () => {
  it('rejects an unknown movieId — allowlist, not passthrough', async () => {
    const plex: Partial<PlexClient> = { getThumb: vi.fn() }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient)
    const req = new Request('http://localhost/api/plex-image?movieId=999999')
    const res = await handler(req)
    expect(res.status).toBe(404)
    expect(plex.getThumb).not.toHaveBeenCalled()
  })

  it('rejects a movieId whose poster_source is tmdb, not plex', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: '/x.jpg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    const plex: Partial<PlexClient> = { getThumb: vi.fn() }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient)
    const res = await handler(new Request(`http://localhost/api/plex-image?movieId=${row.id}`))
    expect(res.status).toBe(404)
  })

  it('proxies a valid plex-sourced movieId with cache headers and forced content-type', async () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-1',
      tmdbId: null,
      imdbId: null,
      title: 'X',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const fakeBody = new ReadableStream()
    const plex: Partial<PlexClient> = {
      getThumb: vi.fn().mockResolvedValue({ body: fakeBody, contentType: 'image/jpeg', status: 200 }),
    }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient)
    const res = await handler(new Request(`http://localhost/api/plex-image?movieId=${row.id}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('max-age=86400')
  })

  it('errors the response stream once the proxied body exceeds the 5MB cap, and passes an under-cap body through untouched', async () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-2',
      tmdbId: null,
      imdbId: null,
      title: 'Y',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })

    function fakeStreamOfSize(totalBytes: number): ReadableStream {
      const chunkSize = 1024 * 1024
      let sent = 0
      return new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) {
            controller.close()
            return
          }
          const size = Math.min(chunkSize, totalBytes - sent)
          controller.enqueue(new Uint8Array(size))
          sent += size
        },
      })
    }

    const oversizedPlex: Partial<PlexClient> = {
      getThumb: vi.fn().mockResolvedValue({
        body: fakeStreamOfSize(6 * 1024 * 1024),
        contentType: 'image/jpeg',
        status: 200,
      }),
    }
    const oversizedHandler = createImageProxyHandler(db, KEY, oversizedPlex as PlexClient)
    const oversizedRes = await oversizedHandler(
      new Request(`http://localhost/api/plex-image?movieId=${row.id}`),
    )
    await expect(async () => {
      for await (const _chunk of oversizedRes.body as unknown as AsyncIterable<Uint8Array>) {
        // draining the stream
      }
    }).rejects.toThrow()

    const underCapPlex: Partial<PlexClient> = {
      getThumb: vi.fn().mockResolvedValue({
        body: fakeStreamOfSize(1024),
        contentType: 'image/jpeg',
        status: 200,
      }),
    }
    const underCapHandler = createImageProxyHandler(db, KEY, underCapPlex as PlexClient)
    const underCapRes = await underCapHandler(
      new Request(`http://localhost/api/plex-image?movieId=${row.id}`),
    )
    const bytes = await underCapRes.arrayBuffer()
    expect(bytes.byteLength).toBe(1024)
  })
})
