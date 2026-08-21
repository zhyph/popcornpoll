import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { getPlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'
import type { TmdbClient } from '../tmdb/client'
import { bufferUpstreamImage, imageResponseFromBytes, type UpstreamImage } from './imageResponse'
import { createImageCache, type ImageCache } from './imageCache'

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
 * Every response is built by imageResponseFromBytes(), and every upstream
 * body goes through bufferUpstreamImage(), so the size cap, the
 * scriptable-content-type refusal and the inert-response headers stay shared
 * with nothing to drift out of sync — a cache hit and a cache miss answer
 * with the same headers by construction.
 *
 * It stays an allowlist rather than a passthrough: the caller names a
 * `movieId` this instance already knows about, never an upstream URL.
 */
export function createImageProxyHandler(
  db: Database.Database,
  encryptionKey: string,
  plex: PlexClient,
  tmdb: TmdbClient,
  cache: ImageCache = createImageCache(),
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const movieIdParam = url.searchParams.get('movieId')
    const movieId = movieIdParam ? Number.parseInt(movieIdParam, 10) : NaN
    if (Number.isNaN(movieId)) return new Response(null, { status: 404 })

    const row = findById(db, movieId)
    if (!row) return new Response(null, { status: 404 })

    const width = parseWidth(url)

    // movieId alone would be an unsafe key. `movies.id` is `INTEGER PRIMARY
    // KEY` with no AUTOINCREMENT, so it is a bare rowid: SQLite hands out
    // max(rowid)+1 and frees an id as soon as the highest row is deleted. Rows
    // are deleted routinely — mergeTmdbOnlyIntoPlexRow drops a TMDB-only row
    // whenever a Plex row later claims the same tmdb_id, and
    // pruneStaleTmdbOnlyRows deletes in batches — so an id can be reissued to
    // a completely different film. Keyed on the id alone, this cache would
    // then serve the old film's poster to *every* client for the rest of the
    // TTL. (The browser-side `immutable` header has always had a narrower
    // version of this problem; a shared server cache would widen it from one
    // stale browser to all of them.)
    //
    // So the key also carries whatever identifies the image upstream, which is
    // stable across id reuse: the Plex rating key, or the TMDB poster path.
    // width is in there because the three allowed widths are three images.
    const posterIdentity = row.posterSource === 'plex' ? `plex:${row.plexRatingKey}` : `tmdb:${row.posterPath}`
    const cacheKey = `${movieId}:${width}:${posterIdentity}`
    const cached = cache.get(cacheKey)
    if (cached) return imageResponseFromBytes(cached)

    // 404s are decided before loadOnce so a missing rating key or poster path
    // never occupies an in-flight slot.
    if (row.posterSource === 'plex' && row.plexRatingKey === null) return new Response(null, { status: 404 })
    if (row.posterSource !== 'plex' && row.posterPath === null) return new Response(null, { status: 404 })

    const image = await cache.loadOnce(cacheKey, async () => {
      let upstream: UpstreamImage
      try {
        if (row.posterSource === 'plex') {
          const link = getPlexLink(db, encryptionKey)
          if (!link) return null
          upstream = await plex.getThumb(link.serverUrl, link.authToken, row.plexRatingKey as string, width)
        } else {
          upstream = await tmdb.getPosterImage(row.posterPath as string, width)
        }
      } catch (err) {
        // Both upstreams are off-process and observably flaky — a Plex server
        // that just went to sleep, or a TMDB CDN connection that intermittently
        // times out from this host. That is a bad gateway, not a fault in this
        // server: letting it throw would surface as an opaque 500 with nothing
        // in the log to explain it.
        console.error(`poster proxy: upstream fetch failed for movieId ${movieId}`, err)
        return null
      }
      try {
        const buffered = await bufferUpstreamImage(upstream)
        // Only successful, validated, size-capped bytes are cached. A 502 is
        // not stored, so a Plex server that was asleep during one request is
        // retried on the next rather than remembered as broken for 24h.
        if (buffered) cache.set(cacheKey, buffered)
        return buffered
      } catch (err) {
        // Reading the body is inside the guarantee too. Anything thrown here
        // would otherwise reject out of the handler and reach index.ts's bare
        // catch as an opaque, unlogged 500 — the exact outcome the fetch
        // branch above goes to trouble to avoid.
        console.error(`poster proxy: reading the upstream body failed for movieId ${movieId}`, err)
        return null
      }
    })

    if (!image) return new Response(null, { status: 502 })
    return imageResponseFromBytes(image)
  }
}
