// server/rateLimit.ts
export interface TokenBucket {
  tryConsume(key: string): boolean
  size(): number
}

const DEFAULT_IDLE_EVICTION_MS = 30 * 60_000
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60_000

export function createTokenBucket(
  maxTokens: number,
  refillPerSecond: number,
  idleEvictionMs = DEFAULT_IDLE_EVICTION_MS,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
): TokenBucket {
  const buckets = new Map<string, { tokens: number; lastRefill: number }>()

  function evictStale(now: number): void {
    for (const [key, bucket] of buckets) {
      if (now - bucket.lastRefill > idleEvictionMs) buckets.delete(key)
    }
  }

  // Buckets are keyed by client IP and otherwise never removed — over the
  // life of a long-running process that's an unbounded Map. A periodic
  // sweep drops any bucket that hasn't been touched in idleEvictionMs, so
  // memory stays bounded by recently-active keys rather than every IP
  // that has ever connected. unref() so this timer alone can't keep the
  // process alive.
  const sweepTimer = setInterval(() => evictStale(Date.now()), sweepIntervalMs)
  sweepTimer.unref()

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
    size() {
      return buckets.size
    },
  }
}

// Resolves the real client IP for rate-limiting purposes, honoring
// TRUSTED_PROXY_HOPS — an untrusted client can set X-Forwarded-For to
// anything, so it's only consulted when the deployer has explicitly said
// how many trusted proxy hops sit in front of this process. Takes plain
// values instead of a transport-specific request type so both the WS
// upgrade handler (Node IncomingMessage) and the HTTP route handlers
// (Web-standard Request, which carries no socket) share one implementation
// instead of each keeping their own copy. Was previously a private
// function inside server/ws/server.ts.
export function getClientIp(
  forwardedFor: string | null,
  remoteAddress: string | undefined,
  trustedProxyHops: number,
): string {
  if (trustedProxyHops > 0 && forwardedFor) {
    const ips = forwardedFor.split(',').map((ip) => ip.trim())
    const index = ips.length - trustedProxyHops
    const candidate = index >= 0 ? ips[index] : undefined
    if (candidate) return candidate
  }
  return remoteAddress ?? 'unknown'
}
