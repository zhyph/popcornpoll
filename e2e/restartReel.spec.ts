// e2e/restartReel.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { expectRosterCount, pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a non-host cannot trigger restart-reel, and the host round-trip resets the deck', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
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
  await expectRosterCount(hostPage, 2)

  await hostPage.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  await expect(guestPage.getByTestId('restart-reel')).toHaveCount(0) // host-only: not rendered for a guest

  // Vote once from both participants so totalVotes > 0 going into the
  // restart — exercises the two-tap confirm path, not the zero-votes
  // instant-reset path. Deliberately NOT a matching vote: a freshly created
  // room's default matchThreshold is 'all' (Box office's default-pressed
  // "Everyone must say yes"), so both participants voting Yes on the same
  // first card triggers an immediate real match — pulling in the whole
  // match-reveal overlay/auto-dismiss lifecycle, which this test has nothing
  // to do with and isn't equipped to wait out. Voting oppositely (host No,
  // guest Yes) still consumes a real swipe from each (incrementing
  // totalVotes by 2) without ever satisfying the match threshold, so the
  // deck just advances normally for both.
  //
  // SwipeDeck's decision animation runs before it actually sends the swipe,
  // so clicking restart immediately after clicking can race the swipe's
  // round trip. Waiting for the card to change is NOT sufficient by itself:
  // server/ws/server.ts sends a swiping participant's own `next_card` via
  // `toSender` BEFORE it broadcasts `state_update` (carrying totalVotes) via
  // `toRoom` — both messages arrive on the same connection in that fixed
  // order, so "the card changed" is guaranteed to be observable strictly
  // before totalVotes updates, not after. The card-title wait still confirms
  // the swipe was consumed at all (a real, useful signal); the short
  // additional wait below covers the gap to the very next message on that
  // same connection, which normally lands within single-digit milliseconds.
  const hostTitleBeforeVote = await hostPage.locator('[data-testid="swipe-card"] h2').textContent()
  const guestTitleBeforeVote = await guestPage.locator('[data-testid="swipe-card"] h2').textContent()
  await hostPage.click('button[aria-label="No"]')
  await guestPage.click('button[aria-label="Yes"]')
  await hostPage.waitForFunction(
    (prevTitle) => document.querySelector('[data-testid="swipe-card"] h2')?.textContent !== prevTitle,
    hostTitleBeforeVote,
  )
  await guestPage.waitForFunction(
    (prevTitle) => document.querySelector('[data-testid="swipe-card"] h2')?.textContent !== prevTitle,
    guestTitleBeforeVote,
  )
  await hostPage.waitForTimeout(300)

  const restartButton = hostPage.getByTestId('restart-reel')
  await restartButton.click()
  await expect(restartButton).toHaveText(/discard/i)

  // Capture each card's title right before the actual restart fires — this
  // is what makes the closing assertion mean something. Both cards are
  // already visible pre-restart, so merely asserting visibility again would
  // pass even against a restart_reel that does nothing; comparing titles
  // only passes if the pool was genuinely rebuilt and a fresh card assigned.
  const hostTitleBeforeRestart = await hostPage.locator('[data-testid="swipe-card"] h2').textContent()
  const guestTitleBeforeRestart = await guestPage.locator('[data-testid="swipe-card"] h2').textContent()
  await restartButton.click()

  await hostPage.waitForFunction(
    (prevTitle) => document.querySelector('[data-testid="swipe-card"] h2')?.textContent !== prevTitle,
    hostTitleBeforeRestart,
  )
  await guestPage.waitForFunction(
    (prevTitle) => document.querySelector('[data-testid="swipe-card"] h2')?.textContent !== prevTitle,
    guestTitleBeforeRestart,
  )
  await expect(hostPage.locator('[data-testid="swipe-card"] h2')).not.toHaveText(hostTitleBeforeRestart ?? '')
  await expect(guestPage.locator('[data-testid="swipe-card"] h2')).not.toHaveText(guestTitleBeforeRestart ?? '')
  await browser.close()
})
