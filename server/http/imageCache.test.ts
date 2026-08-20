import { describe, expect, it } from 'vitest'
import { createImageCache } from './imageCache'

function image(bytes: number, fill = 1) {
  return { bytes: new Uint8Array(bytes).fill(fill), contentType: 'image/jpeg' }
}

describe('createImageCache', () => {
  it('returns what was stored', () => {
    const cache = createImageCache()
    cache.set('a', image(10, 7))
    expect(cache.get('a')?.bytes).toEqual(new Uint8Array(10).fill(7))
    expect(cache.get('a')?.contentType).toBe('image/jpeg')
  })

  it('misses on an unknown key', () => {
    const cache = createImageCache()
    expect(cache.get('nope')).toBeUndefined()
    expect(cache.stats().misses).toBe(1)
  })

  it('evicts least-recently-used entries to stay under the byte cap', () => {
    // The cap is the whole point: a library with thousands of posters must not
    // be able to grow this cache without bound inside the one process that
    // also serves SSR and the WebSocket session.
    const cache = createImageCache({ maxBytes: 30 })
    cache.set('a', image(10))
    cache.set('b', image(10))
    cache.set('c', image(10))
    expect(cache.stats().bytes).toBe(30)

    // Touch 'a' so 'b' becomes the least-recently-used entry, then overflow.
    cache.get('a')
    cache.set('d', image(10))

    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.get('d')).toBeDefined()
    expect(cache.stats().bytes).toBe(30)
    expect(cache.stats().evictions).toBe(1)
  })

  it('replaces an existing key without double-counting its bytes', () => {
    const cache = createImageCache({ maxBytes: 100 })
    cache.set('a', image(10))
    cache.set('a', image(20))
    expect(cache.stats().entries).toBe(1)
    expect(cache.stats().bytes).toBe(20)
  })

  it('refuses an image larger than the whole cache rather than flushing everything for it', () => {
    const cache = createImageCache({ maxBytes: 30 })
    cache.set('a', image(10))
    cache.set('huge', image(31))
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
  })

  it('expires entries at the TTL boundary', () => {
    let clock = 0
    const cache = createImageCache({ ttlMs: 100, now: () => clock })
    cache.set('a', image(10))
    clock = 99
    expect(cache.get('a')).toBeDefined()
    clock = 100
    expect(cache.get('a')).toBeUndefined()
    // The expired entry's bytes are reclaimed, not merely hidden.
    expect(cache.stats().bytes).toBe(0)
    expect(cache.stats().entries).toBe(0)
  })

  describe('loadOnce', () => {
    it('shares one in-flight load across concurrent callers', async () => {
      const cache = createImageCache()
      let calls = 0
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const load = async () => {
        calls++
        await gate
        return image(10)
      }

      const all = Promise.all([cache.loadOnce('k', load), cache.loadOnce('k', load), cache.loadOnce('k', load)])
      release?.()
      const results = await all

      expect(calls).toBe(1)
      expect(results.every((r) => r?.bytes.byteLength === 10)).toBe(true)
    })

    it('releases the in-flight slot after a rejection so the next caller retries', async () => {
      const cache = createImageCache()
      let calls = 0
      const load = async () => {
        calls++
        if (calls === 1) throw new Error('upstream down')
        return image(10)
      }

      await expect(cache.loadOnce('k', load)).rejects.toThrow('upstream down')
      await expect(cache.loadOnce('k', load)).resolves.toEqual(image(10))
      expect(calls).toBe(2)
    })
  })
})
