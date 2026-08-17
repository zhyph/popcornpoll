import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { getPlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

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
    if (thumb.status !== 200 || !thumb.body || !thumb.contentType?.startsWith('image/')) {
      return new Response(null, { status: 502 })
    }

    return new Response(capStreamSize(thumb.body, MAX_IMAGE_BYTES), {
      status: 200,
      headers: {
        'Content-Type': thumb.contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  }
}
