// server/ws/router.ts
import type Database from 'better-sqlite3'
import { insertMatch } from '../db/matchHistory'
import { joinRoom, kickParticipant, reconnectRoom, updateSettings } from '../room/actions'
import { restartReel, startRoom, swipeAction, type SyncWaiter } from '../room/activeActions'
import { endRoom, touchActivity } from '../room/lifecycle'
import type { RoomStore } from '../room/roomStore'
import type { Participant, RoomState } from '../room/types'
import type { TmdbClient } from '../tmdb/client'
import type { ClientMessage, ParticipantView, RoomSnapshot, ServerMessage } from './protocol'

export interface ConnectionState {
  roomCode: string | null
  participantId: string | null
  isHost: boolean
}

export interface RouterOutput {
  toSender: ServerMessage[]
  toRoom: ServerMessage[]
  toParticipant: { participantId: string; messages: ServerMessage[] }[]
  closeSender: boolean
  newState: ConnectionState
}

function emptyOutput(state: ConnectionState): RouterOutput {
  return { toSender: [], toRoom: [], toParticipant: [], closeSender: false, newState: state }
}

function participantViews(room: RoomState): ParticipantView[] {
  return [...room.participants.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    connectionStatus: p.connectionStatus,
    finished: p.finished,
  }))
}

export function stateUpdate(room: RoomState): Extract<ServerMessage, { type: 'state_update' }> {
  room.seq++
  return {
    type: 'state_update',
    participants: participantViews(room),
    status: room.status,
    matches: room.matches,
    exhausted: room.exhausted,
    matchThreshold: room.matchThreshold,
    candidateSource: room.candidateSource,
    totalVotes: room.totalVotes,
    seq: room.seq,
  }
}

export function topCandidatesFor(room: RoomState): (typeof room.pool) {
  return [...room.pool]
    .filter((entry) => !room.matchedMovieIds.has(entry.movieId))
    .sort((a, b) => {
      const yesA = [...room.participants.values()].filter((p) => p.swipes.get(a.movieId) === 'yes').length
      const yesB = [...room.participants.values()].filter((p) => p.swipes.get(b.movieId) === 'yes').length
      return yesB - yesA
    })
    .slice(0, 5)
}

function snapshotFor(room: RoomState, participant: Participant): RoomSnapshot {
  const base: RoomSnapshot = {
    status: room.status,
    mySwipes: Object.fromEntries(participant.swipes),
    participants: participantViews(room),
    matches: room.matches,
    exhausted: room.exhausted,
    matchThreshold: room.matchThreshold,
    candidateSource: room.candidateSource,
    totalVotes: room.totalVotes,
    seq: room.seq,
  }
  if (room.status === 'active' || room.status === 'ended') {
    base.pool = room.pool
    base.pendingCardId = participant.pendingCardId
    if (room.exhausted && room.matches.length === 0) {
      base.topCandidates = topCandidatesFor(room)
    }
  }
  return base
}

