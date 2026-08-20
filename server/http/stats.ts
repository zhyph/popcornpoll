// server/http/stats.ts
import type Database from 'better-sqlite3'
import { nightsSettled, recentMatches } from '../db/matchHistory'
import { DecryptionError, getPlexLink } from '../plex/link'

const RECENT_MATCHES_LIMIT = 12

// Deliberately unauthenticated. Two callers depend on that: the landing page
// (app/page.tsx), which is itself unauthenticated and renders recentMatches as
// its "last week" reel, and /setup, which probes plexLinked before it has an
// admin token to offer. So the recently-matched titles are readable by anyone
// who can reach this instance — the same boundary as room creation, which
// also has no login. README's "Network exposure" section states this
// outright; the fix for an instance where that matters is access control in
// front of the whole app, not auth on this one route.

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
