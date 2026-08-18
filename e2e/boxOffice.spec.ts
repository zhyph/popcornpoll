// e2e/boxOffice.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('box office shows real stats and a live eligible count, and still creates a room', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  // The stat panel sits below the fold on load. CountUp (components/ui/reactbits/CountUp.tsx)
  // only starts its count-up animation once its element enters the viewport
  // (framer-motion's useInView, { once: true }) — exactly like a real user
  // would need to scroll to see it animate. Scroll it into view first, or
  // the assertions below hang at the un-animated "0" from-value forever.
  await page.getByTestId('stat-library').scrollIntoViewIfNeeded()

  // Stats load from the real fixture library seeded above: the fixture is a
  // fixed 10-title set (server/plex/fakeClient.ts), so the library count is
  // deterministically 10 once /api/stats resolves and CountUp settles.
  // (A "not zero" substring check would be a false negative here — "10"
  // contains "0" — so assert the exact known value instead.)
  // Wider timeout than this suite's usual 15s (see e.g. e2e/authorization.spec.ts):
  // unlike those specs, whose first 15s-timeout assertion comes after an
  // earlier navigation already warmed up the room route, this is the very
  // first request against a freshly-booted dev server — it pays BOTH the
  // page route's compile AND /api/stats's on-demand compile (observed up to
  // ~25-30s cold, per playwright.config.ts's comment) before any data shows.
  await expect(page.getByTestId('stat-library')).toHaveText('10', { timeout: 30000 })

  // Live eligible count responds to a filter edit.
  const genreInput = page.getByPlaceholder('e.g. Comedy')
  await genreInput.fill('Nonexistent Genre XYZ')
  await expect(page.getByTestId('stat-pool')).toHaveText('0', { timeout: 15000 })
  await genreInput.fill('')

  // The restyled CTA still creates a room.
  await page.getByTestId('create-room').click()
  await page.waitForURL(/\/room\//)
})
