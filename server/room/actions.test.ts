import { describe, expect, it } from 'vitest'
import { createRoomStore } from './roomStore'
import { joinRoom, kickParticipant, reconnectRoom, updateSettings } from './actions'

function newRoom() {
  const store = createRoomStore()
  const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
  return { store, code, hostClaimToken }
}

describe('joinRoom', () => {
  it('the first join with a valid hostClaimToken becomes host', () => {
    const { store, code, hostClaimToken } = newRoom()
    const result = joinRoom(store, code, 'Alice', hostClaimToken)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hostToken).not.toBeNull()
    expect(result.data.hostClaimResult).toBe('claimed')
  })

  it('a second join presenting the same (now-consumed) hostClaimToken is a plain participant', () => {
    const { store, code, hostClaimToken } = newRoom()
    joinRoom(store, code, 'Alice', hostClaimToken)
    const second = joinRoom(store, code, 'Bob', hostClaimToken)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.hostToken).toBeNull()
    expect(second.data.hostClaimResult).toBe('already_consumed')
  })

  it('a join with no hostClaimToken is a plain participant with no hostClaimResult field', () => {
    const { store, code } = newRoom()
    const result = joinRoom(store, code, 'Alice')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hostToken).toBeNull()
    expect(result.data.hostClaimResult).toBeNull()
  })

  it('a failed join (invalid name) does not consume the hostClaimToken — a retry with it still claims host', () => {
    const { store, code, hostClaimToken } = newRoom()
    const failed = joinRoom(store, code, '', hostClaimToken)
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.code).toBe('invalid_name')

    const retry = joinRoom(store, code, 'Alice', hostClaimToken)
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.data.hostClaimResult).toBe('claimed')
  })

  it('rejects a join once the room has left lobby', () => {
    const { store, code } = newRoom()
    const room = store.get(code)!
    room.status = 'active'
    const result = joinRoom(store, code, 'Alice')
    expect(result).toEqual({ ok: false, code: 'already_started' })
  })

  it('rejects joins past MAX_PARTICIPANTS_PER_ROOM', () => {
    const { store, code } = newRoom()
    for (let i = 0; i < 20; i++) {
      expect(joinRoom(store, code, `P${i}`).ok).toBe(true)
    }
    const overflow = joinRoom(store, code, 'One Too Many')
    expect(overflow).toEqual({ ok: false, code: 'room_full' })
  })

  it('auto-suffixes a duplicate display name within the same room', () => {
    const { store, code } = newRoom()
    joinRoom(store, code, 'Alice')
    const second = joinRoom(store, code, 'Alice')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const room = store.get(code)!
    const names = [...room.participants.values()].map((p) => p.displayName)
    expect(names).toContain('Alice')
    expect(names.some((n) => n !== 'Alice' && n.startsWith('Alice'))).toBe(true)
  })

  it('rejects an empty or over-length display name', () => {
    const { store, code } = newRoom()
    expect(joinRoom(store, code, '').ok).toBe(false)
    expect(joinRoom(store, code, 'x'.repeat(25)).ok).toBe(false)
    expect(joinRoom(store, code, 'x'.repeat(24)).ok).toBe(true)
  })

  it('returns room_not_found for an unknown code', () => {
    const { store } = newRoom()
    expect(joinRoom(store, 'NOPE-NOPE-000', 'Alice')).toEqual({ ok: false, code: 'room_not_found' })
  })
})

describe('reconnectRoom', () => {
  it('reconnects with a valid sessionToken', () => {
    const { store, code } = newRoom()
    const joined = joinRoom(store, code, 'Alice')
    if (!joined.ok) throw new Error('setup failed')
    const room = store.get(code)!
    room.participants.get(joined.data.participantId)!.connectionStatus = 'disconnected'

    const result = reconnectRoom(store, code, joined.data.sessionToken)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.participantId).toBe(joined.data.participantId)
    expect(room.participants.get(joined.data.participantId)!.connectionStatus).toBe('connected')
  })

  it('grants isHost only when the correct hostToken is also presented', () => {
    const { store, code, hostClaimToken } = newRoom()
    const joined = joinRoom(store, code, 'Alice', hostClaimToken)
    if (!joined.ok) throw new Error('setup failed')

    const withoutHostToken = reconnectRoom(store, code, joined.data.sessionToken)
    expect(withoutHostToken.ok && withoutHostToken.data.isHost).toBe(false)

    const withHostToken = reconnectRoom(store, code, joined.data.sessionToken, joined.data.hostToken!)
    expect(withHostToken.ok && withHostToken.data.isHost).toBe(true)
  })

  it('returns bad_token for an unrecognized sessionToken', () => {
    const { store, code } = newRoom()
    expect(reconnectRoom(store, code, 'not-a-real-token')).toEqual({ ok: false, code: 'bad_token' })
  })

  it('returns kicked for a revoked (kicked) sessionToken', () => {
    const { store, code, hostClaimToken } = newRoom()
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const target = joinRoom(store, code, 'Troll')
    if (!host.ok || !target.ok) throw new Error('setup failed')
    kickParticipant(store, code, true, target.data.participantId)
    expect(reconnectRoom(store, code, target.data.sessionToken)).toEqual({ ok: false, code: 'kicked' })
  })

  it('recomputes exhaustion when an active room participant reconnects', () => {
    const { store, code, hostClaimToken } = newRoom()
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const guest = joinRoom(store, code, 'Guest')
    if (!host.ok || !guest.ok) throw new Error('setup failed')
    const room = store.get(code)!
    room.status = 'active'
    const guestParticipant = room.participants.get(guest.data.participantId)!
    guestParticipant.connectionStatus = 'disconnected'
    guestParticipant.finished = false
    room.participants.get(host.data.participantId)!.finished = true
    room.exhausted = true // stale — as if this had been computed while the guest was still disconnected

    const result = reconnectRoom(store, code, guest.data.sessionToken)
    expect(result.ok).toBe(true)
    // the guest is back, connected, and unfinished — the room is blocked on them again
    expect(room.exhausted).toBe(false)
  })

  it('clears disconnectedAt on reconnect', () => {
    const { store, code, hostClaimToken } = newRoom()
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    if (!host.ok) throw new Error('setup failed')
    const participant = store.get(code)!.participants.get(host.data.participantId)!
    participant.connectionStatus = 'disconnected'
    participant.disconnectedAt = Date.now()

    reconnectRoom(store, code, host.data.sessionToken)
    expect(participant.disconnectedAt).toBeNull()
  })
})

