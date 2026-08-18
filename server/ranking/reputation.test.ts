import { describe, expect, it } from 'vitest'
import { computeCAndM, reputationScore } from './reputation'

describe('computeCAndM', () => {
  it('returns the fixed defaults only when the rated candidate set is empty', () => {
    const { c, m } = computeCAndM([{ rating: null, voteCount: null }])
    expect(c).toBe(6.5)
    expect(m).toBe(50)
  })

  it('computes real stats from a small rated set rather than falling back to defaults — regression for a spec-undocumented MIN_RATED_FOR_STATS floor', () => {
    const { c, m } = computeCAndM([{ rating: 8, voteCount: 100 }])
    expect(c).toBe(8)
    expect(m).toBe(100)
  })

  it('computes the mean rating and 60th-percentile vote count over rated candidates', () => {
    const rated = Array.from({ length: 30 }, (_, i) => ({
      rating: 5 + (i % 5),
      voteCount: (i + 1) * 10,
    }))
    const { c, m } = computeCAndM(rated)
    expect(c).toBeCloseTo(7, 0)
    expect(m).toBeGreaterThan(0)
  })

  it('ignores candidates with a null rating when computing C and m', () => {
    const rated = Array.from({ length: 40 }, () => ({ rating: 8, voteCount: 100 }))
    const unrated = Array.from({ length: 10 }, () => ({ rating: null, voteCount: null }))
    const { c } = computeCAndM([...rated, ...unrated])
    expect(c).toBeCloseTo(8, 5)
  })
})

describe('reputationScore', () => {
  const c = 6.5
  const m = 50

  it('a candidate with no rating (Plex item, no tmdb data) scores exactly C', () => {
    expect(reputationScore({ rating: null, voteCount: null }, c, m)).toBe(c)
  })

  it('a well-rated, well-voted candidate scores close to its own rating', () => {
    const score = reputationScore({ rating: 9, voteCount: 5000 }, c, m)
    expect(score).toBeGreaterThan(8.5)
  })

  it('a candidate with 0 votes shrinks fully to C regardless of its raw rating', () => {
    const score = reputationScore({ rating: 10, voteCount: 0 }, c, m)
    expect(score).toBe(c)
  })

  it('matches the Bayesian formula exactly for a mid-vote-count candidate', () => {
    const score = reputationScore({ rating: 8, voteCount: 50 }, c, m)
    // v/(v+m)*R + m/(v+m)*C = 0.5*8 + 0.5*6.5 = 7.25
    expect(score).toBeCloseTo(7.25, 5)
  })
})
