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
// Network exposure's cap ("max concurrent rooms, e.g. 50, counting `ended`
// rooms until they're evicted") — enforced by the HTTP handler
// (server/http/rooms.ts) against store.all().length before calling
// create(), not in here; this constant lives with the store it's measured
// against.
export const MAX_CONCURRENT_ROOMS = 50

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

// codeGenerator defaults to the real generateRoomCode; overriding it is what
// lets roomStore.test.ts force a deterministic collision without a mocking
// library.
export function createRoomStore(codeGenerator: () => string = generateRoomCode): RoomStore {
  const rooms = new Map<string, RoomState>()

  return {
    create(matchThreshold, candidateSource, tmdbFilters) {
      let code = normalizeCode(codeGenerator())
      let attempts = 0
      while (rooms.has(code)) {
        if (attempts >= MAX_CODE_GENERATION_ATTEMPTS) {
          // Previously this loop fell through after MAX_CODE_GENERATION_ATTEMPTS
          // and called rooms.set() regardless, silently overwriting whatever
          // live room already held that code. With the ~10^7-code space and
          // the MAX_CONCURRENT_ROOMS cap above this is effectively
          // unreachable in production, but it must fail loudly rather than
          // clobber a live room if it's ever hit.
          throw new Error(`Could not generate a unique room code after ${MAX_CODE_GENERATION_ATTEMPTS} attempts`)
        }
        code = normalizeCode(codeGenerator())
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
      return rooms.get(normalizeCode(code))
    },
    delete(code) {
      rooms.delete(normalizeCode(code))
    },
    all() {
      return [...rooms.values()]
    },
  }
}
