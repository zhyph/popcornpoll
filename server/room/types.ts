import type { GenreTally } from '../ranking/affinity'
import type { PoolEntry } from '../pool/buildPool'

export type MatchThreshold = { kind: 'all' } | { kind: 'majority' } | { kind: 'atLeast'; n: number }
export type CandidateSource = 'plex' | 'plex+tmdb'
export type RoomStatus = 'lobby' | 'starting' | 'active' | 'ended'
export type ConnectionStatus = 'connected' | 'disconnected'

export interface Participant {
  id: string
  displayName: string
  sessionToken: string
  connectionStatus: ConnectionStatus
  finished: boolean
  swipes: Map<number, 'yes' | 'no'>
  pendingCardId: number | null
  disconnectedAt: number | null
}

export interface TmdbFilters {
  genre?: string
  yearMin?: number
  yearMax?: number
  ratingMin?: number
}

export interface RoomState {
  code: string
  status: RoomStatus
  hostParticipantId: string | null
  hostToken: string | null
  hostClaimToken: string | null
  hostClaimConsumed: boolean
  participants: Map<string, Participant>
  revokedSessionTokens: Set<string>
  kickReasons: Map<string, 'kicked' | 'excluded_at_start'>
  matchThreshold: MatchThreshold
  candidateSource: CandidateSource
  tmdbFilters: TmdbFilters
  pool: PoolEntry[]
  matches: number[]
  matchedMovieIds: Set<number>
  exhausted: boolean
  genreTally: GenreTally
  totalVotes: number
  reputationC: number
  reputationM: number
  rngSeed: number
  rngCallCount: number
  lastActivityAt: number
  seq: number
  endedAt: number | null
}
