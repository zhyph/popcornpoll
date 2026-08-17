import { describe, expect, it } from 'vitest'
import { clampThreshold, evaluateThreshold, isValidThreshold } from './matchThreshold'

describe('evaluateThreshold', () => {
  it('"all" requires yesCount === frozenCount', () => {
    expect(evaluateThreshold({ kind: 'all' }, 4, 4)).toBe(true)
    expect(evaluateThreshold({ kind: 'all' }, 3, 4)).toBe(false)
  })

  it('"majority" requires strictly more than half — 3 of 4, not 2 of 4', () => {
    expect(evaluateThreshold({ kind: 'majority' }, 3, 4)).toBe(true)
    expect(evaluateThreshold({ kind: 'majority' }, 2, 4)).toBe(false)
  })

  it('"atLeast" requires yesCount >= n', () => {
    expect(evaluateThreshold({ kind: 'atLeast', n: 2 }, 2, 5)).toBe(true)
    expect(evaluateThreshold({ kind: 'atLeast', n: 3 }, 2, 5)).toBe(false)
  })
})

describe('isValidThreshold', () => {
  it('"atLeast" is valid only when 1 <= n <= participantCount', () => {
    expect(isValidThreshold({ kind: 'atLeast', n: 0 }, 5)).toBe(false)
    expect(isValidThreshold({ kind: 'atLeast', n: 5 }, 5)).toBe(true)
    expect(isValidThreshold({ kind: 'atLeast', n: 6 }, 5)).toBe(false)
  })

  it('"all" and "majority" are always valid for any positive participant count', () => {
    expect(isValidThreshold({ kind: 'all' }, 1)).toBe(true)
    expect(isValidThreshold({ kind: 'majority' }, 1)).toBe(true)
  })
})

describe('clampThreshold', () => {
  it('clamps an atLeast.n that now exceeds the (post-kick) participant count', () => {
    const clamped = clampThreshold({ kind: 'atLeast', n: 5 }, 3)
    expect(clamped).toEqual({ kind: 'atLeast', n: 3 })
  })

  it('leaves a still-valid atLeast.n unchanged', () => {
    const original = { kind: 'atLeast', n: 2 } as const
    expect(clampThreshold(original, 3)).toEqual(original)
  })

  it('leaves "all" and "majority" unchanged — they scale automatically', () => {
    expect(clampThreshold({ kind: 'all' }, 2)).toEqual({ kind: 'all' })
  })
})
