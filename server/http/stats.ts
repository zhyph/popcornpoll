// server/http/stats.ts
import type Database from 'better-sqlite3'
import { nightsSettled, recentMatches } from '../db/matchHistory'
import { DecryptionError, getPlexLink } from '../plex/link'

const RECENT_MATCHES_LIMIT = 12

function isPlexLinked(db: Database.Database, encryptionKey: string): boolean {
  try {
    return getPlexLink(db, encryptionKey) !== null
  } catch (err) {
    if (err instanceof DecryptionError) {
      console.error(
        'Failed to decrypt stored Plex link — AUTH_ENCRYPTION_KEY may have changed. ' +
          'Reporting plexLinked: false; re-link via setup to recover.',
        err,
      )
      return false
    }
    throw err
  }
}

export function createStatsHandler(
  db: Database.Database,
  encryptionKey: string,
  librarySync: { lastSyncAt(): number | null },
): (req: Request) => Promise<Response> {
  return async () => {
    const libraryCount = (
      db.prepare('SELECT COUNT(*) AS n FROM movies WHERE plex_rating_key IS NOT NULL AND in_library = 1').get() as {
        n: number
      }
    ).n
    return Response.json({
      libraryCount,
      nightsSettled: nightsSettled(db),
      recentMatches: recentMatches(db, RECENT_MATCHES_LIMIT),
      plexLinked: isPlexLinked(db, encryptionKey),
      lastSyncAt: librarySync.lastSyncAt(),
    })
  }
}
