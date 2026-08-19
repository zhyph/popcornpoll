// server/ws/validateMessage.ts
//
// server/ws/server.ts only JSON.parses an incoming frame and casts the
// result to ClientMessage — that cast is a compile-time-only guarantee, so
// nothing stops a client from sending a payload that doesn't actually match
// the shape TypeScript assumes downstream. isClientMessage is the runtime
// boundary check: reject anything that doesn't structurally match before it
// reaches the router. This mirrors the hand-rolled type-guard style already
// used for untrusted JSON at the HTTP boundary (see isCreateRoomBody in
// server/http/rooms.ts) rather than introducing a new validation library.
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../room/types'
import type { ClientMessage } from './protocol'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isMatchThreshold(value: unknown): value is MatchThreshold {
  if (!isRecord(value)) return false
  if (value.kind === 'all' || value.kind === 'majority') return true
  if (value.kind === 'atLeast') return isFiniteNumber(value.n)
  return false
}

function isCandidateSource(value: unknown): value is CandidateSource {
  return value === 'plex' || value === 'plex+tmdb'
}

function isTmdbFilters(value: unknown): value is TmdbFilters {
  if (!isRecord(value)) return false
  return (
    (value.genre === undefined || typeof value.genre === 'string') &&
    (value.yearMin === undefined || isFiniteNumber(value.yearMin)) &&
    (value.yearMax === undefined || isFiniteNumber(value.yearMax)) &&
    (value.ratingMin === undefined || isFiniteNumber(value.ratingMin))
  )
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'join':
      return (
        typeof value.roomCode === 'string' &&
        typeof value.displayName === 'string' &&
        isOptionalString(value.hostClaimToken)
      )
    case 'reconnect':
      return (
        typeof value.roomCode === 'string' &&
        typeof value.sessionToken === 'string' &&
        isOptionalString(value.hostToken)
      )
    case 'resync':
    case 'start':
    case 'end_room':
    case 'restart_reel':
    case 'heartbeat':
      return true
    case 'swipe':
      return isFiniteNumber(value.movieId) && (value.vote === 'yes' || value.vote === 'no')
    case 'update_settings':
      return (
        (value.matchThreshold === undefined || isMatchThreshold(value.matchThreshold)) &&
        (value.candidateSource === undefined || isCandidateSource(value.candidateSource)) &&
        (value.tmdbFilters === undefined || isTmdbFilters(value.tmdbFilters))
      )
    case 'kick':
      return typeof value.participantId === 'string'
    default:
      return false
  }
}