describe('kickParticipant', () => {
  it('a non-host caller is rejected', () => {
    const { store, code } = newRoom()
    const target = joinRoom(store, code, 'Alice')
    if (!target.ok) throw new Error('setup failed')
    expect(kickParticipant(store, code, false, target.data.participantId)).toEqual({
      ok: false,
      code: 'not_host',
    })
  })

  it('removes the participant and revokes their session with reason kicked', () => {
    const { store, code, hostClaimToken } = newRoom()
    joinRoom(store, code, 'Host', hostClaimToken)
    const target = joinRoom(store, code, 'Troll')
    if (!target.ok) throw new Error('setup failed')

    const result = kickParticipant(store, code, true, target.data.participantId)
    expect(result.ok).toBe(true)
    const room = store.get(code)!
    expect(room.participants.has(target.data.participantId)).toBe(false)
    expect(room.revokedSessionTokens.has(target.data.sessionToken)).toBe(true)
    expect(room.kickReasons.get(target.data.sessionToken)).toBe('kicked')
  })

  it('clamps an atLeast threshold that now exceeds the shrunk participant count', () => {
    const { store, code, hostClaimToken } = newRoom()
    store.get(code)!.matchThreshold = { kind: 'atLeast', n: 3 }
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    const c = joinRoom(store, code, 'C')
    if (!c.ok) throw new Error('setup failed')
    kickParticipant(store, code, true, c.data.participantId)
    expect(store.get(code)!.matchThreshold).toEqual({ kind: 'atLeast', n: 2 })
  })

  it('recomputes exhaustion for the remaining participants in an active room', () => {
    const { store, code, hostClaimToken } = newRoom()
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const guest = joinRoom(store, code, 'Guest')
    if (!host.ok || !guest.ok) throw new Error('setup failed')
    const room = store.get(code)!
    room.status = 'active'
    room.participants.get(host.data.participantId)!.finished = true
    room.participants.get(guest.data.participantId)!.finished = false
    room.exhausted = false // blocked on the guest

    const result = kickParticipant(store, code, true, guest.data.participantId)
    expect(result.ok).toBe(true)
    // the guest (the only unfinished participant) is gone — nobody left to block on
    expect(room.exhausted).toBe(true)
  })
})

describe('updateSettings', () => {
  it('a non-host caller is rejected', () => {
    const { store, code } = newRoom()
    expect(updateSettings(store, code, false, { matchThreshold: { kind: 'majority' } })).toEqual({
      ok: false,
      code: 'not_host',
    })
  })

  it('applies a valid threshold change', () => {
    const { store, code } = newRoom()
    updateSettings(store, code, true, { matchThreshold: { kind: 'majority' } })
    expect(store.get(code)!.matchThreshold).toEqual({ kind: 'majority' })
  })

  it('rejects an atLeast.n greater than the current participant count', () => {
    const { store, code } = newRoom()
    joinRoom(store, code, 'Alice')
    const result = updateSettings(store, code, true, { matchThreshold: { kind: 'atLeast', n: 5 } })
    expect(result).toEqual({ ok: false, code: 'invalid_threshold' })
  })

  it('is rejected once the room has left lobby', () => {
    const { store, code } = newRoom()
    store.get(code)!.status = 'active'
    expect(updateSettings(store, code, true, { candidateSource: 'plex+tmdb' })).toEqual({
      ok: false,
      code: 'already_started',
    })
  })
})
