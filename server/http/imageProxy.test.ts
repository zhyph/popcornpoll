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
import type { TmdbClient } from '../tmdb/client'

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

function addPlexRow(ratingKey: string) {
  return upsertPlexRow(db, 1, {
    plexRatingKey: ratingKey,
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
}

function addTmdbRow(tmdbId: number, posterPath: string | null) {
  return upsertTmdbOnlyRow(db, {
    tmdbId,
    imdbId: null,
    title: 'X',
    posterPath,
    posterSource: 'tmdb',
    overview: null,
    year: null,
    genres: [],
    rating: null,
    voteCount: null,
    lastUsedAt: null,
  })
}

function okImage() {
  return { body: new ReadableStream(), contentType: 'image/jpeg', status: 200 }
}

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

describe('createImageProxyHandler', () => {
  it('rejects an unknown movieId — allowlist, not passthrough', async () => {
    const plex: Partial<PlexClient> = { getThumb: vi.fn() }
    const tmdb: Partial<TmdbClient> = { getPosterImage: vi.fn() }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient, tmdb as TmdbClient)
    const res = await handler(new Request('http://localhost/api/poster?movieId=999999'))
    expect(res.status).toBe(404)
    expect(plex.getThumb).not.toHaveBeenCalled()
    expect(tmdb.getPosterImage).not.toHaveBeenCalled()
  })

  it('proxies a plex-sourced poster with cache headers and forced content-type', async () => {
    const row = addPlexRow('pk-1')
    const plex: Partial<PlexClient> = { getThumb: vi.fn().mockResolvedValue(okImage()) }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient, {} as TmdbClient)
    const res = await handler(new Request(`http://localhost/api/poster?movieId=${row.id}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('max-age=86400')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  // Regression: posters used to be requested from Plex with no width, which
  // streams the *original* artwork — 0.4-3.4MB each on a real library, 37MB
  // for one 24-card grid. The rendered width has to reach the Plex client or
  // that cost silently comes back.
  it('asks Plex for the rendered width, never the full-size master', async () => {
    const row = addPlexRow('pk-1')
    const getThumb = vi.fn().mockResolvedValue(okImage())
    const handler = createImageProxyHandler(
      db,
      KEY,
      { getThumb } as unknown as PlexClient,
      {} as TmdbClient,
    )
    await handler(new Request(`http://localhost/api/poster?movieId=${row.id}&w=185`))
    expect(getThumb).toHaveBeenCalledWith('http://plex.local:32400', 'token', 'pk-1', 185)
  })

  // Regression: TMDB posters used to be loaded straight from image.tmdb.org
  // by the browser. That request hangs indefinitely on client networks that
  // can't reach the public CDN, even though this server reaches it fine.
  it('proxies a tmdb-sourced poster server-side instead of rejecting it', async () => {
    const row = addTmdbRow(1, '/x.jpg')
    const getPosterImage = vi.fn().mockResolvedValue(okImage())
    const handler = createImageProxyHandler(db, KEY, {} as PlexClient, {
      getPosterImage,
    } as unknown as TmdbClient)
    const res = await handler(new Request(`http://localhost/api/poster?movieId=${row.id}&w=342`))
    expect(res.status).toBe(200)
    expect(getPosterImage).toHaveBeenCalledWith('/x.jpg', 342)
  })

  it('404s a tmdb row that has no poster at all', async () => {
    const row = addTmdbRow(2, null)
    const getPosterImage = vi.fn()
    const handler = createImageProxyHandler(db, KEY, {} as PlexClient, {
      getPosterImage,
    } as unknown as TmdbClient)
    const res = await handler(new Request(`http://localhost/api/poster?movieId=${row.id}`))
    expect(res.status).toBe(404)
    expect(getPosterImage).not.toHaveBeenCalled()
  })

  // `width` is handed to Plex's photo transcoder, so an arbitrary value would
  // let an unauthenticated caller drive transcode work on the household's
  // Plex server. Only the sizes the UI asks for are honored.
  it('falls back to the default width for anything outside the allowlist', async () => {
    const row = addPlexRow('pk-1')
    // A fresh stream per call: capStreamSize locks the one it is handed, so
    // a single shared ReadableStream would fail on the second iteration.
    const getThumb = vi.fn().mockImplementation(async () => okImage())
    const handler = createImageProxyHandler(
      db,
      KEY,
      { getThumb } as unknown as PlexClient,
      {} as TmdbClient,
    )
    for (const hostile of ['99999', '0', '-1', 'abc', '342abc', '']) {
      await handler(new Request(`http://localhost/api/poster?movieId=${row.id}&w=${hostile}`))
      expect(getThumb).toHaveBeenLastCalledWith('http://plex.local:32400', 'token', 'pk-1', 342)
    }
    await handler(new Request(`http://localhost/api/poster?movieId=${row.id}`))
    expect(getThumb).toHaveBeenLastCalledWith('http://plex.local:32400', 'token', 'pk-1', 342)
  })

  // The short-lived /api/tmdb-image endpoint spelled the size `size=w185`.
  // Poster responses are cached immutable for 24h, so pages built against it
  // keep asking that way — the alias has to honor it or those clients get
  // silently mis-sized posters for a day.
  it("honors the retired /api/tmdb-image endpoint's size= spelling", async () => {
    const row = addTmdbRow(5, '/x.jpg')
    const getPosterImage = vi.fn().mockImplementation(async () => okImage())
    const handler = createImageProxyHandler(db, KEY, {} as PlexClient, {
      getPosterImage,
    } as unknown as TmdbClient)
    await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}&size=w185`))
    expect(getPosterImage).toHaveBeenLastCalledWith('/x.jpg', 185)
    await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}&size=w9999`))
    expect(getPosterImage).toHaveBeenLastCalledWith('/x.jpg', 342)
  })

  // image/svg+xml passes a naive startsWith('image/') check but is a scriptable
  // document — an SVG poster opened directly at /api/poster?movieId=N would
  // execute script in this app's origin, where the host token lives.
  it('refuses to proxy a scriptable image type (SVG) as a same-origin document', async () => {
    const row = addPlexRow('pk-svg')
    const handler = createImageProxyHandler(
      db,
      KEY,
      {
        getThumb: vi.fn().mockResolvedValue({
          body: new ReadableStream(),
          contentType: 'image/svg+xml',
          status: 200,
        }),
      } as unknown as PlexClient,
      {} as TmdbClient,
    )
    expect((await handler(new Request(`http://localhost/api/poster?movieId=${row.id}`))).status).toBe(502)
  })

  it('accepts a content type carrying parameters, e.g. image/jpeg; charset=binary', async () => {
    const row = addPlexRow('pk-param')
    const handler = createImageProxyHandler(
      db,
      KEY,
      {
        getThumb: vi.fn().mockResolvedValue({
          body: new ReadableStream(),
          contentType: 'image/jpeg; charset=binary',
          status: 200,
        }),
      } as unknown as PlexClient,
      {} as TmdbClient,
    )
    const res = await handler(new Request(`http://localhost/api/poster?movieId=${row.id}`))
    expect(res.status).toBe(200)
  })

  it('refuses to relay a non-image body from either upstream', async () => {
    const plexRow = addPlexRow('pk-1')
    const plexHandler = createImageProxyHandler(
      db,
      KEY,
      {
        getThumb: vi
          .fn()
          .mockResolvedValue({ body: new ReadableStream(), contentType: 'text/html', status: 200 }),
      } as unknown as PlexClient,
      {} as TmdbClient,
    )
    expect((await plexHandler(new Request(`http://localhost/api/poster?movieId=${plexRow.id}`))).status).toBe(502)

    const tmdbRow = addTmdbRow(3, '/x.jpg')
    const tmdbHandler = createImageProxyHandler(db, KEY, {} as PlexClient, {
      getPosterImage: vi
        .fn()
        .mockResolvedValue({ body: new ReadableStream(), contentType: 'text/html', status: 200 }),
    } as unknown as TmdbClient)
    expect((await tmdbHandler(new Request(`http://localhost/api/poster?movieId=${tmdbRow.id}`))).status).toBe(502)
  })

  // Both upstreams are observably flaky in the field (a sleeping Plex server,
  // a TMDB CDN connection that intermittently times out from the host). A
  // rejected fetch is a bad gateway, not a fault in this server.
  it('answers 502, not 500, when an upstream fetch rejects outright', async () => {
    const plexRow = addPlexRow('pk-3')
    const plexHandler = createImageProxyHandler(
      db,
      KEY,
      { getThumb: vi.fn().mockRejectedValue(new TypeError('fetch failed')) } as unknown as PlexClient,
      {} as TmdbClient,
    )
    expect((await plexHandler(new Request(`http://localhost/api/poster?movieId=${plexRow.id}`))).status).toBe(502)

    const tmdbRow = addTmdbRow(4, '/x.jpg')
    const tmdbHandler = createImageProxyHandler(db, KEY, {} as PlexClient, {
      getPosterImage: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    } as unknown as TmdbClient)
    expect((await tmdbHandler(new Request(`http://localhost/api/poster?movieId=${tmdbRow.id}`))).status).toBe(502)
  })

  it('errors the response stream once the proxied body exceeds the 5MB cap, and passes an under-cap body through untouched', async () => {
    const row = addPlexRow('pk-2')

    const oversizedHandler = createImageProxyHandler(
      db,
      KEY,
      {
        getThumb: vi.fn().mockResolvedValue({
          body: fakeStreamOfSize(6 * 1024 * 1024),
          contentType: 'image/jpeg',
          status: 200,
        }),
      } as unknown as PlexClient,
      {} as TmdbClient,
    )
    const oversizedRes = await oversizedHandler(
      new Request(`http://localhost/api/poster?movieId=${row.id}`),
    )
    await expect(async () => {
      for await (const _chunk of oversizedRes.body as unknown as AsyncIterable<Uint8Array>) {
        // draining the stream
      }
    }).rejects.toThrow()

    const underCapHandler = createImageProxyHandler(
      db,
      KEY,
      {
        getThumb: vi.fn().mockResolvedValue({
          body: fakeStreamOfSize(1024),
          contentType: 'image/jpeg',
          status: 200,
        }),
      } as unknown as PlexClient,
      {} as TmdbClient,
    )
    const underCapRes = await underCapHandler(
      new Request(`http://localhost/api/poster?movieId=${row.id}`),
    )
    expect((await underCapRes.arrayBuffer()).byteLength).toBe(1024)
  })
})
