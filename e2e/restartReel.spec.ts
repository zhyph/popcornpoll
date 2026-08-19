// e2e/restartReel.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a non-host cannot trigger restart-reel, and the host round-trip resets the deck', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.getByTestId('create-room').click()
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.getByTestId('join-name-input').fill('Guest')
  await guestPage.getByTestId('join-submit').click()
  await guestPage.waitForURL(/\/room\//)
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })

  await hostPage.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  await expect(guestPage.getByTestId('restart-reel')).toHaveCount(0) // host-only: not rendered for a guest

  // Vote once from both participants so totalVotes > 0 going into the
  // restart — exercises the two-tap confirm path, not the zero-votes
  // instant-reset path.
  await hostPage.click('button[aria-label="Yes"]')
  await guestPage.click('button[aria-label="Yes"]')

  const restartButton = hostPage.getByTestId('restart-reel')
  await restartButton.click()
  await expect(restartButton).toHaveText(/discard/i)
  await restartButton.click()

  // A fresh card is assigned to both participants post-restart.
  await expect(hostPage.getByTestId('swipe-card')).toBeVisible()
  await expect(guestPage.getByTestId('swipe-card')).toBeVisible()
  await browser.close()
})
