// server/room/activeActions.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { joinRoom, reconnectRoom } from './actions'
import { restartReel, startRoom, swipeAction, type SyncWaiter } from './activeActions'
import { createRoomStore } from './roomStore'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database
const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}
const noOpLibrarySync: SyncWaiter = { async waitForCurrent() {} }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-active-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedPlexRows(count: number) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2020,
      genres: ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

describe('startRoom', () => {
  it('rejects a non-host caller', async () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(10)
    const result = await startRoom(store, code, false, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'not_host' })
  })

  it('rejects Start with fewer than 2 connected participants', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    seedPlexRows(10)
    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'not_enough_participants' })
  })

  it('does not revoke or exclude anyone when Start fails due to not_enough_participants after exclusion', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const flaky = joinRoom(store, code, 'Flaky')
    if (!host.ok || !flaky.ok) throw new Error('setup failed')
    store.get(code)!.participants.get(flaky.data.participantId)!.connectionStatus = 'disconnected'
    seedPlexRows(10)

    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'not_enough_participants' })

    const room = store.get(code)!
    expect(room.status).toBe('lobby')
    expect(room.participants.has(flaky.data.participantId)).toBe(true)
    expect(room.participants.get(flaky.data.participantId)!.connectionStatus).toBe('disconnected')
    expect(room.revokedSessionTokens.has(flaky.data.sessionToken)).toBe(false)
    expect(room.kickReasons.has(flaky.data.sessionToken)).toBe(false)
  })

  it('does not revoke or exclude the would-be-excluded participant when Start fails due to pool_too_small', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    const flaky = joinRoom(store, code, 'Flaky')
    if (!host.ok || !other.ok || !flaky.ok) throw new Error('setup failed')
    store.get(code)!.participants.get(flaky.data.participantId)!.connectionStatus = 'disconnected'
    seedPlexRows(2) // below POOL_MIN_SIZE (5)

    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'pool_too_small' })

    const room = store.get(code)!
    expect(room.status).toBe('lobby')
    expect(room.participants.size).toBe(3)
    expect(room.participants.has(flaky.data.participantId)).toBe(true)
    expect(room.revokedSessionTokens.has(flaky.data.sessionToken)).toBe(false)
    expect(room.kickReasons.has(flaky.data.sessionToken)).toBe(false)
  })

  it('retries and succeeds once the previously-disconnected participant reconnects', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const flaky = joinRoom(store, code, 'Flaky')
    if (!host.ok || !flaky.ok) throw new Error('setup failed')
    store.get(code)!.participants.get(flaky.data.participantId)!.connectionStatus = 'disconnected'
    seedPlexRows(10)

    const failed = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(failed).toEqual({ ok: false, code: 'not_enough_participants' })

    // The flaky client, still carrying its original (never revoked)
    // sessionToken, reconnects — exactly what its browser does on any page
    // reload, since the token was never invalidated by the failed attempt.
    const reconnected = reconnectRoom(store, code, flaky.data.sessionToken)
    expect(reconnected.ok).toBe(true)
    expect(store.get(code)!.participants.get(flaky.data.participantId)!.connectionStatus).toBe('connected')

    const retried = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(retried.ok).toBe(true)
    if (!retried.ok) return
    expect(retried.data.excludedParticipantIds).toEqual([])
    const room = store.get(code)!
    expect(room.status).toBe('active')
    expect(room.participants.has(flaky.data.participantId)).toBe(true)
  })

  it('excludes a disconnected participant from the frozen set and revokes their session with excluded_at_start', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    const flaky = joinRoom(store, code, 'Flaky')
    if (!host.ok || !other.ok || !flaky.ok) throw new Error('setup failed')
    store.get(code)!.participants.get(flaky.data.participantId)!.connectionStatus = 'disconnected'
    seedPlexRows(10)

    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.excludedParticipantIds).toEqual([flaky.data.participantId])
    const room = store.get(code)!
    expect(room.participants.has(flaky.data.participantId)).toBe(false)
    expect(room.revokedSessionTokens.has(flaky.data.sessionToken)).toBe(true)
    expect(room.kickReasons.get(flaky.data.sessionToken)).toBe('excluded_at_start')
  })

  it('rejects Start when the resulting pool has fewer than POOL_MIN_SIZE candidates', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    seedPlexRows(2) // below POOL_MIN_SIZE (5)
    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'pool_too_small' })
    expect(store.get(code)!.status).toBe('lobby')
  })

  it('rejects Start with library_empty when the plex library has zero movies at all', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    // No seedPlexRows call.
    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'library_empty' })
    expect(store.get(code)!.status).toBe('lobby')
  })

  it('on success, moves to active, freezes the pool, and assigns each participant a first pendingCardId', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(20)

    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result.ok).toBe(true)
    const room = store.get(code)!
    expect(room.status).toBe('active')
    expect(room.pool.length).toBeGreaterThanOrEqual(5)
    expect(room.participants.get(host.data.participantId)!.pendingCardId).not.toBeNull()
    expect(room.participants.get(other.data.participantId)!.pendingCardId).not.toBeNull()
  })

  it('propagates buildPool degraded: true through to the caller on TMDB failure', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex+tmdb', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(20)
    const failingTmdb: TmdbClient = {
      discoverMovies: vi.fn().mockRejectedValue(new Error('TMDB is down')),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
    }

    const result = await startRoom(store, code, true, db, failingTmdb, noOpLibrarySync)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.degraded).toBe(true)
    expect(store.get(code)!.status).toBe('active') // degraded, not failed — the room still starts
  })

  it('reverts to lobby instead of wedging in "starting" when librarySync.waitForCurrent throws', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(20)
    const throwingLibrarySync: SyncWaiter = {
      waitForCurrent: vi.fn().mockRejectedValueOnce(new Error('sync wait failed')),
    }

    await expect(startRoom(store, code, true, db, noOpTmdb, throwingLibrarySync)).rejects.toThrow(
      'sync wait failed',
    )

    // The room must not be permanently wedged in 'starting' — a retry should
    // still be possible instead of only recoverable via the 30-minute
    // inactivity sweep.
    expect(store.get(code)!.status).toBe('lobby')
  })
})

