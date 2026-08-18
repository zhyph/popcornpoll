// e2e/fixtures.ts
import { request } from '@playwright/test'

export async function seedFakeLibrary(baseURL: string): Promise<void> {
  const ctx = await request.newContext({ baseURL })
  // In FAKE_EXTERNAL_APIS mode (Step 1), server/index.ts selects
  // createFakePlexClient() and auto-seeds a fixture Plex link, so
  // /api/setup/plex/resync (admin-token-gated) triggers a sync against a
  // fixed 10-title fixture set without needing a real Plex server reachable
  // from the test runner. The resync route awaits the sync synchronously in
  // fake mode, so by the time this resolves the pool is ready.
  await ctx.post('/api/setup/plex/resync', { headers: { Authorization: 'Bearer admin' } })
  await ctx.dispose()
}
