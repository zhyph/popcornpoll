// server/ws/protocol.ts
import type { PoolEntry } from '../pool/buildPool'
import type { ErrorCode } from '../room/actions'
import type { CandidateSource, ConnectionStatus, MatchThreshold, RoomStatus, TmdbFilters } from '../room/types'

// A custom WS close code (RFC 6455 reserves 4000-4999 for application use).
// Sent for a deliberate, terminal server-side close — kicked, or the room
// itself ending — so lib/wsClient.ts can distinguish it from a transient
// drop and stop its reconnect-with-backoff loop.
export const WS_CLOSE_TERMINAL = 4001

export type ClientMessage =
  | { type: 'join'; roomCode: string; displayName: string; hostClaimToken?: string }
  | { type: 'reconnect'; roomCode: string; sessionToken: string; hostToken?: string }
  | { type: 'resync' }
  | { type: 'swipe'; movieId: number; vote: 'yes' | 'no' }
  | { type: 'start' }
  | { type: 'end_room' }
  | { type: 'restart_reel' }
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
  // Lets a client derive host connectivity from any snapshot it receives —
  // notably the `joined` response, which is the only host-state signal a
  // client gets when it joins or reconnects *during* a host-gone window
  // (the live host_disconnected/host_reconnected broadcasts can't reach a
  // client that wasn't connected when they fired).
  isHost: boolean
}

// The Runners Up screen shows each candidate's yes-tally alongside its rank
// (the design's "3 of 4 yes" line), so the ranked list carries that count
// along with the pool entry instead of just the entry itself.
export interface RankedCandidate extends PoolEntry {
  yesCount: number
}

export interface RoomSnapshot {
  status: RoomStatus
  mySwipes: Record<number, 'yes' | 'no'>
  participants: ParticipantView[]
  matches: number[]
  exhausted: boolean
  matchThreshold: MatchThreshold
  candidateSource: CandidateSource
  totalVotes: number
  seq: number
  pool?: PoolEntry[]
  pendingCardId?: number | null
  topCandidates?: RankedCandidate[]
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
      totalVotes: number
      seq: number
    }
  | { type: 'match'; movieId: number; movie: PoolEntry; seq: number }
  | { type: 'exhausted'; topCandidates: RankedCandidate[] }
  | { type: 'notice'; level: 'info' | 'warning'; code: string; message: string }
  | { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' }
  | { type: 'host_disconnected' }
  | { type: 'host_reconnected' }
  | { type: 'room_ended'; reason: string; seq: number }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'heartbeat_ack' }
