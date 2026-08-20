// e2e/authorization.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { expectRosterCount, pinEnglishLocale } from './fixtures'

test('a non-host cannot start the room', async ({ baseURL }) => {
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
  // Confirm the guest's join actually completed (both participants visible
  // on the host's roster) before asserting Start stays invisible for the
  // guest — otherwise this could pass vacuously against a silently-failed
  // join, since a guest who never joined also never sees "Start".
  await expectRosterCount(hostPage, 2)

  await expect(guestPage.getByRole('button', { name: 'DIM THE LIGHTS' })).not.toBeVisible()
  await browser.close()
})

test('reconnecting with only sessionToken (no hostToken) does not grant host controls', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.getByTestId('create-room').click()
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]
  const sessionToken = await hostPage.evaluate((code) => sessionStorage.getItem(`sessionToken:${code}`), roomCode)

  // A fresh context simulates a device that has the host's sessionToken
  // (e.g. copied out-of-band) but never received hostToken — the real
  // credential kept only in the original browser's localStorage.
  const strippedContext = await browser.newContext()
  await pinEnglishLocale(strippedContext, baseURL!)
  const strippedPage = await strippedContext.newPage()
  await strippedPage.goto(`/room/${roomCode}`)
  await strippedPage.evaluate(
    ({ code, token }) => sessionStorage.setItem(`sessionToken:${code}`, token as string),
    { code: roomCode, token: sessionToken },
  )
  await strippedPage.reload()

  await expect(strippedPage.getByRole('button', { name: 'DIM THE LIGHTS' })).not.toBeVisible()
  await browser.close()
})

test('host status survives a page reload (hostToken persisted in localStorage)', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.getByTestId('create-room').click()
  await hostPage.waitForURL(/\/room\//)

  // Generous timeouts (matching e.g. e2e/authorization.spec.ts's other cases
  // and playwright.config.ts's own note on Next dev-mode cold-compile cost)
  // rather than the 5s default: this join round-trip can legitimately take
  // longer than that on a first hit to a not-yet-compiled route.
  await expect(hostPage.getByRole('button', { name: 'DIM THE LIGHTS' })).toBeVisible({ timeout: 15000 })
  await hostPage.reload()
  await expect(hostPage.getByRole('button', { name: 'DIM THE LIGHTS' })).toBeVisible({ timeout: 15000 }) // still recognized as host after the refresh
  await browser.close()
})
