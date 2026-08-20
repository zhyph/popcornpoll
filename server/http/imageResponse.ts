// server/http/imageResponse.ts
//
// Shared by both poster proxies — /api/plex-image (http/imageProxy.ts) and
// /api/tmdb-image (http/tmdbImageProxy.ts). They had independent copies of
// the size cap and the content-type check, which is exactly how one copy
// quietly drifts from the other: the svg+xml hole below was closed in the
// Plex proxy first and was still open in the TMDB proxy, because the TMDB
// one was written later from the same original template. One implementation
// means a fix lands in both by construction.

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

export interface UpstreamImage {
  body: ReadableStream<Uint8Array> | null
  contentType: string | null
  status: number
}

// Turns an upstream poster response into the response this server sends back:
// 502 for anything that isn't a usable, safe image, otherwise a size-capped
// stream carrying the headers that make a same-origin image response inert.
export function imageResponse(upstream: UpstreamImage): Response {
  if (upstream.status !== 200 || !upstream.body || !isSafeImageType(upstream.contentType)) {
    return new Response(null, { status: 502 })
  }
  return new Response(capStreamSize(upstream.body, MAX_IMAGE_BYTES), {
    status: 200,
    headers: {
      'Content-Type': upstream.contentType as string,
      'Cache-Control': 'public, max-age=86400, immutable',
      // nosniff stops a browser re-interpreting a mislabeled body as HTML;
      // the sandbox CSP neutralizes scripting for anything that still ends up
      // treated as a document. server/index.ts sets nosniff on every /api
      // response too — repeated here so the guarantee belongs to this
      // response builder rather than to one caller's dispatch path.
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    },
  })
}
