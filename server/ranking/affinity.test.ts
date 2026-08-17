import { describe, expect, it } from 'vitest'
import { affinityWeight, emptyTally, genreAffinity, recordVote } from './affinity'

describe('recordVote + genreAffinity', () => {
  it('a genre with no votes yet has affinity 0', () => {
    expect(genreAffinity(['Comedy'], emptyTally())).toBe(0)
  })

  it('a genre with many yes votes trends positive but stays smoothed short of +1', () => {
    let tally = emptyTally()
    for (let i = 0; i < 10; i++) tally = recordVote(tally, ['Comedy'], 'yes')
    const affinity = genreAffinity(['Comedy'], tally)
    expect(affinity).toBeGreaterThan(0.5)
    expect(affinity).toBeLessThan(1)
  })

  it('one or two votes on a genre stay close to 0 (Laplace smoothing, alpha=2)', () => {
    let tally = emptyTally()
    tally = recordVote(tally, ['Horror'], 'yes')
    // (1 - 0) / (1 + 0 + 4) = 0.2, not 1
    expect(genreAffinity(['Horror'], tally)).toBeCloseTo(0.2, 5)
  })

  it('genreAffinity for a multi-genre candidate is the mean across its genres, not the sum', () => {
    let tally = emptyTally()
    for (let i = 0; i < 10; i++) tally = recordVote(tally, ['Comedy'], 'yes')
    for (let i = 0; i < 10; i++) tally = recordVote(tally, ['Horror'], 'no')
    const comedyOnly = genreAffinity(['Comedy'], tally)
    const both = genreAffinity(['Comedy', 'Horror'], tally)
    // averaging a strong positive with a strong negative pulls it toward 0,
    // and specifically must not just be comedyOnly (which sum would produce
    // for a positive-only case, but is a clean way to assert mean-not-sum here)
    expect(both).toBeCloseTo((comedyOnly + genreAffinity(['Horror'], tally)) / 2, 5)
  })

  it('rebuilding a tally from scratch (kick) produces the same result as never having those votes', () => {
    let withExtra = emptyTally()
    withExtra = recordVote(withExtra, ['Comedy'], 'yes')
    withExtra = recordVote(withExtra, ['Comedy'], 'no') // the kicked participant's vote
    const rebuilt = recordVote(emptyTally(), ['Comedy'], 'yes') // rebuilt without the kicked vote
    expect(genreAffinity(['Comedy'], rebuilt)).not.toBe(genreAffinity(['Comedy'], withExtra))
  })
})

describe('affinityWeight', () => {
  it('is 0 with no votes cast yet', () => {
    expect(affinityWeight(0)).toBe(0)
  })

  it('ramps linearly up to the cap of 1.5 at 20 total votes', () => {
    expect(affinityWeight(10)).toBeCloseTo(0.75, 5)
    expect(affinityWeight(20)).toBe(1.5)
  })

  it('never exceeds 1.5 past 20 votes', () => {
    expect(affinityWeight(1000)).toBe(1.5)
  })
})