export async function handleMessage(
  store: RoomStore,
  db: Database.Database,
  tmdb: TmdbClient,
  librarySync: SyncWaiter,
  state: ConnectionState,
  message: ClientMessage,
  onBroadcast?: (messages: ServerMessage[]) => void,
): Promise<RouterOutput> {
  switch (message.type) {
    case 'join': {
      const result = joinRoom(store, message.roomCode, message.displayName, message.hostClaimToken)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      touchActivity(result.data.room)
      const newState: ConnectionState = {
        // Canonical (uppercase) code from the room itself, not the raw
        // client-supplied message.roomCode — roomStore normalizes case for
        // get()/delete() but broadcastToRoom/closeRoomSockets filter by exact
        // string equality against this value, so a non-canonical-case join
        // would silently exclude the participant from every room broadcast.
        roomCode: result.data.room.code,
        participantId: result.data.participantId,
        isHost: result.data.hostToken !== null,
      }
      const participant = result.data.room.participants.get(result.data.participantId)!
      return {
        toSender: [
          {
            type: 'joined',
            participantId: result.data.participantId,
            sessionToken: result.data.sessionToken,
            hostToken: result.data.hostToken,
            hostClaimResult: result.data.hostClaimResult,
            room: snapshotFor(result.data.room, participant),
          },
        ],
        toRoom: [stateUpdate(result.data.room)],
        toParticipant: [],
        closeSender: false,
        newState,
      }
    }

    case 'reconnect': {
      const result = reconnectRoom(store, message.roomCode, message.sessionToken, message.hostToken)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      touchActivity(result.data.room)
      const participant = result.data.room.participants.get(result.data.participantId)!
      const newState: ConnectionState = {
        // See the 'join' case above — canonical code, not the raw client input.
        roomCode: result.data.room.code,
        participantId: result.data.participantId,
        isHost: result.data.isHost,
      }
      const update = stateUpdate(result.data.room)
      const toRoom: ServerMessage[] = result.data.isHost ? [update, { type: 'host_reconnected' }] : [update]
      return {
        toSender: [
          {
            type: 'joined',
            participantId: result.data.participantId,
            sessionToken: message.sessionToken,
            hostToken: result.data.isHost ? (result.data.room.hostToken as string) : null,
            hostClaimResult: null,
            room: snapshotFor(result.data.room, participant),
          },
        ],
        toRoom,
        toParticipant: [],
        closeSender: false,
        newState,
      }
    }

    case 'resync': {
      if (!state.roomCode || !state.participantId) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: 'room_not_found', message: 'not in a room' }] }
      }
      const room = store.get(state.roomCode)
      const participant = room?.participants.get(state.participantId)
      if (!room || !participant) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: 'room_not_found', message: 'room_not_found' }] }
      }
      return {
        ...emptyOutput(state),
        toSender: [
          {
            type: 'joined',
            participantId: state.participantId,
            sessionToken: participant.sessionToken,
            hostToken: state.isHost ? (room.hostToken as string) : null,
            hostClaimResult: null,
            room: snapshotFor(room, participant),
          },
        ],
      }
    }

    case 'swipe': {
      if (!state.roomCode || !state.participantId) return emptyOutput(state)
      const result = swipeAction(store, state.roomCode, state.participantId, message.movieId, message.vote)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      if (!result.data.consumed) {
        return { ...emptyOutput(state), toSender: [{ type: 'next_card', movieId: result.data.nextCardForParticipant }] }
      }
      const room = store.get(state.roomCode)!
      const toRoom: ServerMessage[] = [stateUpdate(room)]
      for (const movieId of result.data.newMatches) {
        const movie = room.pool.find((p) => p.movieId === movieId)!
        try {
          insertMatch(db, {
            movieId: movie.movieId,
            roomCode: room.code,
            title: movie.title,
            posterPath: movie.posterPath,
            posterSource: movie.posterSource,
            year: movie.year,
          })
        } catch (err) {
          console.error('insertMatch failed', err)
        }
        toRoom.push({ type: 'match', movieId, movie, seq: room.seq })
      }
      if (result.data.exhaustedNow && room.matches.length === 0) {
        toRoom.push({ type: 'exhausted', topCandidates: topCandidatesFor(room) })
      }
      return {
        toSender: [{ type: 'next_card', movieId: result.data.nextCardForParticipant }],
        toRoom,
        toParticipant: [],
        closeSender: false,
        newState: state,
      }
    }

    case 'start': {
      if (!state.roomCode) return emptyOutput(state)
      const roomCode = state.roomCode
      const result = await startRoom(store, roomCode, state.isHost, db, tmdb, librarySync, () => {
        const room = store.get(roomCode)
        if (room) onBroadcast?.([stateUpdate(room)])
      })
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(state.roomCode)!
      // stateUpdate() is the sole seq-incrementing call — build it first and
      // reuse its seq on room_started, so both messages in this toRoom batch
      // carry the identical value (the invariant the WS protocol section
      // documents: "every message describing [a] change carries that same
      // value"). Incrementing seq a second time here, before stateUpdate,
      // would desync the two — a real bug this exact fix closes.
      const update = stateUpdate(room)
      const toRoom: ServerMessage[] = [
        { type: 'room_started', pool: room.pool, seq: update.seq },
        update,
      ]
      if (result.data.degraded) {
        // buildPool couldn't reach TMDB for this round and fell back to a
        // Plex-only pool — tell the room rather than silently shrinking
        // the candidate set without explanation.
        toRoom.push({
          type: 'notice',
          level: 'warning',
          code: 'degraded_to_plex_only',
          message: 'TMDB is unavailable right now — this round uses your Plex library only.',
        })
      }
      return {
        ...emptyOutput(state),
        toRoom,
        toParticipant: Array.from(room.participants.values()).map((p) => ({
          participantId: p.id,
          messages: [{ type: 'next_card', movieId: p.pendingCardId }],
        })),
      }
    }

    case 'kick': {
      if (!state.roomCode) return emptyOutput(state)
      const room = store.get(state.roomCode)
      const target = room?.participants.get(message.participantId)
      const result = kickParticipant(store, state.roomCode, state.isHost, message.participantId)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const updatedRoom = store.get(state.roomCode)!
      const toRoom: ServerMessage[] = [stateUpdate(updatedRoom)]
      for (const movieId of result.data.newMatches) {
        const movie = updatedRoom.pool.find((p) => p.movieId === movieId)!
        try {
          insertMatch(db, {
            movieId: movie.movieId,
            roomCode: updatedRoom.code,
            title: movie.title,
            posterPath: movie.posterPath,
            posterSource: movie.posterSource,
            year: movie.year,
          })
        } catch (err) {
          console.error('insertMatch failed', err)
        }
        toRoom.push({ type: 'match', movieId, movie, seq: updatedRoom.seq })
      }
      if (updatedRoom.exhausted && updatedRoom.matches.length === 0) {
        toRoom.push({ type: 'exhausted', topCandidates: topCandidatesFor(updatedRoom) })
      }
      return {
        toSender: [],
        toRoom,
        toParticipant: target ? [{ participantId: target.id, messages: [{ type: 'kicked', reason: 'kicked' }] }] : [],
        closeSender: false,
        newState: state,
      }
    }

    case 'update_settings': {
      if (!state.roomCode) return emptyOutput(state)
      const result = updateSettings(store, state.roomCode, state.isHost, {
        matchThreshold: message.matchThreshold,
        candidateSource: message.candidateSource,
        tmdbFilters: message.tmdbFilters,
      })
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(state.roomCode)!
      return { ...emptyOutput(state), toRoom: [stateUpdate(room)] }
    }

    case 'end_room': {
      if (!state.roomCode) return emptyOutput(state)
      const result = endRoom(store, state.roomCode, state.isHost)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(state.roomCode)!
      const update = stateUpdate(room) // same reasoning as the 'start' case above — one seq source, reused
      return {
        ...emptyOutput(state),
        toRoom: [{ type: 'room_ended', reason: 'host_ended', seq: update.seq }, update],
      }
    }

    case 'restart_reel': {
      if (!state.roomCode) return emptyOutput(state)
      const roomCode = state.roomCode
      const result = await restartReel(store, roomCode, state.isHost, db, tmdb, librarySync)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(roomCode)!
      const update = stateUpdate(room) // same seq-source reasoning as 'start' and 'end_room' above
      const toRoom: ServerMessage[] = [{ type: 'room_started', pool: room.pool, seq: update.seq }, update]
      if (result.data.degraded) {
        toRoom.push({
          type: 'notice',
          level: 'warning',
          code: 'degraded_to_plex_only',
          message: 'TMDB is unavailable right now — this round uses your Plex library only.',
        })
      }
      return {
        ...emptyOutput(state),
        toRoom,
        toParticipant: Array.from(room.participants.values()).map((p) => ({
          participantId: p.id,
          messages: [{ type: 'next_card', movieId: p.pendingCardId }],
        })),
      }
    }

    case 'heartbeat': {
      if (state.roomCode) {
        const room = store.get(state.roomCode)
        if (room) touchActivity(room)
      }
      return { ...emptyOutput(state), toSender: [{ type: 'heartbeat_ack' }] }
    }
  }
}
