import type Database from 'better-sqlite3'
import { isValidThreshold } from '../room/matchThreshold'
import type { RoomStore } from '../room/roomStore'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../room/types'

interface CreateRoomBody {
  candidateSource: CandidateSource
  matchThreshold: MatchThreshold
  tmdbFilters?: TmdbFilters
}

function isCreateRoomBody(value: unknown): value is CreateRoomBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.candidateSource === 'plex' || v.candidateSource === 'plex+tmdb') &&
    typeof v.matchThreshold === 'object' &&
    v.matchThreshold !== null
  )
}

export function createRoomsHandler(
  store: RoomStore,
  _db: Database.Database,
  _encryptionKey: string,
): (req: Request) => Promise<Response> {
  return async (req) => {
    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_threshold', message: 'malformed body' } }, { status: 400 })
    }
    if (!isCreateRoomBody(parsed)) {
      return Response.json({ error: { code: 'invalid_threshold', message: 'malformed body' } }, { status: 400 })
    }
    // At creation time there's no participant count yet — atLeast is validated
    // for real once real participants exist, at Start (Task 16). Here we only
    // reject the structurally-impossible case, n < 1.
    if (!isValidThreshold(parsed.matchThreshold, Number.MAX_SAFE_INTEGER)) {
      return Response.json({ error: { code: 'invalid_threshold', message: 'invalid threshold' } }, { status: 400 })
    }

    const { code, hostClaimToken } = store.create(
      parsed.matchThreshold,
      parsed.candidateSource,
      parsed.tmdbFilters ?? {},
    )
    return Response.json({ roomCode: code, hostClaimToken })
  }
}
