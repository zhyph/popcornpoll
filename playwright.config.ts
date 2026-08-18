// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // each test starts its own server on a fresh port; keep simple, no port contention
  // Next.js dev-mode compiles each route on-demand on first request; whichever
  // test happens to run first against a freshly-booted webServer can pay a
  // real, legitimate compile cost (observed up to ~25-30s under load) on top
  // of its actual assertions. The default 30s per-test timeout leaves no
  // margin for that — bump it so cold-start compile time doesn't read as a
  // test failure.
  timeout: 60_000,
  webServer: {
    command: 'npm run dev',
    port: 3100,
    reuseExistingServer: false,
    env: {
      FAKE_EXTERNAL_APIS: 'true',
      POOL_SIZE_CAP: '6',
      ROOM_RNG_SEED: '42',
      TMDB_API_KEY: 'fake',
      AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
      ADMIN_SETUP_TOKEN: 'admin',
      APP_ORIGIN: 'http://localhost:3100',
      PORT: '3100',
    },
  },
  use: { baseURL: 'http://localhost:3100' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
