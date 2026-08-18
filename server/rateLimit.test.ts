// server/rateLimit.test.ts
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultRateLimitBucket, createTokenBucket, defaultRateLimitRefillPerSecond, getClientIp } from './rateLimit'

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

describe('defaultRateLimitRefillPerSecond / createDefaultRateLimitBucket', () => {
  afterEach(() => {
    delete process.env.ROOM_RATE_LIMIT_REFILL_PER_SECOND
  })

  it('falls back to the production rate (10/60 per second) when unset', () => {
    delete process.env.ROOM_RATE_LIMIT_REFILL_PER_SECOND
    expect(defaultRateLimitRefillPerSecond()).toBeCloseTo(10 / 60, 5)
  })

  it('falls back to the production rate when set to a non-positive or non-numeric value', () => {
    process.env.ROOM_RATE_LIMIT_REFILL_PER_SECOND = '0'
    expect(defaultRateLimitRefillPerSecond()).toBeCloseTo(10 / 60, 5)
    process.env.ROOM_RATE_LIMIT_REFILL_PER_SECOND = 'not-a-number'
    expect(defaultRateLimitRefillPerSecond()).toBeCloseTo(10 / 60, 5)
  })

  it('uses the override when set to a positive number', () => {
    process.env.ROOM_RATE_LIMIT_REFILL_PER_SECOND = '5'
    expect(defaultRateLimitRefillPerSecond()).toBe(5)
  })

  it('createDefaultRateLimitBucket has a fixed 10-token capacity regardless of the refill override', () => {
    process.env.ROOM_RATE_LIMIT_REFILL_PER_SECOND = '100' // fast refill, but capacity is still capped at 10
    const bucket = createDefaultRateLimitBucket()
    for (let i = 0; i < 10; i++) expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
  })
})

describe('getClientIp', () => {
  it('ignores X-Forwarded-For when trustedProxyHops is 0', () => {
    expect(getClientIp('203.0.113.9', '10.0.0.5', 0)).toBe('10.0.0.5')
  })

  it('reads the (length - trustedProxyHops)th entry of X-Forwarded-For when hops > 0', () => {
    expect(getClientIp('1.1.1.1, 2.2.2.2, 3.3.3.3', '10.0.0.2', 1)).toBe('3.3.3.3')
  })

  it('falls back to remoteAddress when X-Forwarded-For is absent', () => {
    expect(getClientIp(null, '10.0.0.5', 1)).toBe('10.0.0.5')
  })

  it("falls back to 'unknown' when neither is available", () => {
    expect(getClientIp(null, undefined, 0)).toBe('unknown')
  })
})
