CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE plex_link (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  client_identifier TEXT NOT NULL,
  server_url TEXT NOT NULL,
  auth_token TEXT NOT NULL,
  library_section_ids TEXT NOT NULL,
  linked_at TEXT NOT NULL
);

CREATE TABLE movies (
  id INTEGER PRIMARY KEY,
  plex_rating_key TEXT UNIQUE,
  tmdb_id INTEGER,
  imdb_id TEXT,
  title TEXT NOT NULL,
  poster_path TEXT,
  poster_source TEXT NOT NULL CHECK (poster_source IN ('plex', 'tmdb')),
  overview TEXT,
  year INTEGER,
  genres TEXT NOT NULL DEFAULT '[]',
  rating REAL,
  vote_count INTEGER,
  in_library INTEGER NOT NULL DEFAULT 0,
  last_sync_id INTEGER,
  last_used_at TEXT,
  cached_at TEXT NOT NULL
);

CREATE INDEX movies_tmdb_id_idx ON movies(tmdb_id);
CREATE INDEX movies_imdb_id_idx ON movies(imdb_id);
CREATE UNIQUE INDEX movies_tmdb_only_uq
  ON movies(tmdb_id) WHERE plex_rating_key IS NULL;
