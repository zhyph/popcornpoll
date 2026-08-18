// server/rateLimit.test.ts
import { describe, expect, it } from 'vitest'
import { createTokenBucket } from './rateLimit'

describe('createTokenBucket', () => {
  it('allows up to maxTokens consumptions, then denies', () => {
    const bucket = createTokenBucket(3, 0)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
  })

  it('tracks buckets independently per key', () => {
    const bucket = createTokenBucket(1, 0)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-2')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
  })

  it('refills over time at the configured rate', async () => {
    const bucket = createTokenBucket(1, 100) // 100 tokens/sec — refills fast enough to await in a test
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(bucket.tryConsume('ip-1')).toBe(true)
  })

  it('evicts buckets untouched past idleEvictionMs on its periodic sweep', async () => {
    const bucket = createTokenBucket(3, 0, 10, 5) // idleEvictionMs=10, sweepIntervalMs=5 — real short timers for a fast test
    bucket.tryConsume('ip-1')
    expect(bucket.size()).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(bucket.size()).toBe(0)
  })
})
