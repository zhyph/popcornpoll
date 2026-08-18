// e2e/exhaustion.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a session with an unreachable threshold exhausts and shows the ranked fallback, even after a refresh', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  // Match rule defaults to 'all' (CreateRoomPage's initial state) — require
  // unanimity, so one "no" prevents any match. No Select interaction needed.
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  // See e2e/reconnect.spec.ts for why this wait is needed: clicking Start
  // immediately after the guest's client-side navigation races the guest's
  // WS 'join' round-trip, and Start can fail silently (not_enough_participants,
  // no client-side 'error' handler) if it wins that race. A plain `text=Guest`
  // wait doesn't work because the host's own default display name is also
  // "Guest" — wait for both participants' "Remove" buttons instead.
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })
  await hostPage.click('text=Start')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  for (const page of [hostPage, guestPage]) {
    for (let i = 0; i < 6; i++) {
      const card = page.locator('[data-testid="swipe-card"]')
      if ((await card.count()) === 0) break
      // SwipeDeck's decision animation runs before it actually sends the
      // swipe, so clicking "No" again before the card changes lands a
      // duplicate click on the *same* card mid-animation — a no-op swipe
      // server-side (duplicate votes for an already-recorded movieId are
      // ignored), which silently undercounts real votes and leaves the
      // deck short of full exhaustion. Wait for the card to change (new
      // title, or none left) before the next click.
      const titleBefore = await card.locator('h2').textContent()
      await page.click('button[aria-label="No"]') // all-no guarantees zero matches with POOL_SIZE_CAP=6
      await page.waitForFunction(
        (prevTitle) => {
          const el = document.querySelector('[data-testid="swipe-card"] h2')
          return !el || el.textContent !== prevTitle
        },
        titleBefore,
      )
    }
  }

  await expect(hostPage.locator('[data-testid="fallback"]')).toBeVisible()
  await hostPage.reload()
  await expect(hostPage.locator('[data-testid="fallback"]')).toBeVisible() // recoverable from the joined snapshot, not just the one-shot event
  await browser.close()
})
