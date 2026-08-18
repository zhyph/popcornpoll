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
  // *capacity*: it never holds more than 10 tokens and refills at ~1 token
  // per 6 seconds, so a burst of 15 near-simultaneous requests — far more
  // than can be refilled in the time it takes to fire them — must contain
  // at least one rejection.
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
