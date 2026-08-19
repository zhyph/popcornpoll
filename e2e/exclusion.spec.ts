// e2e/exclusion.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a participant disconnected through Start is excluded and their reconnect is rejected', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.getByTestId('create-room').click()
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  // A THIRD participant (stayingGuestPage) is required, not two — Task 16
  // established that MIN_PARTICIPANTS_TO_START is checked AFTER excluding
  // disconnected participants (spec-mandated: a room that only "started"
  // because it silently dropped to 1 real participant would match on the
  // very first yes swipe). With only host + 1 disconnecting guest, Start
  // would correctly be rejected — this scenario needs someone who stays
  // connected through Start so the post-exclusion count is still 2.
  const stayingGuestContext = await browser.newContext()
  await pinEnglishLocale(stayingGuestContext, baseURL!)
  const stayingGuestPage = await stayingGuestContext.newPage()
  await stayingGuestPage.goto(`/join/${roomCode}`)
  await stayingGuestPage.getByTestId('join-name-input').fill('Staying Guest')
  await stayingGuestPage.getByTestId('join-submit').click()
  await stayingGuestPage.waitForSelector('text=Admitted')

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.getByTestId('join-name-input').fill('Disconnecting Guest')
  await guestPage.getByTestId('join-submit').click()
  await guestPage.waitForSelector('text=Admitted') // the lobby roster panel's heading
  const guestSessionToken = await guestPage.evaluate((code) => sessionStorage.getItem(`sessionToken:${code}`), roomCode)

  await guestContext.close() // simulates the guest going fully offline before Start
  await hostPage.waitForTimeout(3000) // exceed the heartbeat timeout so the server marks them disconnected
  await hostPage.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await hostPage.waitForSelector('[data-testid="swipe-card"]')

  const reconnectingContext = await browser.newContext()
  await pinEnglishLocale(reconnectingContext, baseURL!)
  const reconnectingPage = await reconnectingContext.newPage()
  await reconnectingPage.goto(`/room/${roomCode}`)
  await reconnectingPage.evaluate(
    ({ code, token }) => sessionStorage.setItem(`sessionToken:${code}`, token as string),
    { code: roomCode, token: guestSessionToken },
  )
  await reconnectingPage.reload()
  await expect(reconnectingPage.locator('text=Connecting')).toBeVisible() // never resolves to a room view — reconnect was rejected
  await browser.close()
})
