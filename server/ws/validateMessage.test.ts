// server/ws/validateMessage.test.ts
import { describe, expect, it } from 'vitest'
import { isClientMessage } from './validateMessage'

describe('isClientMessage', () => {
  it('accepts every legitimate ClientMessage shape', () => {
    expect(isClientMessage({ type: 'join', roomCode: 'ABCD', displayName: 'Alex' })).toBe(true)
    expect(
      isClientMessage({ type: 'join', roomCode: 'ABCD', displayName: 'Alex', hostClaimToken: 'tok' }),
    ).toBe(true)
    expect(isClientMessage({ type: 'reconnect', roomCode: 'ABCD', sessionToken: 'tok' })).toBe(true)
    expect(isClientMessage({ type: 'resync' })).toBe(true)
    expect(isClientMessage({ type: 'swipe', movieId: 42, vote: 'yes' })).toBe(true)
    expect(isClientMessage({ type: 'start' })).toBe(true)
    expect(isClientMessage({ type: 'end_room' })).toBe(true)
    expect(isClientMessage({ type: 'restart_reel' })).toBe(true)
    expect(isClientMessage({ type: 'update_settings' })).toBe(true)
    expect(isClientMessage({ type: 'update_settings', matchThreshold: { kind: 'all' } })).toBe(true)
    expect(isClientMessage({ type: 'update_settings', matchThreshold: { kind: 'atLeast', n: 2 } })).toBe(true)
    expect(isClientMessage({ type: 'update_settings', candidateSource: 'plex+tmdb' })).toBe(true)
    expect(
      isClientMessage({ type: 'update_settings', tmdbFilters: { genre: 'Drama', yearMin: 1990, ratingMin: 5 } }),
    ).toBe(true)
    expect(isClientMessage({ type: 'kick', participantId: 'p1' })).toBe(true)
    expect(isClientMessage({ type: 'heartbeat' })).toBe(true)
  })

  it('rejects a swipe with a null movieId', () => {
    expect(isClientMessage({ type: 'swipe', movieId: null, vote: 'yes' })).toBe(false)
  })

  it('rejects a swipe with a non-finite movieId', () => {
    expect(isClientMessage({ type: 'swipe', movieId: Number.NaN, vote: 'yes' })).toBe(false)
    expect(isClientMessage({ type: 'swipe', movieId: Number.POSITIVE_INFINITY, vote: 'yes' })).toBe(false)
    expect(isClientMessage({ type: 'swipe', movieId: '42', vote: 'yes' })).toBe(false)
  })

  it('rejects a swipe with an invalid vote', () => {
    expect(isClientMessage({ type: 'swipe', movieId: 1, vote: 'maybe' })).toBe(false)
  })

  it('rejects join/reconnect with non-string identity fields', () => {
    expect(isClientMessage({ type: 'join', roomCode: 1234, displayName: 'Alex' })).toBe(false)
    expect(isClientMessage({ type: 'join', roomCode: 'ABCD', displayName: 42 })).toBe(false)
    expect(isClientMessage({ type: 'reconnect', roomCode: 'ABCD', sessionToken: 42 })).toBe(false)
  })

  it('rejects kick without a string participantId', () => {
    expect(isClientMessage({ type: 'kick', participantId: null })).toBe(false)
  })

  it('rejects update_settings with an unrecognized matchThreshold.kind', () => {
    expect(isClientMessage({ type: 'update_settings', matchThreshold: { kind: 'bogus' } })).toBe(false)
  })

  it('rejects update_settings with a non-numeric atLeast.n', () => {
    expect(isClientMessage({ type: 'update_settings', matchThreshold: { kind: 'atLeast', n: '2' } })).toBe(false)
  })

  it('rejects update_settings with an unrecognized candidateSource', () => {
    expect(isClientMessage({ type: 'update_settings', candidateSource: 'netflix' })).toBe(false)
  })

  it('rejects update_settings with non-numeric tmdbFilters fields', () => {
    expect(isClientMessage({ type: 'update_settings', tmdbFilters: { yearMin: '1990' } })).toBe(false)
  })

  it('rejects an unrecognized message type', () => {
    expect(isClientMessage({ type: 'not_a_real_type' })).toBe(false)
  })

  it('rejects non-object and null input', () => {
    expect(isClientMessage(null)).toBe(false)
    expect(isClientMessage('swipe')).toBe(false)
    expect(isClientMessage(42)).toBe(false)
    expect(isClientMessage(undefined)).toBe(false)
  })

  it('rejects an object with no type field', () => {
    expect(isClientMessage({ roomCode: 'ABCD' })).toBe(false)
  })
})
