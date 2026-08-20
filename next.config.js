// next.config.js
import createNextIntlPlugin from 'next-intl/plugin'
import { SECURITY_HEADERS_LIST } from './lib/securityHeaders.mjs'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Applied to every Next-served route. The /api/* routes bypass Next
  // entirely (server/index.ts dispatches them before handleNextRequest) and
  // apply the same shared list themselves — see lib/securityHeaders.mjs.
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS_LIST }]
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
