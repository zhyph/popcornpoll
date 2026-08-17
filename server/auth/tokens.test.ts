import { describe, expect, it } from 'vitest'
import { generateRoomCode, generateToken } from './tokens'

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
