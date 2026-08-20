// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
import { E2E_DATA_DIR } from './e2e/dataDir'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // each test starts its own server on a fresh port; keep simple, no port contention
  // All projects share the one webServer above — one process, one SQLite
  // file (DATA_DIR below), one room store, one set of rate-limit buckets —
  // so concurrent chromium/mobile-chrome workers would race on all of it.
  // Per-project isolation isn't a matter of pointing DATA_DIR somewhere
  // else: it would need a separate webServer (and a second full `next
  // build`) per project. fullyParallel:false only
  // serializes tests *within* a file; workers still run different files (or
  // different projects covering the same file) concurrently by default.
  // Force one worker so the whole suite — every project, every file — runs
  // strictly serially against that one shared server. Slower, but correct.
  workers: 1,
  timeout: 60_000,
  // exhaustion.spec.ts's fallback-screen wait has twice needed a bigger
  // fixed timeout to pass under CI-runner load (15s -> 20s, still not
  // always enough with other CI jobs contending for the same runner pool).
  // Retrying under load is the standard fix for that kind of timing
  // sensitivity, rather than guessing at a third timeout constant.
  retries: process.env.CI ? 2 : 0,
  webServer: {
    // Run against a production build, not `next dev`. Dev mode used to be
    // unusable here for a reason that is now fixed and understood: the room
    // server's 'upgrade' listener destroyed every non-/ws upgrade, including
    // Next's dev HMR socket (/_next/hmr), and without that socket Turbopack's
    // dev client never boots — pages render server-side but never hydrate, so
    // clicks reach no React handler and no effect ever runs. server/index.ts
    // now hands /_next/hmr upgrades to Next's own handler in dev. The
    // production build stays the target here anyway: it is what actually gets
    // deployed, and it avoids dev mode's on-demand per-route compile cost and
    // HMR-socket churn inside a timing-sensitive suite.
    // The DATA_DIR below is wiped first so every run starts from an empty
    // database. Without it this suite inherited server/config.ts's './data'
    // default — i.e. the developer's own instance — which both made results
    // depend on whatever library happened to be synced locally and let the
    // fake-Plex resync overwrite that real library's in_library flags.
    command: `rm -rf "${E2E_DATA_DIR}" && npm run build && npm run start`,
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000, // `next build` runs before the server starts listening
    env: {
      FAKE_EXTERNAL_APIS: 'true',
      POOL_SIZE_CAP: '6',
      ROOM_RNG_SEED: '42',
      TMDB_API_KEY: 'fake',
      AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
      // >= MIN_ADMIN_SETUP_TOKEN_LENGTH in server/config.ts, which the
      // server now enforces at boot — a shorter one fails startup here.
      ADMIN_SETUP_TOKEN: 'e2e-admin-token-000000000000',
      APP_ORIGIN: 'http://localhost:3100',
      PORT: '3100',
      NODE_ENV: 'production',
      // See server/rateLimit.ts: this whole suite shares one server process
      // and one client IP, so e2e/rateLimit.spec.ts's burst test (which
      // deliberately drains the bucket to 0) would otherwise starve
      // whatever room-creation or WS upgrade runs next for up to a minute.
      // 5/sec instead of the production ~0.167/sec means it recovers in
      // about 2 seconds.
      ROOM_RATE_LIMIT_REFILL_PER_SECOND: '5',
      // Never the default './data': see the command above.
      DATA_DIR: E2E_DATA_DIR,
    },
  },
  use: { baseURL: 'http://localhost:3100' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
