// server/db/matchHistory.ts
import type Database from 'better-sqlite3'

export interface MatchHistoryEntry {
  // The Box Office "last week at this house" strip needs this to build a
  // /api/plex-image?movieId= URL for plex-sourced entries (which, like the
  // swipe deck's cards, carry no posterPath of their own) — without it the
  // strip can only ever show its striped placeholder, never a real poster.
  movieId: number
  title: string
  posterPath: string | null
  posterSource: 'plex' | 'tmdb'
  year: number | null
}

export function insertMatch(
  db: Database.Database,
  params: {
    movieId: number
    roomCode: string
    title: string
    posterPath: string | null
    posterSource: 'plex' | 'tmdb'
    year: number | null
  },
): void {
  db.prepare(
    `INSERT INTO match_history (movie_id, room_code, title, poster_path, poster_source, year, matched_at)
     VALUES (@movieId, @roomCode, @title, @posterPath, @posterSource, @year, @matchedAt)`,
  ).run({ ...params, matchedAt: new Date().toISOString() })
}

export function recentMatches(db: Database.Database, limit: number): MatchHistoryEntry[] {
  const rows = db
    .prepare('SELECT movie_id, title, poster_path, poster_source, year FROM match_history ORDER BY matched_at DESC LIMIT ?')
    .all(limit) as {
    movie_id: number
    title: string
    poster_path: string | null
    poster_source: 'plex' | 'tmdb'
    year: number | null
  }[]
  return rows.map((r) => ({
    movieId: r.movie_id,
    title: r.title,
    posterPath: r.poster_path,
    posterSource: r.poster_source,
    year: r.year,
  }))
}

export function nightsSettled(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(DISTINCT room_code) AS n FROM match_history').get() as { n: number }).n
}
