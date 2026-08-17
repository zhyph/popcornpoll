import { describe, expect, it } from 'vitest'
import { createRng, weightedSample, weightedSampleWithoutReplacement } from './rng'

describe('createRng', () => {
  it('is deterministic — the same seed produces the same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('different seeds produce different sequences', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a()).not.toBe(b())
  })

  it('always returns values in [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('weightedSample', () => {
  it('always picks the only item when there is one', () => {
    const rng = createRng(1)
    expect(weightedSample(['only'], () => 1, rng)).toBe('only')
  })

  it('never selects an item with zero or negative weight when a positive-weight item exists', () => {
    const rng = createRng(3)
    for (let i = 0; i < 50; i++) {
      const pick = weightedSample(['zero', 'positive'], (item) => (item === 'zero' ? 0 : 1), rng)
      expect(pick).toBe('positive')
    }
  })

  it('is deterministic for a fixed seed', () => {
    const items = ['a', 'b', 'c', 'd']
    const picks1 = Array.from({ length: 5 }, () => weightedSample(items, () => 1, createRng(99)))
    const picks2 = Array.from({ length: 5 }, () => weightedSample(items, () => 1, createRng(99)))
    expect(picks1).toEqual(picks2)
  })
})

describe('weightedSampleWithoutReplacement', () => {
  it('returns exactly `count` distinct items', () => {
    const rng = createRng(5)
    const picks = weightedSampleWithoutReplacement([1, 2, 3, 4, 5], () => 1, 3, rng)
    expect(picks).toHaveLength(3)
    expect(new Set(picks).size).toBe(3)
  })

  it('returns all items if count exceeds the pool size', () => {
    const rng = createRng(5)
    const picks = weightedSampleWithoutReplacement([1, 2], () => 1, 5, rng)
    expect(picks.sort()).toEqual([1, 2])
  })
})
