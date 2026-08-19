import type Database from 'better-sqlite3'

export interface MovieRow {
  id: number
  plexRatingKey: string | null
  tmdbId: number | null
  imdbId: string | null
  title: string
  posterPath: string | null
  posterSource: 'plex' | 'tmdb'
  overview: string | null
  year: number | null
  genres: string[]
  rating: number | null
  voteCount: number | null
  inLibrary: boolean
  lastSyncId: number | null
  lastUsedAt: string | null
  cachedAt: string
}

function rowFromDb(raw: Record<string, unknown>): MovieRow {
  return {
    id: raw.id as number,
    plexRatingKey: raw.plex_rating_key as string | null,
    tmdbId: raw.tmdb_id as number | null,
    imdbId: raw.imdb_id as string | null,
    title: raw.title as string,
    posterPath: raw.poster_path as string | null,
    posterSource: raw.poster_source as 'plex' | 'tmdb',
    overview: raw.overview as string | null,
    year: raw.year as number | null,
    genres: JSON.parse(raw.genres as string),
    rating: raw.rating as number | null,
    voteCount: raw.vote_count as number | null,
    inLibrary: Boolean(raw.in_library),
    lastSyncId: raw.last_sync_id as number | null,
    lastUsedAt: raw.last_used_at as string | null,
    cachedAt: raw.cached_at as string,
  }
}

export function upsertPlexRow(
  db: Database.Database,
  runId: number,
  row: Omit<MovieRow, 'id' | 'cachedAt' | 'lastSyncId'>,
): MovieRow {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO movies
       (plex_rating_key, tmdb_id, imdb_id, title, poster_path, poster_source,
        overview, year, genres, rating, vote_count, in_library, last_sync_id, last_used_at, cached_at)
     VALUES (@plexRatingKey, @tmdbId, @imdbId, @title, @posterPath, @posterSource,
             @overview, @year, @genres, @rating, @voteCount, @inLibrary, @runId, @lastUsedAt, @cachedAt)
     ON CONFLICT(plex_rating_key) DO UPDATE SET
       tmdb_id = excluded.tmdb_id,
       imdb_id = excluded.imdb_id,
       title = excluded.title,
       poster_path = excluded.poster_path,
       poster_source = excluded.poster_source,
       overview = excluded.overview,
       year = excluded.year,
       genres = excluded.genres,
       in_library = excluded.in_library,
       last_sync_id = excluded.last_sync_id`,
  ).run({
    plexRatingKey: row.plexRatingKey,
    tmdbId: row.tmdbId,
    imdbId: row.imdbId,
    title: row.title,
    posterPath: row.posterPath,
    posterSource: row.posterSource,
    overview: row.overview,
    year: row.year,
    genres: JSON.stringify(row.genres),
    rating: row.rating,
    voteCount: row.voteCount,
    inLibrary: row.inLibrary ? 1 : 0,
    runId,
    lastUsedAt: row.lastUsedAt,
    cachedAt: now,
  })
  const found = db.prepare('SELECT * FROM movies WHERE plex_rating_key = ?').get(row.plexRatingKey)
  return rowFromDb(found as Record<string, unknown>)
}

export function upsertTmdbOnlyRow(
  db: Database.Database,
  row: Omit<MovieRow, 'id' | 'cachedAt' | 'lastSyncId' | 'plexRatingKey' | 'inLibrary'>,
): MovieRow {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO movies
       (plex_rating_key, tmdb_id, imdb_id, title, poster_path, poster_source,
        overview, year, genres, rating, vote_count, in_library, last_used_at, cached_at)
     VALUES (NULL, @tmdbId, @imdbId, @title, @posterPath, @posterSource,
             @overview, @year, @genres, @rating, @voteCount, 0, @lastUsedAt, @cachedAt)
     ON CONFLICT(tmdb_id) WHERE plex_rating_key IS NULL DO UPDATE SET
       title = excluded.title,
       poster_path = excluded.poster_path,
       overview = excluded.overview,
       rating = excluded.rating,
       vote_count = excluded.vote_count`,
  ).run({
    tmdbId: row.tmdbId,
    imdbId: row.imdbId,
    title: row.title,
    posterPath: row.posterPath,
    posterSource: row.posterSource,
    overview: row.overview,
    year: row.year,
    genres: JSON.stringify(row.genres),
    rating: row.rating,
    voteCount: row.voteCount,
    lastUsedAt: row.lastUsedAt,
    cachedAt: now,
  })
  const found = db
    .prepare('SELECT * FROM movies WHERE tmdb_id = ? AND plex_rating_key IS NULL')
    .get(row.tmdbId)
  return rowFromDb(found as Record<string, unknown>)
}

export function sweepRemoved(db: Database.Database, runId: number): void {
  db.prepare(
    `UPDATE movies SET in_library = 0
     WHERE plex_rating_key IS NOT NULL AND (last_sync_id IS NULL OR last_sync_id != ?)`,
  ).run(runId)
}

