import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow, upsertTmdbOnlyRow } from '../db/movies'
import { createTmdbImageProxyHandler } from './tmdbImageProxy'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-tmdbimgproxy-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('createTmdbImageProxyHandler', () => {
  it('rejects an unknown movieId — allowlist, not passthrough', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const handler = createTmdbImageProxyHandler(db)
    const res = await handler(new Request('http://localhost/api/tmdb-image?movieId=999999'))
    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a movieId whose poster_source is plex, not tmdb', async () => {
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
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const handler = createTmdbImageProxyHandler(db)
    const res = await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}`))
    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a tmdb-sourced movieId with no posterPath', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const handler = createTmdbImageProxyHandler(db)
    const res = await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}`))
    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('proxies a valid tmdb-sourced movieId, fetching the stored posterPath at an allowed size', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: '/vertigo.jpg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    const fakeBody = new ReadableStream()
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(fakeBody, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const handler = createTmdbImageProxyHandler(db)
    const res = await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}&size=w342`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('max-age=86400')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(fetchSpy).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w342/vertigo.jpg')
  })

  // Same check as imageProxy.test.ts's SVG case — both proxies now share
  // imageResponse(), and this pins the behaviour on this side too so the two
  // can't drift apart again.
  it('refuses to proxy a scriptable image type (SVG) as a same-origin document', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 2,
      imdbId: null,
      title: 'Scriptable',
      posterPath: '/evil.svg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream(), { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
      ),
    )
    const handler = createTmdbImageProxyHandler(db)
    const res = await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}`))
    expect(res.status).toBe(502)
  })

  it('falls back to w185 for an unrecognized size param instead of passing it through', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: '/vertigo.jpg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(new ReadableStream(), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const handler = createTmdbImageProxyHandler(db)
    await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}&size=original`))
    expect(fetchSpy).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w185/vertigo.jpg')
  })

  it('returns 502 when the upstream TMDB fetch rejects', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: '/vertigo.jpg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const handler = createTmdbImageProxyHandler(db)
    const res = await handler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}`))
    expect(res.status).toBe(502)
  })

  it('errors the response stream once the proxied body exceeds the 5MB cap, and passes an under-cap body through untouched', async () => {
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: '/vertigo.jpg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
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

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(fakeStreamOfSize(6 * 1024 * 1024), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      ),
    )
    const oversizedHandler = createTmdbImageProxyHandler(db)
    const oversizedRes = await oversizedHandler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}`))
    await expect(async () => {
      for await (const _chunk of oversizedRes.body as unknown as AsyncIterable<Uint8Array>) {
        // draining the stream
      }
    }).rejects.toThrow()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(fakeStreamOfSize(1024), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
      ),
    )
    const underCapHandler = createTmdbImageProxyHandler(db)
    const underCapRes = await underCapHandler(new Request(`http://localhost/api/tmdb-image?movieId=${row.id}`))
    const bytes = await underCapRes.arrayBuffer()
    expect(bytes.byteLength).toBe(1024)
  })
})
