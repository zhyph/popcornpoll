// server/room/activeActions.ts
import type Database from 'better-sqlite3'
import { buildPool, POOL_MIN_SIZE, type PoolEntry } from '../pool/buildPool'
import { pickNextCard } from '../pool/nextCard'
import { recordVote } from '../ranking/affinity'
import { computeCAndM } from '../ranking/reputation'
import { createRng, type Rng } from '../ranking/rng'
import type { TmdbClient } from '../tmdb/client'
import { evaluateThreshold } from './matchThreshold'
import type { ActionResult, ErrorCode } from './actions'
import type { RoomStore } from './roomStore'
import type { RoomState } from './types'

export const MIN_PARTICIPANTS_TO_START = 2

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
function err<T>(code: ErrorCode): ActionResult<T> {
  return { ok: false, code }
}

export function nextRngForRoom(room: RoomState): Rng {
  const rng = createRng(room.rngSeed + room.rngCallCount)
  room.rngCallCount++
  return rng
}

function assignPendingCard(room: RoomState, participantId: string): number | null {
  const participant = room.participants.get(participantId)
  if (!participant) return null
  const swiped = new Set(participant.swipes.keys())
  const nextCardId = pickNextCard(
    room.pool,
    swiped,
    room.genreTally,
    room.totalVotes,
    room.reputationC,
    room.reputationM,
    nextRngForRoom(room),
  )
  participant.pendingCardId = nextCardId
  participant.finished = nextCardId === null
  return nextCardId
}

function recomputeExhaustion(room: RoomState): boolean {
  const blocking = [...room.participants.values()].some(
    (p) => p.connectionStatus === 'connected' && !p.finished,
  )
  room.exhausted = !blocking
  return room.exhausted
}

export async function startRoom(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  db: Database.Database,
  tmdb: TmdbClient,
): Promise<ActionResult<{ excludedParticipantIds: string[]; pool: PoolEntry[] }>> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'lobby') return err('already_started')

  const excludedParticipantIds: string[] = []
  for (const participant of [...room.participants.values()]) {
    if (participant.connectionStatus === 'disconnected') {
      room.revokedSessionTokens.add(participant.sessionToken)
      room.kickReasons.set(participant.sessionToken, 'excluded_at_start')
      room.participants.delete(participant.id)
      excludedParticipantIds.push(participant.id)
    }
  }

  if (room.participants.size < MIN_PARTICIPANTS_TO_START) {
    return err('not_enough_participants')
  }

  // Synchronous status flip BEFORE the async pool build — closes the join
  // race described in the spec's Concurrency section.
  room.status = 'starting'

  const result = await buildPool(db, tmdb, room.candidateSource, room.tmdbFilters, room.rngSeed)
  if (result.tooSmall) {
    room.status = 'lobby'
    return err('pool_too_small')
  }

  room.pool = result.pool
  const { c, m } = computeCAndM(result.pool)
  room.reputationC = c
  room.reputationM = m
  room.status = 'active'
  room.lastActivityAt = Date.now()

  for (const participantId of room.participants.keys()) {
    assignPendingCard(room, participantId)
  }
  recomputeExhaustion(room)

  return ok({ excludedParticipantIds, pool: room.pool })
}

export function swipeAction(
  store: RoomStore,
  code: string,
  participantId: string,
  movieId: number,
  vote: 'yes' | 'no',
): ActionResult<{ consumed: boolean; newMatches: number[]; nextCardForParticipant: number | null; exhaustedNow: boolean }> {
  const room = store.get(code)
  if (!room) return err('room_not_found')
  const participant = room.participants.get(participantId)
  if (!participant) return err('room_not_found')

  if (movieId !== participant.pendingCardId) {
    if (participant.swipes.has(movieId)) {
      // Replayed/duplicate delivery of an already-recorded swipe — idempotent no-op.
      return ok({ consumed: false, newMatches: [], nextCardForParticipant: participant.pendingCardId, exhaustedNow: room.exhausted })
    }
    return err('not_your_card')
  }

  participant.swipes.set(movieId, vote)
  room.totalVotes++
  const entry = room.pool.find((p) => p.movieId === movieId)
  if (entry) room.genreTally = recordVote(room.genreTally, entry.genres, vote)

  const newMatches: number[] = []
  if (!room.matchedMovieIds.has(movieId)) {
    const frozenCount = room.participants.size
    const yesCount = [...room.participants.values()].filter((p) => p.swipes.get(movieId) === 'yes').length
    if (evaluateThreshold(room.matchThreshold, yesCount, frozenCount)) {
      room.matchedMovieIds.add(movieId)
      room.matches.push(movieId)
      newMatches.push(movieId)
    }
  }

  const nextCardForParticipant = assignPendingCard(room, participantId)
  const exhaustedNow = recomputeExhaustion(room)
  room.lastActivityAt = Date.now()

  return ok({ consumed: true, newMatches, nextCardForParticipant, exhaustedNow })
}
