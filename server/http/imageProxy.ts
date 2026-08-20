import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { getPlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'
import { imageResponse } from './imageResponse'

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
    return imageResponse(thumb)
  }
}
