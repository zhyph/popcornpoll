// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // each test starts its own server on a fresh port; keep simple, no port contention
  timeout: 60_000,
  webServer: {
    // Run against a production build, not `next dev`. Root-caused via
    // systematic-debugging: in this environment, Next.js dev mode's client
    // runtime does not hydrate when the page is driven by Playwright Test's
    // own launched Chromium — clicks never reach React's event handlers and
    // client-side effects never fire, with no console error (confirmed by a
    // minimal page.setContent() repro that ruled out the browser/JS engine
    // itself: MessageChannel/rAF scheduling primitives work fine, and a
    // plain inline onclick handler fires — so this is specific to Next dev
    // mode's own client bundle). The same page hydrates correctly when
    // driven interactively (e.g. via an MCP browser tool) or when served
    // from a production build. Building first and serving with
    // NODE_ENV=production sidesteps the dev-mode-specific failure — and is
    // also just a better match for real deployed behavior, without dev
    // mode's on-demand per-route compile cost or HMR-socket churn.
    command: 'npm run build && npm run start',
    port: 3100,
    reuseExistingServer: false,
    timeout: 120_000, // `next build` runs before the server starts listening
    env: {
      FAKE_EXTERNAL_APIS: 'true',
      POOL_SIZE_CAP: '6',
      ROOM_RNG_SEED: '42',
      TMDB_API_KEY: 'fake',
      AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
      ADMIN_SETUP_TOKEN: 'admin',
      APP_ORIGIN: 'http://localhost:3100',
      PORT: '3100',
      NODE_ENV: 'production',
    },
  },
  use: { baseURL: 'http://localhost:3100' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
