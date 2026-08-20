// e2e/solo.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('solo: box office links to /solo, filters produce a shortlist, and a direct pick reaches the confirmed screen', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  await page.getByTestId('flying-solo').click()
  await page.waitForURL('/solo')

  // aria-current="step" marks the active chip specifically — the header
  // renders all three step labels at once regardless of screen (only
  // styling differs), so asserting on plain text-contains would pass
  // trivially on any solo screen; scoping to the active chip is what
  // actually verifies progression. toContainText, not toHaveText: each chip
  // also renders its step number (or a ✓ once passed) inside the same
  // element, so the full text is "1Trim the bill".
  await expect(page.locator('[data-testid="chapter-indicator"] [aria-current="step"]')).toContainText('Trim the bill')

  await expect(page.getByTestId('solo-eligible-count')).not.toHaveText('—', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()

  await expect(page.locator('[data-testid="chapter-indicator"] [aria-current="step"]')).toContainText("Tonight's bill")
  const cards = page.getByTestId('shortlist-card')
  await expect(cards.first()).toBeVisible({ timeout: 15000 })

  await cards.first().getByRole('button', { name: 'Pick this' }).click()

  await expect(page.locator('[data-testid="chapter-indicator"] [aria-current="step"]')).toContainText('Your pick')
  await expect(page.getByTestId('solo-room-code')).toContainText('solo-')
})

test('solo: surprise me reveals a title from the shortlist and can be re-rolled before confirming', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/solo')

  await expect(page.getByTestId('solo-eligible-count')).not.toHaveText('—', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()
  await expect(page.getByTestId('shortlist-card').first()).toBeVisible({ timeout: 15000 })

  await page.getByTestId('surprise-me').click()
  await expect(page.getByTestId('watch-this')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('reroll').click()
  await expect(page.getByTestId('watch-this')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('watch-this').click()
  await expect(page.getByTestId('solo-room-code')).toContainText('solo-')
})

test('solo: filters narrow enough to fail submission show the full-screen pool-fail edge state, not a toast', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/solo')

  // Genre is a closed select fed by the library's own shelf, so narrow on
  // "Year, from" instead: the fixture set's newest title is 2021
  // (server/plex/fakeClient.ts), and validateTmdbFilters clamps any larger
  // year down to next year, so this empties the pool in every calendar year.
  await page.getByPlaceholder('1930').fill('3000')
  // solo-eligible-count's DOM text is the count number concatenated with a
  // "titles" label span (no separator) — toHaveText('0') against the whole
  // testid node would never match "0titles"; target the count's own child
  // span instead.
  await expect(page.getByTestId('solo-eligible-count').locator('span').first()).toHaveText('0', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()

  await expect(page.getByTestId('edge-poolfail')).toBeVisible({ timeout: 15000 })
})
