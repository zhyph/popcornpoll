import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { getPlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// `image/svg+xml` passes a naive startsWith('image/') check but is a scriptable
// document: an SVG poster in the linked Plex library, opened directly at
// /api/plex-image?movieId=N, would execute script in this app's origin (where
// the host token lives in localStorage). Posters are raster formats, so an
// explicit allowlist costs nothing and closes that off. Parameters like
// `; charset=` are stripped before matching.
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

function isSafeImageType(contentType: string | null): boolean {
  if (!contentType) return false
  const [mediaType = ''] = contentType.split(';')
  return ALLOWED_IMAGE_TYPES.has(mediaType.trim().toLowerCase())
}

function capStreamSize(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk: Uint8Array, controller) {
        total += chunk.byteLength
        if (total > maxBytes) {
          controller.error(new Error('Image exceeds size cap'))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
}

export function createImageProxyHandler(
  db: Database.Database,
  encryptionKey: string,
  plex: PlexClient,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const movieIdParam = url.searchParams.get('movieId')
    const movieId = movieIdParam ? Number.parseInt(movieIdParam, 10) : NaN
    if (Number.isNaN(movieId)) return new Response(null, { status: 404 })

    const row = findById(db, movieId)
    if (!row || row.posterSource !== 'plex' || row.plexRatingKey === null) {
      return new Response(null, { status: 404 })
    }

    const link = getPlexLink(db, encryptionKey)
    if (!link) return new Response(null, { status: 502 })

    const thumb = await plex.getThumb(link.serverUrl, link.authToken, row.plexRatingKey)
    if (thumb.status !== 200 || !thumb.body || !isSafeImageType(thumb.contentType)) {
      return new Response(null, { status: 502 })
    }

    return new Response(capStreamSize(thumb.body, MAX_IMAGE_BYTES), {
      status: 200,
      headers: {
        'Content-Type': thumb.contentType as string,
        'Cache-Control': 'public, max-age=86400, immutable',
        // This response is same-origin with the app, so its content type is a
        // security boundary: nosniff stops a browser from re-interpreting a
        // mislabeled body as HTML, and CSP sandbox neutralizes scripting for
        // anything that still manages to be treated as a document.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox; default-src \'none\'',
      },
    })
  }
}
