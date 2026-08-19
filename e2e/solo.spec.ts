// e2e/solo.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('solo: box office links to /solo, filters produce a shortlist, and a direct pick reaches the confirmed screen', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  await page.getByTestId('flying-solo').click()
  await page.waitForURL('/solo')

  await expect(page.getByTestId('chapter-indicator')).toContainText("Trim the bill")

  await expect(page.getByTestId('solo-eligible-count')).not.toHaveText('—', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()

  await expect(page.getByTestId('chapter-indicator')).toContainText("Tonight's bill")
  const cards = page.getByTestId('shortlist-card')
  await expect(cards.first()).toBeVisible({ timeout: 15000 })

  await cards.first().getByRole('button', { name: 'Pick this' }).click()

  await expect(page.getByTestId('chapter-indicator')).toContainText('Your pick')
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

  // Fixture library's titles don't clear an impossible rating bar — see
  // server/plex/fakeClient.ts for the fixed 10-title set's actual ratings.
  await page.getByPlaceholder('e.g. Comedy').fill('Nonexistent Genre XYZ')
  // solo-eligible-count's DOM text is the count number concatenated with a
  // "titles" label span (no separator) — toHaveText('0') against the whole
  // testid node would never match "0titles"; target the count's own child
  // span instead.
  await expect(page.getByTestId('solo-eligible-count').locator('span').first()).toHaveText('0', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()

  await expect(page.getByTestId('edge-poolfail')).toBeVisible({ timeout: 15000 })
})
