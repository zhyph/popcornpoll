// lib/securityHeaders.mjs
//
// The single definition of the security headers this app sends, shared by the
// two places that have to apply them: next.config.js's headers() (everything
// Next serves) and server/index.ts (every /api/* route, which is dispatched by
// the custom server and never reaches Next). Previously each side kept its own
// hand-copied list; they had already drifted in key casing, which is not
// cosmetic — see the lowercase note below.
//
// Plain .mjs, not .ts: next.config.js is loaded as ESM by Next.js and can only
// import runnable JavaScript, while the TS side type-checks this file through
// allowJs + the JSDoc annotation.
//
// Keys are lowercase on purpose. server/index.ts merges this record with the
// header names a Response yields, and `Headers.forEach` always lowercases —
// with Title-Case keys here the two spellings become distinct properties of
// the same object, so Node emits BOTH and a handler's own value never
// actually replaces the default. That was observable on /api/poster, which
// answered with its `sandbox; default-src 'none'` CSP *and* the
// frame-ancestors one below. Next.js treats header names case-insensitively,
// so lowercase is equally correct on that side.
//
// The Content-Security-Policy below was checked against a running browser
// (dev and a production build), not just a green unit suite:
//
//   - script-src keeps 'unsafe-inline' because Next.js streams its RSC
//     payload through inline `self.__next_f.push(...)` <script> tags on every
//     page. The alternative — a per-request nonce from a proxy/middleware —
//     cannot be baked into prerendered HTML, so it would force every route to
//     render dynamically. Deliberate trade: this policy is about blocking
//     script/style/object loads from *other origins*, not about surviving an
//     inline-injection XSS, which this app has little surface for (all
//     library text renders as escaped React text nodes).
//   - style-src keeps 'unsafe-inline' for the same non-negotiable reason:
//     SSR turns every React `style={{...}}` prop into an inline style
//     attribute, and a nonce never applies to attributes. GSAP, framer-motion
//     and ogl also write styles, though those go through the CSSOM at runtime
//     (el.style.foo = ...), which CSP does not police either way.
//   - 'unsafe-eval' is dev-only: Turbopack's dev runtime evaluates modules
//     with eval, production bundles do not.
//   - connect-src 'self' covers the app's own /ws WebSocket — CSP3 matches
//     ws:/wss: on the same origin against 'self' — and Next's dev HMR socket.
//   - img-src allows data: for inlined build assets; posters all come from
//     this origin through /api/poster.
//   - No upgrade-insecure-requests: this app is routinely self-hosted over
//     plain http on a LAN, and that directive would break those deployments.
//   - frame-ancestors constrains framing only, which is why it was already
//     safe to ship before the rest of this policy was verified.

const isDev = process.env.NODE_ENV !== 'production'

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]

/** @type {Record<string, string>} */
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': CSP_DIRECTIVES.join('; '),
}

/**
 * The same list in the `{ key, value }[]` shape next.config.js's headers()
 * expects.
 *
 * @type {{ key: string, value: string }[]}
 */
export const SECURITY_HEADERS_LIST = Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value }))