describe('startRoom notifyStarting callback', () => {
  it('invokes notifyStarting synchronously right after flipping to starting', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'Other')
    seedPlexRows(10)

    const seenStatuses: string[] = []
    const notifyStarting = vi.fn(() => seenStatuses.push(store.get(code)!.status))
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync, notifyStarting)

    expect(notifyStarting).toHaveBeenCalledTimes(1)
    expect(seenStatuses).toEqual(['starting'])
  })

  it('invokes notifyStarting again on revert to lobby when the pool is too small', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    seedPlexRows(2) // below POOL_MIN_SIZE (5)

    const seenStatuses: string[] = []
    const notifyStarting = vi.fn(() => seenStatuses.push(store.get(code)!.status))
    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync, notifyStarting)

    expect(result).toEqual({ ok: false, code: 'pool_too_small' })
    expect(notifyStarting).toHaveBeenCalledTimes(2)
    expect(seenStatuses).toEqual(['starting', 'lobby'])
  })
})

describe('restartReel', () => {
  it('rejects a non-host caller', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'Guest')
    seedPlexRows(10)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    const result = await restartReel(store, code, false, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'not_host' })
  })

  it('rejects restarting a room that has not been started yet', async () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(10)
    const result = await restartReel(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'room_not_active' })
  })

  it('resets matches, votes, and exhaustion, and reassigns every participant a fresh pendingCardId', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const guest = joinRoom(store, code, 'Guest')
    if (!host.ok || !guest.ok) throw new Error('setup failed')
    const hostId = host.data.participantId
    const guestId = guest.data.participantId
    seedPlexRows(10)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    const room = store.get(code)!
    const firstCardId = room.participants.get(hostId)!.pendingCardId!
    // Force both participants onto the same card so this vote can produce a
    // match — pendingCardId assignment is per-participant RNG-weighted and
    // not otherwise guaranteed to line up (see the analogous forcing in
    // 'fires a match exactly once...' in the swipeAction describe block below).
    room.participants.get(guestId)!.pendingCardId = firstCardId
    swipeAction(store, code, hostId, firstCardId, 'yes')
    swipeAction(store, code, guestId, firstCardId, 'yes')
    expect(room.matches.length).toBe(1)
    expect(room.totalVotes).toBe(2)

    const result = await restartReel(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result.ok).toBe(true)
    expect(room.matches).toEqual([])
    expect(room.matchedMovieIds.size).toBe(0)
    expect(room.totalVotes).toBe(0)
    expect(room.exhausted).toBe(false)
    expect(room.participants.get(hostId)!.swipes.size).toBe(0)
    expect(room.participants.get(hostId)!.pendingCardId).not.toBeNull()
    expect(room.participants.get(guestId)!.pendingCardId).not.toBeNull()
  })

  it('rejects when the resulting pool has fewer than POOL_MIN_SIZE candidates', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'Guest')
    seedPlexRows(10)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'popcornpoll-active-'))
    const emptyDb = openDb(dir)
    const result = await restartReel(store, code, true, emptyDb, noOpTmdb, noOpLibrarySync)
    // A fresh, never-seeded db has zero Plex rows at all — the genuinely
    // empty library case, so this now surfaces as library_empty rather than
    // the generic pool_too_small (see the more specific test below).
    expect(result).toEqual({ ok: false, code: 'library_empty' })
    emptyDb.close()
  })

  it('rejects restart with library_empty when the plex library has zero movies at all', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    seedPlexRows(10)
    const started = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(started.ok).toBe(true)

    // Library goes empty between Start and this restart attempt (e.g. the
    // synced titles were removed from Plex).
    db.prepare('DELETE FROM movies').run()

    const result = await restartReel(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'library_empty' })
  })
})

