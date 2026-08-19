import { describe, expect, it } from 'vitest'
import { edgeAccentClasses } from './EdgeState'

describe('edgeAccentClasses', () => {
  it('uses exit-red for kicked and poolfail (both are dead-end failures)', () => {
    expect(edgeAccentClasses('kicked').text).toBe('text-exit-red')
    expect(edgeAccentClasses('poolfail').text).toBe('text-exit-red')
  })

  it('uses marquee for hostgone (transient, not a failure)', () => {
    expect(edgeAccentClasses('hostgone').text).toBe('text-marquee')
  })

  it('uses brass for emptylib (a setup/config state, not a failure)', () => {
    expect(edgeAccentClasses('emptylib').text).toBe('text-brass')
  })

  it('every kind has matching border and bg classes for the same color family', () => {
    const kinds: Array<'kicked' | 'hostgone' | 'poolfail' | 'emptylib'> = ['kicked', 'hostgone', 'poolfail', 'emptylib']
    for (const kind of kinds) {
      const { text, border, bg } = edgeAccentClasses(kind)
      const family = text.replace('text-', '')
      expect(border).toContain(family)
      expect(bg).toBe(`bg-${family}`)
    }
  })
})
