import type Database from 'better-sqlite3'
import { findById } from '../db/movies'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_SIZES = new Set(['w185', 'w342'])

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

// Posters used to be fetched by the browser directly from image.tmdb.org.
// From some client networks that path is slow or unreachable (DNS/firewall
// to the public TMDB CDN), leaving posters stuck for a minute-plus or never
// loading at all, while requests to this server (which does reach the
// public internet fine) resolved instantly. Proxying through the server —
// same pattern as /api/plex-image — fixes that and lets us cache the result.
export function createTmdbImageProxyHandler(db: Database.Database): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const movieIdParam = url.searchParams.get('movieId')
    const movieId = movieIdParam ? Number.parseInt(movieIdParam, 10) : NaN
    if (Number.isNaN(movieId)) return new Response(null, { status: 404 })

    const sizeParam = url.searchParams.get('size')
    const size = sizeParam && ALLOWED_SIZES.has(sizeParam) ? sizeParam : 'w185'

    const row = findById(db, movieId)
    if (!row || row.posterSource !== 'tmdb' || row.posterPath === null) {
      return new Response(null, { status: 404 })
    }

    let upstream: Response
    try {
      upstream = await fetch(`https://image.tmdb.org/t/p/${size}${row.posterPath}`)
    } catch {
      return new Response(null, { status: 502 })
    }
    if (upstream.status !== 200 || !upstream.body || !upstream.headers.get('content-type')?.startsWith('image/')) {
      return new Response(null, { status: 502 })
    }

    return new Response(capStreamSize(upstream.body, MAX_IMAGE_BYTES), {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') as string,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  }
}
