import type { ActionResult, ErrorCode } from './actions'
import type { RoomStore } from './roomStore'
import type { RoomState } from './types'

export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
export const EVICTION_DELAY_MS = 10 * 60 * 1000

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
function err<T>(code: ErrorCode): ActionResult<T> {
  return { ok: false, code }
}

export function endRoom(store: RoomStore, code: string, callerIsHost: boolean): ActionResult<null> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  room.status = 'ended'
  room.endedAt = Date.now()
  return ok(null)
}

export function touchActivity(room: RoomState): void {
  room.lastActivityAt = Date.now()
}

export function sweepInactiveRooms(store: RoomStore, now: number): string[] {
  const endedCodes: string[] = []
  for (const room of store.all()) {
    if (room.status === 'ended') continue
    if (now - room.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
      room.status = 'ended'
      room.endedAt = now
      endedCodes.push(room.code)
    }
  }
  return endedCodes
}

export function sweepEvictions(store: RoomStore, now: number): string[] {
  const evicted: string[] = []
  for (const room of store.all()) {
    if (room.status !== 'ended' || room.endedAt === null) continue
    if (now - room.endedAt > EVICTION_DELAY_MS) {
      store.delete(room.code)
      evicted.push(room.code)
    }
  }
  return evicted
}
