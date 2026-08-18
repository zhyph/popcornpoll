// e2e/match.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('two participants reach a match', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  // Candidate source defaults to 'plex' (CreateRoomPage's initial state) — no
  // interaction with the shadcn Select needed for this scenario.
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  await guestPage.waitForURL(/\/room\//)
  // Wait for the host's own roster to show both participants before starting
  // — clicking Start immediately after the guest's client-side navigation
  // races the guest's WS 'join' round-trip, and Start can fail with
  // not_enough_participants if it wins that race (the page does toast an
  // 'error' handler now, but this test doesn't wait on a toast — waiting for
  // both participants avoids the race outright). See e2e/reconnect.spec.ts.
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })

  await hostPage.click('text=Start')
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  // Both swipe yes on every card in front of them until a match appears —
  // deterministic given ROOM_RNG_SEED, so both land on the same card order.
  for (const page of [hostPage, guestPage]) {
    for (let i = 0; i < 6; i++) {
      const card = page.locator('[data-testid="swipe-card"]')
      if ((await card.count()) === 0) break
      // SwipeDeck's decision animation runs before it actually sends the
      // swipe, so clicking again before the card changes lands a duplicate
      // click on the *same* card mid-animation — a no-op swipe server-side.
      // See e2e/exhaustion.spec.ts for the same fix and full reasoning.
      const titleBefore = await card.locator('h2').textContent()
      await page.click('button[aria-label="Yes"]')
      if (await page.locator('[data-testid="match-banner"]').count() > 0) break
      await page.waitForFunction(
        (prevTitle) => {
          const el = document.querySelector('[data-testid="swipe-card"] h2')
          return !el || el.textContent !== prevTitle
        },
        titleBefore,
      )
    }
  }

  await expect(hostPage.locator('[data-testid="match-banner"]')).toBeVisible()
  await browser.close()
})
