CREATE TABLE match_history (
  id INTEGER PRIMARY KEY,
  movie_id INTEGER NOT NULL REFERENCES movies(id),
  room_code TEXT NOT NULL,
  title TEXT NOT NULL,
  poster_path TEXT,
  poster_source TEXT NOT NULL CHECK (poster_source IN ('plex', 'tmdb')),
  year INTEGER,
  matched_at TEXT NOT NULL
);

CREATE INDEX match_history_matched_at_idx ON match_history(matched_at);
