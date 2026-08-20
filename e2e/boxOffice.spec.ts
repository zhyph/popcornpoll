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
  await expect(page.getByTestId('stat-library')).toHaveText('10', { timeout: 15000 })

  // Live eligible count responds to a filter edit. Genre is a closed select
  // now (its options come from the linked library), so an impossible genre
  // can no longer be typed — narrow on "Year, from" instead. Any value above
  // the fixture set's newest title (2021, server/plex/fakeClient.ts) empties
  // the pool, and validateTmdbFilters clamps whatever is typed down to
  // next year, so this stays 0 no matter what year the suite runs in.
  const yearFrom = page.getByPlaceholder('1930')
  await yearFrom.fill('3000')
  await expect(page.getByTestId('stat-pool')).toHaveText('0', { timeout: 15000 })
  await yearFrom.fill('')

  // The restyled CTA still creates a room.
  await page.getByTestId('create-room').click()
  await page.waitForURL(/\/room\//)
})
