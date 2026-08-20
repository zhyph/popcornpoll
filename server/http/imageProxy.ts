import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { getPlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'
import type { TmdbClient } from '../tmdb/client'
import { imageResponse, type UpstreamImage } from './imageResponse'

// Closed set, not an arbitrary integer: `width` reaches Plex's photo
// transcoder, and letting a caller name any width would turn this
// unauthenticated endpoint into a transcode-work amplifier against the
// household's Plex server. These are the three sizes the UI actually asks
// for, and they line up with TMDB's own w185/w342/w500 buckets so both
// branches below can share one parameter.
const ALLOWED_WIDTHS = [185, 342, 500] as const
const DEFAULT_WIDTH = 342

/**
 * Reads the requested width from either spelling: `w=342` (current) or
 * `size=w342` (what the short-lived /api/tmdb-image endpoint took). The
 * second exists because poster responses are cached `immutable` for 24h, so
 * a browser holding a page built against that endpoint keeps asking for it
 * with its own parameter — an alias that silently ignored `size` would
 * quietly serve those clients the wrong size for a day.
 */
function parseWidth(url: URL): number {
  const raw = url.searchParams.get('w') ?? url.searchParams.get('size')?.replace(/^w/, '') ?? null
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return (ALLOWED_WIDTHS as readonly number[]).includes(parsed) ? parsed : DEFAULT_WIDTH
}

/**
 * Serves every poster the UI renders, whatever its source.
 *
 * Plex posters have to be proxied — they need the household's auth token,
 * which participants must never hold. TMDB posters are publicly fetchable,
 * but the browser can't be trusted to reach image.tmdb.org: on real client
 * networks those requests hang indefinitely, while this server completes the
 * same fetch in ~0.2-0.5s. Both go through here, which is also what lets the
 * client stop caring where a given poster comes from.
 *
 * Every response is built by imageResponse(), so the size cap, the
 * scriptable-content-type refusal and the inert-response headers stay shared
 * with nothing to drift out of sync.
 *
 * It stays an allowlist rather than a passthrough: the caller names a
 * `movieId` this instance already knows about, never an upstream URL.
 */
export function createImageProxyHandler(
  db: Database.Database,
  encryptionKey: string,
  plex: PlexClient,
  tmdb: TmdbClient,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const movieIdParam = url.searchParams.get('movieId')
    const movieId = movieIdParam ? Number.parseInt(movieIdParam, 10) : NaN
    if (Number.isNaN(movieId)) return new Response(null, { status: 404 })

    const row = findById(db, movieId)
    if (!row) return new Response(null, { status: 404 })

    const width = parseWidth(url)

    let upstream: UpstreamImage
    try {
      if (row.posterSource === 'plex') {
        if (row.plexRatingKey === null) return new Response(null, { status: 404 })
        const link = getPlexLink(db, encryptionKey)
        if (!link) return new Response(null, { status: 502 })
        upstream = await plex.getThumb(link.serverUrl, link.authToken, row.plexRatingKey, width)
      } else {
        if (row.posterPath === null) return new Response(null, { status: 404 })
        upstream = await tmdb.getPosterImage(row.posterPath, width)
      }
    } catch (err) {
      // Both upstreams are off-process and observably flaky — a Plex server
      // that just went to sleep, or a TMDB CDN connection that intermittently
      // times out from this host. That is a bad gateway, not a fault in this
      // server: letting it throw would surface as an opaque 500 with nothing
      // in the log to explain it.
      console.error(`poster proxy: upstream fetch failed for movieId ${movieId}`, err)
      return new Response(null, { status: 502 })
    }

    return imageResponse(upstream)
  }
}