export function findByTmdbId(db: Database.Database, tmdbId: number): MovieRow | null {
  const found = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdbId)
  return found ? rowFromDb(found as Record<string, unknown>) : null
}

export function findById(db: Database.Database, id: number): MovieRow | null {
  const found = db.prepare('SELECT * FROM movies WHERE id = ?').get(id)
  return found ? rowFromDb(found as Record<string, unknown>) : null
}

export function findRowsNeedingEnrichment(db: Database.Database, limit: number): MovieRow[] {
  const rows = db
    .prepare('SELECT * FROM movies WHERE tmdb_id IS NOT NULL AND rating IS NULL LIMIT ?')
    .all(limit)
  return rows.map((r) => rowFromDb(r as Record<string, unknown>))
}

export function mergeTmdbOnlyIntoPlexRow(
  db: Database.Database,
  plexRowId: number,
  tmdbOnlyRowId: number,
): void {
  const merge = db.transaction(() => {
    const tmdbOnly = db.prepare('SELECT * FROM movies WHERE id = ?').get(tmdbOnlyRowId) as
      | Record<string, unknown>
      | undefined
    if (!tmdbOnly) return
    db.prepare(
      `UPDATE movies SET
         tmdb_id = COALESCE(tmdb_id, @tmdbId),
         overview = COALESCE(overview, @overview),
         rating = COALESCE(rating, @rating),
         vote_count = COALESCE(vote_count, @voteCount)
       WHERE id = @plexRowId`,
    ).run({
      tmdbId: tmdbOnly.tmdb_id,
      overview: tmdbOnly.overview,
      rating: tmdbOnly.rating,
      voteCount: tmdbOnly.vote_count,
      plexRowId,
    })
    db.prepare('DELETE FROM movies WHERE id = ?').run(tmdbOnlyRowId)
  })
  merge()
}

export function pruneStaleTmdbOnlyRows(
  db: Database.Database,
  olderThanDays: number,
  excludeIds: Set<number>,
): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const candidates = db
    .prepare(
      `SELECT id FROM movies
       WHERE plex_rating_key IS NULL AND (last_used_at IS NULL OR last_used_at < ?)`,
    )
    .all(cutoff) as { id: number }[]
  const toDelete = candidates.filter((c) => !excludeIds.has(c.id))
  if (toDelete.length === 0) return 0
  const stmt = db.prepare('DELETE FROM movies WHERE id = ?')
  const deleteAll = db.transaction(() => {
    for (const c of toDelete) stmt.run(c.id)
  })
  deleteAll()
  return toDelete.length
}

export function stampLastUsed(db: Database.Database, ids: number[], when: string): void {
  if (ids.length === 0) return
  const stmt = db.prepare('UPDATE movies SET last_used_at = ? WHERE id = ?')
  const stampAll = db.transaction(() => {
    for (const id of ids) stmt.run(when, id)
  })
  stampAll()
}

// The Box Office screen's genre filter is a closed select, not free text —
// its options come from whatever's actually on the linked library's shelf,
// not a hardcoded genre list that might not match what the owner actually
// has. `genres` is stored as a JSON array string (see upsertPlexRow), so
// dedup/sort happens in JS after a single-column scan rather than relying on
// SQLite JSON functions that better-sqlite3 doesn't guarantee are compiled in.
export function findDistinctGenres(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT genres FROM movies WHERE plex_rating_key IS NOT NULL AND in_library = 1`)
    .all() as { genres: string }[]
  const genres = new Set<string>()
  for (const row of rows) {
    // Every writer (upsertPlexRow/upsertTmdbOnlyRow) JSON.stringifies this
    // column, so malformed JSON shouldn't occur in practice — but this feeds
    // a decorative dropdown, not a critical path, so one corrupt row must
    // not 500 the whole /api/genres response and blank out every other
    // movie's genres. Skip just that row instead.
    let parsed: unknown
    try {
      parsed = JSON.parse(row.genres)
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    for (const genre of parsed) if (typeof genre === 'string') genres.add(genre)
  }
  return [...genres].sort((a, b) => a.localeCompare(b))
}

export function findEligiblePlexRows(
  db: Database.Database,
  filters: { genre?: string; yearMin?: number; yearMax?: number; ratingMin?: number },
): MovieRow[] {
  let sql = `SELECT * FROM movies WHERE plex_rating_key IS NOT NULL AND in_library = 1`
  const params: unknown[] = []
  if (filters.genre) {
    sql += ` AND genres LIKE ?`
    params.push(`%"${filters.genre}"%`)
  }
  if (filters.yearMin !== undefined) {
    sql += ` AND year >= ?`
    params.push(filters.yearMin)
  }
  if (filters.yearMax !== undefined) {
    sql += ` AND year <= ?`
    params.push(filters.yearMax)
  }
  if (filters.ratingMin !== undefined) {
    sql += ` AND rating IS NOT NULL AND rating >= ?`
    params.push(filters.ratingMin)
  }
  const rows = db.prepare(sql).all(...params)
  return rows.map((r) => rowFromDb(r as Record<string, unknown>))
}
