import type Database from 'better-sqlite3'
import { findRowsNeedingEnrichment } from '../db/movies'
import type { TmdbClient } from '../tmdb/client'

export interface EnrichmentWorker {
  start(): void
  stop(): void
  runOnce(): Promise<number>
}

export function createEnrichmentWorker(
  db: Database.Database,
  tmdb: TmdbClient,
  requestsPerSecond = 2,
): EnrichmentWorker {
  let timer: NodeJS.Timeout | null = null

  async function runOnce(): Promise<number> {
    const batch = findRowsNeedingEnrichment(db, 50)
    let enriched = 0
    for (const row of batch) {
      if (row.tmdbId === null) continue
      const details = await tmdb.getMovieDetails(row.tmdbId)
      if (details) {
        db.prepare('UPDATE movies SET rating = ?, vote_count = ? WHERE id = ?').run(
          details.rating,
          details.voteCount,
          row.id,
        )
        enriched++
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000 / requestsPerSecond))
    }
    return enriched
  }

  return {
    start() {
      if (timer) return
      const tick = async () => {
        await runOnce()
        timer = setTimeout(tick, 30_000)
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
