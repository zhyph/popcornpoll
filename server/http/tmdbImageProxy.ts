import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { imageResponse } from './imageResponse'

const ALLOWED_SIZES = new Set(['w185', 'w342'])

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
    return imageResponse({
      body: upstream.body,
      contentType: upstream.headers.get('content-type'),
      status: upstream.status,
    })
  }
}
