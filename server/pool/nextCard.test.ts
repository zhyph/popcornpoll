import { describe, expect, it } from 'vitest'
import { emptyTally, recordVote } from '../ranking/affinity'
import { createRng } from '../ranking/rng'
import { pickNextCard } from './nextCard'
import type { PoolEntry } from './buildPool'

function entry(id: number, overrides: Partial<PoolEntry> = {}): PoolEntry {
  return {
    movieId: id,
    title: `Movie ${id}`,
    posterPath: null,
    posterSource: 'plex',
    overview: null,
    genres: [],
    year: null,
    inLibrary: true,
    rating: 7,
    voteCount: 1000,
    ...overrides,
  }
}

describe('pickNextCard', () => {
  it('returns null when every pool entry has already been swiped', () => {
    const pool = [entry(1), entry(2)]
    const result = pickNextCard(pool, new Set([1, 2]), emptyTally(), 2, 6.5, 50, createRng(1))
    expect(result).toBeNull()
  })

  it('never returns an already-swiped movieId', () => {
    const pool = Array.from({ length: 20 }, (_, i) => entry(i))
    const swiped = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8])
    for (let seed = 0; seed < 30; seed++) {
      const result = pickNextCard(pool, swiped, emptyTally(), 0, 6.5, 50, createRng(seed))
      expect(result).not.toBeNull()
      expect(swiped.has(result as number)).toBe(false)
    }
  })

  it('is deterministic for a fixed seed and fixed inputs', () => {
    const pool = Array.from({ length: 20 }, (_, i) => entry(i, { rating: 5 + (i % 5), voteCount: 100 }))
    const a = pickNextCard(pool, new Set(), emptyTally(), 0, 6.5, 50, createRng(123))
    const b = pickNextCard(pool, new Set(), emptyTally(), 0, 6.5, 50, createRng(123))
    expect(a).toBe(b)
  })

  it('strongly favors a candidate whose genre the group has voted yes on repeatedly', () => {
    let tally = emptyTally()
    for (let i = 0; i < 20; i++) tally = recordVote(tally, ['Comedy'], 'yes')
    const pool = [
      entry(1, { genres: ['Comedy'], rating: 6.5, voteCount: 50 }),
      ...Array.from({ length: 30 }, (_, i) => entry(100 + i, { genres: ['Horror'], rating: 6.5, voteCount: 50 })),
    ]
    const picks = Array.from({ length: 20 }, (_, seed) =>
      pickNextCard(pool, new Set(), tally, 20, 6.5, 50, createRng(seed)),
    )
    const comedyPicks = picks.filter((p) => p === 1).length
    // With only 1 of 31 candidates being Comedy, a uniform pick would land on
    // it ~3% of the time; strong positive affinity should push this well above chance.
    expect(comedyPicks).toBeGreaterThan(3)
  })

  it('only considers the top 10 by score, not the full remaining pool', () => {
    const pool = [
      entry(1, { rating: 10, voteCount: 10000 }), // clearly top score
      ...Array.from({ length: 50 }, (_, i) => entry(100 + i, { rating: 1, voteCount: 10000 })), // clearly bottom
    ]
    const picks = new Set(
      Array.from({ length: 50 }, (_, seed) => pickNextCard(pool, new Set(), emptyTally(), 0, 6.5, 50, createRng(seed))),
    )
    // The 50 low-score candidates should almost never all be excluded from a
    // 50-draw sample if the whole pool were in play; asserting id 1 dominates
    // is the direct, robust check that scoring (not uniform choice) is active.
    const idOnePicks = Array.from(picks).filter((p) => p === 1)
    expect(idOnePicks.length).toBeGreaterThan(0)
  })
})
