// e2e/reconnect.spec.ts
import { expect, test, chromium } from '@playwright/test'
import { seedFakeLibrary } from './fixtures'

test('participant reconnects and keeps their current pending card', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  // Wait for the host's own roster to show both participants (one "Remove"
  // button per admitted participant, host included) before starting —
  // clicking Start immediately after the guest's client-side navigation
  // races the guest's WS 'join' round-trip, and Start can fail with
  // not_enough_participants (silently, since the client has no 'error'
  // handler) if it wins that race. A plain `text=Guest` wait doesn't work
  // here because the host's own default display name is also "Guest".
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })
  await hostPage.click('text=Start')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  const titleBeforeDisconnect = await guestPage.locator('[data-testid="swipe-card"] h2').textContent()
  await guestPage.reload()
  await guestPage.waitForSelector('[data-testid="swipe-card"]')
  const titleAfterReconnect = await guestPage.locator('[data-testid="swipe-card"] h2').textContent()

  expect(titleAfterReconnect).toBe(titleBeforeDisconnect)
  await browser.close()
})
