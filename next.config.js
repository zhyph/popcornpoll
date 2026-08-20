// next.config.js
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

// Applied to every Next-served route. The /api/* routes bypass Next entirely
// (server/index.ts dispatches them before handleNextRequest), so they set the
// same list themselves — SECURITY_HEADERS there is the other half of this.
//
// Deliberately no script-src/style-src CSP yet: this app runs GSAP,
// framer-motion and ogl, all of which write inline styles, and Next injects
// inline bootstrap scripts. A real policy for that needs verifying in a
// browser against the actual animation paths, not just a green unit suite, so
// it's left as follow-up rather than shipped half-checked. frame-ancestors is
// safe to set now because it constrains only framing, not execution.
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org' }],
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
  experimental: {
    // TypeScript 7 (this repo's pinned devDependency, see package.json) no
    // longer ships typescript/lib/typescript.js, the compiler API Next.js's
    // build pipeline used to require() directly for type-checking. Next.js
    // 16.3.1 already defaults experimental.useTypeScriptCli to true (see
    // node_modules/next/dist/server/config-shared.js's defaultConfig), which
    // routes type-checking through a `tsc` subprocess instead — that's why
    // `next build` works today with zero config here. Setting it explicitly
    // makes that dependency load-bearing and visible, rather than resting on
    // an *experimental* flag's current default, which a future Next patch
    // release is free to change without notice. TS7's classic compiler API
    // isn't coming back (it's a from-scratch Go rewrite), so this repo will
    // need CLI-based type-checking for as long as it's on TypeScript 7.
    useTypeScriptCli: true,
  },
}

export default withNextIntl(nextConfig)
