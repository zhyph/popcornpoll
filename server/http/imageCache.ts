// server/http/imageCache.ts
//
// A bounded in-process cache for poster bytes.
//
// Without it, every /api/poster request is a fresh round trip to Plex or
// TMDB. The browser-facing `Cache-Control: immutable, max-age=86400` only
// helps a browser that already holds the poster: the ranked solo list alone
// renders 24 posters at once, and each participant who opens a room is a
// separate cold browser cache asking this server for the same images again.
// Four people in one room means the same 24 posters fetched 96 times from a
// household Plex server — with the fetches issued from the single-threaded
// process that also serves SSR and the WebSocket session.
//
// Deliberately in-process and bounded rather than on disk: PopcornPoll is one
// replica with a SQLite file next to it, so there is no cross-process cache to
// keep coherent, and a byte cap is the only thing that keeps a large library
// from turning this into an unbounded memory leak.

export interface CachedImage {
  bytes: Uint8Array
  contentType: string
}

export interface ImageCacheStats {
  entries: number
  bytes: number
  hits: number
  misses: number
  evictions: number
}

export interface ImageCache {
  /** Returns the cached image, or undefined on miss or expiry. */
  get(key: string): CachedImage | undefined
  /** Stores an image, evicting least-recently-used entries to stay under the byte cap. */
  set(key: string, image: CachedImage): void
  /**
   * Runs `load` for `key`, sharing one in-flight call across concurrent
   * callers. The 24 posters of a solo list are requested in parallel, and a
   * room full of participants requests overlapping sets at the same moment —
   * without this, N simultaneous misses for one poster become N upstream
   * fetches.
   */
  loadOnce(key: string, load: () => Promise<CachedImage | null>): Promise<CachedImage | null>
  stats(): ImageCacheStats
}

export interface ImageCacheOptions {
  /** Total bytes of poster data to hold. */
  maxBytes?: number
  /**
   * How long an entry stays usable. Matches the 24h the browser is told to
   * hold the same bytes, so a poster changed in Plex converges on both sides
   * within a day rather than one outliving the other.
   */
  ttlMs?: number
  /** Injected in tests; defaults to Date.now. */
  now?: () => number
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

interface Entry {
  image: CachedImage
  expiresAt: number
}

export function createImageCache(options: ImageCacheOptions = {}): ImageCache {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const now = options.now ?? Date.now

  // Map keeps insertion order, and re-inserting on read moves an entry to the
  // end — that ordering is the LRU list, so no separate structure is needed.
  const entries = new Map<string, Entry>()
  const inFlight = new Map<string, Promise<CachedImage | null>>()
  let bytes = 0
  let hits = 0
  let misses = 0
  let evictions = 0

  function drop(key: string): void {
    const existing = entries.get(key)
    if (!existing) return
    bytes -= existing.image.bytes.byteLength
    entries.delete(key)
  }

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) {
        misses++
        return undefined
      }
      if (entry.expiresAt <= now()) {
        drop(key)
        misses++
        return undefined
      }
      // Re-insert to move this key to the most-recently-used end.
      entries.delete(key)
      entries.set(key, entry)
      hits++
      return entry.image
    },

    set(key, image) {
      // An image larger than the whole cache would evict everything and then
      // sit there alone; skip it rather than let one poster flush the cache.
      if (image.bytes.byteLength > maxBytes) return
      drop(key)
      entries.set(key, { image, expiresAt: now() + ttlMs })
      bytes += image.bytes.byteLength
      while (bytes > maxBytes) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        drop(oldest.value)
        evictions++
      }
    },

    async loadOnce(key, load) {
      const pending = inFlight.get(key)
      if (pending) return pending
      const promise = load().finally(() => {
        inFlight.delete(key)
      })
      inFlight.set(key, promise)
      return promise
    },

    stats() {
      return { entries: entries.size, bytes, hits, misses, evictions }
    },
  }
}
