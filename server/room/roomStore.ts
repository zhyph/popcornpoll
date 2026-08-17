// server/room/roomStore.ts
import { emptyTally } from '../ranking/affinity'
import { generateRoomCode, generateToken } from '../auth/tokens'
import type { CandidateSource, MatchThreshold, RoomState, TmdbFilters } from './types'

export interface RoomStore {
  create(matchThreshold: MatchThreshold, candidateSource: CandidateSource, tmdbFilters: TmdbFilters): {
    code: string
    hostClaimToken: string
  }
  get(code: string): RoomState | undefined
  delete(code: string): void
  all(): RoomState[]
}

const MAX_CODE_GENERATION_ATTEMPTS = 20

export function createRoomStore(): RoomStore {
  const rooms = new Map<string, RoomState>()

  return {
    create(matchThreshold, candidateSource, tmdbFilters) {
      let code = generateRoomCode()
      let attempts = 0
      while (rooms.has(code) && attempts < MAX_CODE_GENERATION_ATTEMPTS) {
        code = generateRoomCode()
        attempts++
      }
      const hostClaimToken = generateToken()
      const room: RoomState = {
        code,
        status: 'lobby',
        hostParticipantId: null,
        hostToken: null,
        hostClaimToken,
        hostClaimConsumed: false,
        participants: new Map(),
        revokedSessionTokens: new Set(),
        kickReasons: new Map(),
        matchThreshold,
        candidateSource,
        tmdbFilters,
        pool: [],
        matches: [],
        matchedMovieIds: new Set(),
        exhausted: false,
        genreTally: emptyTally(),
        totalVotes: 0,
        reputationC: 6.5,
        reputationM: 50,
        rngSeed:
          process.env.FAKE_EXTERNAL_APIS === 'true' && process.env.ROOM_RNG_SEED
            ? Number.parseInt(process.env.ROOM_RNG_SEED, 10)
            : Math.floor(Math.random() * 2 ** 31),
        rngCallCount: 0,
        lastActivityAt: Date.now(),
        seq: 0,
        endedAt: null,
      }
      rooms.set(code, room)
      return { code, hostClaimToken }
    },
    get(code) {
      return rooms.get(code)
    },
    delete(code) {
      rooms.delete(code)
    },
    all() {
      return [...rooms.values()]
    },
  }
}
