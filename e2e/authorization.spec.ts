// e2e/authorization.spec.ts
import { test, expect, chromium } from '@playwright/test'

test('a non-host cannot start the room', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostPage = await (await browser.newContext()).newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestPage = await (await browser.newContext()).newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')

  await expect(guestPage.locator('text=Start')).not.toBeVisible()
  await browser.close()
})

test('reconnecting with only sessionToken (no hostToken) does not grant host controls', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]
  const sessionToken = await hostPage.evaluate((code) => sessionStorage.getItem(`sessionToken:${code}`), roomCode)

  // A fresh context simulates a device that has the host's sessionToken
  // (e.g. copied out-of-band) but never received hostToken — the real
  // credential kept only in the original browser's localStorage.
  const strippedContext = await browser.newContext()
  const strippedPage = await strippedContext.newPage()
  await strippedPage.goto(`/room/${roomCode}`)
  await strippedPage.evaluate(
    ({ code, token }) => sessionStorage.setItem(`sessionToken:${code}`, token as string),
    { code: roomCode, token: sessionToken },
  )
  await strippedPage.reload()

  await expect(strippedPage.locator('text=Start')).not.toBeVisible()
  await browser.close()
})
