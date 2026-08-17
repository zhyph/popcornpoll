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
})