describe('swipeAction', () => {
  it('rejects a swipe on a room that has not been started', () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    if (!host.ok) throw new Error('setup failed')
    const result = swipeAction(store, code, host.data.participantId, 1, 'yes')
    expect(result).toEqual({ ok: false, code: 'room_not_active' })
  })

  async function startedRoom(threshold: import('./types').MatchThreshold = { kind: 'all' }) {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create(threshold, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(20)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    return { store, code, hostId: host.data.participantId, otherId: other.data.participantId }
  }

  it('a swipe on the pending card is consumed and assigns a new pendingCardId', async () => {
    const { store, code, hostId } = await startedRoom()
    const room = store.get(code)!
    const pendingBefore = room.participants.get(hostId)!.pendingCardId!
    const result = swipeAction(store, code, hostId, pendingBefore, 'yes')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.consumed).toBe(true)
    expect(room.participants.get(hostId)!.swipes.get(pendingBefore)).toBe('yes')
    expect(room.participants.get(hostId)!.pendingCardId).not.toBe(pendingBefore)
  })

  it('a swipe naming a movieId that is not the pending card is a no-op — not_your_card', async () => {
    const { store, code, hostId } = await startedRoom()
    const room = store.get(code)!
    const notPending = room.pool.find((p) => p.movieId !== room.participants.get(hostId)!.pendingCardId)!.movieId
    const result = swipeAction(store, code, hostId, notPending, 'yes')
    expect(result).toEqual({ ok: false, code: 'not_your_card' })
    expect(room.participants.get(hostId)!.swipes.size).toBe(0)
  })

  it('a duplicate/replayed swipe for an already-recorded movieId is a no-op with consumed: false', async () => {
    const { store, code, hostId } = await startedRoom()
    const room = store.get(code)!
    const first = room.participants.get(hostId)!.pendingCardId!
    swipeAction(store, code, hostId, first, 'yes')
    const replay = swipeAction(store, code, hostId, first, 'yes')
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.data.consumed).toBe(false)
  })

  it('fires a match exactly once when the last required yes vote lands', async () => {
    const { store, code, hostId, otherId } = await startedRoom({ kind: 'all' })
    const room = store.get(code)!
    const target = room.participants.get(hostId)!.pendingCardId!
    // force both participants onto the same card for this test
    room.participants.get(otherId)!.pendingCardId = target

    const first = swipeAction(store, code, hostId, target, 'yes')
    expect(first.ok && first.data.newMatches).toEqual([])
    const second = swipeAction(store, code, otherId, target, 'yes')
    expect(second.ok && second.data.newMatches).toEqual([target])
    expect(room.matchedMovieIds.has(target)).toBe(true)
  })

  it('marks a participant finished and sets exhaustedNow once no connected participant has cards left', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'atLeast', n: 2 }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(5) // exactly POOL_MIN_SIZE, so this session is fast to exhaust
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    const room = store.get(code)!

    let exhaustedNow = false
    for (const participantId of [host.data.participantId, other.data.participantId]) {
      let card = room.participants.get(participantId)!.pendingCardId
      while (card !== null) {
        const result = swipeAction(store, code, participantId, card, 'no')
        if (result.ok) exhaustedNow = result.data.exhaustedNow
        card = room.participants.get(participantId)!.pendingCardId
      }
    }
    expect(room.participants.get(host.data.participantId)!.finished).toBe(true)
    expect(room.exhausted).toBe(true)
    expect(exhaustedNow).toBe(true)
  })
})
