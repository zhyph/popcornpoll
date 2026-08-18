import { test, expect, request } from '@playwright/test'

test('rejects a room-creation request with a mismatched Origin header', async ({ baseURL }) => {
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: 'http://evil.example' } })
  const res = await ctx.post('/api/rooms', {
    data: { candidateSource: 'plex', matchThreshold: { kind: 'all' } },
  })
  expect(res.status()).toBe(403)
  const body = await res.json()
  expect(body.error.code).toBe('forbidden_origin')
  await ctx.dispose()
})

test('rate-limits a burst of room-creation requests from one client', async ({ baseURL }) => {
  // The dev server backing this whole Playwright run is shared across every
  // spec file, and POST /api/rooms is rate-limited per resolved client IP —
  // every request in the suite comes from the test runner's own loopback
  // address, so the bucket's exact remaining balance here depends on how
  // many rooms earlier spec files already created via the UI. Asserting an
  // exact "the Nth request fails" boundary would be order-dependent and
  // flaky. What's guaranteed regardless of history is the bucket's
  // *capacity*: it never holds more than 10 tokens (see
  // server/rateLimit.ts), so a burst of 15 near-simultaneous requests — more
  // than the bucket can ever hold at once — must contain at least one
  // rejection.
  //
  // This burst deliberately drains the bucket to 0 for this client IP. That
  // would otherwise starve whatever room-creation or WS upgrade runs next in
  // the same shared-server suite (createRoom() toasts and returns on a 429
  // rather than throwing, so the failure would surface elsewhere as a bare
  // navigation timeout with no clear cause) — playwright.config.ts sets
  // ROOM_RATE_LIMIT_REFILL_PER_SECOND high specifically so this recovers in
  // ~2 seconds instead of up to a minute, rather than leaving each spec file
  // to work around it individually.
  const origin = new URL(baseURL!).origin
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } })
  const results = await Promise.all(
    Array.from({ length: 15 }, () =>
      ctx.post('/api/rooms', { data: { candidateSource: 'plex', matchThreshold: { kind: 'all' } } }),
    ),
  )
  const statuses = results.map((r) => r.status())
  expect(statuses).toContain(429)
  await ctx.dispose()
})
