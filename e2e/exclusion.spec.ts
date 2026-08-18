// e2e/exclusion.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { seedFakeLibrary } from './fixtures'

test('a participant disconnected through Start is excluded and their reconnect is rejected', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostPage = await (await browser.newContext()).newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  // A THIRD participant (stayingGuestPage) is required, not two — Task 16
  // established that MIN_PARTICIPANTS_TO_START is checked AFTER excluding
  // disconnected participants (spec-mandated: a room that only "started"
  // because it silently dropped to 1 real participant would match on the
  // very first yes swipe). With only host + 1 disconnecting guest, Start
  // would correctly be rejected — this scenario needs someone who stays
  // connected through Start so the post-exclusion count is still 2.
  const stayingGuestPage = await (await browser.newContext()).newPage()
  await stayingGuestPage.goto(`/join/${roomCode}`)
  await stayingGuestPage.fill('input[placeholder="Your name"]', 'Staying Guest')
  await stayingGuestPage.click('text=Join')
  await stayingGuestPage.waitForSelector('text=Admitted')

  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Disconnecting Guest')
  await guestPage.click('text=Join')
  await guestPage.waitForSelector('text=Admitted') // the lobby roster panel's heading
  const guestSessionToken = await guestPage.evaluate((code) => sessionStorage.getItem(`sessionToken:${code}`), roomCode)

  await guestContext.close() // simulates the guest going fully offline before Start
  await hostPage.waitForTimeout(3000) // exceed the heartbeat timeout so the server marks them disconnected
  await hostPage.click('text=Start')
  await hostPage.waitForSelector('[data-testid="swipe-card"]')

  const reconnectingPage = await (await browser.newContext()).newPage()
  await reconnectingPage.goto(`/room/${roomCode}`)
  await reconnectingPage.evaluate(
    ({ code, token }) => sessionStorage.setItem(`sessionToken:${code}`, token as string),
    { code: roomCode, token: guestSessionToken },
  )
  await reconnectingPage.reload()
  await expect(reconnectingPage.locator('text=Connecting')).toBeVisible() // never resolves to a room view — reconnect was rejected
  await browser.close()
})
