// e2e/fixtures.ts
import { expect, request, type BrowserContext, type Page } from '@playwright/test'

export async function seedFakeLibrary(baseURL: string): Promise<void> {
  const ctx = await request.newContext({ baseURL })
  // In FAKE_EXTERNAL_APIS mode (Step 1), server/index.ts selects
  // createFakePlexClient() and auto-seeds a fixture Plex link, so
  // /api/setup/plex/resync (admin-token-gated) triggers a sync against a
  // fixed 10-title fixture set without needing a real Plex server reachable
  // from the test runner. The resync route awaits the sync synchronously in
  // fake mode, so by the time this resolves the pool is ready.
  await ctx.post('/api/setup/plex/resync', { headers: { Authorization: 'Bearer e2e-admin-token-000000000000' } })
  await ctx.dispose()
}

export async function pinEnglishLocale(context: BrowserContext, baseURL: string): Promise<void> {
  const url = new URL(baseURL)
  await context.addCookies([{ name: 'locale', value: 'en-us', domain: url.hostname, path: '/' }])
}

// Waits until the host's own roster actually shows `count` participants.
// Every multi-participant spec needs this before asserting anything else,
// otherwise it can pass vacuously against a silently-failed join.
//
// Asserts on the admitted counter, not on the number of "Remove" buttons:
// the host's own ticket has no Remove affordance (a host can't kick
// themselves — see the `!p.isHost` guard in app/room/[code]/page.tsx), so a
// two-person room shows exactly one Remove button. The old
// `toHaveCount(2)` idiom counted an affordance that never existed for the
// host, and went stale the moment that guard landed.
export async function expectRosterCount(hostPage: Page, count: number): Promise<void> {
  await expect(hostPage.getByTestId('admitted-count')).toHaveText(new RegExp(`^${count}\\b`), { timeout: 15000 })
}
