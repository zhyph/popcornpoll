// e2e/boxOffice.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('box office shows real stats and a live eligible count, and still creates a room', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  // Stats load from the real fixture library seeded above: the fixture is a
  // fixed 10-title set (server/plex/fakeClient.ts), so the library count is
  // deterministically 10 once /api/stats resolves and CountUp settles.
  // (A "not zero" substring check would be a false negative here — "10"
  // contains "0" — so assert the exact known value instead.)
  // Generous timeout (matching e.g. e2e/authorization.spec.ts's other cases):
  // Next.js dev mode compiles /api/stats on-demand on first hit, on top of
  // the page route itself, which page.goto already paid for.
  await expect(page.getByTestId('stat-library')).toHaveText('10', { timeout: 15000 })

  // Live eligible count responds to a filter edit.
  const genreInput = page.getByPlaceholder('e.g. Comedy')
  await genreInput.fill('Nonexistent Genre XYZ')
  await expect(page.getByTestId('stat-pool')).toHaveText('0', { timeout: 15000 })
  await genreInput.fill('')

  // The restyled CTA still creates a room.
  await page.getByTestId('create-room').click()
  await page.waitForURL(/\/room\//)
})
