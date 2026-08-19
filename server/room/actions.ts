// server/room/actions.ts
import { emptyTally, recordVote } from '../ranking/affinity'
import { generateToken } from '../auth/tokens'
import { clampThreshold, evaluateThreshold, isValidThreshold } from './matchThreshold'
import { recomputeExhaustion } from './activeActions'
import type { RoomStore } from './roomStore'
import type { CandidateSource, MatchThreshold, Participant, RoomState, TmdbFilters } from './types'

export const MAX_PARTICIPANTS_PER_ROOM = 20

export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'already_started'
  | 'invalid_name'
  | 'not_host'
  | 'kicked'
  | 'excluded_at_start'
  | 'invalid_threshold'
  | 'bad_token'
  | 'not_enough_participants'
  | 'pool_too_small'
  | 'library_empty'
  | 'not_your_card'
  | 'internal_error'
  | 'room_not_active'
  | 'rate_limited'
  | 'room_cap_reached'
  | 'forbidden_origin'
  | 'invalid_filters'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
function err<T>(code: ErrorCode): ActionResult<T> {
  return { ok: false, code }
}

function uniqueDisplayName(room: RoomState, requested: string): string {
  const taken = new Set([...room.participants.values()].map((p) => p.displayName))
  if (!taken.has(requested)) return requested
  let suffix = 2
  while (taken.has(`${requested} (${suffix})`)) suffix++
  return `${requested} (${suffix})`
}

export function joinRoom(
  store: RoomStore,
  code: string,
  displayName: string,
  hostClaimToken?: string,
): ActionResult<{
  participantId: string
  sessionToken: string
  hostToken: string | null
  hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null
  room: RoomState
}> {
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'lobby') return err('already_started')
  if (displayName.length < 1 || displayName.length > 24) return err('invalid_name')
  if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM) return err('room_full')

  const participantId = generateToken()
  const sessionToken = generateToken()
  const participant: Participant = {
    id: participantId,
    displayName: uniqueDisplayName(room, displayName),
    sessionToken,
    connectionStatus: 'connected',
    finished: false,
    swipes: new Map(),
    pendingCardId: null,
    disconnectedAt: null,
  }
  room.participants.set(participantId, participant)
  room.lastActivityAt = Date.now()

  let hostToken: string | null = null
  let hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null = null
  if (hostClaimToken !== undefined) {
    if (room.hostClaimConsumed) {
      hostClaimResult = 'already_consumed'
    } else if (hostClaimToken !== room.hostClaimToken) {
      hostClaimResult = 'expired'
    } else {
      room.hostClaimConsumed = true
      room.hostParticipantId = participantId
      hostToken = generateToken()
      room.hostToken = hostToken
      hostClaimResult = 'claimed'
    }
  }

  return ok({ participantId, sessionToken, hostToken, hostClaimResult, room })
}

export function reconnectRoom(
  store: RoomStore,
  code: string,
  sessionToken: string,
  hostToken?: string,
): ActionResult<{ participantId: string; isHost: boolean; room: RoomState }> {
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.revokedSessionTokens.has(sessionToken)) {
    const reason = room.kickReasons.get(sessionToken) ?? 'kicked'
    return err(reason)
  }
  const participant = [...room.participants.values()].find((p) => p.sessionToken === sessionToken)
  if (!participant) return err('bad_token')

  participant.connectionStatus = 'connected'
  participant.disconnectedAt = null
  room.lastActivityAt = Date.now()
  const isHost = hostToken !== undefined && hostToken === room.hostToken && room.hostParticipantId === participant.id
  if (room.status === 'active') recomputeExhaustion(room)

  return ok({ participantId: participant.id, isHost, room })
}

function rebuildAffinityFromSwipes(room: RoomState): void {
  let tally = emptyTally()
  let totalVotes = 0
  for (const participant of room.participants.values()) {
    for (const [movieId, vote] of participant.swipes) {
      const entry = room.pool.find((p) => p.movieId === movieId)
      if (entry) tally = recordVote(tally, entry.genres, vote)
      totalVotes++
    }
  }
  room.genreTally = tally
  room.totalVotes = totalVotes
}

function reevaluateMatches(room: RoomState): number[] {
  const frozenCount = room.participants.size
  const votedMovieIds = new Set<number>()
  for (const participant of room.participants.values()) {
    for (const movieId of participant.swipes.keys()) votedMovieIds.add(movieId)
  }
  const newMatches: number[] = []
  for (const movieId of votedMovieIds) {
    if (room.matchedMovieIds.has(movieId)) continue
    const yesCount = [...room.participants.values()].filter((p) => p.swipes.get(movieId) === 'yes').length
    if (evaluateThreshold(room.matchThreshold, yesCount, frozenCount)) {
      room.matchedMovieIds.add(movieId)
      room.matches.push(movieId)
      newMatches.push(movieId)
    }
  }
  return newMatches
}

export function kickParticipant(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  targetParticipantId: string,
): ActionResult<{ newMatches: number[] }> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  const target = room.participants.get(targetParticipantId)
  if (!target) return err('room_not_found')

  room.revokedSessionTokens.add(target.sessionToken)
  room.kickReasons.set(target.sessionToken, 'kicked')
  room.participants.delete(targetParticipantId)

  rebuildAffinityFromSwipes(room)
  const newMatches = reevaluateMatches(room)
  room.matchThreshold = clampThreshold(room.matchThreshold, room.participants.size)
  room.lastActivityAt = Date.now()
  if (room.status === 'active') recomputeExhaustion(room)

  return ok({ newMatches })
}

export function updateSettings(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  updates: Partial<{ matchThreshold: MatchThreshold; candidateSource: CandidateSource; tmdbFilters: TmdbFilters }>,
): ActionResult<null> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'lobby') return err('already_started')

  if (updates.matchThreshold && !isValidThreshold(updates.matchThreshold, room.participants.size)) {
    return err('invalid_threshold')
  }

  if (updates.matchThreshold) room.matchThreshold = updates.matchThreshold
  if (updates.candidateSource) room.candidateSource = updates.candidateSource
  if (updates.tmdbFilters) room.tmdbFilters = updates.tmdbFilters
  room.lastActivityAt = Date.now()

  return ok(null)
}
