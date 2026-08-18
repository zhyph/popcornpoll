-- match_history.movie_id was declared as `INTEGER NOT NULL REFERENCES
-- movies(id)` with no ON DELETE clause. Under `foreign_keys = ON`
-- (server/db/index.ts), that FK blocks two existing, legitimate deletes of
-- rows in `movies`:
--   - mergeTmdbOnlyIntoPlexRow (server/db/movies.ts): deletes a TMDB-only
--     row once its Plex counterpart is found in the library.
--   - pruneStaleTmdbOnlyRows (server/db/movies.ts): deletes stale TMDB-only
--     rows on a schedule.
-- If either row was ever matched (recorded in match_history), the DELETE
-- throws "FOREIGN KEY constraint failed" and the whole transaction aborts.
-- match_history only ever reads title/posterPath/posterSource/year off its
-- own row (recentMatches/nightsSettled in matchHistory.ts) — it never joins
-- back to movies — so movie_id is purely informational and does not need
-- referential integrity. This recreates the table without the REFERENCES
-- constraint, keeping movie_id as a plain nullable INTEGER.
CREATE TABLE match_history_new (
  id INTEGER PRIMARY KEY,
  movie_id INTEGER,
  room_code TEXT NOT NULL,
  title TEXT NOT NULL,
  poster_path TEXT,
  poster_source TEXT NOT NULL CHECK (poster_source IN ('plex', 'tmdb')),
  year INTEGER,
  matched_at TEXT NOT NULL
);

INSERT INTO match_history_new (id, movie_id, room_code, title, poster_path, poster_source, year, matched_at)
  SELECT id, movie_id, room_code, title, poster_path, poster_source, year, matched_at FROM match_history;

DROP TABLE match_history;
ALTER TABLE match_history_new RENAME TO match_history;

CREATE INDEX match_history_matched_at_idx ON match_history(matched_at);
