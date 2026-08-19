// e2e/hostDisconnect.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a guest sees the host-gone edge screen when the host drops, and it clears when the host reconnects', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const { chromium } = await import('@playwright/test')
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
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  // Simulate the host's connection dropping: a reload closes the existing
  // socket (triggering the disconnect broadcast) and, once the page comes
  // back up, re-establishes via the sessionToken/hostToken already in this
  // tab's storage (same technique e2e/reconnect.spec.ts uses).
  const hostGoneCard = guestPage.getByTestId('edge-hostgone')
  await hostPage.reload()
  await expect(hostGoneCard).toBeVisible({ timeout: 15000 })

  // The host's reload lands back on the deck once its own reconnect
  // round-trip completes — that reconnect is what broadcasts
  // host_reconnected to the guest.
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await expect(hostGoneCard).not.toBeVisible({ timeout: 15000 })

  await browser.close()
})
