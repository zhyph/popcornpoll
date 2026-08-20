// e2e/match.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { expectRosterCount, pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('two participants reach a match', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  // Candidate source defaults to 'plex' (CreateRoomPage's initial state) — no
  // interaction with the shadcn Select needed for this scenario.
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
  // Wait for the host's own roster to show both participants before starting
  // — clicking Start immediately after the guest's client-side navigation
  // races the guest's WS 'join' round-trip, and Start can fail with
  // not_enough_participants if it wins that race (the page does toast an
  // 'error' handler now, but this test doesn't wait on a toast — waiting for
  // both participants avoids the race outright). See e2e/reconnect.spec.ts.
  await expectRosterCount(hostPage, 2)

  await hostPage.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  // Both swipe yes on every card in front of them until a match appears —
  // deterministic given ROOM_RNG_SEED, so both land on the same card order.
  for (const page of [hostPage, guestPage]) {
    for (let i = 0; i < 6; i++) {
      // Checked before clicking, not only after: the Match Reveal overlay
      // (app/room/[code]/page.tsx) is fixed on top of the deck, so once it is
      // up a click on the Yes rail is intercepted by it and Playwright waits
      // for actionability until the whole test times out. The match message
      // can arrive a moment *after* the click that caused it, so a
      // check-only-after-clicking loop can miss the banner on iteration N and
      // then hang on iteration N+1's click.
      if ((await page.locator('[data-testid="match-banner"]').count()) > 0) break
      const card = page.locator('[data-testid="swipe-card"]')
      if ((await card.count()) === 0) break
      // SwipeDeck's decision animation runs before it actually sends the
      // swipe, so clicking again before the card changes lands a duplicate
      // click on the *same* card mid-animation — a no-op swipe server-side.
      // See e2e/exhaustion.spec.ts for the same fix and full reasoning.
      const titleBefore = await card.locator('h2').textContent()
      await page.click('button[aria-label="Yes"]')
      // Settle on either outcome of that swipe — the next card, or the match
      // this vote just completed — so the next iteration reads a stable page.
      await page.waitForFunction(
        (prevTitle) => {
          if (document.querySelector('[data-testid="match-banner"]')) return true
          const el = document.querySelector('[data-testid="swipe-card"] h2')
          return !el || el.textContent !== prevTitle
        },
        titleBefore,
      )
    }
  }

  // Assert on the overlay itself, not on the [data-testid] wrapper: that
  // wrapper's only child is `fixed inset-0` (components/MarqueeReveal.tsx),
  // so the wrapper has a zero-size box of its own and Playwright reports it
  // as hidden even while the reveal is plainly on screen. The reveal
  // auto-dismisses after MATCH_REVEAL_MS (8s, app/room/[code]/page.tsx), and
  // the loop above stops on the first match, so this runs well inside it.
  await expect(hostPage.locator('[data-testid="match-banner"] [role="alert"]')).toBeVisible()
  await browser.close()
})
