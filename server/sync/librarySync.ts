import type Database from 'better-sqlite3'
import { parseGuid } from '../plex/guid'
import type { PlexClient, PlexItem } from '../plex/client'
import { getPlexLink } from '../plex/link'
import type { TmdbClient } from '../tmdb/client'
import {
  findByTmdbId,
  mergeTmdbOnlyIntoPlexRow,
  sweepRemoved,
  upsertPlexRow,
} from '../db/movies'

export interface SyncDeps {
  db: Database.Database
  plex: PlexClient
  tmdb: TmdbClient
  encryptionKey: string
  chunkSize?: number
  imdbBackfillCap?: number
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

let runIdCounter = 0

export function createLibrarySync(deps: SyncDeps) {
  const chunkSize = deps.chunkSize ?? 200
  const imdbBackfillCap = deps.imdbBackfillCap ?? 50
  let inFlight: Promise<{ runId: number; itemCount: number }> | null = null

  async function doRun(): Promise<{ runId: number; itemCount: number }> {
    const link = getPlexLink(deps.db, deps.encryptionKey)
    if (!link) return { runId: -1, itemCount: 0 }

    const runId = ++runIdCounter
    const sections = await deps.plex.getLibrarySections(link.serverUrl, link.authToken)
    const allItems: PlexItem[] = []
    for (const section of sections) {
      const items = await deps.plex.getLibraryItems(link.serverUrl, link.authToken, section.id)
      allItems.push(...items)
    }

    let imdbLookupsUsed = 0
    for (const batch of chunk(allItems, chunkSize)) {
      const upsertBatch = deps.db.transaction(() => {
        for (const item of batch) {
          const { tmdbId, imdbId } = parseGuid(item)
          const row = upsertPlexRow(deps.db, runId, {
            plexRatingKey: item.ratingKey,
            tmdbId,
            imdbId,
            title: item.title,
            posterPath: null,
            posterSource: 'plex',
            overview: null,
            year: item.year,
            genres: item.genres,
            rating: null,
            voteCount: null,
            inLibrary: true,
            lastUsedAt: null,
          })
          return row
        }
      })
      upsertBatch()
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    // imdb backfill: for rows just synced with imdb_id but no tmdb_id, resolve one at a time.
    const needingBackfill = deps.db
      .prepare(
        `SELECT id, imdb_id FROM movies
         WHERE last_sync_id = ? AND tmdb_id IS NULL AND imdb_id IS NOT NULL
         LIMIT ?`,
      )
      .all(runId, imdbBackfillCap) as { id: number; imdb_id: string }[]

    for (const row of needingBackfill) {
      if (imdbLookupsUsed >= imdbBackfillCap) break
      imdbLookupsUsed++
      const tmdbId = await deps.tmdb.findByImdbId(row.imdb_id)
      if (!tmdbId) continue

      const existingTmdbOnly = findByTmdbId(deps.db, tmdbId)
      if (existingTmdbOnly && existingTmdbOnly.plexRatingKey === null) {
        mergeTmdbOnlyIntoPlexRow(deps.db, row.id, existingTmdbOnly.id)
      } else {
        deps.db.prepare('UPDATE movies SET tmdb_id = ? WHERE id = ?').run(tmdbId, row.id)
      }

      const details = await deps.tmdb.getMovieDetails(tmdbId)
      if (details) {
        deps.db
          .prepare('UPDATE movies SET rating = ?, vote_count = ? WHERE id = ?')
          .run(details.rating, details.voteCount, row.id)
      }
    }

    sweepRemoved(deps.db, runId)
    return { runId, itemCount: allItems.length }
  }

  return {
    async run() {
      if (inFlight) return inFlight
      inFlight = doRun().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    isRunning() {
      return inFlight !== null
    },
    async waitForCurrent() {
      if (inFlight) await inFlight
    },
  }
}
