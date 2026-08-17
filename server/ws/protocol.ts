// server/ws/protocol.ts
import type { PoolEntry } from '../pool/buildPool'
import type { ErrorCode } from '../room/actions'
import type { CandidateSource, ConnectionStatus, MatchThreshold, RoomStatus, TmdbFilters } from '../room/types'

export type ClientMessage =
  | { type: 'join'; roomCode: string; displayName: string; hostClaimToken?: string }
  | { type: 'reconnect'; roomCode: string; sessionToken: string; hostToken?: string }
  | { type: 'resync' }
  | { type: 'swipe'; movieId: number; vote: 'yes' | 'no' }
  | { type: 'start' }
  | { type: 'end_room' }
  | {
      type: 'update_settings'
      matchThreshold?: MatchThreshold
      candidateSource?: CandidateSource
      tmdbFilters?: TmdbFilters
    }
  | { type: 'kick'; participantId: string }
  | { type: 'heartbeat' }

export interface ParticipantView {
  id: string
  displayName: string
  connectionStatus: ConnectionStatus
  finished: boolean
}

export interface RoomSnapshot {
  status: RoomStatus
  mySwipes: Record<number, 'yes' | 'no'>
  participants: ParticipantView[]
  matches: number[]
  exhausted: boolean
  matchThreshold: MatchThreshold
  candidateSource: CandidateSource
  seq: number
  pool?: PoolEntry[]
  pendingCardId?: number | null
  topCandidates?: PoolEntry[]
}

export type ServerMessage =
  | {
      type: 'joined'
      participantId: string
      sessionToken: string
      hostToken: string | null
      hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null
      room: RoomSnapshot
    }
  | { type: 'room_started'; pool: PoolEntry[]; seq: number }
  | { type: 'next_card'; movieId: number | null }
  | {
      type: 'state_update'
      participants: ParticipantView[]
      status: RoomStatus
      matches: number[]
      exhausted: boolean
      matchThreshold: MatchThreshold
      candidateSource: CandidateSource
      seq: number
    }
  | { type: 'match'; movieId: number; movie: PoolEntry; seq: number }
  | { type: 'exhausted'; topCandidates: PoolEntry[] }
  | { type: 'notice'; level: 'info' | 'warning'; code: string; message: string }
  | { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' }
  | { type: 'room_ended'; reason: string; seq: number }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'heartbeat_ack' }
