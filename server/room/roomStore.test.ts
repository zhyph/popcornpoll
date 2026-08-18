import { describe, expect, it } from 'vitest'
import { createRoomStore } from './roomStore'

describe('createRoomStore', () => {
  it('looks up a room case-insensitively', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    expect(store.get(code.toLowerCase())?.code).toBe(code)
  })

  it('normalizes case on delete too', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    store.delete(code.toLowerCase())
    expect(store.get(code)).toBeUndefined()
  })

  it('accepts an injected code generator, defaulting to generateRoomCode', () => {
    const store = createRoomStore(() => 'ZEBRA-OTTER-999')
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    expect(code).toBe('ZEBRA-OTTER-999')
  })

  it('throws instead of silently overwriting a live room once the collision-retry budget is exhausted', () => {
    const store = createRoomStore(() => 'FOX-WOLF-001')
    store.create({ kind: 'all' }, 'plex', {}) // occupies the only code this generator can ever produce
    expect(() => store.create({ kind: 'all' }, 'plex', {})).toThrow()
  })
})
