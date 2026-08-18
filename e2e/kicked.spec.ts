// e2e/kicked.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a kicked participant sees the terminal screen and does not reconnect', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  // Wait for both participants to show on the host's roster (one "Remove"
  // button each, host included) before kicking — same join-race reasoning
  // as e2e/reconnect.spec.ts.
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })

  // The host joined first (via hostClaimToken) and is admitted first, so the
  // guest is the second "Remove" button in the roster.
  await hostPage.getByRole('button', { name: 'Remove' }).nth(1).click()

  const terminal = guestPage.getByTestId('terminal-screen')
  await expect(terminal).toBeVisible({ timeout: 15000 })
  await expect(terminal).toContainText('removed you from the room')

  // Wait past one reconnect-backoff cycle to prove wsClient recognized the
  // terminal close code and didn't try to reconnect — a reconnect attempt
  // would flash the page back to "Connecting…" before landing on the
  // terminal screen again (or fail to reconnect at all, since the session
  // was revoked), which this assertion would catch either way.
  await guestPage.waitForTimeout(2000)
  await expect(terminal).toBeVisible()
  await expect(guestPage.locator('text=Connecting')).not.toBeVisible()

  await browser.close()
})

test('remaining participants see the terminal screen when the host ends the session', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })

  await hostPage.click('text=Start')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  await hostPage.click('text=End session')

  const terminal = guestPage.getByTestId('terminal-screen')
  await expect(terminal).toBeVisible({ timeout: 15000 })
  await expect(terminal).toContainText('host ended this session')

  await browser.close()
})
