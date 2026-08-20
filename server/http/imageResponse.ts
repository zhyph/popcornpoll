// server/http/imageResponse.ts
//
// Builds every poster response (http/imageProxy.ts, serving both the Plex and
// TMDB sources). This started as two independent proxies with their own
// copies of the size cap and the content-type check, which is exactly how one
// copy quietly drifts from the other: the svg+xml hole below was closed in
// the Plex proxy first and stayed open in the TMDB one, written later from
// the same original template. One implementation means a fix lands on every
// source by construction.

import type { CachedImage } from './imageCache'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// `image/svg+xml` passes a naive startsWith('image/') check but is a
// scriptable document, and these responses are same-origin with the app —
// so an SVG "poster" opened directly (not via <img>) would execute script in
// the origin where the host token lives. Posters are raster formats from
// Plex and TMDB alike, so an explicit allowlist costs nothing real.
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export function isSafeImageType(contentType: string | null): boolean {
  if (!contentType) return false
  // Strip parameters (`; charset=`, `; boundary=`) before matching.
  const [mediaType = ''] = contentType.split(';')
  return ALLOWED_IMAGE_TYPES.has(mediaType.trim().toLowerCase())
}

/**
 * Reads an upstream body into memory, refusing anything past the size cap.
 *
 * This replaced a streaming pass-through when poster caching landed: bytes
 * that are never held cannot be cached, and a poster is tens of kilobytes
 * against a 5MB ceiling, so the streaming was buying nothing that the cache
 * does not now repay many times over. The cap is enforced as the body
 * arrives, not after, so an upstream lying about its length still cannot
 * make this process buffer more than MAX_IMAGE_BYTES.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export interface UpstreamImage {
  body: ReadableStream<Uint8Array> | null
  contentType: string | null
  status: number
}

export async function bufferUpstreamImage(upstream: UpstreamImage): Promise<CachedImage | null> {
  if (upstream.status !== 200 || !upstream.body || !isSafeImageType(upstream.contentType)) {
    // Release the upstream socket rather than leaving it held until GC — a
    // 200 carrying a disallowed content type arrives here with a live body.
    void upstream.body?.cancel().catch(() => {})
    return null
  }
  const bytes = await readCapped(upstream.body, MAX_IMAGE_BYTES)
  if (!bytes) return null
  return { bytes, contentType: upstream.contentType as string }
}

/**
 * The single place poster response headers are written, so a cache hit and a
 * cache miss cannot answer with different headers.
 */
export function imageResponseFromBytes(image: CachedImage): Response {
  return new Response(image.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=86400, immutable',
      // nosniff stops a browser re-interpreting a mislabeled body as HTML;
      // the sandbox CSP neutralizes scripting for anything that still ends up
      // treated as a document. server/index.ts sets nosniff on every /api
      // response too — repeated here so the guarantee belongs to this
      // response builder rather than to one caller's dispatch path.
      //
      // frame-ancestors is restated for the same reason: that merge is
      // per-header-name, so this value *replaces* the shared
      // "frame-ancestors 'none'" rather than intersecting with it. Omitting it
      // here would quietly leave framing protection for poster responses
      // resting on X-Frame-Options alone.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
    },
  })
}
