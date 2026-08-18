import type Database from 'better-sqlite3'
import { pruneStaleTmdbOnlyRows } from '../db/movies'
import type { RoomStore } from '../room/roomStore'

export interface TmdbPruneWorker {
  start(): void
  stop(): void
  runOnce(): number
}

// The cutoff itself is 30 days (spec: "TMDB-only row pruning"), so polling
// more than roughly once a day buys nothing.
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
export const TMDB_ONLY_STALE_DAYS = 30

export function createTmdbPruneWorker(db: Database.Database, store: RoomStore): TmdbPruneWorker {
  let timer: NodeJS.Timeout | null = null

  function runOnce(): number {
    const excludeIds = new Set<number>()
    for (const room of store.all()) {
      for (const entry of room.pool) excludeIds.add(entry.movieId)
    }
    return pruneStaleTmdbOnlyRows(db, TMDB_ONLY_STALE_DAYS, excludeIds)
  }

  return {
    start() {
      if (timer) return
      const tick = () => {
        try {
          runOnce()
        } catch (err) {
          console.error('tmdbPrune: sweep failed', err)
        }
        timer = setTimeout(tick, PRUNE_INTERVAL_MS)
      }
      timer = setTimeout(tick, 0)
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
    },
    runOnce,
  }
}
