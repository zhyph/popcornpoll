import { describe, expect, it } from 'vitest'
import { AMBIENT_FRAME_INTERVAL_MS, AMBIENT_TARGET_FPS, createAmbientFrameGate } from './ambientFrameRate'

describe('createAmbientFrameGate', () => {
  it('draws the first frame it is asked about', () => {
    const gate = createAmbientFrameGate()
    expect(gate(0)).toBe(true)
  })

  it('skips ticks that arrive inside the frame interval', () => {
    const gate = createAmbientFrameGate()
    gate(0)
    expect(gate(AMBIENT_FRAME_INTERVAL_MS - 0.01)).toBe(false)
  })

  it('draws again once the interval has elapsed', () => {
    const gate = createAmbientFrameGate()
    gate(0)
    expect(gate(AMBIENT_FRAME_INTERVAL_MS)).toBe(true)
  })

  it('cuts a 144Hz tick stream to the frame budget', () => {
    // The measured case: a 144Hz display drove 719 draws per layer over 5s.
    // Draws can only land on tick boundaries, so the gate cannot hit exactly
    // 30fps here — it takes every 5th tick, i.e. 28.8fps. What matters is the
    // ratio: 720 draws become 144, a 5x cut, and never more than the budget.
    const ticks = 144 * 5
    const gate = createAmbientFrameGate()
    const tickMs = 1000 / 144
    let drawn = 0
    for (let i = 0; i < ticks; i++) {
      if (gate(i * tickMs)) drawn++
    }
    expect(drawn).toBe(144)
    expect(drawn).toBeLessThanOrEqual(AMBIENT_TARGET_FPS * 5)
    expect(drawn / ticks).toBeLessThan(0.25)
  })

  it('does not starve a display slower than the target', () => {
    // A 24Hz tick stream is already under budget — every tick should draw,
    // rather than the gate dropping every other one.
    const gate = createAmbientFrameGate()
    const tickMs = 1000 / 24
    let drawn = 0
    for (let i = 0; i < 24 * 5; i++) {
      if (gate(i * tickMs)) drawn++
    }
    expect(drawn).toBe(24 * 5)
  })

  it('gives each gate its own independent budget', () => {
    // Aurora and LightRays each hold their own gate; one must not consume the
    // other's frame allowance.
    const a = createAmbientFrameGate()
    const b = createAmbientFrameGate()
    expect(a(0)).toBe(true)
    expect(b(0)).toBe(true)
  })
})
