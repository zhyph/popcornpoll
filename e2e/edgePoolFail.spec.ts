// e2e/edgePoolFail.spec.ts
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { test, expect, chromium } from '@playwright/test'
import { E2E_DATA_DIR } from './dataDir'
import { expectRosterCount, pinEnglishLocale, seedFakeLibrary } from './fixtures'

// Both tests need a second participant: startRoom() (server/room/activeActions.ts)
// enforces MIN_PARTICIPANTS_TO_START = 2 before it ever attempts to build the
// pool, so a host-only room's Start always fails with not_enough_participants
// rather than reaching the library_empty/pool_too_small check this test is
// meant to exercise. See e2e/reconnect.spec.ts / e2e/kicked.spec.ts for the
// same host+guest join pattern.

// A literal "never synced" library (i.e. skipping seedFakeLibrary entirely,
// as originally attempted here) does not stay empty long enough to test
// against: server/http/rooms.ts's room-creation handler blocks on
// `SELECT COUNT(*) FROM movies` === 0 and *awaits* librarySync.run() before
// creating the room ("a cold cache blocks room creation on the first sync so
// a client never creates a room against an empty library"), and in
// FAKE_EXTERNAL_APIS mode that sync always succeeds and populates the fixed
// 10-title fixture — so the room is created with a freshly non-empty
// library regardless. This is true on every run, not just as part of the
// full suite (this whole e2e suite also shares one server process and one
// on-disk SQLite file across every spec file — see playwright.config.ts's
// webServer comment — so an untouched library additionally can't be
// guaranteed once other spec files, e.g. boxOffice.spec.ts, have already
// synced it).
//
// To reach buildPool's real library_empty branch (server/pool/buildPool.ts),
// the library instead needs to have been synced *once* already (so
// room-creation's cold-cache check sees movieCount > 0 and skips
// re-syncing) and then have every Plex-sourced row flipped to
// in_library = 0 — mirroring server/db/movies.ts's own sweepRemoved(),
// which does exactly this when a sync run no longer sees a title in the
// live Plex library, rather than deleting rows outright.
function markPlexLibraryEmpty(): void {
  // E2E_DATA_DIR, not process.env.DATA_DIR: that variable is set on the
  // *server's* environment by playwright.config.ts's webServer block, and is
  // not inherited by this test-runner process — reading it here would fall
  // through to './data', i.e. the developer's own database, and leave the
  // server's actual library untouched.
  const dbPath = join(E2E_DATA_DIR, 'popcornpoll.db')
  const db = new Database(dbPath)
  try {
    db.prepare('UPDATE movies SET in_library = 0 WHERE plex_rating_key IS NOT NULL').run()
  } finally {
    db.close()
  }
}

test('Start shows the empty-library edge screen when the plex library has no movies', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  markPlexLibraryEmpty()
  // markPlexLibraryEmpty() writes straight to the on-disk SQLite file that
  // every spec in this suite shares (one server process, one DB — see
  // playwright.config.ts's webServer comment), so it has to be undone here
  // rather than relying on whatever runs next happening to re-seed. Running
  // the fake resync again is the faithful undo: it re-upserts the same 10
  // fixture titles with in_library = 1, exactly as the initial seed did.
  try {
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
    await expect(hostPage.getByTestId('edge-emptylib')).toBeVisible({ timeout: 15000 })

    await browser.close()
  } finally {
    await seedFakeLibrary(baseURL!)
  }
})

test('Start shows the pool-fail edge screen when filters exclude every movie in a non-empty library', async ({
  baseURL,
}) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')

  // Same reasoning as e2e/boxOffice.spec.ts: genre is a closed select, so
  // the impossible filter is a "Year, from" above the fixture set's newest
  // title (2021, server/plex/fakeClient.ts).
  await hostPage.getByPlaceholder('1930').fill('3000')
  // Unlike e2e/boxOffice.spec.ts, deliberately do NOT clear the filter
  // before creating the room — this test needs it to carry into the
  // room's stored tmdbFilters so Start actually fails.
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
  await expect(hostPage.getByTestId('edge-poolfail')).toBeVisible({ timeout: 15000 })

  await browser.close()
})
