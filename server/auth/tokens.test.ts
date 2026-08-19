import { describe, expect, it } from 'vitest'
import { generateRoomCode, generateSoloCode, generateToken, WORDS } from './tokens'

describe('generateToken', () => {
  it('generates a 32-character hex string (128 bits)', () => {
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates distinct tokens across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })
})

describe('generateRoomCode', () => {
  it('matches the WORD-WORD-NNN format', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)
  })

  it('generates different codes across calls (not exhaustively unique — collision handling is the room store\'s job)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('generateSoloCode', () => {
  it('matches the solo-XXXX format (4 unambiguous uppercase-alphanumeric chars)', () => {
    const code = generateSoloCode()
    expect(code).toMatch(/^solo-[A-HJ-NP-Z2-9]{4}$/)
  })

  it('generates different codes across calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateSoloCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})

describe('WORDS', () => {
  it('has no duplicate entries', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length)
  })

  it('has the documented 100-word list size (design spec Network exposure: "a 100-word list")', () => {
    expect(WORDS.length).toBe(100)
  })
})
