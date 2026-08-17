export type Rng = () => number

// mulberry32 — small, fast, deterministic PRNG. Good enough for sampling
// variety; not cryptographic (never used for tokens — see server/auth/tokens.ts).
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function weightedSample<T>(items: T[], weight: (item: T) => number, rng: Rng): T {
  if (items.length === 0) throw new Error('Cannot sample from empty array')
  if (items.length === 1) return items[0]!
  const weights = items.map((item) => Math.max(weight(item), Number.EPSILON))
  const total = weights.reduce((sum, w) => sum + w, 0)
  let target = rng() * total
  for (let i = 0; i < items.length; i++) {
    target -= weights[i]!
    if (target <= 0) return items[i]!
  }
  return items[items.length - 1]!
}

export function weightedSampleWithoutReplacement<T>(
  items: T[],
  weight: (item: T) => number,
  count: number,
  rng: Rng,
): T[] {
  const remaining = [...items]
  const picked: T[] = []
  while (remaining.length > 0 && picked.length < count) {
    const choice = weightedSample(remaining, weight, rng)
    picked.push(choice)
    remaining.splice(remaining.indexOf(choice), 1)
  }
  return picked
}
