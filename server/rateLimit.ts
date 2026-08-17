// server/rateLimit.ts
export interface TokenBucket {
  tryConsume(key: string): boolean
}

export function createTokenBucket(maxTokens: number, refillPerSecond: number): TokenBucket {
  const buckets = new Map<string, { tokens: number; lastRefill: number }>()

  return {
    tryConsume(key) {
      const now = Date.now()
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { tokens: maxTokens, lastRefill: now }
        buckets.set(key, bucket)
      }
      const elapsedSeconds = (now - bucket.lastRefill) / 1000
      bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsedSeconds * refillPerSecond)
      bucket.lastRefill = now

      if (bucket.tokens < 1) return false
      bucket.tokens -= 1
      return true
    },
  }
}
