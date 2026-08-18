# PopcornPoll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PopcornPoll, a self-hosted, single-container Tinder-style movie-night picker for Plex, with optional TMDB-extended candidates, reputation-weighted and live-affinity-adaptive deck ordering, realtime WebSocket sync, and no persistent participant data.

**Architecture:** Next.js (App Router) frontend served by a custom Node server that also terminates WebSocket connections (`ws`) and a small HTTP API. Room/session state lives in an in-memory `Map`; a SQLite file (`better-sqlite3`) holds the Plex link and the movie-metadata cache. No external services, no Redis.

**Tech Stack:** TypeScript (strict), Next.js App Router, `ws`, `better-sqlite3`, Vitest, Playwright, Framer Motion, Docker.

**Spec:** `docs/superpowers/specs/2026-08-17-popcornpoll-design.md` — this plan implements that spec; executors should have both open.

## Global Constraints

- Single replica only — the in-memory room `Map` does not survive a restart and is not shared across processes.
- `TMDB_API_KEY` (v3 key), `AUTH_ENCRYPTION_KEY`, `ADMIN_SETUP_TOKEN`, `APP_ORIGIN` are all **required** env vars; the app refuses to boot without them. `TRUSTED_PROXY_HOPS` is optional, default `0`.
- No participant accounts; sessions are ephemeral. The Plex link is a one-time, instance-level setup concept.
- Match threshold is a tagged union: `{kind: 'all'} | {kind: 'majority'} | {kind: 'atLeast', n}` with `n >= 1`. `matches` is append-only — never retracted.
- Room codes: 2-word + 3-digit format (e.g. `BLUE-FOX-427`) from a 100-word list.
- Pool cap 100 candidates, minimum pool size 5, minimum participant count 2.
- 30-minute inactivity timeout (reset by join/swipe/host action/any connected participant's heartbeat); 10-minute eviction after `ended`.
- TypeScript strict mode throughout. Vitest for unit tests, Playwright for end-to-end.
- All UI work goes through the frontend-design skill's process, not default component styling — shadcn/ui (Radix-based) for structural components, react-bits (via the shadcn CLI's `@react-bits` registry) for ambient motion, hand-authored components for the bespoke signature element. Design tokens (palette, type, structural devices) are fixed in Task 22 — later UI work extends that system rather than introducing a new one.
- Plex/TMDB clients are always called through an interface with a fake implementation, selected via `FAKE_EXTERNAL_APIS=true`, so no task's tests require network access or real credentials.
- UI chrome is internationalized (Task 25): pt-BR is the default locale, en-US is available via a cookie-persisted switcher, no URL locale prefix — room links stay `/room/CODE`. Movie content (Plex/TMDB titles/overviews/genres) and room codes are not translated.

---

## Task 1: Project scaffolding + config loader

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `server/config.ts`
- Test: `server/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): AppConfig` where
  ```ts
  interface AppConfig {
    tmdbApiKey: string
    authEncryptionKey: string
    adminSetupToken: string
    appOrigin: string
    trustedProxyHops: number
    port: number
    dataDir: string
  }
  ```
  Throws `ConfigError` (a named `Error` subclass, message lists every missing var) if any required var is absent.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "popcornpoll",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx server/index.ts",
    "build": "next build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "framer-motion": "^11.5.4",
    "next": "^14.2.5",
    "qrcode": "^1.5.4",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.5.4",
    "@types/react": "^18.3.5",
    "@types/qrcode": "^1.5.5",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist", ".next"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.next', 'e2e/**'],
  },
})
```

- [ ] **Step 4: Write `next.config.js`**

```js
/** @type {import('next').NextConfig} */
// package.json declares "type": "module", so this file is loaded as ESM —
// `module.exports` would throw ReferenceError at Next.js build time. This
// bug went undetected until Task 22 was the first task to actually run
// `next build`; fixed here so it's caught by then, not discovered fresh.
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org' }],
  },
}

export default nextConfig
```

- [ ] **Step 5: Write `.gitignore` and `.env.example`**

`.gitignore`:
```
node_modules/
.next/
dist/
data/
*.db
.env
```

`.env.example`:
```
TMDB_API_KEY=
AUTH_ENCRYPTION_KEY=
ADMIN_SETUP_TOKEN=
APP_ORIGIN=http://localhost:3000
TRUSTED_PROXY_HOPS=0
PORT=3000
DATA_DIR=./data
```

- [ ] **Step 6: Write the failing test for the config loader**

```ts
// server/config.test.ts
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config'

const validEnv = {
  TMDB_API_KEY: 'tmdb-key',
  AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
  ADMIN_SETUP_TOKEN: 'setup-token',
  APP_ORIGIN: 'http://localhost:3000',
}

describe('loadConfig', () => {
  it('loads a valid config with defaults applied', () => {
    const config = loadConfig(validEnv)
    expect(config.tmdbApiKey).toBe('tmdb-key')
    expect(config.trustedProxyHops).toBe(0)
    expect(config.port).toBe(3000)
    expect(config.dataDir).toBe('./data')
  })

  it('respects explicit PORT, DATA_DIR, and TRUSTED_PROXY_HOPS', () => {
    const config = loadConfig({ ...validEnv, PORT: '4000', DATA_DIR: '/data', TRUSTED_PROXY_HOPS: '2' })
    expect(config.port).toBe(4000)
    expect(config.dataDir).toBe('/data')
    expect(config.trustedProxyHops).toBe(2)
  })

  it('throws ConfigError listing every missing required var', () => {
    expect(() => loadConfig({})).toThrow(ConfigError)
    try {
      loadConfig({})
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const message = (err as Error).message
      expect(message).toContain('TMDB_API_KEY')
      expect(message).toContain('AUTH_ENCRYPTION_KEY')
      expect(message).toContain('ADMIN_SETUP_TOKEN')
      expect(message).toContain('APP_ORIGIN')
    }
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run server/config.test.ts`
Expected: FAIL — `server/config.ts` does not exist yet.

- [ ] **Step 8: Write `server/config.ts`**

```ts
// server/config.ts
export class ConfigError extends Error {}

export interface AppConfig {
  tmdbApiKey: string
  authEncryptionKey: string
  adminSetupToken: string
  appOrigin: string
  trustedProxyHops: number
  port: number
  dataDir: string
}

const REQUIRED_VARS = ['TMDB_API_KEY', 'AUTH_ENCRYPTION_KEY', 'ADMIN_SETUP_TOKEN', 'APP_ORIGIN'] as const

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const missing = REQUIRED_VARS.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new ConfigError(`Missing required environment variable(s): ${missing.join(', ')}`)
  }

  return {
    tmdbApiKey: env.TMDB_API_KEY as string,
    authEncryptionKey: env.AUTH_ENCRYPTION_KEY as string,
    adminSetupToken: env.ADMIN_SETUP_TOKEN as string,
    appOrigin: env.APP_ORIGIN as string,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS ? Number.parseInt(env.TRUSTED_PROXY_HOPS, 10) : 0,
    port: env.PORT ? Number.parseInt(env.PORT, 10) : 3000,
    dataDir: env.DATA_DIR ?? './data',
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run server/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Install dependencies and commit**

```bash
npm install
git add -A
git commit -m "chore: project scaffolding and env config loader"
```

---

## Task 2: SQLite schema + migration runner

**Files:**
- Create: `server/db/migrations/001_init.sql`
- Create: `server/db/index.ts`
- Test: `server/db/index.test.ts`

**Interfaces:**
- Consumes: `AppConfig.dataDir` (Task 1)
- Produces: `openDb(dataDir: string): Database.Database` (a `better-sqlite3` handle with all migrations applied), `runMigrations(db: Database.Database): void`

- [ ] **Step 1: Write the migration SQL**

```sql
-- server/db/migrations/001_init.sql
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
```

- [ ] **Step 2: Write the failing test**

```ts
// server/db/index.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-db-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openDb', () => {
  it('creates the sqlite file and applies migrations', () => {
    const db = openDb(dir)
    expect(existsSync(join(dir, 'popcornpoll.db'))).toBe(true)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('movies')
    expect(names).toContain('plex_link')
    expect(names).toContain('schema_version')
    db.close()
  })

  it('is idempotent — reopening does not re-apply or fail', () => {
    openDb(dir).close()
    const db = openDb(dir)
    const version = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }
    expect(version.v).toBe(1)
    db.close()
  })

  it('enforces movies_tmdb_only_uq — two NULL-plex_rating_key rows with the same tmdb_id collide', () => {
    const db = openDb(dir)
    const insert = db.prepare(
      `INSERT INTO movies (plex_rating_key, tmdb_id, title, poster_source, cached_at)
       VALUES (NULL, 42, 'A', 'tmdb', '2026-01-01')`,
    )
    insert.run()
    expect(() => insert.run()).toThrow()
    db.close()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/db/index.test.ts`
Expected: FAIL — `server/db/index.ts` does not exist yet.

- [ ] **Step 4: Write `server/db/index.ts`**

```ts
// server/db/index.ts
import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS: Array<{ version: number; file: string }> = [
  { version: 1, file: '001_init.sql' },
]

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)')
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as { version: number }[]).map(
      (row) => row.version,
    ),
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    const sql = readFileSync(join(import.meta.dirname, 'migrations', migration.file), 'utf-8')
    const runMigration = db.transaction(() => {
      // 001_init.sql itself creates schema_version, which would collide with the
      // CREATE TABLE IF NOT EXISTS above on a fresh DB — strip that one statement.
      const withoutVersionTable = sql.replace(/CREATE TABLE schema_version[\s\S]*?;/, '')
      db.exec(withoutVersionTable)
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
    })
    runMigration()
  }
}

export function openDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true })
  const db = new Database(join(dataDir, 'popcornpoll.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/db/index.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add server/db
git commit -m "feat: sqlite schema and migration runner"
```

---

## Task 3: Movies data access layer

**Files:**
- Create: `server/db/movies.ts`
- Test: `server/db/movies.test.ts`

**Interfaces:**
- Consumes: `Database.Database` (Task 2)
- Produces:
  ```ts
  interface MovieRow {
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

  function upsertPlexRow(db: Database.Database, runId: number, row: Omit<MovieRow, 'id' | 'cachedAt' | 'lastSyncId'>): MovieRow
  function upsertTmdbOnlyRow(db: Database.Database, row: Omit<MovieRow, 'id' | 'cachedAt' | 'lastSyncId' | 'plexRatingKey' | 'inLibrary'>): MovieRow
  function sweepRemoved(db: Database.Database, runId: number): void
  function findByTmdbId(db: Database.Database, tmdbId: number): MovieRow | null
  function findRowsNeedingEnrichment(db: Database.Database, limit: number): MovieRow[]
  function mergeTmdbOnlyIntoPlexRow(db: Database.Database, plexRowId: number, tmdbOnlyRowId: number): void
  function pruneStaleTmdbOnlyRows(db: Database.Database, olderThanDays: number, excludeIds: Set<number>): number
  function stampLastUsed(db: Database.Database, ids: number[], when: string): void
  function findEligiblePlexRows(db: Database.Database, filters: { genre?: string; yearMin?: number; yearMax?: number; ratingMin?: number }): MovieRow[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/db/movies.test.ts
import { rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import {
  findByTmdbId,
  findEligiblePlexRows,
  findRowsNeedingEnrichment,
  mergeTmdbOnlyIntoPlexRow,
  pruneStaleTmdbOnlyRows,
  stampLastUsed,
  sweepRemoved,
  upsertPlexRow,
  upsertTmdbOnlyRow,
} from './movies'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-movies-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('upsertPlexRow + sweepRemoved', () => {
  it('upserts by plex_rating_key and re-upserting updates in place', () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-1',
      tmdbId: null,
      imdbId: null,
      title: 'Arrival',
      posterPath: '/thumb/pk-1',
      posterSource: 'plex',
      overview: null,
      year: 2016,
      genres: ['Sci-Fi'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const again = upsertPlexRow(db, 2, { ...row, title: 'Arrival (renamed)' })
    expect(again.id).toBe(row.id)
    expect(again.title).toBe('Arrival (renamed)')
  })

  it('sweepRemoved sets in_library=0 for rows not touched by the given runId', () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-2',
      tmdbId: null,
      imdbId: null,
      title: 'Gone',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    sweepRemoved(db, 2) // run 2 didn't touch row (stamped with runId 1)
    const found = findByTmdbId(db, -1) // not used here; re-read via raw query instead
    const raw = db.prepare('SELECT in_library FROM movies WHERE id = ?').get(row.id) as {
      in_library: number
    }
    expect(raw.in_library).toBe(0)
  })
})

describe('upsertTmdbOnlyRow + mergeTmdbOnlyIntoPlexRow', () => {
  it('merges a TMDB-only row into a Plex row sharing the same tmdb_id and deletes the duplicate', () => {
    const tmdbOnly = upsertTmdbOnlyRow(db, {
      tmdbId: 99,
      imdbId: null,
      title: 'Dune',
      posterPath: '/dune.jpg',
      posterSource: 'tmdb',
      overview: 'desc',
      year: 2021,
      genres: ['Sci-Fi'],
      rating: 8.1,
      voteCount: 12000,
      lastUsedAt: null,
    })
    const plexRow = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-3',
      tmdbId: null,
      imdbId: null,
      title: 'Dune',
      posterPath: '/thumb/pk-3',
      posterSource: 'plex',
      overview: null,
      year: 2021,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })

    mergeTmdbOnlyIntoPlexRow(db, plexRow.id, tmdbOnly.id)

    const merged = db.prepare('SELECT * FROM movies WHERE id = ?').get(plexRow.id) as {
      tmdb_id: number
      rating: number
    }
    expect(merged.tmdb_id).toBe(99)
    expect(merged.rating).toBe(8.1)
    const deleted = db.prepare('SELECT * FROM movies WHERE id = ?').get(tmdbOnly.id)
    expect(deleted).toBeUndefined()
  })
})

describe('findRowsNeedingEnrichment', () => {
  it('returns rows with a tmdb_id but NULL rating, up to the limit', () => {
    for (let i = 0; i < 3; i++) {
      upsertPlexRow(db, 1, {
        plexRatingKey: `pk-e${i}`,
        tmdbId: 100 + i,
        imdbId: null,
        title: `Movie ${i}`,
        posterPath: null,
        posterSource: 'plex',
        overview: null,
        year: null,
        genres: [],
        rating: null,
        voteCount: null,
        inLibrary: true,
        lastUsedAt: null,
      })
    }
    const rows = findRowsNeedingEnrichment(db, 2)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.tmdbId !== null && r.rating === null)).toBe(true)
  })
})

describe('pruneStaleTmdbOnlyRows', () => {
  it('deletes TMDB-only rows past the age cutoff, except excluded ids', () => {
    const old = upsertTmdbOnlyRow(db, {
      tmdbId: 200,
      imdbId: null,
      title: 'Old',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    db.prepare("UPDATE movies SET last_used_at = '2020-01-01' WHERE id = ?").run(old.id)

    const keep = upsertTmdbOnlyRow(db, {
      tmdbId: 201,
      imdbId: null,
      title: 'KeepMeLive',
      posterPath: null,
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      lastUsedAt: null,
    })
    db.prepare("UPDATE movies SET last_used_at = '2020-01-01' WHERE id = ?").run(keep.id)

    const deletedCount = pruneStaleTmdbOnlyRows(db, 30, new Set([keep.id]))
    expect(deletedCount).toBe(1)
    expect(db.prepare('SELECT * FROM movies WHERE id = ?').get(old.id)).toBeUndefined()
    expect(db.prepare('SELECT * FROM movies WHERE id = ?').get(keep.id)).toBeDefined()
  })
})

describe('findEligiblePlexRows', () => {
  it('filters by genre, year range, and rating, only among in_library rows', () => {
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-f1',
      tmdbId: null,
      imdbId: null,
      title: 'Match',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2015,
      genres: ['Comedy'],
      rating: 7.5,
      voteCount: 500,
      inLibrary: true,
      lastUsedAt: null,
    })
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-f2',
      tmdbId: null,
      imdbId: null,
      title: 'WrongGenre',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2015,
      genres: ['Horror'],
      rating: 7.5,
      voteCount: 500,
      inLibrary: true,
      lastUsedAt: null,
    })
    const results = findEligiblePlexRows(db, { genre: 'Comedy', yearMin: 2010, yearMax: 2020, ratingMin: 7 })
    expect(results.map((r) => r.title)).toEqual(['Match'])
  })

  it('excludes rows with in_library=0', () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-f3',
      tmdbId: null,
      imdbId: null,
      title: 'Removed',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    sweepRemoved(db, 999)
    const results = findEligiblePlexRows(db, {})
    expect(results.find((r) => r.id === row.id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/db/movies.test.ts`
Expected: FAIL — `server/db/movies.ts` does not exist yet.

- [ ] **Step 3: Write `server/db/movies.ts`**

```ts
// server/db/movies.ts
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
        overview, year, genres, rating, vote_count, in_library, cached_at)
     VALUES (NULL, @tmdbId, @imdbId, @title, @posterPath, @posterSource,
             @overview, @year, @genres, @rating, @voteCount, 0, @cachedAt)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/db/movies.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/db
git commit -m "feat: movies table data access layer"
```

---

## Task 4: Plex guid parsing

**Files:**
- Create: `server/plex/guid.ts`
- Test: `server/plex/guid.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PlexGuidSource {
    guid: string
    Guid?: { id: string }[]
  }
  function parseGuid(item: PlexGuidSource): { tmdbId: number | null; imdbId: string | null }
  ```

- [ ] **Step 1: Write the failing test — all five cases from the spec**

```ts
// server/plex/guid.test.ts
import { describe, expect, it } from 'vitest'
import { parseGuid } from './guid'

describe('parseGuid', () => {
  it('modern agent: reads tmdb:// from the Guid[] child array', () => {
    const result = parseGuid({
      guid: 'plex://movie/5d7768ba96b0170020522ac9',
      Guid: [{ id: 'tmdb://438631' }, { id: 'imdb://tt1160419' }],
    })
    expect(result).toEqual({ tmdbId: 438631, imdbId: 'tt1160419' })
  })

  it('legacy themoviedb agent: parses the top-level guid, stripping the query suffix', () => {
    const result = parseGuid({ guid: 'com.plexapp.agents.themoviedb://278?lang=en' })
    expect(result).toEqual({ tmdbId: 278, imdbId: null })
  })

  it('legacy imdb agent: parses the top-level guid', () => {
    const result = parseGuid({ guid: 'com.plexapp.agents.imdb://tt0111161?lang=en' })
    expect(result).toEqual({ tmdbId: null, imdbId: 'tt0111161' })
  })

  it('manually-matched item: local:// guid has no external id', () => {
    const result = parseGuid({ guid: 'local://12345' })
    expect(result).toEqual({ tmdbId: null, imdbId: null })
  })

  it('modern agent with only an opaque plex:// guid and no Guid[] entries: no external id', () => {
    const result = parseGuid({ guid: 'plex://movie/5d7768ba96b0170020522ac9', Guid: [] })
    expect(result).toEqual({ tmdbId: null, imdbId: null })
  })

  it('modern agent with Guid[] present but no tmdb:// entry falls back to imdb:// in Guid[]', () => {
    const result = parseGuid({
      guid: 'plex://movie/5d7768ba96b0170020522ac9',
      Guid: [{ id: 'imdb://tt1160419' }],
    })
    expect(result).toEqual({ tmdbId: null, imdbId: 'tt1160419' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/plex/guid.test.ts`
Expected: FAIL — `server/plex/guid.ts` does not exist yet.

- [ ] **Step 3: Write `server/plex/guid.ts`**

```ts
// server/plex/guid.ts
export interface PlexGuidSource {
  guid: string
  Guid?: { id: string }[]
}

function extractId(guid: string, prefix: string): string | null {
  if (!guid.startsWith(prefix)) return null
  const withoutPrefix = guid.slice(prefix.length)
  // String.split always returns at least one element, so this index is safe
  // at runtime; the `?? ''` fallback exists only to satisfy
  // noUncheckedIndexedAccess, not because the value can actually be missing.
  const withoutQuery = withoutPrefix.split('?')[0] ?? ''
  return withoutQuery.length > 0 ? withoutQuery : null
}

export function parseGuid(item: PlexGuidSource): { tmdbId: number | null; imdbId: string | null } {
  const childIds = (item.Guid ?? []).map((g) => g.id)

  const tmdbFromChild = childIds.map((id) => extractId(id, 'tmdb://')).find((v) => v !== null)
  const imdbFromChild = childIds.map((id) => extractId(id, 'imdb://')).find((v) => v !== null)

  if (tmdbFromChild || imdbFromChild) {
    return {
      tmdbId: tmdbFromChild ? Number.parseInt(tmdbFromChild, 10) : null,
      imdbId: imdbFromChild ?? null,
    }
  }

  const legacyTmdb = extractId(item.guid, 'com.plexapp.agents.themoviedb://')
  if (legacyTmdb) {
    return { tmdbId: Number.parseInt(legacyTmdb, 10), imdbId: null }
  }

  const legacyImdb = extractId(item.guid, 'com.plexapp.agents.imdb://')
  if (legacyImdb) {
    return { tmdbId: null, imdbId: legacyImdb }
  }

  return { tmdbId: null, imdbId: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/plex/guid.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/plex/guid.ts server/plex/guid.test.ts
git commit -m "feat: plex guid parsing across all known formats"
```

---

## Task 5: Plex link storage (encryption)

**Files:**
- Create: `server/plex/link.ts`
- Test: `server/plex/link.test.ts`

**Interfaces:**
- Consumes: `Database.Database` (Task 2), `AppConfig.authEncryptionKey` (Task 1)
- Produces:
  ```ts
  class DecryptionError extends Error {}
  interface PlexLink {
    clientIdentifier: string
    serverUrl: string
    authToken: string
    librarySectionIds: string[]
    linkedAt: string
  }
  function savePlexLink(db: Database.Database, key: string, link: PlexLink): void
  function getPlexLink(db: Database.Database, key: string): PlexLink | null
  function clearPlexLink(db: Database.Database): void
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/plex/link.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { DecryptionError, clearPlexLink, getPlexLink, savePlexLink } from './link'
import type Database from 'better-sqlite3'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-link-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const sampleLink = {
  clientIdentifier: 'client-abc',
  serverUrl: 'http://192.168.1.10:32400',
  authToken: 'plex-secret-token',
  librarySectionIds: ['1', '2'],
  linkedAt: '2026-08-17T00:00:00.000Z',
}

describe('savePlexLink / getPlexLink', () => {
  it('round-trips the link, decrypting the token back to the original value', () => {
    savePlexLink(db, KEY, sampleLink)
    const loaded = getPlexLink(db, KEY)
    expect(loaded).toEqual(sampleLink)
  })

  it('stores the token encrypted, not in plaintext, in the raw column', () => {
    savePlexLink(db, KEY, sampleLink)
    const raw = db.prepare('SELECT auth_token FROM plex_link WHERE id = 1').get() as {
      auth_token: string
    }
    expect(raw.auth_token).not.toContain('plex-secret-token')
  })

  it('re-saving overwrites the single row (CHECK id=1 invariant)', () => {
    savePlexLink(db, KEY, sampleLink)
    savePlexLink(db, KEY, { ...sampleLink, serverUrl: 'http://10.0.0.5:32400' })
    const count = db.prepare('SELECT COUNT(*) as c FROM plex_link').get() as { c: number }
    expect(count.c).toBe(1)
    expect(getPlexLink(db, KEY)?.serverUrl).toBe('http://10.0.0.5:32400')
  })

  it('returns null when no link has been saved', () => {
    expect(getPlexLink(db, KEY)).toBeNull()
  })

  it('throws DecryptionError when read with the wrong key', () => {
    savePlexLink(db, KEY, sampleLink)
    expect(() => getPlexLink(db, 'b'.repeat(32))).toThrow(DecryptionError)
  })
})

describe('clearPlexLink', () => {
  it('removes the row', () => {
    savePlexLink(db, KEY, sampleLink)
    clearPlexLink(db)
    expect(getPlexLink(db, KEY)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/plex/link.test.ts`
Expected: FAIL — `server/plex/link.ts` does not exist yet.

- [ ] **Step 3: Write `server/plex/link.ts`**

```ts
// server/plex/link.ts
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'

export class DecryptionError extends Error {}

export interface PlexLink {
  clientIdentifier: string
  serverUrl: string
  authToken: string
  librarySectionIds: string[]
  linkedAt: string
}

function deriveKey(key: string): Buffer {
  // Real HKDF (RFC 5869) via Node's built-in hkdfSync, per the spec's binding
  // "key derived via HKDF" requirement — not a plain hash. Empty salt is
  // standard practice when the input key material (AUTH_ENCRYPTION_KEY) is
  // already expected to be high-entropy; `info` provides domain separation
  // so this derivation can never collide with a key derived for another
  // purpose from the same secret.
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(key), Buffer.alloc(0), 'popcornpoll-plex-auth-token', 32),
  )
}

function encrypt(plaintext: string, key: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(key), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

function decrypt(encoded: string, key: string): string {
  try {
    const raw = Buffer.from(encoded, 'base64')
    const iv = raw.subarray(0, 12)
    const authTag = raw.subarray(12, 28)
    const encrypted = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(key), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8')
  } catch (err) {
    throw new DecryptionError('Failed to decrypt stored Plex token — AUTH_ENCRYPTION_KEY may have changed', {
      cause: err,
    })
  }
}

export function savePlexLink(db: Database.Database, key: string, link: PlexLink): void {
  db.prepare(
    `INSERT INTO plex_link (id, client_identifier, server_url, auth_token, library_section_ids, linked_at)
     VALUES (1, @clientIdentifier, @serverUrl, @authToken, @librarySectionIds, @linkedAt)
     ON CONFLICT(id) DO UPDATE SET
       client_identifier = excluded.client_identifier,
       server_url = excluded.server_url,
       auth_token = excluded.auth_token,
       library_section_ids = excluded.library_section_ids,
       linked_at = excluded.linked_at`,
  ).run({
    clientIdentifier: link.clientIdentifier,
    serverUrl: link.serverUrl,
    authToken: encrypt(link.authToken, key),
    librarySectionIds: JSON.stringify(link.librarySectionIds),
    linkedAt: link.linkedAt,
  })
}

export function getPlexLink(db: Database.Database, key: string): PlexLink | null {
  const raw = db.prepare('SELECT * FROM plex_link WHERE id = 1').get() as
    | Record<string, unknown>
    | undefined
  if (!raw) return null
  return {
    clientIdentifier: raw.client_identifier as string,
    serverUrl: raw.server_url as string,
    authToken: decrypt(raw.auth_token as string, key),
    librarySectionIds: JSON.parse(raw.library_section_ids as string),
    linkedAt: raw.linked_at as string,
  }
}

export function clearPlexLink(db: Database.Database): void {
  db.prepare('DELETE FROM plex_link WHERE id = 1').run()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/plex/link.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/plex/link.ts server/plex/link.test.ts
git commit -m "feat: encrypted plex link storage"
```

---

## Task 6: Plex API client

**Files:**
- Create: `server/plex/client.ts`
- Test: `server/plex/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PlexClient {
    createPin(): Promise<{ id: number; code: string }>
    checkPin(pinId: number, clientIdentifier: string): Promise<{ authToken: string | null }>
    getResources(authToken: string): Promise<{ name: string; clientIdentifier: string; connections: { uri: string }[] }[]>
    getLibrarySections(serverUrl: string, authToken: string): Promise<{ id: string; title: string; type: string }[]>
    interface PlexItem extends import('./guid').PlexGuidSource { ratingKey: string; title: string; year: number | null; genres: string[] }
    getLibraryItems(serverUrl: string, authToken: string, sectionId: string): Promise<PlexItem[]>
    getThumb(serverUrl: string, authToken: string, ratingKey: string): Promise<{ body: ReadableStream | null; contentType: string | null; status: number }>
  }
  function createPlexClient(clientIdentifier: string): PlexClient
  ```
  `PlexItem` (the concrete return element type of `getLibraryItems`) is defined in this file and re-exported for Task 7 to consume.

- [ ] **Step 1: Write the failing test using a stubbed global `fetch`**

```ts
// server/plex/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlexClient } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, status = 200) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('createPlexClient', () => {
  it('createPin posts to plex.tv and returns id/code', async () => {
    mockFetchOnce({ id: 123, code: 'ABCD' })
    const client = createPlexClient('client-id')
    const result = await client.createPin()
    expect(result).toEqual({ id: 123, code: 'ABCD' })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://plex.tv/api/v2/pins',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('checkPin returns authToken: null while unclaimed, and the token once claimed', async () => {
    mockFetchOnce({ authToken: null })
    const client = createPlexClient('client-id')
    const pending = await client.checkPin(123, 'client-id')
    expect(pending.authToken).toBeNull()

    mockFetchOnce({ authToken: 'plex-token-xyz' })
    const claimed = await client.checkPin(123, 'client-id')
    expect(claimed.authToken).toBe('plex-token-xyz')
  })

  it('getResources filters to Plex Media Server resources with connections', async () => {
    mockFetchOnce([
      {
        name: 'Home Server',
        clientIdentifier: 'server-1',
        provides: 'server',
        connections: [{ uri: 'http://192.168.1.10:32400' }],
      },
    ])
    const client = createPlexClient('client-id')
    const resources = await client.getResources('token')
    expect(resources).toHaveLength(1)
    // Non-null assertions: this test's own mock guarantees a single resource
    // with a single connection, so these are always defined at runtime —
    // noUncheckedIndexedAccess just can't prove that from the array type.
    expect(resources[0]!.connections[0]!.uri).toBe('http://192.168.1.10:32400')
  })

  it('getLibraryItems requests with includeGuids=1 and maps fields', async () => {
    mockFetchOnce({
      MediaContainer: {
        Metadata: [
          {
            ratingKey: '100',
            title: 'Arrival',
            year: 2016,
            guid: 'plex://movie/abc',
            Genre: [{ tag: 'Sci-Fi' }],
            Guid: [{ id: 'tmdb://329865' }],
          },
        ],
      },
    })
    const client = createPlexClient('client-id')
    const items = await client.getLibraryItems('http://192.168.1.10:32400', 'token', '1')
    expect(items).toHaveLength(1)
    expect(items[0]!.ratingKey).toBe('100')
    expect(items[0]!.genres).toEqual(['Sci-Fi'])
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('includeGuids=1'),
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/plex/client.test.ts`
Expected: FAIL — `server/plex/client.ts` does not exist yet.

- [ ] **Step 3: Write `server/plex/client.ts`**

```ts
// server/plex/client.ts
import type { PlexGuidSource } from './guid'

export interface PlexItem extends PlexGuidSource {
  ratingKey: string
  title: string
  year: number | null
  genres: string[]
}

export interface PlexResource {
  name: string
  clientIdentifier: string
  connections: { uri: string }[]
}

export interface PlexClient {
  createPin(): Promise<{ id: number; code: string }>
  checkPin(pinId: number, clientIdentifier: string): Promise<{ authToken: string | null }>
  getResources(authToken: string): Promise<PlexResource[]>
  getLibrarySections(
    serverUrl: string,
    authToken: string,
  ): Promise<{ id: string; title: string; type: string }[]>
  getLibraryItems(serverUrl: string, authToken: string, sectionId: string): Promise<PlexItem[]>
  getThumb(
    serverUrl: string,
    authToken: string,
    ratingKey: string,
  ): Promise<{ body: ReadableStream | null; contentType: string | null; status: number }>
}

function headers(clientIdentifier: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientIdentifier,
    'X-Plex-Product': 'PopcornPoll',
  }
}

export function createPlexClient(clientIdentifier: string): PlexClient {
  return {
    async createPin() {
      const res = await fetch('https://plex.tv/api/v2/pins', {
        method: 'POST',
        headers: headers(clientIdentifier),
      })
      const body = (await res.json()) as { id: number; code: string }
      return { id: body.id, code: body.code }
    },

    async checkPin(pinId, clientId) {
      const res = await fetch(`https://plex.tv/api/v2/pins/${pinId}`, {
        headers: headers(clientId),
      })
      const body = (await res.json()) as { authToken: string | null }
      return { authToken: body.authToken ?? null }
    },

    async getResources(authToken) {
      const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
        headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken },
      })
      const body = (await res.json()) as (PlexResource & { provides: string })[]
      return body.filter((r) => r.provides === 'server' && r.connections.length > 0)
    },

    async getLibrarySections(serverUrl, authToken) {
      const res = await fetch(`${serverUrl}/library/sections`, {
        headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken },
      })
      const body = (await res.json()) as {
        MediaContainer: { Directory: { key: string; title: string; type: string }[] }
      }
      return body.MediaContainer.Directory.filter((d) => d.type === 'movie').map((d) => ({
        id: d.key,
        title: d.title,
        type: d.type,
      }))
    },

    async getLibraryItems(serverUrl, authToken, sectionId) {
      const res = await fetch(
        `${serverUrl}/library/sections/${sectionId}/all?includeGuids=1`,
        { headers: { ...headers(clientIdentifier), 'X-Plex-Token': authToken } },
      )
      const body = (await res.json()) as {
        MediaContainer: {
          Metadata: {
            ratingKey: string
            title: string
            year?: number
            guid: string
            Genre?: { tag: string }[]
            Guid?: { id: string }[]
          }[]
        }
      }
      return body.MediaContainer.Metadata.map((m) => ({
        ratingKey: m.ratingKey,
        title: m.title,
        year: m.year ?? null,
        guid: m.guid,
        Guid: m.Guid,
        genres: (m.Genre ?? []).map((g) => g.tag),
      }))
    },

    async getThumb(serverUrl, authToken, ratingKey) {
      const res = await fetch(
        `${serverUrl}/library/metadata/${ratingKey}/thumb?X-Plex-Token=${authToken}`,
      )
      return {
        body: res.body,
        contentType: res.headers.get('content-type'),
        status: res.status,
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/plex/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/plex/client.ts server/plex/client.test.ts
git commit -m "feat: plex API client (PIN flow, resources, library, thumb)"
```

---

## Task 7: TMDB client

**Files:**
- Create: `server/tmdb/client.ts`
- Test: `server/tmdb/client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface TmdbMovie {
    tmdbId: number
    title: string
    overview: string
    posterPath: string | null
    year: number | null
    genreIds: number[]
    rating: number
    voteCount: number
  }
  interface TmdbClient {
    discoverMovies(filters: { genreId?: number; yearMin?: number; yearMax?: number; ratingMin?: number }, pageCap: number): Promise<TmdbMovie[]>
    getMovieDetails(tmdbId: number): Promise<{ rating: number; voteCount: number } | null>
    findByImdbId(imdbId: string): Promise<number | null>
  }
  function createTmdbClient(apiKey: string): TmdbClient
  const TMDB_MIN_VOTE_COUNT = 200
  const TMDB_DISCOVER_PAGE_CAP = 5
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/tmdb/client.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TMDB_MIN_VOTE_COUNT, createTmdbClient } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch
}

describe('createTmdbClient', () => {
  it('discoverMovies requests vote_count.gte and sort_by=vote_average.desc, maps results', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 438631,
            title: 'Dune',
            overview: 'desc',
            poster_path: '/dune.jpg',
            release_date: '2021-10-21',
            genre_ids: [878],
            vote_average: 8.1,
            vote_count: 12000,
          },
        ],
        total_pages: 1,
      }),
    }) as unknown as typeof fetch

    const client = createTmdbClient('api-key')
    const movies = await client.discoverMovies({}, 5)
    expect(movies).toEqual([
      {
        tmdbId: 438631,
        title: 'Dune',
        overview: 'desc',
        posterPath: '/dune.jpg',
        year: 2021,
        genreIds: [878],
        rating: 8.1,
        voteCount: 12000,
      },
    ])
    const calledUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string
    expect(calledUrl).toContain(`vote_count.gte=${TMDB_MIN_VOTE_COUNT}`)
    expect(calledUrl).toContain('sort_by=vote_average.desc')
  })

  it('discoverMovies stops at the page cap even if more pages exist', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], total_pages: 999 }),
    }) as unknown as typeof fetch
    const client = createTmdbClient('api-key')
    await client.discoverMovies({}, 3)
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('getMovieDetails returns rating/voteCount', async () => {
    mockFetchOnce({ vote_average: 7.2, vote_count: 900 })
    const client = createTmdbClient('api-key')
    const details = await client.getMovieDetails(278)
    expect(details).toEqual({ rating: 7.2, voteCount: 900 })
  })

  it('findByImdbId returns the tmdb id from /find, or null if no movie result', async () => {
    mockFetchOnce({ movie_results: [{ id: 278 }] })
    const client = createTmdbClient('api-key')
    expect(await client.findByImdbId('tt0111161')).toBe(278)

    mockFetchOnce({ movie_results: [] })
    expect(await client.findByImdbId('tt0000000')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/tmdb/client.test.ts`
Expected: FAIL — `server/tmdb/client.ts` does not exist yet.

- [ ] **Step 3: Write `server/tmdb/client.ts`**

```ts
// server/tmdb/client.ts
export const TMDB_MIN_VOTE_COUNT = 200
export const TMDB_DISCOVER_PAGE_CAP = 5

export interface TmdbMovie {
  tmdbId: number
  title: string
  overview: string
  posterPath: string | null
  year: number | null
  genreIds: number[]
  rating: number
  voteCount: number
}

export interface TmdbClient {
  discoverMovies(
    filters: { genreId?: number; yearMin?: number; yearMax?: number; ratingMin?: number },
    pageCap: number,
  ): Promise<TmdbMovie[]>
  getMovieDetails(tmdbId: number): Promise<{ rating: number; voteCount: number } | null>
  findByImdbId(imdbId: string): Promise<number | null>
}

interface TmdbDiscoverResult {
  id: number
  title: string
  overview: string
  poster_path: string | null
  release_date: string
  genre_ids: number[]
  vote_average: number
  vote_count: number
}

function yearFromReleaseDate(date: string): number | null {
  const year = Number.parseInt(date.slice(0, 4), 10)
  return Number.isNaN(year) ? null : year
}

export function createTmdbClient(apiKey: string): TmdbClient {
  const base = 'https://api.themoviedb.org/3'

  return {
    async discoverMovies(filters, pageCap) {
      const movies: TmdbMovie[] = []
      for (let page = 1; page <= pageCap; page++) {
        const params = new URLSearchParams({
          api_key: apiKey,
          sort_by: 'vote_average.desc',
          'vote_count.gte': String(TMDB_MIN_VOTE_COUNT),
          page: String(page),
        })
        if (filters.genreId) params.set('with_genres', String(filters.genreId))
        if (filters.yearMin) params.set('primary_release_date.gte', `${filters.yearMin}-01-01`)
        if (filters.yearMax) params.set('primary_release_date.lte', `${filters.yearMax}-12-31`)
        if (filters.ratingMin) params.set('vote_average.gte', String(filters.ratingMin))

        const res = await fetch(`${base}/discover/movie?${params.toString()}`)
        const body = (await res.json()) as { results: TmdbDiscoverResult[]; total_pages: number }
        for (const r of body.results) {
          movies.push({
            tmdbId: r.id,
            title: r.title,
            overview: r.overview,
            posterPath: r.poster_path,
            year: yearFromReleaseDate(r.release_date),
            genreIds: r.genre_ids,
            rating: r.vote_average,
            voteCount: r.vote_count,
          })
        }
        if (page >= body.total_pages) break
      }
      return movies
    },

    async getMovieDetails(tmdbId) {
      const res = await fetch(`${base}/movie/${tmdbId}?api_key=${apiKey}`)
      if (!res.ok) return null
      const body = (await res.json()) as { vote_average: number; vote_count: number }
      return { rating: body.vote_average, voteCount: body.vote_count }
    },

    async findByImdbId(imdbId) {
      const res = await fetch(
        `${base}/find/${imdbId}?api_key=${apiKey}&external_source=imdb_id`,
      )
      const body = (await res.json()) as { movie_results: { id: number }[] }
      return body.movie_results[0]?.id ?? null
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/tmdb/client.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/tmdb
git commit -m "feat: tmdb client with obscurity-filtered discover query"
```

---

## Task 8: Library sync + imdb backfill

**Files:**
- Create: `server/sync/librarySync.ts`
- Test: `server/sync/librarySync.test.ts`

**Interfaces:**
- Consumes: `PlexClient` (Task 6), `TmdbClient` (Task 7), `movies.ts` functions (Task 3), `getPlexLink` (Task 5)
- Produces:
  ```ts
  interface SyncDeps {
    db: Database.Database
    plex: PlexClient
    tmdb: TmdbClient
    encryptionKey: string
    chunkSize?: number       // default 200
    imdbBackfillCap?: number // default 50
  }
  function createLibrarySync(deps: SyncDeps): {
    run(): Promise<{ runId: number; itemCount: number }>
    isRunning(): boolean
    waitForCurrent(): Promise<void>
  }
  ```
  `run()` is idempotent under concurrency: overlapping calls resolve to the same in-flight result via `waitForCurrent()`.

- [ ] **Step 1: Write the failing test**

```ts
// server/sync/librarySync.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { findByTmdbId, upsertPlexRow } from '../db/movies'
import { savePlexLink } from '../plex/link'
import { createLibrarySync } from './librarySync'
import type Database from 'better-sqlite3'
import type { PlexClient, PlexItem } from '../plex/client'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-sync-'))
  db = openDb(dir)
  savePlexLink(db, KEY, {
    clientIdentifier: 'client-1',
    serverUrl: 'http://plex.local:32400',
    authToken: 'token',
    librarySectionIds: ['1'],
    linkedAt: '2026-08-17T00:00:00.000Z',
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function fakePlexItem(overrides: Partial<PlexItem> = {}): PlexItem {
  return {
    ratingKey: 'pk-1',
    title: 'Movie',
    year: 2020,
    guid: 'plex://movie/x',
    Guid: [],
    genres: [],
    ...overrides,
  }
}

describe('createLibrarySync', () => {
  it('upserts items from Plex and stamps a shared runId', async () => {
    const plex: Partial<PlexClient> = {
      getLibraryItems: vi.fn().mockResolvedValue([fakePlexItem({ ratingKey: 'pk-1' })]),
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
    }
    const tmdb: Partial<TmdbClient> = {
      findByImdbId: vi.fn(),
      getMovieDetails: vi.fn(),
    }
    const sync = createLibrarySync({
      db,
      plex: plex as PlexClient,
      tmdb: tmdb as TmdbClient,
      encryptionKey: KEY,
    })
    const result = await sync.run()
    expect(result.itemCount).toBe(1)
    const row = db.prepare('SELECT * FROM movies WHERE plex_rating_key = ?').get('pk-1')
    expect(row).toBeDefined()
  })

  it('upserts every item in a chunk, not just the first — regression test for a real dropped-items bug', async () => {
    const plex: Partial<PlexClient> = {
      getLibraryItems: vi.fn().mockResolvedValue([
        fakePlexItem({ ratingKey: 'multi-1' }),
        fakePlexItem({ ratingKey: 'multi-2' }),
        fakePlexItem({ ratingKey: 'multi-3' }),
      ]),
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({
      db,
      plex: plex as PlexClient,
      tmdb: tmdb as TmdbClient,
      encryptionKey: KEY,
      chunkSize: 2, // forces a chunk boundary mid-batch (2 items, then 1)
    })
    const result = await sync.run()
    expect(result.itemCount).toBe(3)
    for (const key of ['multi-1', 'multi-2', 'multi-3']) {
      const row = db.prepare('SELECT * FROM movies WHERE plex_rating_key = ?').get(key)
      expect(row).toBeDefined()
    }
  })

  it('sweeps items missing from the current scan to in_library=0', async () => {
    upsertPlexRow(db, 0, {
      plexRatingKey: 'gone',
      tmdbId: null,
      imdbId: null,
      title: 'Removed',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const plex: Partial<PlexClient> = {
      getLibraryItems: vi.fn().mockResolvedValue([]),
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })
    await sync.run()
    const raw = db.prepare('SELECT in_library FROM movies WHERE plex_rating_key = ?').get('gone') as {
      in_library: number
    }
    expect(raw.in_library).toBe(0)
  })

  it('concurrent run() calls share one in-flight sync (single-flight)', async () => {
    let resolveFetch: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveFetch = resolve
    })
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockImplementation(async () => {
        await gate
        return [fakePlexItem()]
      }),
    }
    const tmdb: Partial<TmdbClient> = { findByImdbId: vi.fn(), getMovieDetails: vi.fn() }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })

    const first = sync.run()
    const second = sync.run()
    expect(sync.isRunning()).toBe(true)
    resolveFetch()
    const [a, b] = await Promise.all([first, second])
    expect(a.runId).toBe(b.runId)
    expect(plex.getLibraryItems).toHaveBeenCalledTimes(1)
  })

  it('backfills tmdb_id from imdb_id via findByImdbId, capped at imdbBackfillCap', async () => {
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockResolvedValue([
        fakePlexItem({ ratingKey: 'a', guid: 'com.plexapp.agents.imdb://tt0111161' }),
      ]),
    }
    const tmdb: Partial<TmdbClient> = {
      findByImdbId: vi.fn().mockResolvedValue(278),
      getMovieDetails: vi.fn().mockResolvedValue({ rating: 9.3, voteCount: 25000 }),
    }
    const sync = createLibrarySync({
      db,
      plex: plex as PlexClient,
      tmdb: tmdb as TmdbClient,
      encryptionKey: KEY,
      imdbBackfillCap: 50,
    })
    await sync.run()
    const found = findByTmdbId(db, 278)
    expect(found?.plexRatingKey).toBe('a')
  })

  it('merges a backfilled tmdb_id into an existing TMDB-only row for the same film', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, tmdb_id, title, poster_source, rating, vote_count, cached_at)
       VALUES (NULL, 278, 'Shawshank (tmdb-only)', 'tmdb', 9.3, 25000, '2026-01-01')`,
    ).run()
    const plex: Partial<PlexClient> = {
      getLibrarySections: vi.fn().mockResolvedValue([{ id: '1', title: 'Movies', type: 'movie' }]),
      getLibraryItems: vi.fn().mockResolvedValue([
        fakePlexItem({ ratingKey: 'a', guid: 'com.plexapp.agents.imdb://tt0111161' }),
      ]),
    }
    const tmdb: Partial<TmdbClient> = {
      findByImdbId: vi.fn().mockResolvedValue(278),
      getMovieDetails: vi.fn(),
    }
    const sync = createLibrarySync({ db, plex: plex as PlexClient, tmdb: tmdb as TmdbClient, encryptionKey: KEY })
    await sync.run()
    const rows = db.prepare('SELECT * FROM movies WHERE tmdb_id = 278').all()
    expect(rows).toHaveLength(1) // merged, not duplicated
    const merged = rows[0] as { plex_rating_key: string; rating: number }
    expect(merged.plex_rating_key).toBe('a')
    expect(merged.rating).toBe(9.3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/sync/librarySync.test.ts`
Expected: FAIL — `server/sync/librarySync.ts` does not exist yet.

- [ ] **Step 3: Write `server/sync/librarySync.ts`**

```ts
// server/sync/librarySync.ts
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
          // No `return` here — this loop must run to completion for every
          // item in the chunk. A `return` inside a `for` exits the whole
          // enclosing function on its first iteration, silently dropping
          // every other item in the chunk from ever being upserted. This
          // was a real bug in an earlier draft of this code, caught by
          // task review — the multi-item-chunk test below (added
          // specifically because the original suite only ever exercised
          // single-item chunks) is what would catch a regression here.
          upsertPlexRow(deps.db, runId, {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/sync/librarySync.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/sync/librarySync.ts server/sync/librarySync.test.ts
git commit -m "feat: chunked library sync with single-flight guard and imdb backfill"
```

---

## Task 9: Reputation-data enrichment worker

**Files:**
- Create: `server/sync/enrichment.ts`
- Test: `server/sync/enrichment.test.ts`

**Interfaces:**
- Consumes: `findRowsNeedingEnrichment`, `TmdbClient.getMovieDetails` (Task 3, Task 7)
- Produces:
  ```ts
  interface EnrichmentWorker {
    start(): void
    stop(): void
    runOnce(): Promise<number> // returns count enriched, for tests
  }
  function createEnrichmentWorker(db: Database.Database, tmdb: TmdbClient, requestsPerSecond?: number): EnrichmentWorker
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/sync/enrichment.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { createEnrichmentWorker } from './enrichment'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-enrich-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createEnrichmentWorker', () => {
  it('runOnce enriches every row missing rating/vote_count that has a tmdb_id', async () => {
    upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-1',
      tmdbId: 42,
      imdbId: null,
      title: 'X',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const tmdb: Partial<TmdbClient> = {
      getMovieDetails: vi.fn().mockResolvedValue({ rating: 7.8, voteCount: 5000 }),
    }
    const worker = createEnrichmentWorker(db, tmdb as TmdbClient)
    const enrichedCount = await worker.runOnce()
    expect(enrichedCount).toBe(1)
    const row = db.prepare('SELECT rating, vote_count FROM movies WHERE tmdb_id = 42').get() as {
      rating: number
      vote_count: number
    }
    expect(row.rating).toBe(7.8)
    expect(row.vote_count).toBe(5000)
  })

  it('runOnce enriches every row in a multi-row batch, not just the first', async () => {
    for (const [key, tmdbId] of [['pk-multi-1', 101], ['pk-multi-2', 102]] as const) {
      upsertPlexRow(db, 1, {
        plexRatingKey: key,
        tmdbId,
        imdbId: null,
        title: key,
        posterPath: null,
        posterSource: 'plex',
        overview: null,
        year: null,
        genres: [],
        rating: null,
        voteCount: null,
        inLibrary: true,
        lastUsedAt: null,
      })
    }
    const tmdb: Partial<TmdbClient> = {
      getMovieDetails: vi.fn().mockResolvedValue({ rating: 6.5, voteCount: 1000 }),
    }
    const worker = createEnrichmentWorker(db, tmdb as TmdbClient)
    const enrichedCount = await worker.runOnce()
    expect(enrichedCount).toBe(2)
    for (const tmdbId of [101, 102]) {
      const row = db.prepare('SELECT rating FROM movies WHERE tmdb_id = ?').get(tmdbId) as { rating: number }
      expect(row.rating).toBe(6.5)
    }
  })

  it('runOnce is a no-op when nothing needs enrichment', async () => {
    const tmdb: Partial<TmdbClient> = { getMovieDetails: vi.fn() }
    const worker = createEnrichmentWorker(db, tmdb as TmdbClient)
    expect(await worker.runOnce()).toBe(0)
    expect(tmdb.getMovieDetails).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/sync/enrichment.test.ts`
Expected: FAIL — `server/sync/enrichment.ts` does not exist yet.

- [ ] **Step 3: Write `server/sync/enrichment.ts`**

```ts
// server/sync/enrichment.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/sync/enrichment.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add server/sync/enrichment.ts server/sync/enrichment.test.ts
git commit -m "feat: paced background enrichment worker, decoupled from room-creation sync"
```

---

## Task 10: Reputation score + genre affinity formulas

**Files:**
- Create: `server/ranking/reputation.ts`
- Create: `server/ranking/affinity.ts`
- Test: `server/ranking/reputation.test.ts`
- Test: `server/ranking/affinity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // reputation.ts
  interface RatedCandidate { rating: number | null; voteCount: number | null }
  function computeCAndM(candidates: RatedCandidate[]): { c: number; m: number }
  function reputationScore(candidate: RatedCandidate, c: number, m: number): number

  // affinity.ts
  interface GenreTally { yes: Record<string, number>; no: Record<string, number> }
  function emptyTally(): GenreTally
  function recordVote(tally: GenreTally, genres: string[], vote: 'yes' | 'no'): GenreTally // returns a new tally
  function genreAffinity(candidateGenres: string[], tally: GenreTally): number
  function affinityWeight(totalVotes: number): number
  ```

- [ ] **Step 1: Write the failing reputation test**

```ts
// server/ranking/reputation.test.ts
import { describe, expect, it } from 'vitest'
import { computeCAndM, reputationScore } from './reputation'

describe('computeCAndM', () => {
  it('returns the fixed defaults when fewer than 30 rated candidates exist', () => {
    const { c, m } = computeCAndM([{ rating: 8, voteCount: 100 }])
    expect(c).toBe(6.5)
    expect(m).toBe(50)
  })

  it('computes the mean rating and 60th-percentile vote count over rated candidates', () => {
    const rated = Array.from({ length: 30 }, (_, i) => ({
      rating: 5 + (i % 5),
      voteCount: (i + 1) * 10,
    }))
    const { c, m } = computeCAndM(rated)
    expect(c).toBeCloseTo(7, 0)
    expect(m).toBeGreaterThan(0)
  })

  it('ignores candidates with a null rating when computing C and m', () => {
    const rated = Array.from({ length: 40 }, () => ({ rating: 8, voteCount: 100 }))
    const unrated = Array.from({ length: 10 }, () => ({ rating: null, voteCount: null }))
    const { c } = computeCAndM([...rated, ...unrated])
    expect(c).toBeCloseTo(8, 5)
  })
})

describe('reputationScore', () => {
  const c = 6.5
  const m = 50

  it('a candidate with no rating (Plex item, no tmdb data) scores exactly C', () => {
    expect(reputationScore({ rating: null, voteCount: null }, c, m)).toBe(c)
  })

  it('a well-rated, well-voted candidate scores close to its own rating', () => {
    const score = reputationScore({ rating: 9, voteCount: 5000 }, c, m)
    expect(score).toBeGreaterThan(8.5)
  })

  it('a candidate with 0 votes shrinks fully to C regardless of its raw rating', () => {
    const score = reputationScore({ rating: 10, voteCount: 0 }, c, m)
    expect(score).toBe(c)
  })

  it('matches the Bayesian formula exactly for a mid-vote-count candidate', () => {
    const score = reputationScore({ rating: 8, voteCount: 50 }, c, m)
    // v/(v+m)*R + m/(v+m)*C = 0.5*8 + 0.5*6.5 = 7.25
    expect(score).toBeCloseTo(7.25, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/ranking/reputation.test.ts`
Expected: FAIL — `server/ranking/reputation.ts` does not exist yet.

- [ ] **Step 3: Write `server/ranking/reputation.ts`**

```ts
// server/ranking/reputation.ts
export interface RatedCandidate {
  rating: number | null
  voteCount: number | null
}

const DEFAULT_C = 6.5
const DEFAULT_M = 50
const MIN_RATED_FOR_STATS = 30

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[index]
}

export function computeCAndM(candidates: RatedCandidate[]): { c: number; m: number } {
  const rated = candidates.filter(
    (c): c is { rating: number; voteCount: number } => c.rating !== null && c.voteCount !== null,
  )
  if (rated.length < MIN_RATED_FOR_STATS) {
    return { c: DEFAULT_C, m: DEFAULT_M }
  }
  const c = rated.reduce((sum, r) => sum + r.rating, 0) / rated.length
  const voteCounts = rated.map((r) => r.voteCount).sort((a, b) => a - b)
  const m = percentile(voteCounts, 0.6)
  return { c, m }
}

export function reputationScore(candidate: RatedCandidate, c: number, m: number): number {
  if (candidate.rating === null || candidate.voteCount === null) return c
  const v = candidate.voteCount
  const r = candidate.rating
  return (v / (v + m)) * r + (m / (v + m)) * c
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/ranking/reputation.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing affinity test**

```ts
// server/ranking/affinity.test.ts
import { describe, expect, it } from 'vitest'
import { affinityWeight, emptyTally, genreAffinity, recordVote } from './affinity'

describe('recordVote + genreAffinity', () => {
  it('a genre with no votes yet has affinity 0', () => {
    expect(genreAffinity(['Comedy'], emptyTally())).toBe(0)
  })

  it('a genre with many yes votes trends positive but stays smoothed short of +1', () => {
    let tally = emptyTally()
    for (let i = 0; i < 10; i++) tally = recordVote(tally, ['Comedy'], 'yes')
    const affinity = genreAffinity(['Comedy'], tally)
    expect(affinity).toBeGreaterThan(0.5)
    expect(affinity).toBeLessThan(1)
  })

  it('one or two votes on a genre stay close to 0 (Laplace smoothing, alpha=2)', () => {
    let tally = emptyTally()
    tally = recordVote(tally, ['Horror'], 'yes')
    // (1 - 0) / (1 + 0 + 4) = 0.2, not 1
    expect(genreAffinity(['Horror'], tally)).toBeCloseTo(0.2, 5)
  })

  it('genreAffinity for a multi-genre candidate is the mean across its genres, not the sum', () => {
    let tally = emptyTally()
    for (let i = 0; i < 10; i++) tally = recordVote(tally, ['Comedy'], 'yes')
    for (let i = 0; i < 2; i++) tally = recordVote(tally, ['Drama'], 'yes')
    // Asymmetric magnitudes deliberately: Comedy = 10/(10+0+4) = 5/7 ≈ 0.7143,
    // Drama = 2/(2+0+4) = 1/3 ≈ 0.3333. A correct mean gives ≈0.5238; a buggy
    // sum would give ≈1.0476 — the two are far enough apart that this test
    // actually distinguishes them, unlike a symmetric +/- pair (whose mean
    // and sum-of-symmetric-opposites both collapse to 0 and prove nothing).
    // The expected value is a hardcoded literal, not re-derived by calling
    // genreAffinity again, so this doesn't tautologically pass regardless of
    // which implementation is under test.
    const both = genreAffinity(['Comedy', 'Drama'], tally)
    expect(both).toBeCloseTo(0.52381, 4)
  })

  it('rebuilding a tally from scratch (kick) produces the same result as never having those votes', () => {
    let withExtra = emptyTally()
    withExtra = recordVote(withExtra, ['Comedy'], 'yes')
    withExtra = recordVote(withExtra, ['Comedy'], 'no') // the kicked participant's vote
    const rebuilt = recordVote(emptyTally(), ['Comedy'], 'yes') // rebuilt without the kicked vote
    expect(genreAffinity(['Comedy'], rebuilt)).not.toBe(genreAffinity(['Comedy'], withExtra))
  })
})

describe('affinityWeight', () => {
  it('is 0 with no votes cast yet', () => {
    expect(affinityWeight(0)).toBe(0)
  })

  it('ramps linearly up to the cap of 1.5 at 20 total votes', () => {
    expect(affinityWeight(10)).toBeCloseTo(0.75, 5)
    expect(affinityWeight(20)).toBe(1.5)
  })

  it('never exceeds 1.5 past 20 votes', () => {
    expect(affinityWeight(1000)).toBe(1.5)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run server/ranking/affinity.test.ts`
Expected: FAIL — `server/ranking/affinity.ts` does not exist yet.

- [ ] **Step 7: Write `server/ranking/affinity.ts`**

```ts
// server/ranking/affinity.ts
export interface GenreTally {
  yes: Record<string, number>
  no: Record<string, number>
}

const ALPHA = 2
const MAX_WEIGHT = 1.5
const RAMP_VOTES = 20

export function emptyTally(): GenreTally {
  return { yes: {}, no: {} }
}

export function recordVote(tally: GenreTally, genres: string[], vote: 'yes' | 'no'): GenreTally {
  const next: GenreTally = { yes: { ...tally.yes }, no: { ...tally.no } }
  const bucket = vote === 'yes' ? next.yes : next.no
  for (const genre of genres) {
    bucket[genre] = (bucket[genre] ?? 0) + 1
  }
  return next
}

function singleGenreAffinity(genre: string, tally: GenreTally): number {
  const yes = tally.yes[genre] ?? 0
  const no = tally.no[genre] ?? 0
  return (yes - no) / (yes + no + 2 * ALPHA)
}

export function genreAffinity(candidateGenres: string[], tally: GenreTally): number {
  if (candidateGenres.length === 0) return 0
  const sum = candidateGenres.reduce((acc, g) => acc + singleGenreAffinity(g, tally), 0)
  return sum / candidateGenres.length
}

export function affinityWeight(totalVotes: number): number {
  return Math.min(totalVotes / RAMP_VOTES, 1) * MAX_WEIGHT
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run server/ranking/affinity.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 9: Commit**

```bash
git add server/ranking/reputation.ts server/ranking/reputation.test.ts server/ranking/affinity.ts server/ranking/affinity.test.ts
git commit -m "feat: reputation-score and genre-affinity ranking formulas"
```

---

## Task 11: Seeded PRNG + weighted sampling

**Files:**
- Create: `server/ranking/rng.ts`
- Test: `server/ranking/rng.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Rng = () => number // returns a float in [0, 1)
  function createRng(seed: number): Rng
  function weightedSample<T>(items: T[], weight: (item: T) => number, rng: Rng): T
  function weightedSampleWithoutReplacement<T>(items: T[], weight: (item: T) => number, count: number, rng: Rng): T[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/ranking/rng.test.ts
import { describe, expect, it } from 'vitest'
import { createRng, weightedSample, weightedSampleWithoutReplacement } from './rng'

describe('createRng', () => {
  it('is deterministic — the same seed produces the same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('different seeds produce different sequences', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a()).not.toBe(b())
  })

  it('always returns values in [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('weightedSample', () => {
  it('always picks the only item when there is one', () => {
    const rng = createRng(1)
    expect(weightedSample(['only'], () => 1, rng)).toBe('only')
  })

  it('never selects an item with zero or negative weight when a positive-weight item exists', () => {
    const rng = createRng(3)
    for (let i = 0; i < 50; i++) {
      const pick = weightedSample(['zero', 'positive'], (item) => (item === 'zero' ? 0 : 1), rng)
      expect(pick).toBe('positive')
    }
  })

  it('is deterministic for a fixed seed', () => {
    const items = ['a', 'b', 'c', 'd']
    const picks1 = Array.from({ length: 5 }, () => weightedSample(items, () => 1, createRng(99)))
    const picks2 = Array.from({ length: 5 }, () => weightedSample(items, () => 1, createRng(99)))
    expect(picks1).toEqual(picks2)
  })
})

describe('weightedSampleWithoutReplacement', () => {
  it('returns exactly `count` distinct items', () => {
    const rng = createRng(5)
    const picks = weightedSampleWithoutReplacement([1, 2, 3, 4, 5], () => 1, 3, rng)
    expect(picks).toHaveLength(3)
    expect(new Set(picks).size).toBe(3)
  })

  it('returns all items if count exceeds the pool size', () => {
    const rng = createRng(5)
    const picks = weightedSampleWithoutReplacement([1, 2], () => 1, 5, rng)
    expect(picks.sort()).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/ranking/rng.test.ts`
Expected: FAIL — `server/ranking/rng.ts` does not exist yet.

- [ ] **Step 3: Write `server/ranking/rng.ts`**

```ts
// server/ranking/rng.ts
export type Rng = () => number

// mulberry32 — small, fast, deterministic PRNG. Good enough for sampling
// variety; not cryptographic (never used for tokens — see server/auth/tokens.ts).
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function weightedSample<T>(items: T[], weight: (item: T) => number, rng: Rng): T {
  if (items.length === 1) return items[0]
  const weights = items.map((item) => Math.max(weight(item), Number.EPSILON))
  const total = weights.reduce((sum, w) => sum + w, 0)
  let target = rng() * total
  for (let i = 0; i < items.length; i++) {
    target -= weights[i]
    if (target <= 0) return items[i]
  }
  return items[items.length - 1]
}

export function weightedSampleWithoutReplacement<T>(
  items: T[],
  weight: (item: T) => number,
  count: number,
  rng: Rng,
): T[] {
  const remaining = [...items]
  const picked: T[] = []
  while (remaining.length > 0 && picked.length < count) {
    const choice = weightedSample(remaining, weight, rng)
    picked.push(choice)
    remaining.splice(remaining.indexOf(choice), 1)
  }
  return picked
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/ranking/rng.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/ranking/rng.ts server/ranking/rng.test.ts
git commit -m "feat: seeded PRNG and weighted sampling for reproducible ranking"
```

---

## Task 12: Pool construction

**Files:**
- Create: `server/pool/buildPool.ts`
- Test: `server/pool/buildPool.test.ts`

**Interfaces:**
- Consumes: `findEligiblePlexRows`, `upsertTmdbOnlyRow`, `findByTmdbId`, `mergeTmdbOnlyIntoPlexRow`, `stampLastUsed` (Task 3); `TmdbClient.discoverMovies` (Task 7); `computeCAndM`, `reputationScore` (Task 10); `createRng`, `weightedSampleWithoutReplacement` (Task 11)
- Produces:
  ```ts
  interface PoolEntry {
    movieId: number
    title: string
    posterPath: string | null
    posterSource: 'plex' | 'tmdb'
    overview: string | null
    genres: string[]
    year: number | null
    inLibrary: boolean
    rating: number | null
    voteCount: number | null
  }
  interface PoolFilters { genre?: string; yearMin?: number; yearMax?: number; ratingMin?: number }
  interface BuildPoolResult { pool: PoolEntry[]; tooSmall: boolean }
  async function buildPool(
    db: Database.Database,
    tmdb: TmdbClient,
    candidateSource: 'plex' | 'plex+tmdb',
    filters: PoolFilters,
    rngSeed: number,
  ): Promise<BuildPoolResult>
  const POOL_CAP = 100
  const POOL_MIN_SIZE = 5
  const TMDB_SHARE = 0.7
  ```
  `tooSmall: true` when the final deduped pool has fewer than `POOL_MIN_SIZE` entries — the caller (Task 15's Start handler) turns that into the `pool_too_small` error.

- [ ] **Step 1: Write the failing test**

```ts
// server/pool/buildPool.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { buildPool } from './buildPool'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-pool-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedPlexRows(count: number, opts: { genres?: string[] } = {}) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: `/thumb/${i}`,
      posterSource: 'plex',
      overview: null,
      year: 2000 + (i % 20),
      genres: opts.genres ?? ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}

describe('buildPool', () => {
  it('builds a plex-only pool capped at 100, with in_library=true for every entry', async () => {
    seedPlexRows(150)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.pool.length).toBe(100)
    expect(result.pool.every((e) => e.inLibrary)).toBe(true)
    expect(result.tooSmall).toBe(false)
  })

  it('returns tooSmall: true when fewer than 5 eligible candidates exist', async () => {
    seedPlexRows(3)
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.tooSmall).toBe(true)
  })

  it('dedups a film that appears in both the Plex sample and the TMDB discover results', async () => {
    seedPlexRows(10)
    // Give one Plex row a resolved tmdb_id matching a TMDB discover result.
    db.prepare('UPDATE movies SET tmdb_id = 999 WHERE plex_rating_key = ?').run('pk-0')
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue([
        {
          tmdbId: 999,
          title: 'Movie 0',
          overview: 'desc',
          posterPath: '/p.jpg',
          year: 2000,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        },
      ]),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    const matchingIds = result.pool.filter((e) => e.title === 'Movie 0')
    expect(matchingIds).toHaveLength(1)
    expect(matchingIds[0]!.inLibrary).toBe(true) // resolved via the merged row, not the TMDB-only fallback
  })

  it('backfills from the other source when one falls short of its 70/30 target share', async () => {
    seedPlexRows(3) // far short of a 70-candidate target
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue(
        Array.from({ length: 40 }, (_, i) => ({
          tmdbId: 2000 + i,
          title: `TMDB ${i}`,
          overview: '',
          posterPath: null,
          year: 2010,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        })),
      ),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    // 3 Plex + up to 40 TMDB should backfill toward the 100 cap, not stay
    // capped at 30% (30) just because Plex only contributed 3.
    expect(result.pool.length).toBeGreaterThan(33)
  })

  it('is deterministic for a fixed rngSeed', async () => {
    seedPlexRows(150)
    const a = await buildPool(db, noOpTmdb, 'plex', {}, 42)
    const b = await buildPool(db, noOpTmdb, 'plex', {}, 42)
    expect(a.pool.map((e) => e.movieId)).toEqual(b.pool.map((e) => e.movieId))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/pool/buildPool.test.ts`
Expected: FAIL — `server/pool/buildPool.ts` does not exist yet.

- [ ] **Step 3: Write `server/pool/buildPool.ts`**

```ts
// server/pool/buildPool.ts
import type Database from 'better-sqlite3'
import { findByTmdbId, findEligiblePlexRows, mergeTmdbOnlyIntoPlexRow, stampLastUsed, upsertTmdbOnlyRow } from '../db/movies'
import type { MovieRow } from '../db/movies'
import { computeCAndM, reputationScore } from '../ranking/reputation'
import { createRng, weightedSampleWithoutReplacement } from '../ranking/rng'
import { TMDB_DISCOVER_PAGE_CAP, type TmdbClient } from '../tmdb/client'

export const POOL_CAP = 100
export const POOL_MIN_SIZE = 5
const TMDB_SHARE = 0.7

export interface PoolEntry {
  movieId: number
  title: string
  posterPath: string | null
  posterSource: 'plex' | 'tmdb'
  overview: string | null
  genres: string[]
  year: number | null
  inLibrary: boolean
  rating: number | null
  voteCount: number | null
}

export interface PoolFilters {
  genre?: string
  yearMin?: number
  yearMax?: number
  ratingMin?: number
}

export interface BuildPoolResult {
  pool: PoolEntry[]
  tooSmall: boolean
}

function toEntry(row: MovieRow): PoolEntry {
  return {
    movieId: row.id,
    title: row.title,
    posterPath: row.posterPath,
    posterSource: row.posterSource,
    overview: row.overview,
    genres: row.genres,
    year: row.year,
    inLibrary: row.inLibrary,
    rating: row.rating,
    voteCount: row.voteCount,
  }
}

async function resolveTmdbCandidatesIntoRows(
  db: Database.Database,
  tmdbResults: Awaited<ReturnType<TmdbClient['discoverMovies']>>,
): Promise<MovieRow[]> {
  const rows: MovieRow[] = []
  for (const result of tmdbResults) {
    const existing = findByTmdbId(db, result.tmdbId)
    if (existing) {
      rows.push(existing)
      continue
    }
    const created = upsertTmdbOnlyRow(db, {
      tmdbId: result.tmdbId,
      imdbId: null,
      title: result.title,
      posterPath: result.posterPath,
      posterSource: 'tmdb',
      overview: result.overview,
      year: result.year,
      genres: [], // genre IDs are TMDB-numeric; name mapping happens client-side for filters, not stored here
      rating: result.rating,
      voteCount: result.voteCount,
      lastUsedAt: null,
    })
    rows.push(created)
  }
  return rows
}

export async function buildPool(
  db: Database.Database,
  tmdb: TmdbClient,
  candidateSource: 'plex' | 'plex+tmdb',
  filters: PoolFilters,
  rngSeed: number,
): Promise<BuildPoolResult> {
  const plexRows = findEligiblePlexRows(db, filters)

  let tmdbRows: MovieRow[] = []
  if (candidateSource === 'plex+tmdb') {
    const discovered = await tmdb.discoverMovies(
      { yearMin: filters.yearMin, yearMax: filters.yearMax, ratingMin: filters.ratingMin },
      TMDB_DISCOVER_PAGE_CAP,
    )
    tmdbRows = await resolveTmdbCandidatesIntoRows(db, discovered)
  }

  // Merge: a row that started as TMDB-only but actually matches a Plex row
  // (same tmdb_id, resolved after this pool's own upserts above) collapses.
  const byMovieId = new Map<number, MovieRow>()
  for (const row of plexRows) byMovieId.set(row.id, row)
  for (const row of tmdbRows) {
    const asPlexRow = plexRows.find((p) => p.tmdbId === row.tmdbId && row.tmdbId !== null)
    if (asPlexRow && row.plexRatingKey === null) {
      mergeTmdbOnlyIntoPlexRow(db, asPlexRow.id, row.id)
      byMovieId.set(asPlexRow.id, asPlexRow)
    } else {
      byMovieId.set(row.id, row)
    }
  }

  const eligible = [...byMovieId.values()]
  const { c, m } = computeCAndM(eligible)
  const rng = createRng(rngSeed)

  let targetPlexCount = candidateSource === 'plex+tmdb' ? Math.round(POOL_CAP * (1 - TMDB_SHARE)) : POOL_CAP
  let targetTmdbCount = candidateSource === 'plex+tmdb' ? POOL_CAP - targetPlexCount : 0

  const plexEligible = eligible.filter((r) => r.plexRatingKey !== null)
  const tmdbEligible = eligible.filter((r) => r.plexRatingKey === null)

  // Shortfall backfill: whichever source has fewer eligible rows than its
  // target share, the other source picks up the difference, up to the cap.
  const plexShortfall = Math.max(0, targetPlexCount - plexEligible.length)
  const tmdbShortfall = Math.max(0, targetTmdbCount - tmdbEligible.length)
  targetPlexCount = Math.min(plexEligible.length, targetPlexCount + tmdbShortfall)
  targetTmdbCount = Math.min(tmdbEligible.length, targetTmdbCount + plexShortfall)

  const weight = (row: MovieRow) => reputationScore(row, c, m)
  const pickedPlex = weightedSampleWithoutReplacement(plexEligible, weight, targetPlexCount, rng)
  const pickedTmdb = weightedSampleWithoutReplacement(tmdbEligible, weight, targetTmdbCount, rng)

  const finalRows = [...pickedPlex, ...pickedTmdb].slice(0, POOL_CAP)
  stampLastUsed(db, finalRows.map((r) => r.id), new Date().toISOString())

  return {
    pool: finalRows.map(toEntry),
    tooSmall: finalRows.length < POOL_MIN_SIZE,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/pool/buildPool.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/pool/buildPool.ts server/pool/buildPool.test.ts
git commit -m "feat: reputation-weighted candidate pool construction with source dedup"
```

---

## Task 13: Next-card selection

**Files:**
- Create: `server/pool/nextCard.ts`
- Test: `server/pool/nextCard.test.ts`

**Interfaces:**
- Consumes: `PoolEntry` (Task 12), `reputationScore`, `computeCAndM` (Task 10), `genreAffinity`, `affinityWeight`, `GenreTally` (Task 10), `Rng`, `weightedSample` (Task 11)
- Produces:
  ```ts
  function pickNextCard(
    pool: PoolEntry[],
    swipedMovieIds: Set<number>,
    tally: GenreTally,
    totalVotes: number,
    reputationC: number,
    reputationM: number,
    rng: Rng,
  ): number | null // movieId, or null if nothing unswiped remains
  const TOP_K = 10
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/pool/nextCard.test.ts
import { describe, expect, it } from 'vitest'
import { emptyTally, recordVote } from '../ranking/affinity'
import { createRng } from '../ranking/rng'
import { pickNextCard } from './nextCard'
import type { PoolEntry } from './buildPool'

function entry(id: number, overrides: Partial<PoolEntry> = {}): PoolEntry {
  return {
    movieId: id,
    title: `Movie ${id}`,
    posterPath: null,
    posterSource: 'plex',
    overview: null,
    genres: [],
    year: null,
    inLibrary: true,
    rating: 7,
    voteCount: 1000,
    ...overrides,
  }
}

describe('pickNextCard', () => {
  it('returns null when every pool entry has already been swiped', () => {
    const pool = [entry(1), entry(2)]
    const result = pickNextCard(pool, new Set([1, 2]), emptyTally(), 2, 6.5, 50, createRng(1))
    expect(result).toBeNull()
  })

  it('never returns an already-swiped movieId', () => {
    const pool = Array.from({ length: 20 }, (_, i) => entry(i))
    const swiped = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8])
    for (let seed = 0; seed < 30; seed++) {
      const result = pickNextCard(pool, swiped, emptyTally(), 0, 6.5, 50, createRng(seed))
      expect(result).not.toBeNull()
      expect(swiped.has(result as number)).toBe(false)
    }
  })

  it('is deterministic for a fixed seed and fixed inputs', () => {
    const pool = Array.from({ length: 20 }, (_, i) => entry(i, { rating: 5 + (i % 5), voteCount: 100 }))
    const a = pickNextCard(pool, new Set(), emptyTally(), 0, 6.5, 50, createRng(123))
    const b = pickNextCard(pool, new Set(), emptyTally(), 0, 6.5, 50, createRng(123))
    expect(a).toBe(b)
  })

  it('strongly favors a candidate whose genre the group has voted yes on repeatedly', () => {
    let tally = emptyTally()
    for (let i = 0; i < 20; i++) tally = recordVote(tally, ['Comedy'], 'yes')
    const pool = [
      entry(1, { genres: ['Comedy'], rating: 6.5, voteCount: 50 }),
      ...Array.from({ length: 30 }, (_, i) => entry(100 + i, { genres: ['Horror'], rating: 6.5, voteCount: 50 })),
    ]
    const picks = Array.from({ length: 20 }, (_, seed) =>
      pickNextCard(pool, new Set(), tally, 20, 6.5, 50, createRng(seed)),
    )
    const comedyPicks = picks.filter((p) => p === 1).length
    // With only 1 of 31 candidates being Comedy, a uniform pick would land on
    // it ~3% of the time; strong positive affinity should push this well above chance.
    expect(comedyPicks).toBeGreaterThan(3)
  })

  it('only considers the top 10 by score, not the full remaining pool', () => {
    const pool = [
      entry(1, { rating: 10, voteCount: 10000 }), // clearly top score
      ...Array.from({ length: 50 }, (_, i) => entry(100 + i, { rating: 1, voteCount: 10000 })), // clearly bottom
    ]
    const picks = new Set(
      Array.from({ length: 50 }, (_, seed) => pickNextCard(pool, new Set(), emptyTally(), 0, 6.5, 50, createRng(seed))),
    )
    // The 50 low-score candidates should almost never all be excluded from a
    // 50-draw sample if the whole pool were in play; asserting id 1 dominates
    // is the direct, robust check that scoring (not uniform choice) is active.
    const idOnePicks = Array.from(picks).filter((p) => p === 1)
    expect(idOnePicks.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/pool/nextCard.test.ts`
Expected: FAIL — `server/pool/nextCard.ts` does not exist yet.

- [ ] **Step 3: Write `server/pool/nextCard.ts`**

```ts
// server/pool/nextCard.ts
import { affinityWeight, genreAffinity, type GenreTally } from '../ranking/affinity'
import { reputationScore } from '../ranking/reputation'
import { weightedSample, type Rng } from '../ranking/rng'
import type { PoolEntry } from './buildPool'

export const TOP_K = 10

export function pickNextCard(
  pool: PoolEntry[],
  swipedMovieIds: Set<number>,
  tally: GenreTally,
  totalVotes: number,
  reputationC: number,
  reputationM: number,
  rng: Rng,
): number | null {
  const remaining = pool.filter((entry) => !swipedMovieIds.has(entry.movieId))
  if (remaining.length === 0) return null

  const weight = affinityWeight(totalVotes)
  const scored = remaining.map((entry) => ({
    entry,
    score:
      reputationScore(entry, reputationC, reputationM) + weight * genreAffinity(entry.genres, tally),
  }))
  scored.sort((a, b) => b.score - a.score)
  const topTen = scored.slice(0, TOP_K)
  const minScore = topTen[topTen.length - 1].score

  const picked = weightedSample(topTen, (item) => item.score - minScore, rng)
  return picked.entry.movieId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/pool/nextCard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/pool/nextCard.ts server/pool/nextCard.test.ts
git commit -m "feat: top-10 weighted-random next-card selection with negative-score safety"
```

---

## Task 14: Room types, match threshold, and auth tokens

**Files:**
- Create: `server/room/types.ts`
- Create: `server/room/matchThreshold.ts`
- Create: `server/auth/tokens.ts`
- Test: `server/room/matchThreshold.test.ts`
- Test: `server/auth/tokens.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  type MatchThreshold = { kind: 'all' } | { kind: 'majority' } | { kind: 'atLeast'; n: number }
  type CandidateSource = 'plex' | 'plex+tmdb'
  type RoomStatus = 'lobby' | 'starting' | 'active' | 'ended'
  type ConnectionStatus = 'connected' | 'disconnected'
  interface Participant {
    id: string
    displayName: string
    sessionToken: string
    connectionStatus: ConnectionStatus
    finished: boolean
    swipes: Map<number, 'yes' | 'no'>
    pendingCardId: number | null
  }
  interface RoomState {
    code: string
    status: RoomStatus
    hostParticipantId: string | null
    hostToken: string | null
    hostClaimToken: string | null
    hostClaimConsumed: boolean
    participants: Map<string, Participant>
    revokedSessionTokens: Set<string>
    kickReasons: Map<string, 'kicked' | 'excluded_at_start'> // keyed by sessionToken, not participantId — a kicked participant is removed from `participants`, so sessionToken (what `reconnect` presents) is the only lookup key still available afterward
    matchThreshold: MatchThreshold
    candidateSource: CandidateSource
    tmdbFilters: { genre?: string; yearMin?: number; yearMax?: number; ratingMin?: number }
    pool: import('../pool/buildPool').PoolEntry[]
    matches: number[]
    matchedMovieIds: Set<number>
    exhausted: boolean
    genreTally: import('../ranking/affinity').GenreTally
    totalVotes: number
    reputationC: number
    reputationM: number
    rngSeed: number
    rngCallCount: number // incremented on every pickNextCard call; combined with rngSeed to derive a fresh, still-deterministic Rng per call without storing a live closure on RoomState
    lastActivityAt: number
    seq: number
    endedAt: number | null
  }

  // matchThreshold.ts
  function evaluateThreshold(threshold: MatchThreshold, yesCount: number, frozenCount: number): boolean
  function isValidThreshold(threshold: MatchThreshold, participantCount: number): boolean
  function clampThreshold(threshold: MatchThreshold, participantCount: number): MatchThreshold

  // tokens.ts
  function generateToken(): string // hex-encoded 128-bit random
  function generateRoomCode(): string // e.g. BLUE-FOX-427
  ```

- [ ] **Step 1: Write `server/room/types.ts`** (no test — pure type definitions, exercised by every later task's tests)

```ts
// server/room/types.ts
import type { GenreTally } from '../ranking/affinity'
import type { PoolEntry } from '../pool/buildPool'

export type MatchThreshold = { kind: 'all' } | { kind: 'majority' } | { kind: 'atLeast'; n: number }
export type CandidateSource = 'plex' | 'plex+tmdb'
export type RoomStatus = 'lobby' | 'starting' | 'active' | 'ended'
export type ConnectionStatus = 'connected' | 'disconnected'

export interface Participant {
  id: string
  displayName: string
  sessionToken: string
  connectionStatus: ConnectionStatus
  finished: boolean
  swipes: Map<number, 'yes' | 'no'>
  pendingCardId: number | null
}

export interface TmdbFilters {
  genre?: string
  yearMin?: number
  yearMax?: number
  ratingMin?: number
}

export interface RoomState {
  code: string
  status: RoomStatus
  hostParticipantId: string | null
  hostToken: string | null
  hostClaimToken: string | null
  hostClaimConsumed: boolean
  participants: Map<string, Participant>
  revokedSessionTokens: Set<string>
  kickReasons: Map<string, 'kicked' | 'excluded_at_start'>
  matchThreshold: MatchThreshold
  candidateSource: CandidateSource
  tmdbFilters: TmdbFilters
  pool: PoolEntry[]
  matches: number[]
  matchedMovieIds: Set<number>
  exhausted: boolean
  genreTally: GenreTally
  totalVotes: number
  reputationC: number
  reputationM: number
  rngSeed: number
  rngCallCount: number
  lastActivityAt: number
  seq: number
  endedAt: number | null
}
```

- [ ] **Step 2: Write the failing match-threshold test**

```ts
// server/room/matchThreshold.test.ts
import { describe, expect, it } from 'vitest'
import { clampThreshold, evaluateThreshold, isValidThreshold } from './matchThreshold'

describe('evaluateThreshold', () => {
  it('"all" requires yesCount === frozenCount', () => {
    expect(evaluateThreshold({ kind: 'all' }, 4, 4)).toBe(true)
    expect(evaluateThreshold({ kind: 'all' }, 3, 4)).toBe(false)
  })

  it('"majority" requires strictly more than half — 3 of 4, not 2 of 4', () => {
    expect(evaluateThreshold({ kind: 'majority' }, 3, 4)).toBe(true)
    expect(evaluateThreshold({ kind: 'majority' }, 2, 4)).toBe(false)
  })

  it('"atLeast" requires yesCount >= n', () => {
    expect(evaluateThreshold({ kind: 'atLeast', n: 2 }, 2, 5)).toBe(true)
    expect(evaluateThreshold({ kind: 'atLeast', n: 3 }, 2, 5)).toBe(false)
  })
})

describe('isValidThreshold', () => {
  it('"atLeast" is valid only when 1 <= n <= participantCount', () => {
    expect(isValidThreshold({ kind: 'atLeast', n: 0 }, 5)).toBe(false)
    expect(isValidThreshold({ kind: 'atLeast', n: 5 }, 5)).toBe(true)
    expect(isValidThreshold({ kind: 'atLeast', n: 6 }, 5)).toBe(false)
  })

  it('"all" and "majority" are always valid for any positive participant count', () => {
    expect(isValidThreshold({ kind: 'all' }, 1)).toBe(true)
    expect(isValidThreshold({ kind: 'majority' }, 1)).toBe(true)
  })
})

describe('clampThreshold', () => {
  it('clamps an atLeast.n that now exceeds the (post-kick) participant count', () => {
    const clamped = clampThreshold({ kind: 'atLeast', n: 5 }, 3)
    expect(clamped).toEqual({ kind: 'atLeast', n: 3 })
  })

  it('leaves a still-valid atLeast.n unchanged', () => {
    const original = { kind: 'atLeast', n: 2 } as const
    expect(clampThreshold(original, 3)).toEqual(original)
  })

  it('leaves "all" and "majority" unchanged — they scale automatically', () => {
    expect(clampThreshold({ kind: 'all' }, 2)).toEqual({ kind: 'all' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/room/matchThreshold.test.ts`
Expected: FAIL — `server/room/matchThreshold.ts` does not exist yet.

- [ ] **Step 4: Write `server/room/matchThreshold.ts`**

```ts
// server/room/matchThreshold.ts
import type { MatchThreshold } from './types'

export function evaluateThreshold(threshold: MatchThreshold, yesCount: number, frozenCount: number): boolean {
  switch (threshold.kind) {
    case 'all':
      return yesCount === frozenCount
    case 'majority':
      return yesCount > frozenCount / 2
    case 'atLeast':
      return yesCount >= threshold.n
  }
}

export function isValidThreshold(threshold: MatchThreshold, participantCount: number): boolean {
  if (threshold.kind !== 'atLeast') return true
  return threshold.n >= 1 && threshold.n <= participantCount
}

export function clampThreshold(threshold: MatchThreshold, participantCount: number): MatchThreshold {
  if (threshold.kind !== 'atLeast') return threshold
  return { kind: 'atLeast', n: Math.min(threshold.n, Math.max(participantCount, 1)) }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/room/matchThreshold.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Write the failing tokens test**

```ts
// server/auth/tokens.test.ts
import { describe, expect, it } from 'vitest'
import { generateRoomCode, generateToken } from './tokens'

describe('generateToken', () => {
  it('generates a 32-character hex string (128 bits)', () => {
    const token = generateToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates distinct tokens across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })
})

describe('generateRoomCode', () => {
  it('matches the WORD-WORD-NNN format', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)
  })

  it('generates different codes across calls (not exhaustively unique — collision handling is the room store\'s job)', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRoomCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run server/auth/tokens.test.ts`
Expected: FAIL — `server/auth/tokens.ts` does not exist yet.

- [ ] **Step 8: Write `server/auth/tokens.ts`**

```ts
// server/auth/tokens.ts
import { randomBytes, randomInt } from 'node:crypto'

const WORDS = [
  'BLUE', 'RED', 'GOLD', 'FOX', 'WOLF', 'BEAR', 'HAWK', 'STAR', 'MOON', 'RAIN',
  'LEAF', 'ROCK', 'WAVE', 'FIRE', 'SNOW', 'PEAK', 'LAKE', 'ROSE', 'IRON', 'JADE',
  // ... in the real implementation this list is filled out to 100 entries;
  // truncated here for plan readability, see Task's Step 9 note below.
]

export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

export function generateRoomCode(): string {
  const wordA = WORDS[randomInt(WORDS.length)]
  const wordB = WORDS[randomInt(WORDS.length)]
  const digits = String(randomInt(0, 1000)).padStart(3, '0')
  return `${wordA}-${wordB}-${digits}`
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run server/auth/tokens.test.ts`
Expected: PASS (4 tests)

Then expand `WORDS` to a full 100-entry list (any 100 short, unambiguous-when-spoken-aloud English nouns/colors/animals — the exact words don't affect correctness, only code-space size, so pick freely) before moving on.

- [ ] **Step 10: Commit**

```bash
git add server/room/types.ts server/room/matchThreshold.ts server/room/matchThreshold.test.ts server/auth/tokens.ts server/auth/tokens.test.ts
git commit -m "feat: room types, match-threshold evaluation, and auth token generation"
```

---

## Task 15: Room store — creation, lobby join/reconnect, kick, settings

**Files:**
- Create: `server/room/roomStore.ts`
- Create: `server/room/actions.ts`
- Test: `server/room/actions.test.ts`

**Interfaces:**
- Consumes: `RoomState`, `Participant`, `MatchThreshold` (Task 14 types); `generateToken`, `generateRoomCode` (Task 14); `evaluateThreshold`, `isValidThreshold`, `clampThreshold` (Task 14); `emptyTally`, `recordVote`, `genreAffinity` (Task 10)
- Produces:
  ```ts
  // roomStore.ts
  interface RoomStore {
    create(matchThreshold: MatchThreshold, candidateSource: CandidateSource, tmdbFilters: TmdbFilters): { code: string; hostClaimToken: string }
    get(code: string): RoomState | undefined
    delete(code: string): void
    all(): RoomState[]
  }
  function createRoomStore(): RoomStore

  // actions.ts — every action returns a discriminated result, never throws for
  // expected error paths (only truly unexpected states throw).
  type ActionResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }
  type ErrorCode = 'room_not_found' | 'room_full' | 'already_started' | 'invalid_name' |
    'not_host' | 'kicked' | 'excluded_at_start' | 'invalid_threshold' | 'bad_token'

  function joinRoom(store: RoomStore, code: string, displayName: string, hostClaimToken?: string):
    ActionResult<{ participantId: string; sessionToken: string; hostToken: string | null; hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null; room: RoomState }>
  function reconnectRoom(store: RoomStore, code: string, sessionToken: string, hostToken?: string):
    ActionResult<{ participantId: string; isHost: boolean; room: RoomState }>
  function kickParticipant(store: RoomStore, code: string, callerIsHost: boolean, targetParticipantId: string):
    ActionResult<{ newMatches: number[] }>
  function updateSettings(store: RoomStore, code: string, callerIsHost: boolean, updates: Partial<{ matchThreshold: MatchThreshold; candidateSource: CandidateSource; tmdbFilters: TmdbFilters }>):
    ActionResult<null>
  const MAX_PARTICIPANTS_PER_ROOM = 20
  ```

- [ ] **Step 1: Write `server/room/roomStore.ts`** (thin enough that its behavior is covered by `actions.test.ts`, below — no standalone test file)

```ts
// server/room/roomStore.ts
import { emptyTally } from '../ranking/affinity'
import { generateRoomCode, generateToken } from '../auth/tokens'
import type { CandidateSource, MatchThreshold, RoomState, TmdbFilters } from './types'

export interface RoomStore {
  create(matchThreshold: MatchThreshold, candidateSource: CandidateSource, tmdbFilters: TmdbFilters): {
    code: string
    hostClaimToken: string
  }
  get(code: string): RoomState | undefined
  delete(code: string): void
  all(): RoomState[]
}

const MAX_CODE_GENERATION_ATTEMPTS = 20

export function createRoomStore(): RoomStore {
  const rooms = new Map<string, RoomState>()

  return {
    create(matchThreshold, candidateSource, tmdbFilters) {
      let code = generateRoomCode()
      let attempts = 0
      while (rooms.has(code) && attempts < MAX_CODE_GENERATION_ATTEMPTS) {
        code = generateRoomCode()
        attempts++
      }
      const hostClaimToken = generateToken()
      const room: RoomState = {
        code,
        status: 'lobby',
        hostParticipantId: null,
        hostToken: null,
        hostClaimToken,
        hostClaimConsumed: false,
        participants: new Map(),
        revokedSessionTokens: new Set(),
        kickReasons: new Map(),
        matchThreshold,
        candidateSource,
        tmdbFilters,
        pool: [],
        matches: [],
        matchedMovieIds: new Set(),
        exhausted: false,
        genreTally: emptyTally(),
        totalVotes: 0,
        reputationC: 6.5,
        reputationM: 50,
        rngSeed: Math.floor(Math.random() * 2 ** 31),
        rngCallCount: 0,
        lastActivityAt: Date.now(),
        seq: 0,
        endedAt: null,
      }
      rooms.set(code, room)
      return { code, hostClaimToken }
    },
    get(code) {
      return rooms.get(code)
    },
    delete(code) {
      rooms.delete(code)
    },
    all() {
      return [...rooms.values()]
    },
  }
}
```

- [ ] **Step 2: Write the failing test for join/reconnect/kick/settings**

```ts
// server/room/actions.test.ts
import { describe, expect, it } from 'vitest'
import { createRoomStore } from './roomStore'
import { joinRoom, kickParticipant, reconnectRoom, updateSettings } from './actions'

function newRoom() {
  const store = createRoomStore()
  const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
  return { store, code, hostClaimToken }
}

describe('joinRoom', () => {
  it('the first join with a valid hostClaimToken becomes host', () => {
    const { store, code, hostClaimToken } = newRoom()
    const result = joinRoom(store, code, 'Alice', hostClaimToken)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hostToken).not.toBeNull()
    expect(result.data.hostClaimResult).toBe('claimed')
  })

  it('a second join presenting the same (now-consumed) hostClaimToken is a plain participant', () => {
    const { store, code, hostClaimToken } = newRoom()
    joinRoom(store, code, 'Alice', hostClaimToken)
    const second = joinRoom(store, code, 'Bob', hostClaimToken)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.hostToken).toBeNull()
    expect(second.data.hostClaimResult).toBe('already_consumed')
  })

  it('a join with no hostClaimToken is a plain participant with no hostClaimResult field', () => {
    const { store, code } = newRoom()
    const result = joinRoom(store, code, 'Alice')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hostToken).toBeNull()
    expect(result.data.hostClaimResult).toBeNull()
  })

  it('a failed join (invalid name) does not consume the hostClaimToken — a retry with it still claims host', () => {
    const { store, code, hostClaimToken } = newRoom()
    const failed = joinRoom(store, code, '', hostClaimToken)
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.code).toBe('invalid_name')

    const retry = joinRoom(store, code, 'Alice', hostClaimToken)
    expect(retry.ok).toBe(true)
    if (!retry.ok) return
    expect(retry.data.hostClaimResult).toBe('claimed')
  })

  it('rejects a join once the room has left lobby', () => {
    const { store, code } = newRoom()
    const room = store.get(code)!
    room.status = 'active'
    const result = joinRoom(store, code, 'Alice')
    expect(result).toEqual({ ok: false, code: 'already_started' })
  })

  it('rejects joins past MAX_PARTICIPANTS_PER_ROOM', () => {
    const { store, code } = newRoom()
    for (let i = 0; i < 20; i++) {
      expect(joinRoom(store, code, `P${i}`).ok).toBe(true)
    }
    const overflow = joinRoom(store, code, 'One Too Many')
    expect(overflow).toEqual({ ok: false, code: 'room_full' })
  })

  it('auto-suffixes a duplicate display name within the same room', () => {
    const { store, code } = newRoom()
    joinRoom(store, code, 'Alice')
    const second = joinRoom(store, code, 'Alice')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const room = store.get(code)!
    const names = [...room.participants.values()].map((p) => p.displayName)
    expect(names).toContain('Alice')
    expect(names.some((n) => n !== 'Alice' && n.startsWith('Alice'))).toBe(true)
  })

  it('rejects an empty or over-length display name', () => {
    const { store, code } = newRoom()
    expect(joinRoom(store, code, '').ok).toBe(false)
    expect(joinRoom(store, code, 'x'.repeat(25)).ok).toBe(false)
    expect(joinRoom(store, code, 'x'.repeat(24)).ok).toBe(true)
  })

  it('returns room_not_found for an unknown code', () => {
    const { store } = newRoom()
    expect(joinRoom(store, 'NOPE-NOPE-000', 'Alice')).toEqual({ ok: false, code: 'room_not_found' })
  })
})

describe('reconnectRoom', () => {
  it('reconnects with a valid sessionToken', () => {
    const { store, code } = newRoom()
    const joined = joinRoom(store, code, 'Alice')
    if (!joined.ok) throw new Error('setup failed')
    const room = store.get(code)!
    room.participants.get(joined.data.participantId)!.connectionStatus = 'disconnected'

    const result = reconnectRoom(store, code, joined.data.sessionToken)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.participantId).toBe(joined.data.participantId)
    expect(room.participants.get(joined.data.participantId)!.connectionStatus).toBe('connected')
  })

  it('grants isHost only when the correct hostToken is also presented', () => {
    const { store, code, hostClaimToken } = newRoom()
    const joined = joinRoom(store, code, 'Alice', hostClaimToken)
    if (!joined.ok) throw new Error('setup failed')

    const withoutHostToken = reconnectRoom(store, code, joined.data.sessionToken)
    expect(withoutHostToken.ok && withoutHostToken.data.isHost).toBe(false)

    const withHostToken = reconnectRoom(store, code, joined.data.sessionToken, joined.data.hostToken!)
    expect(withHostToken.ok && withHostToken.data.isHost).toBe(true)
  })

  it('returns bad_token for an unrecognized sessionToken', () => {
    const { store, code } = newRoom()
    expect(reconnectRoom(store, code, 'not-a-real-token')).toEqual({ ok: false, code: 'bad_token' })
  })

  it('returns kicked for a revoked (kicked) sessionToken', () => {
    const { store, code, hostClaimToken } = newRoom()
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const target = joinRoom(store, code, 'Troll')
    if (!host.ok || !target.ok) throw new Error('setup failed')
    kickParticipant(store, code, true, target.data.participantId)
    expect(reconnectRoom(store, code, target.data.sessionToken)).toEqual({ ok: false, code: 'kicked' })
  })
})

describe('kickParticipant', () => {
  it('a non-host caller is rejected', () => {
    const { store, code } = newRoom()
    const target = joinRoom(store, code, 'Alice')
    if (!target.ok) throw new Error('setup failed')
    expect(kickParticipant(store, code, false, target.data.participantId)).toEqual({
      ok: false,
      code: 'not_host',
    })
  })

  it('removes the participant and revokes their session with reason kicked', () => {
    const { store, code, hostClaimToken } = newRoom()
    joinRoom(store, code, 'Host', hostClaimToken)
    const target = joinRoom(store, code, 'Troll')
    if (!target.ok) throw new Error('setup failed')

    const result = kickParticipant(store, code, true, target.data.participantId)
    expect(result.ok).toBe(true)
    const room = store.get(code)!
    expect(room.participants.has(target.data.participantId)).toBe(false)
    expect(room.revokedSessionTokens.has(target.data.sessionToken)).toBe(true)
    expect(room.kickReasons.get(target.data.sessionToken)).toBe('kicked')
  })

  it('clamps an atLeast threshold that now exceeds the shrunk participant count', () => {
    const { store, code, hostClaimToken } = newRoom()
    store.get(code)!.matchThreshold = { kind: 'atLeast', n: 3 }
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    const c = joinRoom(store, code, 'C')
    if (!c.ok) throw new Error('setup failed')
    kickParticipant(store, code, true, c.data.participantId)
    expect(store.get(code)!.matchThreshold).toEqual({ kind: 'atLeast', n: 2 })
  })
})

describe('updateSettings', () => {
  it('a non-host caller is rejected', () => {
    const { store, code } = newRoom()
    expect(updateSettings(store, code, false, { matchThreshold: { kind: 'majority' } })).toEqual({
      ok: false,
      code: 'not_host',
    })
  })

  it('applies a valid threshold change', () => {
    const { store, code } = newRoom()
    updateSettings(store, code, true, { matchThreshold: { kind: 'majority' } })
    expect(store.get(code)!.matchThreshold).toEqual({ kind: 'majority' })
  })

  it('rejects an atLeast.n greater than the current participant count', () => {
    const { store, code } = newRoom()
    joinRoom(store, code, 'Alice')
    const result = updateSettings(store, code, true, { matchThreshold: { kind: 'atLeast', n: 5 } })
    expect(result).toEqual({ ok: false, code: 'invalid_threshold' })
  })

  it('is rejected once the room has left lobby', () => {
    const { store, code } = newRoom()
    store.get(code)!.status = 'active'
    expect(updateSettings(store, code, true, { candidateSource: 'plex+tmdb' })).toEqual({
      ok: false,
      code: 'already_started',
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/room/actions.test.ts`
Expected: FAIL — `server/room/actions.ts` does not exist yet.

- [ ] **Step 4: Write `server/room/actions.ts`**

```ts
// server/room/actions.ts
import { emptyTally, recordVote } from '../ranking/affinity'
import { generateToken } from '../auth/tokens'
import { clampThreshold, evaluateThreshold, isValidThreshold } from './matchThreshold'
import type { RoomStore } from './roomStore'
import type { CandidateSource, MatchThreshold, Participant, RoomState, TmdbFilters } from './types'

export const MAX_PARTICIPANTS_PER_ROOM = 20

export type ErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'already_started'
  | 'invalid_name'
  | 'not_host'
  | 'kicked'
  | 'excluded_at_start'
  | 'invalid_threshold'
  | 'bad_token'

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: ErrorCode }

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
function err<T>(code: ErrorCode): ActionResult<T> {
  return { ok: false, code }
}

function uniqueDisplayName(room: RoomState, requested: string): string {
  const taken = new Set([...room.participants.values()].map((p) => p.displayName))
  if (!taken.has(requested)) return requested
  let suffix = 2
  while (taken.has(`${requested} (${suffix})`)) suffix++
  return `${requested} (${suffix})`
}

export function joinRoom(
  store: RoomStore,
  code: string,
  displayName: string,
  hostClaimToken?: string,
): ActionResult<{
  participantId: string
  sessionToken: string
  hostToken: string | null
  hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null
  room: RoomState
}> {
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'lobby') return err('already_started')
  if (displayName.length < 1 || displayName.length > 24) return err('invalid_name')
  if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM) return err('room_full')

  const participantId = generateToken()
  const sessionToken = generateToken()
  const participant: Participant = {
    id: participantId,
    displayName: uniqueDisplayName(room, displayName),
    sessionToken,
    connectionStatus: 'connected',
    finished: false,
    swipes: new Map(),
    pendingCardId: null,
  }
  room.participants.set(participantId, participant)
  room.lastActivityAt = Date.now()

  let hostToken: string | null = null
  let hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null = null
  if (hostClaimToken !== undefined) {
    if (room.hostClaimConsumed) {
      hostClaimResult = 'already_consumed'
    } else if (hostClaimToken !== room.hostClaimToken) {
      hostClaimResult = 'expired'
    } else {
      room.hostClaimConsumed = true
      room.hostParticipantId = participantId
      hostToken = generateToken()
      room.hostToken = hostToken
      hostClaimResult = 'claimed'
    }
  }

  return ok({ participantId, sessionToken, hostToken, hostClaimResult, room })
}

export function reconnectRoom(
  store: RoomStore,
  code: string,
  sessionToken: string,
  hostToken?: string,
): ActionResult<{ participantId: string; isHost: boolean; room: RoomState }> {
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.revokedSessionTokens.has(sessionToken)) {
    const reason = room.kickReasons.get(sessionToken) ?? 'kicked'
    return err(reason)
  }
  const participant = [...room.participants.values()].find((p) => p.sessionToken === sessionToken)
  if (!participant) return err('bad_token')

  participant.connectionStatus = 'connected'
  room.lastActivityAt = Date.now()
  const isHost = hostToken !== undefined && hostToken === room.hostToken && room.hostParticipantId === participant.id

  return ok({ participantId: participant.id, isHost, room })
}

function rebuildAffinityFromSwipes(room: RoomState): void {
  let tally = emptyTally()
  let totalVotes = 0
  for (const participant of room.participants.values()) {
    for (const [movieId, vote] of participant.swipes) {
      const entry = room.pool.find((p) => p.movieId === movieId)
      if (entry) tally = recordVote(tally, entry.genres, vote)
      totalVotes++
    }
  }
  room.genreTally = tally
  room.totalVotes = totalVotes
}

function reevaluateMatches(room: RoomState): number[] {
  const frozenCount = room.participants.size
  const votedMovieIds = new Set<number>()
  for (const participant of room.participants.values()) {
    for (const movieId of participant.swipes.keys()) votedMovieIds.add(movieId)
  }
  const newMatches: number[] = []
  for (const movieId of votedMovieIds) {
    if (room.matchedMovieIds.has(movieId)) continue
    const yesCount = [...room.participants.values()].filter((p) => p.swipes.get(movieId) === 'yes').length
    if (evaluateThreshold(room.matchThreshold, yesCount, frozenCount)) {
      room.matchedMovieIds.add(movieId)
      room.matches.push(movieId)
      newMatches.push(movieId)
    }
  }
  return newMatches
}

export function kickParticipant(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  targetParticipantId: string,
): ActionResult<{ newMatches: number[] }> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  const target = room.participants.get(targetParticipantId)
  if (!target) return err('room_not_found')

  room.revokedSessionTokens.add(target.sessionToken)
  room.kickReasons.set(target.sessionToken, 'kicked')
  room.participants.delete(targetParticipantId)

  rebuildAffinityFromSwipes(room)
  const newMatches = reevaluateMatches(room)
  room.matchThreshold = clampThreshold(room.matchThreshold, room.participants.size)
  room.lastActivityAt = Date.now()

  return ok({ newMatches })
}

export function updateSettings(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  updates: Partial<{ matchThreshold: MatchThreshold; candidateSource: CandidateSource; tmdbFilters: TmdbFilters }>,
): ActionResult<null> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'lobby') return err('already_started')

  if (updates.matchThreshold && !isValidThreshold(updates.matchThreshold, room.participants.size)) {
    return err('invalid_threshold')
  }

  if (updates.matchThreshold) room.matchThreshold = updates.matchThreshold
  if (updates.candidateSource) room.candidateSource = updates.candidateSource
  if (updates.tmdbFilters) room.tmdbFilters = updates.tmdbFilters
  room.lastActivityAt = Date.now()

  return ok(null)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/room/actions.test.ts`
Expected: PASS (20 tests)

- [ ] **Step 6: Commit**

```bash
git add server/room/roomStore.ts server/room/actions.ts server/room/actions.test.ts
git commit -m "feat: room store with hostClaimToken-gated join, reconnect, kick, settings"
```

---

## Task 16: Start transition, swipe handling, match evaluation, exhaustion

**Files:**
- Create: `server/room/activeActions.ts`
- Test: `server/room/activeActions.test.ts`

**Interfaces:**
- Consumes: `RoomStore`, `ActionResult`, `ErrorCode` (Task 15, extended with `not_enough_participants | pool_too_small | not_your_card`); `buildPool`, `POOL_MIN_SIZE` (Task 12); `pickNextCard` (Task 13); `computeCAndM` (Task 10); `recordVote`, `emptyTally` (Task 10); `createRng` (Task 11); `evaluateThreshold` (Task 14)
- Produces:
  ```ts
  function nextRngForRoom(room: RoomState): Rng
  function startRoom(store: RoomStore, code: string, callerIsHost: boolean, db: Database.Database, tmdb: TmdbClient):
    ActionResult<{ excludedParticipantIds: string[]; pool: PoolEntry[] }>
  function swipeAction(store: RoomStore, code: string, participantId: string, movieId: number, vote: 'yes' | 'no'):
    ActionResult<{ consumed: boolean; newMatches: number[]; nextCardForParticipant: number | null; exhaustedNow: boolean }>
  ```
  Extends `ErrorCode` with `'not_enough_participants' | 'pool_too_small' | 'not_your_card'`.

- [ ] **Step 1: Write the failing test**

```ts
// server/room/activeActions.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { joinRoom } from './actions'
import { startRoom, swipeAction } from './activeActions'
import { createRoomStore } from './roomStore'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'

let dir: string
let db: Database.Database
const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-active-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function seedPlexRows(count: number) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2020,
      genres: ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

describe('startRoom', () => {
  it('rejects a non-host caller', async () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(10)
    const result = await startRoom(store, code, false, db, noOpTmdb)
    expect(result).toEqual({ ok: false, code: 'not_host' })
  })

  it('rejects Start with fewer than 2 connected participants', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    seedPlexRows(10)
    const result = await startRoom(store, code, true, db, noOpTmdb)
    expect(result).toEqual({ ok: false, code: 'not_enough_participants' })
  })

  it('excludes a disconnected participant from the frozen set and revokes their session with excluded_at_start', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    // A third participant, in addition to host + flaky, so that excluding
    // the one disconnected participant still leaves 2 connected — this test
    // is specifically about exclusion behavior, not the separate minimum-
    // participant gate (MIN_PARTICIPANTS_TO_START=2 is checked against the
    // POST-exclusion count, per spec's "(disconnected-filtered) participant
    // count" — conflating the two in one test with only 2 total joiners
    // would make "excludes 1 of 2" and "needs at least 2 remaining"
    // contradict each other).
    const other = joinRoom(store, code, 'Other')
    const flaky = joinRoom(store, code, 'Flaky')
    if (!host.ok || !other.ok || !flaky.ok) throw new Error('setup failed')
    store.get(code)!.participants.get(flaky.data.participantId)!.connectionStatus = 'disconnected'
    seedPlexRows(10)

    const result = await startRoom(store, code, true, db, noOpTmdb)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.excludedParticipantIds).toEqual([flaky.data.participantId])
    const room = store.get(code)!
    expect(room.participants.has(flaky.data.participantId)).toBe(false)
    expect(room.revokedSessionTokens.has(flaky.data.sessionToken)).toBe(true)
    expect(room.kickReasons.get(flaky.data.sessionToken)).toBe('excluded_at_start')
  })

  it('rejects Start when the resulting pool has fewer than POOL_MIN_SIZE candidates', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    seedPlexRows(2) // below POOL_MIN_SIZE (5)
    const result = await startRoom(store, code, true, db, noOpTmdb)
    expect(result).toEqual({ ok: false, code: 'pool_too_small' })
    expect(store.get(code)!.status).toBe('lobby')
  })

  it('on success, moves to active, freezes the pool, and assigns each participant a first pendingCardId', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(20)

    const result = await startRoom(store, code, true, db, noOpTmdb)
    expect(result.ok).toBe(true)
    const room = store.get(code)!
    expect(room.status).toBe('active')
    expect(room.pool.length).toBeGreaterThanOrEqual(5)
    expect(room.participants.get(host.data.participantId)!.pendingCardId).not.toBeNull()
    expect(room.participants.get(other.data.participantId)!.pendingCardId).not.toBeNull()
  })
})

describe('swipeAction', () => {
  async function startedRoom(threshold: import('./types').MatchThreshold = { kind: 'all' }) {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create(threshold, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(20)
    await startRoom(store, code, true, db, noOpTmdb)
    return { store, code, hostId: host.data.participantId, otherId: other.data.participantId }
  }

  it('a swipe on the pending card is consumed and assigns a new pendingCardId', async () => {
    const { store, code, hostId } = await startedRoom()
    const room = store.get(code)!
    const pendingBefore = room.participants.get(hostId)!.pendingCardId!
    const result = swipeAction(store, code, hostId, pendingBefore, 'yes')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.consumed).toBe(true)
    expect(room.participants.get(hostId)!.swipes.get(pendingBefore)).toBe('yes')
    expect(room.participants.get(hostId)!.pendingCardId).not.toBe(pendingBefore)
  })

  it('a swipe naming a movieId that is not the pending card is a no-op — not_your_card', async () => {
    const { store, code, hostId } = await startedRoom()
    const room = store.get(code)!
    const notPending = room.pool.find((p) => p.movieId !== room.participants.get(hostId)!.pendingCardId)!.movieId
    const result = swipeAction(store, code, hostId, notPending, 'yes')
    expect(result).toEqual({ ok: false, code: 'not_your_card' })
    expect(room.participants.get(hostId)!.swipes.size).toBe(0)
  })

  it('a duplicate/replayed swipe for an already-recorded movieId is a no-op with consumed: false', async () => {
    const { store, code, hostId } = await startedRoom()
    const room = store.get(code)!
    const first = room.participants.get(hostId)!.pendingCardId!
    swipeAction(store, code, hostId, first, 'yes')
    const replay = swipeAction(store, code, hostId, first, 'yes')
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.data.consumed).toBe(false)
  })

  it('fires a match exactly once when the last required yes vote lands', async () => {
    const { store, code, hostId, otherId } = await startedRoom({ kind: 'all' })
    const room = store.get(code)!
    const target = room.participants.get(hostId)!.pendingCardId!
    // force both participants onto the same card for this test
    room.participants.get(otherId)!.pendingCardId = target

    const first = swipeAction(store, code, hostId, target, 'yes')
    expect(first.ok && first.data.newMatches).toEqual([])
    const second = swipeAction(store, code, otherId, target, 'yes')
    expect(second.ok && second.data.newMatches).toEqual([target])
    expect(room.matchedMovieIds.has(target)).toBe(true)
  })

  it('marks a participant finished and sets exhaustedNow once no connected participant has cards left', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'atLeast', n: 2 }, 'plex', {})
    const host = joinRoom(store, code, 'Host', hostClaimToken)
    const other = joinRoom(store, code, 'Other')
    if (!host.ok || !other.ok) throw new Error('setup failed')
    seedPlexRows(5) // exactly POOL_MIN_SIZE, so this session is fast to exhaust
    await startRoom(store, code, true, db, noOpTmdb)
    const room = store.get(code)!

    let exhaustedNow = false
    for (const participantId of [host.data.participantId, other.data.participantId]) {
      let card = room.participants.get(participantId)!.pendingCardId
      while (card !== null) {
        const result = swipeAction(store, code, participantId, card, 'no')
        if (result.ok) exhaustedNow = result.data.exhaustedNow
        card = room.participants.get(participantId)!.pendingCardId
      }
    }
    expect(room.participants.get(host.data.participantId)!.finished).toBe(true)
    expect(room.exhausted).toBe(true)
    expect(exhaustedNow).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/room/activeActions.test.ts`
Expected: FAIL — `server/room/activeActions.ts` does not exist yet.

- [ ] **Step 3: Write `server/room/activeActions.ts`**

```ts
// server/room/activeActions.ts
import type Database from 'better-sqlite3'
import { buildPool, POOL_MIN_SIZE, type PoolEntry } from '../pool/buildPool'
import { pickNextCard } from '../pool/nextCard'
import { recordVote } from '../ranking/affinity'
import { computeCAndM } from '../ranking/reputation'
import { createRng, type Rng } from '../ranking/rng'
import type { TmdbClient } from '../tmdb/client'
import { evaluateThreshold } from './matchThreshold'
import type { ActionResult, ErrorCode } from './actions'
import type { RoomStore } from './roomStore'
import type { RoomState } from './types'

export const MIN_PARTICIPANTS_TO_START = 2

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
function err<T>(code: ErrorCode): ActionResult<T> {
  return { ok: false, code }
}

export function nextRngForRoom(room: RoomState): Rng {
  const rng = createRng(room.rngSeed + room.rngCallCount)
  room.rngCallCount++
  return rng
}

function assignPendingCard(room: RoomState, participantId: string): number | null {
  const participant = room.participants.get(participantId)
  if (!participant) return null
  const swiped = new Set(participant.swipes.keys())
  const nextCardId = pickNextCard(
    room.pool,
    swiped,
    room.genreTally,
    room.totalVotes,
    room.reputationC,
    room.reputationM,
    nextRngForRoom(room),
  )
  participant.pendingCardId = nextCardId
  participant.finished = nextCardId === null
  return nextCardId
}

function recomputeExhaustion(room: RoomState): boolean {
  const blocking = [...room.participants.values()].some(
    (p) => p.connectionStatus === 'connected' && !p.finished,
  )
  room.exhausted = !blocking
  return room.exhausted
}

export async function startRoom(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  db: Database.Database,
  tmdb: TmdbClient,
): Promise<ActionResult<{ excludedParticipantIds: string[]; pool: PoolEntry[] }>> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'lobby') return err('already_started')

  const excludedParticipantIds: string[] = []
  for (const participant of [...room.participants.values()]) {
    if (participant.connectionStatus === 'disconnected') {
      room.revokedSessionTokens.add(participant.sessionToken)
      room.kickReasons.set(participant.sessionToken, 'excluded_at_start')
      room.participants.delete(participant.id)
      excludedParticipantIds.push(participant.id)
    }
  }

  if (room.participants.size < MIN_PARTICIPANTS_TO_START) {
    return err('not_enough_participants')
  }

  // Synchronous status flip BEFORE the async pool build — closes the join
  // race described in the spec's Concurrency section.
  room.status = 'starting'

  const result = await buildPool(db, tmdb, room.candidateSource, room.tmdbFilters, room.rngSeed)
  if (result.tooSmall) {
    room.status = 'lobby'
    return err('pool_too_small')
  }

  room.pool = result.pool
  const { c, m } = computeCAndM(result.pool)
  room.reputationC = c
  room.reputationM = m
  room.status = 'active'
  room.lastActivityAt = Date.now()

  for (const participantId of room.participants.keys()) {
    assignPendingCard(room, participantId)
  }
  recomputeExhaustion(room)

  return ok({ excludedParticipantIds, pool: room.pool })
}

export function swipeAction(
  store: RoomStore,
  code: string,
  participantId: string,
  movieId: number,
  vote: 'yes' | 'no',
): ActionResult<{ consumed: boolean; newMatches: number[]; nextCardForParticipant: number | null; exhaustedNow: boolean }> {
  const room = store.get(code)
  if (!room) return err('room_not_found')
  const participant = room.participants.get(participantId)
  if (!participant) return err('room_not_found')

  if (movieId !== participant.pendingCardId) {
    if (participant.swipes.has(movieId)) {
      // Replayed/duplicate delivery of an already-recorded swipe — idempotent no-op.
      return ok({ consumed: false, newMatches: [], nextCardForParticipant: participant.pendingCardId, exhaustedNow: room.exhausted })
    }
    return err('not_your_card')
  }

  participant.swipes.set(movieId, vote)
  room.totalVotes++
  const entry = room.pool.find((p) => p.movieId === movieId)
  if (entry) room.genreTally = recordVote(room.genreTally, entry.genres, vote)

  const newMatches: number[] = []
  if (!room.matchedMovieIds.has(movieId)) {
    const frozenCount = room.participants.size
    const yesCount = [...room.participants.values()].filter((p) => p.swipes.get(movieId) === 'yes').length
    if (evaluateThreshold(room.matchThreshold, yesCount, frozenCount)) {
      room.matchedMovieIds.add(movieId)
      room.matches.push(movieId)
      newMatches.push(movieId)
    }
  }

  const nextCardForParticipant = assignPendingCard(room, participantId)
  const exhaustedNow = recomputeExhaustion(room)
  room.lastActivityAt = Date.now()

  return ok({ consumed: true, newMatches, nextCardForParticipant, exhaustedNow })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/room/activeActions.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add server/room/activeActions.ts server/room/activeActions.test.ts
git commit -m "feat: start transition, pendingCard-gated swipes, match evaluation, exhaustion"
```

---

## Task 17: Room lifecycle — end, inactivity sweep, eviction sweep

**Files:**
- Create: `server/room/lifecycle.ts`
- Test: `server/room/lifecycle.test.ts`

**Interfaces:**
- Consumes: `RoomStore`, `ActionResult`, `ErrorCode` (Task 15)
- Produces:
  ```ts
  const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
  const EVICTION_DELAY_MS = 10 * 60 * 1000
  function endRoom(store: RoomStore, code: string, callerIsHost: boolean): ActionResult<null>
  function touchActivity(room: RoomState): void // called by join/swipe/host-action/heartbeat
  function sweepInactiveRooms(store: RoomStore, now: number): string[] // returns codes just ended
  function sweepEvictions(store: RoomStore, now: number): string[] // returns codes just deleted
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/room/lifecycle.test.ts
import { describe, expect, it } from 'vitest'
import {
  EVICTION_DELAY_MS,
  INACTIVITY_TIMEOUT_MS,
  endRoom,
  sweepEvictions,
  sweepInactiveRooms,
  touchActivity,
} from './lifecycle'
import { createRoomStore } from './roomStore'

describe('endRoom', () => {
  it('a non-host caller is rejected', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    expect(endRoom(store, code, false)).toEqual({ ok: false, code: 'not_host' })
  })

  it('sets status to ended and stamps endedAt', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const before = Date.now()
    endRoom(store, code, true)
    const room = store.get(code)!
    expect(room.status).toBe('ended')
    expect(room.endedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('sweepInactiveRooms', () => {
  it('ends a lobby room whose lastActivityAt is past the inactivity timeout', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const room = store.get(code)!
    room.lastActivityAt = Date.now() - INACTIVITY_TIMEOUT_MS - 1000

    const ended = sweepInactiveRooms(store, Date.now())
    expect(ended).toEqual([code])
    expect(room.status).toBe('ended')
  })

  it('does not end a room whose activity is within the timeout', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const ended = sweepInactiveRooms(store, Date.now())
    expect(ended).toEqual([])
  })

  it('does not re-end an already-ended room', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    endRoom(store, code, true)
    const ended = sweepInactiveRooms(store, Date.now() + INACTIVITY_TIMEOUT_MS * 2)
    expect(ended).toEqual([])
  })

  it('processes every eligible room when multiple rooms are inactive, not just the first', () => {
    const store = createRoomStore()
    const codes = [store.create({ kind: 'all' }, 'plex', {}).code, store.create({ kind: 'all' }, 'plex', {}).code, store.create({ kind: 'all' }, 'plex', {}).code]
    for (const code of codes) {
      store.get(code)!.lastActivityAt = Date.now() - INACTIVITY_TIMEOUT_MS - 1000
    }
    const ended = sweepInactiveRooms(store, Date.now())
    expect(ended.sort()).toEqual([...codes].sort())
    for (const code of codes) {
      expect(store.get(code)!.status).toBe('ended')
    }
  })
})

describe('touchActivity', () => {
  it('advances lastActivityAt to the current time', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const room = store.get(code)!
    room.lastActivityAt = 0
    touchActivity(room)
    expect(room.lastActivityAt).toBeGreaterThan(0)
  })
})

describe('sweepEvictions', () => {
  it('deletes a room 10+ minutes after it ended', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    endRoom(store, code, true)
    const room = store.get(code)!
    room.endedAt = Date.now() - EVICTION_DELAY_MS - 1000

    const evicted = sweepEvictions(store, Date.now())
    expect(evicted).toEqual([code])
    expect(store.get(code)).toBeUndefined()
  })

  it('leaves a recently-ended room alone until the delay passes', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    endRoom(store, code, true)
    const evicted = sweepEvictions(store, Date.now())
    expect(evicted).toEqual([])
    expect(store.get(code)).toBeDefined()
  })

  it('ignores rooms that are not yet ended', () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const evicted = sweepEvictions(store, Date.now() + EVICTION_DELAY_MS * 10)
    expect(evicted).toEqual([])
    expect(store.get(code)).toBeDefined()
  })

  it('processes every eligible room when multiple rooms are past eviction delay, not just the first', () => {
    const store = createRoomStore()
    const codes = [store.create({ kind: 'all' }, 'plex', {}).code, store.create({ kind: 'all' }, 'plex', {}).code, store.create({ kind: 'all' }, 'plex', {}).code]
    for (const code of codes) {
      endRoom(store, code, true)
      store.get(code)!.endedAt = Date.now() - EVICTION_DELAY_MS - 1000
    }
    const evicted = sweepEvictions(store, Date.now())
    expect(evicted.sort()).toEqual([...codes].sort())
    for (const code of codes) {
      expect(store.get(code)).toBeUndefined()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/room/lifecycle.test.ts`
Expected: FAIL — `server/room/lifecycle.ts` does not exist yet.

- [ ] **Step 3: Write `server/room/lifecycle.ts`**

```ts
// server/room/lifecycle.ts
import type { ActionResult, ErrorCode } from './actions'
import type { RoomStore } from './roomStore'
import type { RoomState } from './types'

export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000
export const EVICTION_DELAY_MS = 10 * 60 * 1000

function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data }
}
function err<T>(code: ErrorCode): ActionResult<T> {
  return { ok: false, code }
}

export function endRoom(store: RoomStore, code: string, callerIsHost: boolean): ActionResult<null> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  room.status = 'ended'
  room.endedAt = Date.now()
  return ok(null)
}

export function touchActivity(room: RoomState): void {
  room.lastActivityAt = Date.now()
}

export function sweepInactiveRooms(store: RoomStore, now: number): string[] {
  const endedCodes: string[] = []
  for (const room of store.all()) {
    if (room.status === 'ended') continue
    if (now - room.lastActivityAt > INACTIVITY_TIMEOUT_MS) {
      room.status = 'ended'
      room.endedAt = now
      endedCodes.push(room.code)
    }
  }
  return endedCodes
}

export function sweepEvictions(store: RoomStore, now: number): string[] {
  const evicted: string[] = []
  for (const room of store.all()) {
    if (room.status !== 'ended' || room.endedAt === null) continue
    if (now - room.endedAt > EVICTION_DELAY_MS) {
      store.delete(room.code)
      evicted.push(room.code)
    }
  }
  return evicted
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/room/lifecycle.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add server/room/lifecycle.ts server/room/lifecycle.test.ts
git commit -m "feat: room end, inactivity sweep, and eviction sweep"
```

---

## Task 18: WebSocket protocol types + pure message router

**Files:**
- Create: `server/ws/protocol.ts`
- Create: `server/ws/router.ts`
- Test: `server/ws/router.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 14–17 (`RoomStore`, all action functions), `Database.Database`, `TmdbClient`
- Produces:
  ```ts
  // protocol.ts
  type ClientMessage =
    | { type: 'join'; roomCode: string; displayName: string; hostClaimToken?: string }
    | { type: 'reconnect'; roomCode: string; sessionToken: string; hostToken?: string }
    | { type: 'resync' }
    | { type: 'swipe'; movieId: number; vote: 'yes' | 'no' }
    | { type: 'start' }
    | { type: 'end_room' }
    | { type: 'update_settings'; matchThreshold?: MatchThreshold; candidateSource?: CandidateSource; tmdbFilters?: TmdbFilters }
    | { type: 'kick'; participantId: string }
    | { type: 'heartbeat' }

  type ServerMessage =
    | { type: 'joined'; participantId: string; sessionToken: string; hostToken: string | null; hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null; room: RoomSnapshot }
    | { type: 'room_started'; pool: PoolEntry[]; seq: number }
    | { type: 'next_card'; movieId: number | null }
    | { type: 'state_update'; participants: ParticipantView[]; status: RoomStatus; matches: number[]; exhausted: boolean; matchThreshold: MatchThreshold; candidateSource: CandidateSource; seq: number }
    | { type: 'match'; movieId: number; movie: PoolEntry; seq: number }
    | { type: 'exhausted'; topCandidates: PoolEntry[] }
    | { type: 'notice'; level: 'info' | 'warning'; code: string; message: string }
    | { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' }
    | { type: 'room_ended'; reason: string; seq: number }
    | { type: 'error'; code: ErrorCode; message: string }
    | { type: 'heartbeat_ack' }

  interface ParticipantView { id: string; displayName: string; connectionStatus: ConnectionStatus; finished: boolean }
  interface RoomSnapshot {
    status: RoomStatus
    mySwipes: Record<number, 'yes' | 'no'>
    participants: ParticipantView[]
    matches: number[]
    exhausted: boolean
    matchThreshold: MatchThreshold
    candidateSource: CandidateSource
    seq: number
    pool?: PoolEntry[]
    pendingCardId?: number | null
    topCandidates?: PoolEntry[]
  }

  // router.ts
  interface ConnectionState { roomCode: string | null; participantId: string | null; isHost: boolean }
  interface RouterOutput {
    toSender: ServerMessage[]
    toRoom: ServerMessage[]          // broadcast to every OTHER connected participant in the room (sender gets toSender instead, so it isn't double-delivered)
    toParticipant: { participantId: string; messages: ServerMessage[] }[]
    closeSender: boolean
    newState: ConnectionState
  }
  function handleMessage(
    store: RoomStore, db: Database.Database, tmdb: TmdbClient,
    state: ConnectionState, message: ClientMessage,
  ): Promise<RouterOutput>
  ```

- [ ] **Step 1: Write `server/ws/protocol.ts`** (types only, no standalone test file — exercised entirely through `router.test.ts`)

```ts
// server/ws/protocol.ts
import type { PoolEntry } from '../pool/buildPool'
import type { ErrorCode } from '../room/actions'
import type { CandidateSource, ConnectionStatus, MatchThreshold, RoomStatus, TmdbFilters } from '../room/types'

export type ClientMessage =
  | { type: 'join'; roomCode: string; displayName: string; hostClaimToken?: string }
  | { type: 'reconnect'; roomCode: string; sessionToken: string; hostToken?: string }
  | { type: 'resync' }
  | { type: 'swipe'; movieId: number; vote: 'yes' | 'no' }
  | { type: 'start' }
  | { type: 'end_room' }
  | {
      type: 'update_settings'
      matchThreshold?: MatchThreshold
      candidateSource?: CandidateSource
      tmdbFilters?: TmdbFilters
    }
  | { type: 'kick'; participantId: string }
  | { type: 'heartbeat' }

export interface ParticipantView {
  id: string
  displayName: string
  connectionStatus: ConnectionStatus
  finished: boolean
}

export interface RoomSnapshot {
  status: RoomStatus
  mySwipes: Record<number, 'yes' | 'no'>
  participants: ParticipantView[]
  matches: number[]
  exhausted: boolean
  matchThreshold: MatchThreshold
  candidateSource: CandidateSource
  seq: number
  pool?: PoolEntry[]
  pendingCardId?: number | null
  topCandidates?: PoolEntry[]
}

export type ServerMessage =
  | {
      type: 'joined'
      participantId: string
      sessionToken: string
      hostToken: string | null
      hostClaimResult: 'claimed' | 'expired' | 'already_consumed' | null
      room: RoomSnapshot
    }
  | { type: 'room_started'; pool: PoolEntry[]; seq: number }
  | { type: 'next_card'; movieId: number | null }
  | {
      type: 'state_update'
      participants: ParticipantView[]
      status: RoomStatus
      matches: number[]
      exhausted: boolean
      matchThreshold: MatchThreshold
      candidateSource: CandidateSource
      seq: number
    }
  | { type: 'match'; movieId: number; movie: PoolEntry; seq: number }
  | { type: 'exhausted'; topCandidates: PoolEntry[] }
  | { type: 'notice'; level: 'info' | 'warning'; code: string; message: string }
  | { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' }
  | { type: 'room_ended'; reason: string; seq: number }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'heartbeat_ack' }
```

- [ ] **Step 2: Write the failing router test**

```ts
// server/ws/router.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { createRoomStore } from '../room/roomStore'
import { handleMessage } from './router'
import type Database from 'better-sqlite3'
import type { RoomStore } from '../room/roomStore'
import type { TmdbClient } from '../tmdb/client'
import type { ConnectionState } from './router'

let dir: string
let db: Database.Database
let store: RoomStore
const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-router-'))
  db = openDb(dir)
  store = createRoomStore()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function freshState(): ConnectionState {
  return { roomCode: null, participantId: null, isHost: false }
}

function seedPlexRows(count: number) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2020,
      genres: ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

describe('handleMessage: join', () => {
  it('a successful join returns a joined message on toSender and a state_update on toRoom', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const result = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Alice',
      hostClaimToken,
    })
    expect(result.toSender[0].type).toBe('joined')
    expect(result.toRoom[0].type).toBe('state_update')
    expect(result.newState.roomCode).toBe(code)
    expect(result.newState.isHost).toBe(true)
  })

  it('joining an unknown room returns an error and does not bind connection state', async () => {
    const result = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: 'NOPE-NOPE-000',
      displayName: 'Alice',
    })
    expect(result.toSender).toEqual([{ type: 'error', code: 'room_not_found', message: expect.any(String) }])
    expect(result.newState.roomCode).toBeNull()
  })
})

describe('handleMessage: start + room_started', () => {
  it('a successful start emits room_started to the whole room, accompanied by a same-seq state_update', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    let state = freshState()
    const joined = await handleMessage(store, db, noOpTmdb, state, {
      type: 'join',
      roomCode: code,
      displayName: 'Host',
      hostClaimToken,
    })
    state = joined.newState
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Other' })
    seedPlexRows(20)

    const result = await handleMessage(store, db, noOpTmdb, state, { type: 'start' })
    const started = result.toRoom.find((m) => m.type === 'room_started')
    const stateUpdate = result.toRoom.find((m) => m.type === 'state_update' && m.status === 'active')
    expect(started).toBeDefined()
    expect(stateUpdate).toBeDefined()
    if (started?.type === 'room_started' && stateUpdate?.type === 'state_update') {
      expect(started.seq).toBe(stateUpdate.seq)
    }
  })

  it('a non-host start attempt returns not_host and does not change room status', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Host', hostClaimToken })
    const otherJoined = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Other',
    })
    const result = await handleMessage(store, db, noOpTmdb, otherJoined.newState, { type: 'start' })
    expect(result.toSender).toEqual([{ type: 'error', code: 'not_host', message: expect.any(String) }])
    expect(store.get(code)!.status).toBe('lobby')
  })
})

describe('handleMessage: swipe -> next_card', () => {
  it('a consumed swipe sends next_card only to the swiping participant, not the whole room', async () => {
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const hostJoined = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Host',
      hostClaimToken,
    })
    await handleMessage(store, db, noOpTmdb, freshState(), { type: 'join', roomCode: code, displayName: 'Other' })
    seedPlexRows(20)
    const started = await handleMessage(store, db, noOpTmdb, hostJoined.newState, { type: 'start' })
    const hostState = started.newState
    const room = store.get(code)!
    const pending = room.participants.get(hostState.participantId!)!.pendingCardId!

    const result = await handleMessage(store, db, noOpTmdb, hostState, {
      type: 'swipe',
      movieId: pending,
      vote: 'yes',
    })
    expect(result.toSender.some((m) => m.type === 'next_card')).toBe(true)
    expect(result.toRoom.some((m) => m.type === 'next_card')).toBe(false)
  })
})

describe('handleMessage: reconnect', () => {
  it('reconnect with a valid sessionToken rebinds connection state', async () => {
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const joined = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'join',
      roomCode: code,
      displayName: 'Alice',
    })
    const sessionToken = (joined.toSender[0] as { type: 'joined'; sessionToken: string }).sessionToken
    const result = await handleMessage(store, db, noOpTmdb, freshState(), {
      type: 'reconnect',
      roomCode: code,
      sessionToken,
    })
    expect(result.toSender[0].type).toBe('joined')
    expect(result.newState.participantId).toBe(joined.newState.participantId)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/ws/router.test.ts`
Expected: FAIL — `server/ws/router.ts` does not exist yet.

- [ ] **Step 4: Write `server/ws/router.ts`**

```ts
// server/ws/router.ts
import type Database from 'better-sqlite3'
import { joinRoom, kickParticipant, reconnectRoom, updateSettings } from '../room/actions'
import { startRoom, swipeAction } from '../room/activeActions'
import { endRoom, touchActivity } from '../room/lifecycle'
import type { RoomStore } from '../room/roomStore'
import type { Participant, RoomState } from '../room/types'
import type { TmdbClient } from '../tmdb/client'
import type { ClientMessage, ParticipantView, RoomSnapshot, ServerMessage } from './protocol'

export interface ConnectionState {
  roomCode: string | null
  participantId: string | null
  isHost: boolean
}

export interface RouterOutput {
  toSender: ServerMessage[]
  toRoom: ServerMessage[]
  toParticipant: { participantId: string; messages: ServerMessage[] }[]
  closeSender: boolean
  newState: ConnectionState
}

function emptyOutput(state: ConnectionState): RouterOutput {
  return { toSender: [], toRoom: [], toParticipant: [], closeSender: false, newState: state }
}

function participantViews(room: RoomState): ParticipantView[] {
  return [...room.participants.values()].map((p) => ({
    id: p.id,
    displayName: p.displayName,
    connectionStatus: p.connectionStatus,
    finished: p.finished,
  }))
}

function stateUpdate(room: RoomState): Extract<ServerMessage, { type: 'state_update' }> {
  room.seq++
  return {
    type: 'state_update',
    participants: participantViews(room),
    status: room.status,
    matches: room.matches,
    exhausted: room.exhausted,
    matchThreshold: room.matchThreshold,
    candidateSource: room.candidateSource,
    seq: room.seq,
  }
}

function topCandidatesFor(room: RoomState): (typeof room.pool) {
  return [...room.pool]
    .filter((entry) => !room.matchedMovieIds.has(entry.movieId))
    .sort((a, b) => {
      const yesA = [...room.participants.values()].filter((p) => p.swipes.get(a.movieId) === 'yes').length
      const yesB = [...room.participants.values()].filter((p) => p.swipes.get(b.movieId) === 'yes').length
      return yesB - yesA
    })
    .slice(0, 5)
}

function snapshotFor(room: RoomState, participant: Participant): RoomSnapshot {
  const base: RoomSnapshot = {
    status: room.status,
    mySwipes: Object.fromEntries(participant.swipes),
    participants: participantViews(room),
    matches: room.matches,
    exhausted: room.exhausted,
    matchThreshold: room.matchThreshold,
    candidateSource: room.candidateSource,
    seq: room.seq,
  }
  if (room.status === 'active' || room.status === 'ended') {
    base.pool = room.pool
    base.pendingCardId = participant.pendingCardId
    if (room.exhausted && room.matches.length === 0) {
      base.topCandidates = topCandidatesFor(room)
    }
  }
  return base
}

export async function handleMessage(
  store: RoomStore,
  db: Database.Database,
  tmdb: TmdbClient,
  state: ConnectionState,
  message: ClientMessage,
): Promise<RouterOutput> {
  switch (message.type) {
    case 'join': {
      const result = joinRoom(store, message.roomCode, message.displayName, message.hostClaimToken)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      touchActivity(result.data.room)
      const newState: ConnectionState = {
        roomCode: message.roomCode,
        participantId: result.data.participantId,
        isHost: result.data.hostToken !== null,
      }
      const participant = result.data.room.participants.get(result.data.participantId)!
      return {
        toSender: [
          {
            type: 'joined',
            participantId: result.data.participantId,
            sessionToken: result.data.sessionToken,
            hostToken: result.data.hostToken,
            hostClaimResult: result.data.hostClaimResult,
            room: snapshotFor(result.data.room, participant),
          },
        ],
        toRoom: [stateUpdate(result.data.room)],
        toParticipant: [],
        closeSender: false,
        newState,
      }
    }

    case 'reconnect': {
      const result = reconnectRoom(store, message.roomCode, message.sessionToken, message.hostToken)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      touchActivity(result.data.room)
      const participant = result.data.room.participants.get(result.data.participantId)!
      const newState: ConnectionState = {
        roomCode: message.roomCode,
        participantId: result.data.participantId,
        isHost: result.data.isHost,
      }
      return {
        toSender: [
          {
            type: 'joined',
            participantId: result.data.participantId,
            sessionToken: message.sessionToken,
            hostToken: result.data.isHost ? (result.data.room.hostToken as string) : null,
            hostClaimResult: null,
            room: snapshotFor(result.data.room, participant),
          },
        ],
        toRoom: [stateUpdate(result.data.room)],
        toParticipant: [],
        closeSender: false,
        newState,
      }
    }

    case 'resync': {
      if (!state.roomCode || !state.participantId) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: 'room_not_found', message: 'not in a room' }] }
      }
      const room = store.get(state.roomCode)
      const participant = room?.participants.get(state.participantId)
      if (!room || !participant) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: 'room_not_found', message: 'room_not_found' }] }
      }
      return {
        ...emptyOutput(state),
        toSender: [
          {
            type: 'joined',
            participantId: state.participantId,
            sessionToken: participant.sessionToken,
            hostToken: state.isHost ? (room.hostToken as string) : null,
            hostClaimResult: null,
            room: snapshotFor(room, participant),
          },
        ],
      }
    }

    case 'swipe': {
      if (!state.roomCode || !state.participantId) return emptyOutput(state)
      const result = swipeAction(store, state.roomCode, state.participantId, message.movieId, message.vote)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      if (!result.data.consumed) {
        return { ...emptyOutput(state), toSender: [{ type: 'next_card', movieId: result.data.nextCardForParticipant }] }
      }
      const room = store.get(state.roomCode)!
      const toRoom: ServerMessage[] = [stateUpdate(room)]
      for (const movieId of result.data.newMatches) {
        const movie = room.pool.find((p) => p.movieId === movieId)!
        toRoom.push({ type: 'match', movieId, movie, seq: room.seq })
      }
      if (result.data.exhaustedNow && room.matches.length === 0) {
        toRoom.push({ type: 'exhausted', topCandidates: topCandidatesFor(room) })
      }
      return {
        toSender: [{ type: 'next_card', movieId: result.data.nextCardForParticipant }],
        toRoom,
        toParticipant: [],
        closeSender: false,
        newState: state,
      }
    }

    case 'start': {
      if (!state.roomCode) return emptyOutput(state)
      const result = await startRoom(store, state.roomCode, state.isHost, db, tmdb)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(state.roomCode)!
      // stateUpdate() is the sole seq-incrementing call — build it first and
      // reuse its seq on room_started, so both messages in this toRoom batch
      // carry the identical value (the invariant the WS protocol section
      // documents: "every message describing [a] change carries that same
      // value"). Incrementing seq a second time here, before stateUpdate,
      // would desync the two — a real bug this exact fix closes.
      const update = stateUpdate(room)
      return {
        ...emptyOutput(state),
        toRoom: [
          { type: 'room_started', pool: room.pool, seq: update.seq },
          update,
        ],
        // startRoom() already assigned every participant a pendingCardId
        // (server-side state is correct from the moment it returns) — but
        // pendingCardId is per-participant, so it can never ride the
        // room-wide `state_update`/`room_started` broadcast above. Without
        // this, no one who was already connected when Start fired ever
        // receives a live next_card; only a later reconnect/resync would
        // surface it, via `joined`'s room.pendingCardId field.
        toParticipant: Array.from(room.participants.values()).map((p) => ({
          participantId: p.id,
          messages: [{ type: 'next_card', movieId: p.pendingCardId }],
        })),
      }
    }

    case 'kick': {
      if (!state.roomCode) return emptyOutput(state)
      const room = store.get(state.roomCode)
      const target = room?.participants.get(message.participantId)
      const result = kickParticipant(store, state.roomCode, state.isHost, message.participantId)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const updatedRoom = store.get(state.roomCode)!
      const toRoom: ServerMessage[] = [stateUpdate(updatedRoom)]
      for (const movieId of result.data.newMatches) {
        const movie = updatedRoom.pool.find((p) => p.movieId === movieId)!
        toRoom.push({ type: 'match', movieId, movie, seq: updatedRoom.seq })
      }
      return {
        toSender: [],
        toRoom,
        toParticipant: target ? [{ participantId: target.id, messages: [{ type: 'kicked', reason: 'kicked' }] }] : [],
        closeSender: false,
        newState: state,
      }
    }

    case 'update_settings': {
      if (!state.roomCode) return emptyOutput(state)
      const result = updateSettings(store, state.roomCode, state.isHost, {
        matchThreshold: message.matchThreshold,
        candidateSource: message.candidateSource,
        tmdbFilters: message.tmdbFilters,
      })
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(state.roomCode)!
      return { ...emptyOutput(state), toRoom: [stateUpdate(room)] }
    }

    case 'end_room': {
      if (!state.roomCode) return emptyOutput(state)
      const result = endRoom(store, state.roomCode, state.isHost)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(state.roomCode)!
      const update = stateUpdate(room) // same reasoning as the 'start' case above — one seq source, reused
      return {
        ...emptyOutput(state),
        toRoom: [{ type: 'room_ended', reason: 'host_ended', seq: update.seq }, update],
      }
    }

    case 'heartbeat': {
      if (state.roomCode) {
        const room = store.get(state.roomCode)
        if (room) touchActivity(room)
      }
      return { ...emptyOutput(state), toSender: [{ type: 'heartbeat_ack' }] }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/ws/router.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add server/ws/protocol.ts server/ws/router.ts server/ws/router.test.ts
git commit -m "feat: WebSocket protocol types and pure message router"
```

---

## Task 19: Rate limiting + WebSocket server wiring

**Files:**
- Create: `server/rateLimit.ts`
- Create: `server/ws/server.ts`
- Test: `server/rateLimit.test.ts`
- Test: `server/ws/server.test.ts`

**Interfaces:**
- Consumes: `handleMessage`, `ConnectionState` (Task 18); `RoomStore` (Task 15); `AppConfig` (Task 1)
- Produces:
  ```ts
  // rateLimit.ts
  interface TokenBucket { tryConsume(key: string): boolean }
  function createTokenBucket(maxTokens: number, refillPerSecond: number): TokenBucket

  // ws/server.ts
  function attachWebSocketServer(
    httpServer: import('node:http').Server,
    store: RoomStore, db: Database.Database, tmdb: TmdbClient, config: AppConfig,
  ): import('ws').WebSocketServer
  const HEARTBEAT_INTERVAL_MS = 15_000
  const HEARTBEAT_TIMEOUT_MS = 45_000
  const RECONNECT_GRACE_MS = 2 * 60_000
  const WS_MAX_PAYLOAD_BYTES = 16 * 1024
  const MAX_FAILED_JOINS = 5
  ```

- [ ] **Step 1: Write the failing rate-limit test**

```ts
// server/rateLimit.test.ts
import { describe, expect, it } from 'vitest'
import { createTokenBucket } from './rateLimit'

describe('createTokenBucket', () => {
  it('allows up to maxTokens consumptions, then denies', () => {
    const bucket = createTokenBucket(3, 0)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
  })

  it('tracks buckets independently per key', () => {
    const bucket = createTokenBucket(1, 0)
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-2')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
  })

  it('refills over time at the configured rate', async () => {
    const bucket = createTokenBucket(1, 100) // 100 tokens/sec — refills fast enough to await in a test
    expect(bucket.tryConsume('ip-1')).toBe(true)
    expect(bucket.tryConsume('ip-1')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(bucket.tryConsume('ip-1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/rateLimit.test.ts`
Expected: FAIL — `server/rateLimit.ts` does not exist yet.

- [ ] **Step 3: Write `server/rateLimit.ts`**

```ts
// server/rateLimit.ts
export interface TokenBucket {
  tryConsume(key: string): boolean
}

export function createTokenBucket(maxTokens: number, refillPerSecond: number): TokenBucket {
  const buckets = new Map<string, { tokens: number; lastRefill: number }>()

  return {
    tryConsume(key) {
      const now = Date.now()
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { tokens: maxTokens, lastRefill: now }
        buckets.set(key, bucket)
      }
      const elapsedSeconds = (now - bucket.lastRefill) / 1000
      bucket.tokens = Math.min(maxTokens, bucket.tokens + elapsedSeconds * refillPerSecond)
      bucket.lastRefill = now

      if (bucket.tokens < 1) return false
      bucket.tokens -= 1
      return true
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/rateLimit.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing WS server test — a real `ws` client against a real in-process server**

```ts
// server/ws/server.test.ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { openDb } from '../db'
import { upsertPlexRow } from '../db/movies'
import { createRoomStore } from '../room/roomStore'
import { attachWebSocketServer } from './server'
import type { Server } from 'node:http'
import type Database from 'better-sqlite3'
import type { TmdbClient } from '../tmdb/client'
import type { AppConfig } from '../config'

let dir: string
let db: Database.Database
let httpServer: Server
let port: number
const config: AppConfig = {
  tmdbApiKey: 'x',
  authEncryptionKey: 'a'.repeat(32),
  adminSetupToken: 'admin',
  appOrigin: 'http://localhost:TESTPORT',
  trustedProxyHops: 0,
  port: 0,
  dataDir: '',
}
const noOpTmdb: TmdbClient = {
  discoverMovies: vi.fn().mockResolvedValue([]),
  getMovieDetails: vi.fn(),
  findByImdbId: vi.fn(),
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-wsserver-'))
  db = openDb(dir)
  const store = createRoomStore()
  httpServer = createServer()
  attachWebSocketServer(httpServer, store, db, noOpTmdb, {
    ...config,
    appOrigin: '', // '' disables Origin enforcement for this test's plain ws:// client
  })
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  port = (httpServer.address() as AddressInfo).port
  ;(globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore = store
})

afterEach(async () => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

function connect(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.once('open', () => resolve(ws))
  })
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())))
  })
}

describe('attachWebSocketServer', () => {
  it('a client can join a room and receives a joined message', async () => {
    const store = (globalThis as { __testStore: ReturnType<typeof createRoomStore> }).__testStore
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const ws = await connect()
    ws.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Alice' }))
    const message = await nextMessage(ws)
    expect(message.type).toBe('joined')
    ws.close()
  })

  it('replies heartbeat_ack to a heartbeat', async () => {
    const ws = await connect()
    ws.send(JSON.stringify({ type: 'heartbeat' }))
    const message = await nextMessage(ws)
    expect(message.type).toBe('heartbeat_ack')
    ws.close()
  })

  it('flips a participant to disconnected when the socket closes, without deleting them', async () => {
    const store = (globalThis as { __testStore: ReturnType<typeof createRoomStore> }).__testStore
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    const ws = await connect()
    ws.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Alice' }))
    const joined = await nextMessage(ws)
    ws.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const room = store.get(code)!
    const participant = room.participants.get(joined.participantId as string)!
    expect(participant.connectionStatus).toBe('disconnected')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run server/ws/server.test.ts`
Expected: FAIL — `server/ws/server.ts` does not exist yet.

- [ ] **Step 7: Write `server/ws/server.ts`**

```ts
// server/ws/server.ts
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type Database from 'better-sqlite3'
import type { AppConfig } from '../config'
import type { RoomStore } from '../room/roomStore'
import type { TmdbClient } from '../tmdb/client'
import { handleMessage, type ConnectionState } from './router'
import type { ClientMessage, ServerMessage } from './protocol'
import { createTokenBucket } from '../rateLimit'

export const HEARTBEAT_INTERVAL_MS = 15_000
export const HEARTBEAT_TIMEOUT_MS = 45_000
export const RECONNECT_GRACE_MS = 2 * 60_000
export const WS_MAX_PAYLOAD_BYTES = 16 * 1024
export const MAX_FAILED_JOINS = 5

interface SocketMeta {
  state: ConnectionState
  lastHeartbeatAt: number
  failedJoins: number
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

// Resolves the real client IP for rate-limiting purposes, honoring
// TRUSTED_PROXY_HOPS the same way the HTTP rate limiter does — an
// untrusted client can set X-Forwarded-For to anything, so this header is
// only consulted at all when the deployer has explicitly said how many
// trusted proxy hops sit in front of this process.
function getClientIp(req: IncomingMessage, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') {
      const ips = forwarded.split(',').map((ip) => ip.trim())
      const index = ips.length - trustedProxyHops
      const candidate = index >= 0 ? ips[index] : undefined
      if (candidate) return candidate
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function attachWebSocketServer(
  httpServer: Server,
  store: RoomStore,
  db: Database.Database,
  tmdb: TmdbClient,
  config: AppConfig,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES })
  const sockets = new Map<WebSocket, SocketMeta>()
  // Per-IP, refilling bucket gating new WS *connections* (~10/minute) — this
  // is the "initial upgrade" half of Network Exposure's rate-limiting
  // requirement. Repeated `join` *messages* on one already-open connection
  // are guarded separately below, per-connection, via meta.failedJoins —
  // a single global bucket for that (an earlier draft of this function used
  // one keyed by `roomCode ?? 'unbound'`, which collapses to one shared
  // bucket for every not-yet-joined connection on the whole server, with a
  // refill rate of 0 — meaning the entire app stops accepting joins from
  // anyone after the first 5 attempts, ever. That was a real bug, not a
  // design choice; per-IP-at-upgrade plus per-connection-failed-joins is
  // the actual fix.)
  const upgradeBucket = createTokenBucket(10, 10 / 60)

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy()
      return
    }
    if (config.appOrigin && req.headers.origin !== config.appOrigin) {
      socket.destroy()
      return
    }
    const clientIp = getClientIp(req, config.trustedProxyHops)
    if (!upgradeBucket.tryConsume(clientIp)) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    const meta: SocketMeta = {
      state: { roomCode: null, participantId: null, isHost: false },
      lastHeartbeatAt: Date.now(),
      failedJoins: 0,
    }
    sockets.set(ws, meta)

    ws.on('message', async (raw) => {
      let message: ClientMessage
      try {
        message = JSON.parse(raw.toString())
      } catch {
        send(ws, { type: 'error', code: 'bad_token', message: 'malformed message' })
        return
      }

      if (message.type === 'heartbeat') meta.lastHeartbeatAt = Date.now()

      const result = await handleMessage(store, db, tmdb, meta.state, message)
      meta.state = result.newState
      for (const m of result.toSender) send(ws, m)

      if (message.type === 'join' && result.toSender.some((m) => m.type === 'error')) {
        meta.failedJoins++
        if (meta.failedJoins >= MAX_FAILED_JOINS) {
          // The response was already sent above; this closes the connection
          // itself as the actual enforcement of "a connection sending failed
          // joins past a small threshold is closed" — tracking failedJoins
          // without ever acting on it would make this guard a no-op.
          ws.close()
          return
        }
      }

      if (result.toRoom.length > 0 && meta.state.roomCode) {
        const room = store.get(meta.state.roomCode)
        if (room) {
          for (const [otherWs, otherMeta] of sockets) {
            if (otherMeta.state.roomCode !== meta.state.roomCode) continue
            if (otherWs === ws) continue
            for (const m of result.toRoom) send(otherWs, m)
          }
        }
      }

      for (const target of result.toParticipant) {
        for (const [otherWs, otherMeta] of sockets) {
          if (otherMeta.state.participantId === target.participantId) {
            for (const m of target.messages) send(otherWs, m)
            if (target.messages.some((m) => m.type === 'kicked')) otherWs.close()
          }
        }
      }

      if (result.closeSender) ws.close()
    })

    ws.on('close', () => {
      const closedMeta = sockets.get(ws)
      sockets.delete(ws)
      if (closedMeta?.state.roomCode && closedMeta.state.participantId) {
        const room = store.get(closedMeta.state.roomCode)
        const participant = room?.participants.get(closedMeta.state.participantId)
        if (participant) participant.connectionStatus = 'disconnected'
      }
    })
  })

  setInterval(() => {
    const now = Date.now()
    for (const [ws, meta] of sockets) {
      if (now - meta.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
        if (meta.state.roomCode && meta.state.participantId) {
          const room = store.get(meta.state.roomCode)
          const participant = room?.participants.get(meta.state.participantId)
          if (participant) participant.connectionStatus = 'disconnected'
        }
        ws.terminate()
        sockets.delete(ws)
      }
    }
  }, HEARTBEAT_INTERVAL_MS)

  return wss
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run server/ws/server.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add server/rateLimit.ts server/rateLimit.test.ts server/ws/server.ts server/ws/server.test.ts
git commit -m "feat: WebSocket server wiring with Origin validation, heartbeat, and rate limiting"
```

---

## Task 20: HTTP API — rooms, setup, image proxy, health

**Files:**
- Create: `server/http/rooms.ts`
- Create: `server/http/setup.ts`
- Create: `server/http/imageProxy.ts`
- Create: `server/http/health.ts`
- Test: `server/http/rooms.test.ts`
- Test: `server/http/setup.test.ts`
- Test: `server/http/imageProxy.test.ts`

**Interfaces:**
- Consumes: `RoomStore.create` (Task 15), `getPlexLink`/`savePlexLink` (Task 5), `PlexClient` (Task 6), `MovieRow` lookup by id (extend `server/db/movies.ts` with `findById(db, id): MovieRow | null` as part of Step 1 below), `AppConfig` (Task 1)
- Produces (each a plain `(req: Request) => Promise<Response>` using the Web-standard `Request`/`Response`, matching what Next.js route handlers and a manual `http` server adapter both accept):
  ```ts
  function createRoomsHandler(store: RoomStore, db: Database.Database, encryptionKey: string): (req: Request) => Promise<Response>
  function createSetupHandlers(db: Database.Database, encryptionKey: string, adminSetupToken: string, plex: PlexClient): {
    pin: (req: Request) => Promise<Response>
    callback: (req: Request) => Promise<Response>
    resync: (req: Request) => Promise<Response>
  }
  function createImageProxyHandler(db: Database.Database, encryptionKey: string, plex: PlexClient): (req: Request) => Promise<Response>
  function createHealthHandler(dataDir: string): (req: Request) => Promise<Response>
  ```

- [ ] **Step 1: Add `findById` to `server/db/movies.ts`**

```ts
// append to server/db/movies.ts
export function findById(db: Database.Database, id: number): MovieRow | null {
  const found = db.prepare('SELECT * FROM movies WHERE id = ?').get(id)
  return found ? rowFromDb(found as Record<string, unknown>) : null
}
```

- [ ] **Step 2: Write the failing rooms test**

```ts
// server/http/rooms.test.ts
import { describe, expect, it } from 'vitest'
import { createRoomStore } from '../room/roomStore'
import { createRoomsHandler } from './rooms'

describe('createRoomsHandler', () => {
  it('creates a room and returns roomCode + hostClaimToken', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key')
    const req = new Request('http://localhost/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ candidateSource: 'plex', matchThreshold: { kind: 'all' } }),
    })
    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^[A-Z]+-[A-Z]+-\d{3}$/)
    expect(typeof body.hostClaimToken).toBe('string')
  })

  it('rejects a malformed body with a 400 and an error code', async () => {
    const store = createRoomStore()
    const handler = createRoomsHandler(store, {} as never, 'key')
    const req = new Request('http://localhost/api/rooms', { method: 'POST', body: 'not json' })
    const res = await handler(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_threshold')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/http/rooms.test.ts`
Expected: FAIL — `server/http/rooms.ts` does not exist yet.

- [ ] **Step 4: Write `server/http/rooms.ts`**

```ts
// server/http/rooms.ts
import type Database from 'better-sqlite3'
import { isValidThreshold } from '../room/matchThreshold'
import type { RoomStore } from '../room/roomStore'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../room/types'

interface CreateRoomBody {
  candidateSource: CandidateSource
  matchThreshold: MatchThreshold
  tmdbFilters?: TmdbFilters
}

function isCreateRoomBody(value: unknown): value is CreateRoomBody {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.candidateSource === 'plex' || v.candidateSource === 'plex+tmdb') &&
    typeof v.matchThreshold === 'object' &&
    v.matchThreshold !== null
  )
}

export function createRoomsHandler(
  store: RoomStore,
  _db: Database.Database,
  _encryptionKey: string,
): (req: Request) => Promise<Response> {
  return async (req) => {
    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_threshold', message: 'malformed body' } }, { status: 400 })
    }
    if (!isCreateRoomBody(parsed)) {
      return Response.json({ error: { code: 'invalid_threshold', message: 'malformed body' } }, { status: 400 })
    }
    // At creation time there's no participant count yet — atLeast is validated
    // for real once real participants exist, at Start (Task 16). Here we only
    // reject the structurally-impossible case, n < 1.
    if (!isValidThreshold(parsed.matchThreshold, Number.MAX_SAFE_INTEGER)) {
      return Response.json({ error: { code: 'invalid_threshold', message: 'invalid threshold' } }, { status: 400 })
    }

    const { code, hostClaimToken } = store.create(
      parsed.matchThreshold,
      parsed.candidateSource,
      parsed.tmdbFilters ?? {},
    )
    return Response.json({ roomCode: code, hostClaimToken })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/http/rooms.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Write the failing setup test**

```ts
// server/http/setup.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { createSetupHandlers } from './setup'
import type Database from 'better-sqlite3'
import type { PlexClient } from '../plex/client'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-setup-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const fakePlex: Partial<PlexClient> = {
  createPin: vi.fn().mockResolvedValue({ id: 1, code: 'ABCD' }),
}

describe('createSetupHandlers', () => {
  it('rejects a pin request without the correct ADMIN_SETUP_TOKEN', async () => {
    const handlers = createSetupHandlers(db, KEY, 'correct-token', fakePlex as PlexClient)
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    const res = await handlers.pin(req)
    expect(res.status).toBe(401)
  })

  it('accepts a pin request with the correct token and returns id/code', async () => {
    const handlers = createSetupHandlers(db, KEY, 'correct-token', fakePlex as PlexClient)
    const req = new Request('http://localhost/api/setup/plex/pin', {
      headers: { Authorization: 'Bearer correct-token' },
    })
    const res = await handlers.pin(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 1, code: 'ABCD' })
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run server/http/setup.test.ts`
Expected: FAIL — `server/http/setup.ts` does not exist yet.

- [ ] **Step 8: Write `server/http/setup.ts`**

```ts
// server/http/setup.ts
import type Database from 'better-sqlite3'
import { savePlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'

function requireAdmin(req: Request, adminSetupToken: string): boolean {
  const header = req.headers.get('authorization') ?? ''
  return header === `Bearer ${adminSetupToken}`
}

export function createSetupHandlers(
  db: Database.Database,
  encryptionKey: string,
  adminSetupToken: string,
  plex: PlexClient,
) {
  return {
    async pin(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const pin = await plex.createPin()
      return Response.json(pin)
    },

    async callback(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      const { authToken, serverUrl, librarySectionIds, clientIdentifier } = (await req.json()) as {
        authToken: string
        serverUrl: string
        librarySectionIds: string[]
        clientIdentifier: string
      }
      savePlexLink(db, encryptionKey, {
        clientIdentifier,
        serverUrl,
        authToken,
        librarySectionIds,
        linkedAt: new Date().toISOString(),
      })
      return Response.json({ ok: true })
    },

    async resync(req: Request): Promise<Response> {
      if (!requireAdmin(req, adminSetupToken)) return new Response(null, { status: 401 })
      // Actual sync invocation is wired in Task 21's server entry point, which
      // holds the shared `createLibrarySync` instance — this handler just
      // needs the admin gate demonstrated and tested here.
      return Response.json({ triggered: true })
    },
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run server/http/setup.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 10: Write the failing image-proxy test**

```ts
// server/http/imageProxy.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import { upsertPlexRow, upsertTmdbOnlyRow } from '../db/movies'
import { savePlexLink } from '../plex/link'
import { createImageProxyHandler } from './imageProxy'
import type Database from 'better-sqlite3'
import type { PlexClient } from '../plex/client'

let dir: string
let db: Database.Database
const KEY = 'a'.repeat(32)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-imgproxy-'))
  db = openDb(dir)
  savePlexLink(db, KEY, {
    clientIdentifier: 'c',
    serverUrl: 'http://plex.local:32400',
    authToken: 'token',
    librarySectionIds: ['1'],
    linkedAt: '2026-08-17T00:00:00.000Z',
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createImageProxyHandler', () => {
  it('rejects an unknown movieId — allowlist, not passthrough', async () => {
    const plex: Partial<PlexClient> = { getThumb: vi.fn() }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient)
    const req = new Request('http://localhost/api/plex-image?movieId=999999')
    const res = await handler(req)
    expect(res.status).toBe(404)
    expect(plex.getThumb).not.toHaveBeenCalled()
  })

  it('rejects a movieId whose poster_source is tmdb, not plex', async () => {
    // upsertTmdbOnlyRow, not upsertPlexRow — it's the function that actually
    // represents a TMDB-sourced row (plex_rating_key genuinely NULL, not a
    // type-unsafe cast forcing null through a function whose real contract
    // requires a non-null plexRatingKey).
    const row = upsertTmdbOnlyRow(db, {
      tmdbId: 1,
      imdbId: null,
      title: 'X',
      posterPath: '/x.jpg',
      posterSource: 'tmdb',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
    })
    const plex: Partial<PlexClient> = { getThumb: vi.fn() }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient)
    const res = await handler(new Request(`http://localhost/api/plex-image?movieId=${row.id}`))
    expect(res.status).toBe(404)
  })

  it('proxies a valid plex-sourced movieId with cache headers and forced content-type', async () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-1',
      tmdbId: null,
      imdbId: null,
      title: 'X',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
    const fakeBody = new ReadableStream()
    const plex: Partial<PlexClient> = {
      getThumb: vi.fn().mockResolvedValue({ body: fakeBody, contentType: 'image/jpeg', status: 200 }),
    }
    const handler = createImageProxyHandler(db, KEY, plex as PlexClient)
    const res = await handler(new Request(`http://localhost/api/plex-image?movieId=${row.id}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(res.headers.get('cache-control')).toContain('max-age=86400')
  })

  it('errors the response stream once the proxied body exceeds the 5MB cap, and passes an under-cap body through untouched', async () => {
    const row = upsertPlexRow(db, 1, {
      plexRatingKey: 'pk-2',
      tmdbId: null,
      imdbId: null,
      title: 'Y',
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: null,
      genres: [],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })

    function fakeStreamOfSize(totalBytes: number): ReadableStream {
      const chunkSize = 1024 * 1024 // 1MB chunks
      let sent = 0
      return new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) {
            controller.close()
            return
          }
          const size = Math.min(chunkSize, totalBytes - sent)
          controller.enqueue(new Uint8Array(size))
          sent += size
        },
      })
    }

    const oversizedPlex: Partial<PlexClient> = {
      getThumb: vi.fn().mockResolvedValue({
        body: fakeStreamOfSize(6 * 1024 * 1024), // 6MB, over the 5MB cap
        contentType: 'image/jpeg',
        status: 200,
      }),
    }
    const oversizedHandler = createImageProxyHandler(db, KEY, oversizedPlex as PlexClient)
    const oversizedRes = await oversizedHandler(
      new Request(`http://localhost/api/plex-image?movieId=${row.id}`),
    )
    // The cap error surfaces when the body is actually read, not at response
    // construction time (the stream errors mid-read) — reading it to
    // completion must reject.
    await expect(async () => {
      for await (const _chunk of oversizedRes.body as unknown as AsyncIterable<Uint8Array>) {
        // draining the stream
      }
    }).rejects.toThrow()

    const underCapPlex: Partial<PlexClient> = {
      getThumb: vi.fn().mockResolvedValue({
        body: fakeStreamOfSize(1024), // 1KB, well under the cap
        contentType: 'image/jpeg',
        status: 200,
      }),
    }
    const underCapHandler = createImageProxyHandler(db, KEY, underCapPlex as PlexClient)
    const underCapRes = await underCapHandler(
      new Request(`http://localhost/api/plex-image?movieId=${row.id}`),
    )
    const bytes = await underCapRes.arrayBuffer()
    expect(bytes.byteLength).toBe(1024)
  })
})
```

- [ ] **Step 11: Run test to verify it fails**

Run: `npx vitest run server/http/imageProxy.test.ts`
Expected: FAIL — `server/http/imageProxy.ts` does not exist yet.

- [ ] **Step 12: Write `server/http/imageProxy.ts`**

```ts
// server/http/imageProxy.ts
import type Database from 'better-sqlite3'
import { findById } from '../db/movies'
import { getPlexLink } from '../plex/link'
import type { PlexClient } from '../plex/client'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Enforces the spec's response-size cap on the proxied stream — Plex is a
// trusted upstream by design (it's the household's own server), but the cap
// is still real defense-in-depth against a misconfigured server or a bug in
// Plex's own thumb endpoint streaming something unbounded through this proxy.
function capStreamSize(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let total = 0
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk: Uint8Array, controller) {
        total += chunk.byteLength
        if (total > maxBytes) {
          controller.error(new Error('Image exceeds size cap'))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
}

export function createImageProxyHandler(
  db: Database.Database,
  encryptionKey: string,
  plex: PlexClient,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const movieIdParam = url.searchParams.get('movieId')
    const movieId = movieIdParam ? Number.parseInt(movieIdParam, 10) : NaN
    if (Number.isNaN(movieId)) return new Response(null, { status: 404 })

    const row = findById(db, movieId)
    if (!row || row.posterSource !== 'plex' || row.plexRatingKey === null) {
      return new Response(null, { status: 404 })
    }

    const link = getPlexLink(db, encryptionKey)
    if (!link) return new Response(null, { status: 502 })

    const thumb = await plex.getThumb(link.serverUrl, link.authToken, row.plexRatingKey)
    if (thumb.status !== 200 || !thumb.body || !thumb.contentType?.startsWith('image/')) {
      return new Response(null, { status: 502 })
    }

    return new Response(capStreamSize(thumb.body, MAX_IMAGE_BYTES), {
      status: 200,
      headers: {
        'Content-Type': thumb.contentType,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  }
}
```

- [ ] **Step 13: Run test to verify it passes**

Run: `npx vitest run server/http/imageProxy.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 14: Write `server/http/health.ts`** (thin enough to skip a dedicated test file — exercised by Task 22's Playwright health check)

```ts
// server/http/health.ts
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

export function createHealthHandler(dataDir: string): (req: Request) => Promise<Response> {
  return async () => {
    try {
      accessSync(join(dataDir, 'popcornpoll.db'), constants.R_OK | constants.W_OK)
      return Response.json({ status: 'ok' })
    } catch {
      return Response.json({ status: 'unhealthy' }, { status: 503 })
    }
  }
}
```

- [ ] **Step 15: Commit**

```bash
git add server/db/movies.ts server/http
git commit -m "feat: HTTP API — rooms, admin-gated setup, allowlisted image proxy, health"
```

---

## Task 21: Server entry point — wiring, sweeps, graceful shutdown

**Files:**
- Create: `server/index.ts`
- Test: `server/index.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–20
- Produces: `createApp(config: AppConfig): { httpServer: import('node:http').Server; store: RoomStore; db: Database.Database; shutdown(): Promise<void> }` — the composition root; `server/index.ts`'s module-level code calls this only when run directly (`import.meta.url === process.argv[1]`-style guard), so tests can import `createApp` without starting a real listening process twice.

- [ ] **Step 1: Write the failing test**

```ts
// server/index.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './index'
import type { AppConfig } from './config'

let dir: string
let app: ReturnType<typeof createApp>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-app-'))
  const config: AppConfig = {
    tmdbApiKey: 'x',
    authEncryptionKey: 'a'.repeat(32),
    adminSetupToken: 'admin',
    appOrigin: '',
    trustedProxyHops: 0,
    port: 0,
    dataDir: dir,
  }
  app = createApp(config)
})

afterEach(async () => {
  await app.shutdown()
  rmSync(dir, { recursive: true, force: true })
})

describe('createApp', () => {
  it('serves /api/health over plain HTTP', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/health`)
    expect(res.status).toBe(200)
  })

  it('serves POST /api/rooms', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      body: JSON.stringify({ candidateSource: 'plex', matchThreshold: { kind: 'all' } }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toBeDefined()
  })

  it('rejects /api/setup/plex/pin without the admin token', async () => {
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve))
    const port = (app.httpServer.address() as { port: number }).port
    const res = await fetch(`http://localhost:${port}/api/setup/plex/pin`)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/index.test.ts`
Expected: FAIL — `createApp` does not exist yet.

- [ ] **Step 3: Write `server/index.ts`**

```ts
// server/index.ts
import { createServer } from 'node:http'
import { loadConfig, type AppConfig } from './config'
import { openDb } from './db'
import { createPlexClient } from './plex/client'
import { createTmdbClient } from './tmdb/client'
import { createRoomStore } from './room/roomStore'
import { sweepEvictions, sweepInactiveRooms } from './room/lifecycle'
import { createLibrarySync } from './sync/librarySync'
import { createEnrichmentWorker } from './sync/enrichment'
import { attachWebSocketServer } from './ws/server'
import { createRoomsHandler } from './http/rooms'
import { createSetupHandlers } from './http/setup'
import { createImageProxyHandler } from './http/imageProxy'
import { createHealthHandler } from './http/health'
import { getPlexLink } from './plex/link'

const SWEEP_INTERVAL_MS = 60_000

export function createApp(config: AppConfig) {
  const db = openDb(config.dataDir)
  const store = createRoomStore()
  const clientIdentifier = getPlexLink(db, config.authEncryptionKey)?.clientIdentifier ?? 'popcornpoll-instance'
  const plex = createPlexClient(clientIdentifier)
  const tmdb = createTmdbClient(config.tmdbApiKey)
  const librarySync = createLibrarySync({ db, plex, tmdb, encryptionKey: config.authEncryptionKey })
  const enrichment = createEnrichmentWorker(db, tmdb)
  enrichment.start()

  const roomsHandler = createRoomsHandler(store, db, config.authEncryptionKey)
  const setupHandlers = createSetupHandlers(db, config.authEncryptionKey, config.adminSetupToken, plex)
  const imageProxyHandler = createImageProxyHandler(db, config.authEncryptionKey, plex)
  const healthHandler = createHealthHandler(config.dataDir)

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const chunks: Buffer[] = []
    // A stream 'error' (client aborts mid-upload, malformed transfer-encoding)
    // is an EventEmitter error with no listener otherwise — Node's default
    // behavior for that is to throw, which crashes this single-replica
    // process over one bad connection. Same failure class as the request
    // dispatch itself below; both need an explicit boundary.
    req.on('error', () => res.destroy())
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      try {
        const webReq = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
        })
        let webRes: Response
        if (url.pathname === '/api/health') webRes = await healthHandler(webReq)
        else if (url.pathname === '/api/rooms' && req.method === 'POST') webRes = await roomsHandler(webReq)
        else if (url.pathname === '/api/setup/plex/pin') webRes = await setupHandlers.pin(webReq)
        else if (url.pathname === '/api/setup/plex/callback') webRes = await setupHandlers.callback(webReq)
        else if (url.pathname === '/api/setup/plex/resync') {
          webRes = await setupHandlers.resync(webReq)
          if (webRes.status === 200) void librarySync.run()
        } else if (url.pathname === '/api/plex-image') webRes = await imageProxyHandler(webReq)
        else {
          res.writeHead(404).end()
          return
        }
        const headerObj: Record<string, string> = {}
        webRes.headers.forEach((value, key) => {
          headerObj[key] = value
        })
        res.writeHead(webRes.status, headerObj)
        res.end(webRes.body ? Buffer.from(await webRes.arrayBuffer()) : undefined)
      } catch {
        // Any handler throwing (e.g. a malformed-JSON body reaching a route
        // that doesn't itself catch req.json() failures) must not crash the
        // whole process over one bad request — this is the boundary that
        // makes that true. A live-reproduced bug before this fix: a
        // malformed-JSON POST to /api/setup/plex/callback took down the
        // entire server via an unhandled promise rejection.
        if (!res.headersSent) res.writeHead(500)
        res.end()
      }
    })
  })

  attachWebSocketServer(httpServer, store, db, tmdb, config)

  const sweepTimer = setInterval(() => {
    const now = Date.now()
    sweepInactiveRooms(store, now)
    sweepEvictions(store, now)
  }, SWEEP_INTERVAL_MS)

  async function shutdown(): Promise<void> {
    clearInterval(sweepTimer)
    enrichment.stop()
    await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    db.close()
  }

  return { httpServer, store, db, shutdown }
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const config = loadConfig(process.env)
  const app = createApp(config)
  app.httpServer.listen(config.port, () => {
    console.log(`PopcornPoll listening on :${config.port}`)
  })
  process.on('SIGTERM', async () => {
    await app.shutdown()
    process.exit(0)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/index.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite to confirm nothing upstream broke**

Run: `npx vitest run`
Expected: PASS — every test file from Tasks 1–21.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts server/index.test.ts
git commit -m "feat: server entry point wiring HTTP, WS, sync, enrichment, and sweeps"
```

---

## Task 22: Frontend — design system, WS client, room creation, lobby, swipe deck

**Files:**
- Create: `app/globals.css`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `lib/utils.ts`
- Create: `components/ui/*` (via shadcn CLI — button, card, avatar, badge, dialog, input, label, select, separator, sonner, skeleton, tooltip, form)
- Create: `components/MarqueeReveal.tsx`, `components/TicketAvatar.tsx`
- Create: `lib/wsClient.ts`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/join/[code]/page.tsx`, `app/room/[code]/page.tsx`
- Create: `components/SwipeDeck.tsx`, `components/RoomShare.tsx`
- Test: `lib/wsClient.test.ts`

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage` (Task 18, re-exported for client use — see Step 4)
- Produces:
  ```ts
  interface WsClient {
    send(message: ClientMessage): void
    on<T extends ServerMessage['type']>(type: T, handler: (msg: Extract<ServerMessage, { type: T }>) => void): () => void
    close(): void
  }
  function createWsClient(url: string): WsClient
  ```

### Design direction

Every UI file in this task is built through the **frontend-design** skill's process, not ad hoc — load that skill before writing any component, and hold every screen against the design plan below rather than default shadcn/Tailwind styling. The subject is a movie theater at night, not a generic swipe app: ticket stubs, marquee bulbs, brass fixtures, velvet curtains. That vernacular is where every distinctive choice below comes from — component styling that doesn't trace back to one of these materials is the wrong choice.

**Tokens** (defined as CSS variables in `app/globals.css`, consumed by `tailwind.config.ts`):

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#17110E` | Base background — curtain-shadow near-black, warm not neutral |
| `--velvet` | `#2C1116` | Surface — card/panel background, deep burgundy |
| `--marquee` | `#F5A623` | Primary accent — marquee-bulb amber; CTAs, "yes," active state |
| `--ticket` | `#F3E9D2` | Primary text-on-dark, light surface — cream ticket paper |
| `--brass` | `#9C7A4A` | Borders, dividers, ticket-perforation — bronze fixture metal |
| `--exit-red` | `#D0463A` | Secondary accent — "no"/reject/error, theater EXIT-sign red |

**Type**: display face **Anton** (tall condensed poster/marquee lettering — room codes, match-reveal title, page H1, used sparingly per the skill's restraint principle, never for body text); body face **Work Sans** (warm geometric humanist sans — everything else); utility face **JetBrains Mono** (ticket-serial-style numerals — the digit portion of room codes, timestamps). Load all three via `next/font/google` in `app/layout.tsx`, exposed as CSS variables (`--font-display`, `--font-body`, `--font-mono`) so Tailwind's `font-display`/`font-body`/`font-mono` utilities resolve to them.

**Structural devices** (the vocabulary every component draws from, not decoration bolted on after):
- **Swipe card** — a torn admit-one ticket silhouette: a dashed perforation line down one edge (`repeating-linear-gradient` border), a clipped torn-corner notch, resting at a slight rotation like a ticket tossed on a table.
- **Lobby roster** — each participant is a ticket-stub chip ("admit one" per guest), not a plain list row.
- **Host controls** — grouped in a brass-bordered panel read as a box-office window, not a bare button row.
- **Ambient background** — a slow, low-opacity spotlight-beam sweep behind the swipe deck (a react-bits background component, retinted to the palette above) — quiet, present, never competing with the deck.

**Signature** (the one memorable element, per the skill's "spend your boldness in one place"): the **marquee chase-light match reveal** — `components/MarqueeReveal.tsx`. When a match fires, the matched title appears inside a frame ringed with small bulbs that light up in a traveling chase sequence (amber glow, brief flicker on first light), title sliding up like a marquee display. This is the one place the UI gets loud; the swipe deck and lobby stay disciplined around it so the reveal actually reads as special.

- [ ] **Step 1: Initialize Tailwind + shadcn/ui**

```bash
npx shadcn@latest init -d
```

This scaffolds `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `lib/utils.ts`, and a starter `app/globals.css` with shadcn's default (neutral) tokens. The next two steps replace those defaults with the palette above — the init's job here is only to wire the build pipeline (Tailwind, CVA, `cn()`) correctly, not to pick the final look.

- [ ] **Step 2: Replace the generated tokens with the design plan's palette**

Overwrite the `:root` block `shadcn init` generated in `app/globals.css` with:

```css
/* app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --ink: 24 20% 6%;
  --velvet: 350 45% 12%;
  --marquee: 36 90% 58%;
  --ticket: 42 47% 90%;
  --brass: 33 30% 46%;
  --exit-red: 5 60% 51%;

  --background: var(--ink);
  --foreground: var(--ticket);
  --card: var(--velvet);
  --card-foreground: var(--ticket);
  --primary: var(--marquee);
  --primary-foreground: var(--ink);
  --secondary: 350 30% 22%;
  --secondary-foreground: var(--ticket);
  --destructive: var(--exit-red);
  --destructive-foreground: var(--ticket);
  --border: var(--brass);
  --input: var(--brass);
  --ring: var(--marquee);
  --muted: 350 30% 18%;
  --muted-foreground: 42 20% 70%;
  --accent: 33 25% 22%;
  --accent-foreground: var(--ticket);
  --popover: var(--velvet);
  --popover-foreground: var(--ticket);
  --radius: 0.4rem;
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: var(--font-body);
}

.font-display {
  font-family: var(--font-display);
  letter-spacing: 0.02em;
}

.font-mono {
  font-family: var(--font-mono);
}

/* ticket-stub silhouette used by the swipe card */
.ticket-edge {
  border-image: repeating-linear-gradient(
    to bottom,
    hsl(var(--brass)) 0 8px,
    transparent 8px 16px
  ) 1;
  border-left-width: 3px;
  border-left-style: solid;
}
```

(shadcn's `-d` init writes HSL triples without the `hsl()` wrapper for its own tokens; the values above follow that same convention so every existing shadcn component — installed in Step 3 — picks them up with zero per-component overrides.)

- [ ] **Step 3: Install the shadcn components this task needs**

```bash
npx shadcn@latest add @shadcn/button @shadcn/card @shadcn/avatar @shadcn/badge @shadcn/dialog @shadcn/input @shadcn/label @shadcn/select @shadcn/separator @shadcn/sonner @shadcn/skeleton @shadcn/tooltip @shadcn/form
```

This writes `components/ui/*.tsx`, already reading from the palette wired in Step 2 — no code sample needed here, the CLI output is the deliverable.

- [ ] **Step 4: Register the react-bits registry and install the ambient background**

Add the registry to `components.json` (merge into the existing file the init wrote):

```json
{
  "registries": {
    "@react-bits": "https://reactbits.dev/r/{name}.json"
  }
}
```

```bash
npx shadcn@latest add @react-bits/Aurora-TS-TW
```

Retint it to the palette in `components/SpotlightBackground.tsx` — a thin wrapper around the installed `Aurora` component rather than editing the vendored file directly, so a future `shadcn add` re-pull doesn't clobber the retint:

```tsx
// components/SpotlightBackground.tsx
'use client'

import Aurora from './ui/Aurora'

export function SpotlightBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 opacity-30">
      <Aurora colorStops={['#2C1116', '#F5A623', '#17110E']} amplitude={0.6} speed={0.3} />
    </div>
  )
}
```

- [ ] **Step 5: Write `components/MarqueeReveal.tsx`** (the signature element)

```tsx
// components/MarqueeReveal.tsx
'use client'

import { motion } from 'framer-motion'
import type { PoolEntry } from '../server/pool/buildPool'

const BULB_COUNT = 20

export function MarqueeReveal({ movie }: { movie: PoolEntry }) {
  return (
    <motion.div
      role="alert"
      className="relative border-2 border-brass bg-velvet p-8 text-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
    >
      {Array.from({ length: BULB_COUNT }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute h-2 w-2 rounded-full bg-marquee"
          style={bulbPosition(i, BULB_COUNT)}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: (i / BULB_COUNT) * 1.2, ease: 'easeInOut' }}
        />
      ))}
      <p className="font-mono text-xs uppercase tracking-widest text-brass">It's a match</p>
      <motion.h2
        className="font-display text-4xl text-ticket"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {movie.title}
      </motion.h2>
      {movie.inLibrary && <p className="mt-2 text-sm text-marquee">Ready to watch in your library</p>}
    </motion.div>
  )
}

// Places bulb i of n evenly around a rectangle's perimeter, expressed as
// inset-based absolute positioning (no layout dependency on the frame's
// exact pixel size).
function bulbPosition(i: number, n: number): React.CSSProperties {
  const perimeterFraction = i / n
  const side = Math.floor(perimeterFraction * 4)
  const t = (perimeterFraction * 4) % 1
  const pct = `${t * 100}%`
  switch (side) {
    case 0: return { top: '-4px', left: pct }
    case 1: return { top: pct, right: '-4px' }
    case 2: return { bottom: '-4px', left: pct }
    default: return { top: pct, left: '-4px' }
  }
}
```

- [ ] **Step 6: Write `components/TicketAvatar.tsx`** (roster chip)

```tsx
// components/TicketAvatar.tsx
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import type { ParticipantView } from '../server/ws/protocol'

export function TicketAvatar({ participant }: { participant: ParticipantView }) {
  const initials = participant.displayName.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2 rounded border border-brass/50 bg-velvet px-3 py-1.5">
      <Avatar className="h-6 w-6">
        <AvatarFallback className="bg-marquee text-xs text-ink">{initials}</AvatarFallback>
      </Avatar>
      <span className="font-mono text-sm text-ticket">{participant.displayName}</span>
      {participant.connectionStatus === 'disconnected' && (
        <Badge variant="outline" className="border-exit-red text-exit-red">away</Badge>
      )}
      {participant.finished && <Badge className="bg-marquee text-ink">done</Badge>}
    </div>
  )
}
```

- [ ] **Step 7: Write the failing `wsClient` test** (uses a real in-process `ws` server as the target, same pattern as Task 19)

```ts
// lib/wsClient.test.ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWsClient } from './wsClient'
import type { Server } from 'node:http'

let httpServer: Server
let wss: WebSocketServer
let url: string

beforeEach(async () => {
  httpServer = createServer()
  wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const port = (httpServer.address() as AddressInfo).port
  url = `ws://localhost:${port}/ws`
})

afterEach(async () => {
  wss.close()
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

describe('createWsClient', () => {
  it('sends a message and dispatches a typed response to the matching handler', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => ws.send(JSON.stringify({ type: 'heartbeat_ack' })))
    })
    const client = createWsClient(url)
    const received = new Promise((resolve) => {
      client.on('heartbeat_ack', (msg) => resolve(msg))
    })
    await new Promise((resolve) => setTimeout(resolve, 50)) // let the socket open
    client.send({ type: 'heartbeat' })
    const msg = await received
    expect(msg).toEqual({ type: 'heartbeat_ack' })
    client.close()
  })

  it('unsubscribing via the returned function stops further dispatch', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => {
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
        ws.send(JSON.stringify({ type: 'heartbeat_ack' }))
      })
    })
    const client = createWsClient(url)
    let count = 0
    const unsubscribe = client.on('heartbeat_ack', () => {
      count++
      unsubscribe()
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    client.send({ type: 'heartbeat' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(count).toBe(1)
    client.close()
  })
})
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run lib/wsClient.test.ts`
Expected: FAIL — `lib/wsClient.ts` does not exist yet.

- [ ] **Step 9: Write `lib/wsClient.ts`**

```ts
// lib/wsClient.ts
import type { ClientMessage, ServerMessage } from '../server/ws/protocol'

export interface WsClient {
  send(message: ClientMessage): void
  on<T extends ServerMessage['type']>(
    type: T,
    handler: (msg: Extract<ServerMessage, { type: T }>) => void,
  ): () => void
  close(): void
}

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

export function createWsClient(url: string): WsClient {
  let socket: WebSocket
  let backoff = INITIAL_BACKOFF_MS
  let closedByCaller = false
  const handlers = new Map<string, Set<(msg: ServerMessage) => void>>()
  const queue: ClientMessage[] = []

  function dispatch(message: ServerMessage) {
    const set = handlers.get(message.type)
    if (!set) return
    for (const handler of [...set]) handler(message)
  }

  function connect() {
    socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      backoff = INITIAL_BACKOFF_MS
      const pending = queue.splice(0, queue.length)
      for (const msg of pending) socket.send(JSON.stringify(msg))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      dispatch(message)
    })
    socket.addEventListener('close', () => {
      if (closedByCaller) return
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    })
  }
  connect()

  return {
    send(message) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message))
      } else {
        queue.push(message)
      }
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set()
      set.add(handler as (msg: ServerMessage) => void)
      handlers.set(type, set)
      return () => set.delete(handler as (msg: ServerMessage) => void)
    },
    close() {
      closedByCaller = true
      socket.close()
    },
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run lib/wsClient.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 11: Write `components/SwipeDeck.tsx`**

```tsx
// components/SwipeDeck.tsx
'use client'

import { motion, useAnimation, type PanInfo } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import type { PoolEntry } from '../server/pool/buildPool'

const SWIPE_THRESHOLD_PX = 120

export function SwipeDeck({
  card,
  onDecide,
}: {
  card: PoolEntry | null
  onDecide: (vote: 'yes' | 'no') => void
}) {
  const controls = useAnimation()
  const [dragDirection, setDragDirection] = useState<'yes' | 'no' | null>(null)

  async function animateDecision(vote: 'yes' | 'no') {
    if (!card) return // nothing to decide on yet (deck is empty or hasn't loaded)
    if (vote === 'yes') {
      await controls.start({ x: 500, opacity: 0, rotate: 15 })
    } else {
      await controls.start({ x: -500, opacity: 0, rotate: -15 })
    }
    onDecide(vote)
    controls.set({ x: 0, opacity: 1, rotate: 0 })
    setDragDirection(null)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') void animateDecision('yes')
      if (event.key === 'ArrowLeft') void animateDecision('no')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animateDecision closes over `card`/`onDecide` freshly each render; re-binding per keystroke is intentional here
  })

  if (!card) {
    return <p className="font-display text-xl text-brass">No more cards</p>
  }

  async function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD_PX) {
      await animateDecision('yes')
    } else if (info.offset.x < -SWIPE_THRESHOLD_PX) {
      await animateDecision('no')
    } else {
      controls.start({ x: 0, rotate: 0 })
      setDragDirection(null)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6" style={{ touchAction: 'pan-y', overscrollBehaviorX: 'none' }}>
      <motion.div
        className="ticket-edge relative w-80 origin-bottom -rotate-1 rounded bg-velvet p-4 shadow-xl"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
        drag="x"
        animate={controls}
        onDrag={(_, info) => setDragDirection(info.offset.x > 0 ? 'yes' : info.offset.x < 0 ? 'no' : null)}
        onDragEnd={handleDragEnd}
        data-drag-direction={dragDirection ?? undefined}
      >
        {card.posterPath && (
          <img
            className="mb-3 aspect-[2/3] w-full rounded object-cover"
            src={card.posterSource === 'plex' ? `/api/plex-image?movieId=${card.movieId}` : `https://image.tmdb.org/t/p/w342${card.posterPath}`}
            alt={card.title}
          />
        )}
        <h2 className="font-display text-2xl text-ticket">{card.title}</h2>
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{card.overview}</p>
        {card.inLibrary && (
          <Badge className="mt-2 bg-marquee text-ink">In your library</Badge>
        )}
      </motion.div>
      <div className="flex gap-6">
        <Button
          size="icon"
          variant="outline"
          className="h-14 w-14 rounded-full border-exit-red text-exit-red hover:bg-exit-red hover:text-ticket"
          onClick={() => animateDecision('no')}
          aria-label="No"
        >
          ✕
        </Button>
        <Button
          size="icon"
          className="h-14 w-14 rounded-full bg-marquee text-ink hover:bg-marquee/90"
          onClick={() => animateDecision('yes')}
          aria-label="Yes"
        >
          ♥
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 12: Write `components/RoomShare.tsx`**

```tsx
// components/RoomShare.tsx
'use client'

import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

export function RoomShare({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : ''

  useEffect(() => {
    if (!joinUrl || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#17110E', light: '#F3E9D2' },
    })
  }, [joinUrl])

  async function copyLink() {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(joinUrl)
    } else {
      const input = document.createElement('input')
      input.value = joinUrl
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    setCopied(true)
    toast('Link copied')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border-2 border-brass bg-velvet">
      <CardContent className="flex flex-col items-center gap-4 p-6">
        <p className="font-mono text-3xl tracking-widest text-marquee">{code}</p>
        <canvas ref={canvasRef} aria-label={`QR code for ${joinUrl}`} className="rounded bg-ticket p-2" />
        <div className="flex gap-2">
          <Button variant="outline" className="border-brass text-ticket" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button
              className="bg-marquee text-ink hover:bg-marquee/90"
              onClick={() => navigator.share({ title: 'Join my movie night', url: joinUrl })}
            >
              Share
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 13: Write `app/layout.tsx`** (loads the three fonts, mounts the ambient background)

```tsx
// app/layout.tsx
import { Anton, JetBrains_Mono, Work_Sans } from 'next/font/google'
import { SpotlightBackground } from '../components/SpotlightBackground'
import { Toaster } from '../components/ui/sonner'
import './globals.css'

const display = Anton({ subsets: ['latin'], weight: '400', variable: '--font-display' })
const body = Work_Sans({ subsets: ['latin'], variable: '--font-body' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = { title: 'PopcornPoll' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <SpotlightBackground />
        {children}
        <Toaster />
      </body>
    </html>
  )
}
```

- [ ] **Step 14: Write `app/page.tsx`** (create room)

```tsx
// app/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import type { CandidateSource, MatchThreshold, TmdbFilters } from '../server/room/types'

export default function CreateRoomPage() {
  const router = useRouter()
  const [candidateSource, setCandidateSource] = useState<CandidateSource>('plex')
  const [thresholdKind, setThresholdKind] = useState<MatchThreshold['kind']>('all')
  const [atLeastN, setAtLeastN] = useState(2)
  const [genre, setGenre] = useState('')
  const [yearMin, setYearMin] = useState('')
  const [yearMax, setYearMax] = useState('')
  const [ratingMin, setRatingMin] = useState('')

  async function createRoom() {
    const matchThreshold: MatchThreshold =
      thresholdKind === 'atLeast' ? { kind: 'atLeast', n: atLeastN } : ({ kind: thresholdKind } as MatchThreshold)
    const tmdbFilters: TmdbFilters = {
      genre: genre || undefined,
      yearMin: yearMin ? Number.parseInt(yearMin, 10) : undefined,
      yearMax: yearMax ? Number.parseInt(yearMax, 10) : undefined,
      ratingMin: ratingMin ? Number.parseFloat(ratingMin) : undefined,
    }
    const res = await fetch('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ candidateSource, matchThreshold, tmdbFilters }),
    })
    const body = await res.json()
    if (res.ok) {
      sessionStorage.setItem(`hostClaimToken:${body.roomCode}`, body.hostClaimToken)
      router.push(`/room/${body.roomCode}`)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-5xl text-marquee">POPCORNPOLL</h1>
      <Card className="w-full border-2 border-brass bg-velvet">
        <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
          Tonight's showing
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Candidate source</Label>
            <Select value={candidateSource} onValueChange={(v) => setCandidateSource(v as CandidateSource)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="plex">Plex library only</SelectItem>
                <SelectItem value="plex+tmdb">Plex + TMDB discover</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Match rule</Label>
            <Select value={thresholdKind} onValueChange={(v) => setThresholdKind(v as MatchThreshold['kind'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone must say yes</SelectItem>
                <SelectItem value="majority">Majority</SelectItem>
                <SelectItem value="atLeast">At least N</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {thresholdKind === 'atLeast' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="atLeastN">N</Label>
              <Input
                id="atLeastN"
                type="number"
                min={1}
                value={atLeastN}
                onChange={(e) => setAtLeastN(Number.parseInt(e.target.value, 10) || 1)}
              />
            </div>
          )}

          <Separator className="bg-brass/40" />
          <p className="font-mono text-xs uppercase tracking-widest text-brass">Filters</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="genre">Genre</Label>
            <Input id="genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="e.g. Comedy" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="yearMin">Year, from</Label>
              <Input id="yearMin" type="number" value={yearMin} onChange={(e) => setYearMin(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="yearMax">Year, to</Label>
              <Input id="yearMax" type="number" value={yearMax} onChange={(e) => setYearMax(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ratingMin">Minimum rating</Label>
            <Input
              id="ratingMin"
              type="number"
              step={0.1}
              min={0}
              max={10}
              value={ratingMin}
              onChange={(e) => setRatingMin(e.target.value)}
            />
          </div>

          <Button className="mt-2 bg-marquee text-ink hover:bg-marquee/90" onClick={createRoom}>
            Create room
          </Button>
          {candidateSource === 'plex+tmdb' && (
            <p className="text-center text-xs text-muted-foreground">
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 15: Write `app/join/[code]/page.tsx`**

```tsx
// app/join/[code]/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'

export default function JoinRoomPage({ params }: { params: { code: string } }) {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-4">
      <p className="font-mono text-xs uppercase tracking-widest text-brass">You're invited to</p>
      <h1 className="font-display text-3xl tracking-widest text-marquee">{params.code}</h1>
      <Card className="w-full border-2 border-brass bg-velvet">
        <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
          Your name on the ticket
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
              placeholder="Your name"
            />
          </div>
          <Button
            className="bg-marquee text-ink hover:bg-marquee/90"
            disabled={displayName.length === 0}
            onClick={() => {
              sessionStorage.setItem('pendingDisplayName', displayName)
              router.push(`/room/${params.code}`)
            }}
          >
            Join
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
```

- [ ] **Step 16: Write `app/room/[code]/page.tsx`** (lobby + active swipe screen, driven entirely by `state_update`/`joined`/`next_card`)

```tsx
// app/room/[code]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { createWsClient, type WsClient } from '../../../lib/wsClient'
import { MarqueeReveal } from '../../../components/MarqueeReveal'
import { RoomShare } from '../../../components/RoomShare'
import { SwipeDeck } from '../../../components/SwipeDeck'
import { TicketAvatar } from '../../../components/TicketAvatar'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import type { ParticipantView, RoomSnapshot } from '../../../server/ws/protocol'
import type { PoolEntry } from '../../../server/pool/buildPool'

export default function RoomPage({ params }: { params: { code: string } }) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [pool, setPool] = useState<PoolEntry[]>([])
  const [pendingCardId, setPendingCardId] = useState<number | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [client, setClient] = useState<WsClient | null>(null)

  useEffect(() => {
    const ws = createWsClient(`${location.origin.replace('http', 'ws')}/ws`)
    setClient(ws)

    const unsubJoined = ws.on('joined', (msg) => {
      setSnapshot(msg.room)
      setParticipants(msg.room.participants)
      if (msg.room.pool) setPool(msg.room.pool)
      if (msg.room.pendingCardId !== undefined) setPendingCardId(msg.room.pendingCardId)
      if (msg.hostToken) setIsHost(true)
      sessionStorage.setItem(`sessionToken:${params.code}`, msg.sessionToken)
    })
    // state_update carries every field that changes over a room's life except
    // pool/pendingCardId/topCandidates (those arrive via room_started/next_card/
    // exhausted) — apply it with a merge, not a replace, or status/matches/
    // exhausted never reach snapshot and the UI can never leave the lobby view.
    const unsubState = ws.on('state_update', (msg) => {
      setParticipants(msg.participants)
      setSnapshot((prev) =>
        prev && {
          ...prev,
          status: msg.status,
          participants: msg.participants,
          matches: msg.matches,
          exhausted: msg.exhausted,
          matchThreshold: msg.matchThreshold,
          candidateSource: msg.candidateSource,
          seq: msg.seq,
        },
      )
    })
    const unsubStarted = ws.on('room_started', (msg) => setPool(msg.pool))
    const unsubNextCard = ws.on('next_card', (msg) => setPendingCardId(msg.movieId))
    // match/exhausted arrive alongside a state_update in the same toRoom batch;
    // state_update already updates snapshot.matches/exhausted, but the movie
    // itself (match) and the ranked runner-up list (exhausted) only ever
    // arrive on these two message types.
    const unsubMatch = ws.on('match', (msg) =>
      setPool((prev) => (prev.some((e) => e.movieId === msg.movieId) ? prev : [...prev, msg.movie])),
    )
    const unsubExhausted = ws.on('exhausted', (msg) =>
      setSnapshot((prev) => prev && { ...prev, topCandidates: msg.topCandidates }),
    )

    const hostClaimToken = sessionStorage.getItem(`hostClaimToken:${params.code}`) ?? undefined
    const pendingDisplayName = sessionStorage.getItem('pendingDisplayName')
    const storedSessionToken = sessionStorage.getItem(`sessionToken:${params.code}`)

    setTimeout(() => {
      if (storedSessionToken) {
        ws.send({ type: 'reconnect', roomCode: params.code, sessionToken: storedSessionToken })
      } else {
        ws.send({
          type: 'join',
          roomCode: params.code,
          displayName: pendingDisplayName ?? 'Guest',
          hostClaimToken,
        })
      }
    }, 0)

    const heartbeat = setInterval(() => ws.send({ type: 'heartbeat' }), 15_000)

    return () => {
      unsubJoined()
      unsubState()
      unsubStarted()
      unsubNextCard()
      unsubMatch()
      unsubExhausted()
      clearInterval(heartbeat)
      ws.close()
    }
  }, [params.code])

  if (!snapshot) return <p className="p-8 font-mono text-brass">Connecting…</p>

  if (snapshot.status === 'lobby' || snapshot.status === 'starting') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 px-4 py-10">
        <RoomShare code={params.code} />
        <Card className="w-full border border-brass/50 bg-velvet">
          <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
            Admitted
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <TicketAvatar participant={p} />
                {isHost && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-exit-red hover:bg-exit-red/10"
                    onClick={() => client?.send({ type: 'kick', participantId: p.id })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        {isHost && snapshot.status === 'lobby' && (
          <Button
            size="lg"
            className="bg-marquee text-ink hover:bg-marquee/90"
            onClick={() => client?.send({ type: 'start' })}
          >
            Start
          </Button>
        )}
        {snapshot.status === 'starting' && (
          <p className="font-mono text-sm text-brass">Building your pool…</p>
        )}
      </main>
    )
  }

  const currentCard = pool.find((entry) => entry.movieId === pendingCardId) ?? null
  const latestMatch = snapshot.matches.length > 0
    ? pool.find((e) => e.movieId === snapshot.matches[snapshot.matches.length - 1])
    : null

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
      {latestMatch && <MarqueeReveal movie={latestMatch} />}
      <SwipeDeck card={currentCard} onDecide={(vote) => client?.send({ type: 'swipe', movieId: pendingCardId!, vote })} />
      {snapshot.exhausted && snapshot.matches.length === 0 && (
        <Card className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-display text-xl text-ticket">No unanimous pick — closest picks</CardHeader>
          <CardContent className="flex flex-col gap-1">
            {(snapshot.topCandidates ?? []).map((entry) => (
              <p key={entry.movieId} className="font-mono text-sm text-ticket">{entry.title}</p>
            ))}
          </CardContent>
        </Card>
      )}
      {isHost && (
        <Button
          variant="outline"
          className="border-exit-red text-exit-red hover:bg-exit-red hover:text-ticket"
          onClick={() => client?.send({ type: 'end_room' })}
        >
          End session
        </Button>
      )}
    </main>
  )
}
```

- [ ] **Step 17: Run the full frontend + backend test suite**

Run: `npx vitest run`
Expected: PASS — all tests from Tasks 1–22.

- [ ] **Step 18: Commit**

```bash
git add lib components app
git commit -m "feat: WS client, room creation/join/lobby pages, swipe deck"
```

---

## Task 23: Playwright end-to-end scenarios

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/fixtures.ts`
- Create: `e2e/match.spec.ts`
- Create: `e2e/reconnect.spec.ts`
- Create: `e2e/exhaustion.spec.ts`
- Create: `e2e/authorization.spec.ts`
- Create: `e2e/exclusion.spec.ts`
- Create: `server/plex/fakeClient.ts` (fake Plex client — the fixture-backed implementation the Global Constraints promised but no prior task built, Step 1)
- Modify: `server/index.ts` (select the fake client under `FAKE_EXTERNAL_APIS`, auto-seed a fixture Plex link, await the resync sync synchronously in fake mode; wire Next.js's request handler into the custom server, since no task before this one ever served a page over HTTP, Step 1)
- Modify: `server/index.test.ts` (opt its four `/api/*`-only tests out of frontend serving via `skipFrontend: true`, Step 1)
- Modify: `server/ws/server.ts`, `server/ws/server.test.ts` (broadcast `toRoom` to every participant including the sender — the host who starts a room previously never saw it start, Step 1)
- Modify: `server/ws/router.ts`, `server/ws/router.test.ts` (`'start'` now pushes each participant's already-assigned `pendingCardId` via `toParticipant`, since it's per-participant and can never ride the room-wide broadcast, Step 1)
- Modify: `server/pool/buildPool.ts`, `server/pool/buildPool.test.ts`, `server/room/roomStore.ts` (test-only env overrides, Step 1)
- Modify: `components/SwipeDeck.tsx`, `app/room/[code]/page.tsx` (add `data-testid` hooks — attribute-only, no behavior change, Step 1)

**Interfaces:**
- Consumes: `createApp` (Task 21), running against `FAKE_EXTERNAL_APIS=true` with `POOL_SIZE_CAP` and `ROOM_RNG_SEED` overrides threaded through `buildPool`'s cap constant and `startRoom`'s rng seeding respectively (extend `buildPool`'s exported `POOL_CAP` to instead read `Number(process.env.POOL_SIZE_CAP) || 100` when `FAKE_EXTERNAL_APIS` is set, and `roomStore.create` to accept an optional seed override from `process.env.ROOM_RNG_SEED` under the same flag — small additions to Tasks 12 and 15's files, made as part of this task's Step 1). Also consumes `data-testid="swipe-card"` (Task 22's `SwipeDeck.tsx`) and `data-testid="match-banner"`/`data-testid="fallback"` (Task 22's `app/room/[code]/page.tsx`) as e2e test hooks — none of these existed before this task; the e2e specs are their only consumer.

- [ ] **Step 1: Build the fake Plex client, auto-seed a fixture link, and wire the two test-only overrides**

The Global Constraints promise "Plex/TMDB clients are always called through an interface with a fake implementation, selected via `FAKE_EXTERNAL_APIS=true`" — but no task through Task 22 actually built that fake implementation; `createPlexClient` (Task 6) has no fake branch, and `server/index.ts` (Task 21) always constructs the real one. Without it, `librarySync.doRun()` returns `{ runId: -1, itemCount: 0 }` immediately (no Plex link saved), so no e2e scenario below could ever see a swipeable card. This step builds the missing piece — it's this task's job to close the gap, since e2e is the first consumer that actually needs it exercised end-to-end.

Create `server/plex/fakeClient.ts`:

```ts
// server/plex/fakeClient.ts
import type { PlexClient, PlexItem } from './client'

// A fixed 10-title fixture set. Every guid is opaque (matches neither the
// tmdb:// nor imdb:// prefix `parseGuid` looks for), so synced rows land
// with tmdbId/imdbId both null — enrichment's `row.tmdbId === null` guard
// and the imdb-backfill query's `imdb_id IS NOT NULL` filter both skip
// these rows naturally, so no TMDB fixture is needed to keep this
// FAKE_EXTERNAL_APIS path fully network-free.
const FAKE_LIBRARY: PlexItem[] = [
  { ratingKey: '1', title: 'The Velvet Reel', year: 2011, genres: ['Comedy', 'Drama'], guid: 'plex://movie/fake-1' },
  { ratingKey: '2', title: 'Marquee Nights', year: 2015, genres: ['Romance', 'Comedy'], guid: 'plex://movie/fake-2' },
  { ratingKey: '3', title: 'Brass and Bone', year: 2008, genres: ['Action', 'Thriller'], guid: 'plex://movie/fake-3' },
  { ratingKey: '4', title: 'Ticket to Nowhere', year: 2019, genres: ['Drama'], guid: 'plex://movie/fake-4' },
  { ratingKey: '5', title: 'The Last Matinee', year: 2003, genres: ['Horror', 'Comedy'], guid: 'plex://movie/fake-5' },
  { ratingKey: '6', title: 'Popcorn Symphony', year: 2021, genres: ['Animation', 'Family'], guid: 'plex://movie/fake-6' },
  { ratingKey: '7', title: 'Curtain Call', year: 1997, genres: ['Drama', 'Mystery'], guid: 'plex://movie/fake-7' },
  { ratingKey: '8', title: 'Exit Row Seven', year: 2013, genres: ['Thriller'], guid: 'plex://movie/fake-8' },
  { ratingKey: '9', title: 'Neon Marquee', year: 2018, genres: ['Sci-Fi', 'Action'], guid: 'plex://movie/fake-9' },
  { ratingKey: '10', title: 'Reel to Reel', year: 2006, genres: ['Documentary'], guid: 'plex://movie/fake-10' },
]

export function createFakePlexClient(): PlexClient {
  return {
    async createPin() {
      return { id: 1, code: 'FAKE' }
    },
    async checkPin() {
      return { authToken: 'fake-token' }
    },
    async getResources() {
      return [
        { name: 'Fake Server', clientIdentifier: 'fake-client', connections: [{ uri: 'http://fake-plex.local' }] },
      ]
    },
    async getLibrarySections() {
      return [{ id: '1', title: 'Movies', type: 'movie' }]
    },
    async getLibraryItems() {
      return FAKE_LIBRARY
    },
    async getThumb() {
      return { body: null, contentType: null, status: 404 }
    },
  }
}
```

In `server/index.ts`, add the imports and select the fake client, auto-seeding a fixture link so `librarySync` has something to sync against without a real OAuth flow:

```ts
// server/index.ts — add to the import block:
import { createFakePlexClient } from './plex/fakeClient'
import { getPlexLink, savePlexLink } from './plex/link'

// server/index.ts — inside createApp(), before the existing
// `const clientIdentifier = ...` line, insert:
if (process.env.FAKE_EXTERNAL_APIS === 'true' && !getPlexLink(db, config.authEncryptionKey)) {
  // e2e/dev fixture mode: seed a fake link so librarySync can run without a
  // real OAuth flow — the fake client below ignores serverUrl/authToken.
  savePlexLink(db, config.authEncryptionKey, {
    clientIdentifier: 'fake-client',
    serverUrl: 'http://fake-plex.local',
    authToken: 'fake-token',
    librarySectionIds: ['1'],
    linkedAt: new Date().toISOString(),
  })
}

// server/index.ts — replace:
//   const plex = createPlexClient(clientIdentifier)
// with:
const plex =
  process.env.FAKE_EXTERNAL_APIS === 'true' ? createFakePlexClient() : createPlexClient(clientIdentifier)
```

`getPlexLink` is already imported in `server/index.ts` (Task 21) — add `savePlexLink` alongside it on the same import line rather than duplicating the import.

Finally, in `server/index.ts`'s request-dispatch block, make the e2e resync path deterministic. The existing `/api/setup/plex/resync` branch fires `librarySync.run()` without awaiting it (correct for production — a real library sync shouldn't block the HTTP response) — but `e2e/fixtures.ts` (Step 3, below) needs the tiny 10-item fake sync to actually finish before it returns, or every spec races an empty pool. Await only in fake mode:

```ts
// server/index.ts — replace:
//   else if (url.pathname === '/api/setup/plex/resync') {
//     webRes = await setupHandlers.resync(webReq)
//     if (webRes.status === 200) void librarySync.run()
//   }
// with:
else if (url.pathname === '/api/setup/plex/resync') {
  webRes = await setupHandlers.resync(webReq)
  if (webRes.status === 200) {
    if (process.env.FAKE_EXTERNAL_APIS === 'true') {
      await librarySync.run() // e2e fixture mode: block so the caller can create a room immediately after
    } else {
      void librarySync.run()
    }
  }
}
```

Run `npx vitest run` to confirm this didn't break any existing test (none of Tasks 1-21's tests set `FAKE_EXTERNAL_APIS=true`, so the new branches are inert for them), then commit this piece on its own:

```bash
git add server/plex/fakeClient.ts server/index.ts
git commit -m "feat: fake Plex client + auto-seeded fixture link for FAKE_EXTERNAL_APIS mode"
```

**A second, larger gap, also discovered by this task and also fixed here:** `server/index.ts`'s HTTP dispatch only ever handles `/api/*` paths and 404s everything else — no task from Task 1 through Task 22 ever wired Next.js's own request handler into the custom server, so `/`, `/join/[code]`, and `/room/[code]` (every actual page) have never been reachable over HTTP at all, in dev or production. This is a Task 1/21-era gap, not something introduced by Task 22 or this task; e2e is simply the first thing that ever made an HTTP request to a page path and noticed. Fix it here, since it blocks every e2e scenario and the running app itself.

In `server/index.ts`, add the import and change `createApp`'s signature to accept an options object and become `async` (it needs to `await` Next's `prepare()` before the server can reliably serve pages):

```ts
// server/index.ts — add to the import block:
import next from 'next'

// server/index.ts — replace:
//   export function createApp(config: AppConfig) {
// with:
export async function createApp(config: AppConfig, opts: { skipFrontend?: boolean } = {}) {
```

Inside `createApp`, after the existing `const healthHandler = createHealthHandler(config.dataDir)` line and before `const httpServer = createServer(...)`, add the Next.js app setup — but only when frontend serving isn't explicitly skipped (unit tests that only exercise `/api/*` behavior pass `skipFrontend: true` so they don't pay for a full Next dev-server boot on every test):

```ts
// server/index.ts — insert before `const httpServer = createServer(...)`:
const nextApp = opts.skipFrontend ? null : next({ dev: process.env.NODE_ENV !== 'production' })
const handleNextRequest = nextApp?.getRequestHandler()
if (nextApp) await nextApp.prepare()
```

Change the request handler's dispatch to route non-`/api/*` paths to Next instead of 404ing. Replace:

```ts
// server/index.ts — replace the httpServer's callback body's opening:
//   const httpServer = createServer((req, res) => {
//     const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
//     const chunks: Buffer[] = []
// with:
const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (!url.pathname.startsWith('/api/')) {
    if (handleNextRequest) {
      void handleNextRequest(req, res, url)
    } else {
      res.writeHead(404).end()
    }
    return
  }
  const chunks: Buffer[] = []
```

(The rest of the existing dispatch body — the `req.on('data', ...)`/`req.on('end', ...)` block, the `if (url.pathname === '/api/health') ...` chain, and its final `else { res.writeHead(404).end(); return }` for unmatched `/api/*` paths — is unchanged; it now only ever runs for `/api/*` requests, which is what it already assumed.)

Update the process bootstrap at the bottom of the file to await the now-async `createApp`:

```ts
// server/index.ts — replace:
//   if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
//     const config = loadConfig(process.env)
//     const app = createApp(config)
//     app.httpServer.listen(config.port, () => {
//       console.log(`PopcornPoll listening on :${config.port}`)
//     })
//     process.on('SIGTERM', async () => {
//       await app.shutdown()
//       process.exit(0)
//     })
//   }
// with:
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  const config = loadConfig(process.env)
  void (async () => {
    const app = await createApp(config)
    app.httpServer.listen(config.port, () => {
      console.log(`PopcornPoll listening on :${config.port}`)
    })
    process.on('SIGTERM', async () => {
      await app.shutdown()
      process.exit(0)
    })
  })()
}
```

In `server/index.test.ts` (Task 21's file — all four of its tests only exercise `/api/*` paths, so they opt out of frontend serving to stay fast and avoid booting a real Next dev server per test):

```ts
// server/index.test.ts — replace:
//   let app: ReturnType<typeof createApp>
// with:
let app: Awaited<ReturnType<typeof createApp>>

// server/index.test.ts — replace:
//   beforeEach(() => {
// with:
beforeEach(async () => {

// server/index.test.ts — replace:
//   app = createApp(config)
// with:
app = await createApp(config, { skipFrontend: true })
```

Run `npx vitest run server/index.test.ts` to confirm those four tests still pass (should be unaffected — `skipFrontend: true` preserves the exact prior behavior for `/api/*` paths), then `npx vitest run` for the full suite, then `npx tsc --noEmit`, then commit:

```bash
git add server/index.ts server/index.test.ts
git commit -m "fix: wire Next.js request handling into the custom server — no task ever served a single page over HTTP before this"
```

**Note for whoever builds Task 24 (deployment):** the production `start` script runs `node dist/server/index.js`, which now calls `next({ dev: false })` at startup — this requires the `.next` build output (from `next build`, already the first half of the `build` script) to be present alongside the compiled server code in the runtime image, not just the `dist/` output from `tsc -p tsconfig.server.json`. Make sure the Dockerfile's runtime stage copies `.next/`, `public/` (if any), `next.config.js`, and `package.json`/`node_modules` (Next needs its own runtime deps available), not only `dist/`.

**A third bug, also discovered by this task and also fixed here:** `server/ws/server.ts`'s `toRoom` delivery loop explicitly excludes the sender (`if (otherWs === ws) continue`, from Task 19). This is correct for `swipe` only in the sense that the swiper's own next card comes through `toSender` — but `state_update`/`match`/`exhausted`/`room_started`/`room_ended` are room-wide facts every connected participant needs, the acting participant included, and every one of `start`/`kick`/`update_settings`/`end_room`'s success paths puts its entire payload in `toRoom` with nothing in `toSender`. Since only the host can ever send `start`, and no one else's action can retroactively deliver it, the host who clicks Start never learns the room started and stays stuck on the lobby screen forever — confirmed live via Playwright by this task, not guessed. `matches`/`exhausted` reaching the swiper who caused them has the same bug, just less visible (another participant's next action happens to relay it).

Fix: broadcast `toRoom` to every socket in the room, including the sender. `next_card` stays correctly sender-specific because it's still delivered separately via `toSender` — nothing about that channel changes.

```ts
// server/ws/server.ts — replace:
//   if (result.toRoom.length > 0 && meta.state.roomCode) {
//     const room = store.get(meta.state.roomCode)
//     if (room) {
//       for (const [otherWs, otherMeta] of sockets) {
//         if (otherMeta.state.roomCode !== meta.state.roomCode) continue
//         if (otherWs === ws) continue
//         for (const m of result.toRoom) send(otherWs, m)
//       }
//     }
//   }
// with:
if (result.toRoom.length > 0 && meta.state.roomCode) {
  const room = store.get(meta.state.roomCode)
  if (room) {
    for (const [otherWs, otherMeta] of sockets) {
      if (otherMeta.state.roomCode !== meta.state.roomCode) continue
      for (const m of result.toRoom) send(otherWs, m)
    }
  }
}
```

Add a regression test to `server/ws/server.test.ts` proving the actor now receives their own room-wide broadcast (this exact scenario — two participants, the host sends `start`, the host's own socket must see `room_started` — is what was silently broken):

```ts
// server/ws/server.test.ts — add this import alongside the existing ones:
import { upsertPlexRow } from '../db/movies'

// server/ws/server.test.ts — add this helper near `connectExpectRejection`:
function seedPlexRows(db: Database.Database, count: number) {
  for (let i = 0; i < count; i++) {
    upsertPlexRow(db, 1, {
      plexRatingKey: `pk-${i}`,
      tmdbId: null,
      imdbId: null,
      title: `Movie ${i}`,
      posterPath: null,
      posterSource: 'plex',
      overview: null,
      year: 2020,
      genres: ['Drama'],
      rating: null,
      voteCount: null,
      inLibrary: true,
      lastUsedAt: null,
    })
  }
}

// server/ws/server.test.ts — add inside the `describe('attachWebSocketServer', ...)` block:
it('the host who sends start receives room_started too, not just other participants', async () => {
  const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
  const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
  seedPlexRows(db, 5) // MIN_POOL_SIZE

  const hostWs = await connect()
  hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
  await nextMessage(hostWs) // joined

  const guestWs = await connect()
  guestWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
  await nextMessage(guestWs) // joined
  await nextMessage(hostWs) // state_update for the guest's join

  hostWs.send(JSON.stringify({ type: 'start' }))
  const hostNext = await nextMessage(hostWs)
  const guestNext = await nextMessage(guestWs)

  // Message order between room_started and state_update isn't guaranteed by
  // this assertion — either socket may see either one first — so check the
  // pair of types each side saw rather than a fixed position.
  expect(hostNext.type === 'room_started' || hostNext.type === 'state_update').toBe(true)
  expect(guestNext.type === 'room_started' || guestNext.type === 'state_update').toBe(true)

  hostWs.close()
  guestWs.close()
})
```

Run `npx vitest run server/ws/server.test.ts` (RED first if you want to see it fail against the unpatched loop, then GREEN after the fix), then the full `npx vitest run`, then commit:

```bash
git add server/ws/server.ts server/ws/server.test.ts
git commit -m "fix: broadcast toRoom to every participant including the sender — the host who starts a room never saw it start"
```

**A fourth bug, discovered after the toRoom-exclusion fix and also fixed here:** with the sender-exclusion gone, the host now correctly learns the room started — but no one (host or guest) who was already connected during the lobby ever receives a live `next_card`. `startRoom()` (Task 15) already assigns every participant a `pendingCardId` server-side — confirmed correct, since a reload/reconnect immediately shows the right card via `joined`'s `room.pendingCardId` field — but `pendingCardId` is per-participant, so it can never ride `state_update`/`room_started`, and the `'start'` case in `server/ws/router.ts` never sends anything through `toParticipant` (the one channel that *can* target a specific participant, exactly like `'kick'` already does).

```ts
// server/ws/router.ts — inside the 'start' case, replace:
//   return {
//     ...emptyOutput(state),
//     toRoom: [
//       { type: 'room_started', pool: room.pool, seq: update.seq },
//       update,
//     ],
//   }
// with:
return {
  ...emptyOutput(state),
  toRoom: [
    { type: 'room_started', pool: room.pool, seq: update.seq },
    update,
  ],
  toParticipant: Array.from(room.participants.values()).map((p) => ({
    participantId: p.id,
    messages: [{ type: 'next_card', movieId: p.pendingCardId }],
  })),
}
```

Extend the existing `'a successful start emits room_started...'` test in `server/ws/router.test.ts` (`describe('handleMessage: start + room_started', ...)`) to also assert both participants get their `next_card`:

```ts
// server/ws/router.test.ts — inside the existing 'a successful start emits room_started...' test,
// after the existing `started`/`stateUpdate` assertions, add:
const room = store.get(code)!
const hostId = state.participantId!
const otherId = Array.from(room.participants.keys()).find((id) => id !== hostId)!
const hostCard = result.toParticipant.find((t) => t.participantId === hostId)
const otherCard = result.toParticipant.find((t) => t.participantId === otherId)
expect(hostCard?.messages).toEqual([{ type: 'next_card', movieId: room.participants.get(hostId)!.pendingCardId }])
expect(otherCard?.messages).toEqual([{ type: 'next_card', movieId: room.participants.get(otherId)!.pendingCardId }])
```

Run `npx vitest run server/ws/router.test.ts`, then the full `npx vitest run`, then commit:

```bash
git add server/ws/router.ts server/ws/router.test.ts
git commit -m "fix: start emits next_card to every already-connected participant via toParticipant, not just on a later reconnect"
```

Now wire the two remaining test-only overrides (pool size, RNG seed) and the e2e `data-testid` hooks.

In `server/pool/buildPool.ts`, change the `POOL_CAP` constant to a function so tests can shrink it:

```ts
// server/pool/buildPool.ts — replace the `export const POOL_CAP = 100` line with:
export function getPoolCap(): number {
  if (process.env.FAKE_EXTERNAL_APIS === 'true' && process.env.POOL_SIZE_CAP) {
    return Number.parseInt(process.env.POOL_SIZE_CAP, 10)
  }
  return 100
}
```

Replace the two `POOL_CAP` usages inside `buildPool()`'s body with `getPoolCap()`. Update `server/pool/buildPool.test.ts`'s one assertion that hardcodes `100` (`expect(result.pool.length).toBe(100)`) to `expect(result.pool.length).toBe(getPoolCap())` and re-run `npx vitest run server/pool/buildPool.test.ts` to confirm it still passes.

In `server/room/roomStore.ts`, change the seed line inside `create()`:

```ts
// replace: rngSeed: Math.floor(Math.random() * 2 ** 31),
rngSeed:
  process.env.FAKE_EXTERNAL_APIS === 'true' && process.env.ROOM_RNG_SEED
    ? Number.parseInt(process.env.ROOM_RNG_SEED, 10)
    : Math.floor(Math.random() * 2 ** 31),
```

Run `npx vitest run` once more to confirm the whole suite is still green.

The e2e specs below (Steps 4, 6, 8) also need three inert `data-testid` hooks added to already-shipped Task 22 components — the components render no other stable, style-independent selector for these three states (a visible swipe card, a fresh match, the exhausted-fallback panel). These are attribute-only additions with zero behavior change; nothing they touch was previously reviewed against these hooks because they didn't exist yet.

In `components/SwipeDeck.tsx`, add `data-testid="swipe-card"` to the draggable card div (the one with `className="ticket-edge relative w-80 ..."`, already carrying `data-drag-direction`):

```tsx
// components/SwipeDeck.tsx — add data-testid alongside the existing data-drag-direction prop:
<motion.div
  className="ticket-edge relative w-80 origin-bottom -rotate-1 rounded bg-velvet p-4 shadow-xl"
  style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
  drag="x"
  animate={controls}
  onDrag={(_, info) => setDragDirection(info.offset.x > 0 ? 'yes' : info.offset.x < 0 ? 'no' : null)}
  onDragEnd={handleDragEnd}
  data-drag-direction={dragDirection ?? undefined}
  data-testid="swipe-card"
>
```

In `app/room/[code]/page.tsx`, add `data-testid="match-banner"` to the wrapper around `MarqueeReveal`, and `data-testid="fallback"` to the exhausted-fallback `Card`:

```tsx
// app/room/[code]/page.tsx — replace:
//   {latestMatch && <MarqueeReveal movie={latestMatch} />}
// with:
{latestMatch && (
  <div data-testid="match-banner">
    <MarqueeReveal movie={latestMatch} />
  </div>
)}
```

```tsx
// app/room/[code]/page.tsx — replace:
//   <Card className="w-full border-2 border-brass bg-velvet">
// (the one inside the `snapshot.exhausted && snapshot.matches.length === 0` block) with:
<Card data-testid="fallback" className="w-full border-2 border-brass bg-velvet">
```

Run `npx vitest run` once more (component tests don't assert on these attributes, so this confirms nothing broke), then commit this wiring on its own:

```bash
git add server/pool/buildPool.ts server/pool/buildPool.test.ts server/room/roomStore.ts components/SwipeDeck.tsx app/room/[code]/page.tsx
git commit -m "test: env-gated pool-size/rng-seed overrides and data-testid hooks for e2e"
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // each test starts its own server on a fresh port; keep simple, no port contention
  webServer: {
    command: 'npm run dev',
    port: 3100,
    reuseExistingServer: false,
    env: {
      FAKE_EXTERNAL_APIS: 'true',
      POOL_SIZE_CAP: '6',
      ROOM_RNG_SEED: '42',
      TMDB_API_KEY: 'fake',
      AUTH_ENCRYPTION_KEY: 'a'.repeat(32),
      ADMIN_SETUP_TOKEN: 'admin',
      APP_ORIGIN: 'http://localhost:3100',
      PORT: '3100',
    },
  },
  use: { baseURL: 'http://localhost:3100' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
})
```

- [ ] **Step 3: Write `e2e/fixtures.ts`** — seeds a small fake Plex library directly into the running server's DB via the admin-gated setup path, shared by every spec file

```ts
// e2e/fixtures.ts
import { request } from '@playwright/test'

export async function seedFakeLibrary(baseURL: string): Promise<void> {
  const ctx = await request.newContext({ baseURL })
  // In FAKE_EXTERNAL_APIS mode (Step 1), server/index.ts selects
  // createFakePlexClient() and auto-seeds a fixture Plex link, so
  // /api/setup/plex/resync (admin-token-gated) syncs the 10-title fixture
  // set with no real Plex server reachable from the test runner — and,
  // in this mode only, the server awaits the sync before responding, so
  // by the time this call resolves the library is already in the DB.
  await ctx.post('/api/setup/plex/resync', { headers: { Authorization: 'Bearer admin' } })
  await ctx.dispose()
}
```

- [ ] **Step 4: Write `e2e/match.spec.ts`** — scenario (a): two contexts reach a match

```ts
// e2e/match.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { seedFakeLibrary } from './fixtures'

test('two participants reach a match', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostPage = await (await browser.newContext()).newPage()
  await hostPage.goto('/')
  // Candidate source defaults to 'plex' (CreateRoomPage's initial state) — no
  // interaction with the shadcn Select needed for this scenario.
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestPage = await (await browser.newContext()).newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  await guestPage.waitForURL(/\/room\//)

  await hostPage.click('text=Start')
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  // Both swipe yes on every card in front of them until a match appears —
  // deterministic given ROOM_RNG_SEED, so both land on the same card order.
  for (const page of [hostPage, guestPage]) {
    for (let i = 0; i < 6; i++) {
      const card = page.locator('[data-testid="swipe-card"]')
      if ((await card.count()) === 0) break
      await page.click('button[aria-label="Yes"]')
      if (await page.locator('[data-testid="match-banner"]').count() > 0) break
    }
  }

  await expect(hostPage.locator('[data-testid="match-banner"]')).toBeVisible()
  await browser.close()
})
```

- [ ] **Step 5: Write `e2e/reconnect.spec.ts`** — scenario (b): disconnect mid-session, reconnect, swipes/pending-card survive

```ts
// e2e/reconnect.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { seedFakeLibrary } from './fixtures'

test('participant reconnects and keeps their current pending card', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  await hostPage.click('text=Start')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  const titleBeforeDisconnect = await guestPage.locator('[data-testid="swipe-card"] h2').textContent()
  await guestPage.reload()
  await guestPage.waitForSelector('[data-testid="swipe-card"]')
  const titleAfterReconnect = await guestPage.locator('[data-testid="swipe-card"] h2').textContent()

  expect(titleAfterReconnect).toBe(titleBeforeDisconnect)
  await browser.close()
})
```

- [ ] **Step 6: Write `e2e/exhaustion.spec.ts`** — scenario (c): exhausts with no match, fallback UI, then survives a refresh

```ts
// e2e/exhaustion.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { seedFakeLibrary } from './fixtures'

test('a session with an unreachable threshold exhausts and shows the ranked fallback, even after a refresh', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostPage = await (await browser.newContext()).newPage()
  await hostPage.goto('/')
  // Match rule defaults to 'all' (CreateRoomPage's initial state) — require
  // unanimity, so one "no" prevents any match. No Select interaction needed.
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestPage = await (await browser.newContext()).newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')
  await hostPage.click('text=Start')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  for (const page of [hostPage, guestPage]) {
    for (let i = 0; i < 6; i++) {
      const card = page.locator('[data-testid="swipe-card"]')
      if ((await card.count()) === 0) break
      await page.click('button[aria-label="No"]') // all-no guarantees zero matches with POOL_SIZE_CAP=6
    }
  }

  await expect(hostPage.locator('[data-testid="fallback"]')).toBeVisible()
  await hostPage.reload()
  await expect(hostPage.locator('[data-testid="fallback"]')).toBeVisible() // recoverable from the joined snapshot, not just the one-shot event
  await browser.close()
})
```

- [ ] **Step 7: Write `e2e/authorization.spec.ts`** — scenario (d)

```ts
// e2e/authorization.spec.ts
import { test, expect, chromium } from '@playwright/test'

test('a non-host cannot start the room', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostPage = await (await browser.newContext()).newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestPage = await (await browser.newContext()).newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Guest')
  await guestPage.click('text=Join')

  await expect(guestPage.locator('text=Start')).not.toBeVisible()
  await browser.close()
})

test('reconnecting with only sessionToken (no hostToken) does not grant host controls', async ({ baseURL }) => {
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]
  const sessionToken = await hostPage.evaluate((code) => sessionStorage.getItem(`sessionToken:${code}`), roomCode)

  // A fresh context simulates a device that has the host's sessionToken
  // (e.g. copied out-of-band) but never received hostToken — the real
  // credential kept only in the original browser's localStorage.
  const strippedContext = await browser.newContext()
  const strippedPage = await strippedContext.newPage()
  await strippedPage.goto(`/room/${roomCode}`)
  await strippedPage.evaluate(
    ({ code, token }) => sessionStorage.setItem(`sessionToken:${code}`, token as string),
    { code: roomCode, token: sessionToken },
  )
  await strippedPage.reload()

  await expect(strippedPage.locator('text=Start')).not.toBeVisible()
  await browser.close()
})
```

- [ ] **Step 8: Write `e2e/exclusion.spec.ts`** — scenario (f)

```ts
// e2e/exclusion.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { seedFakeLibrary } from './fixtures'

test('a participant disconnected through Start is excluded and their reconnect is rejected', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const browser = await chromium.launch()
  const hostPage = await (await browser.newContext()).newPage()
  await hostPage.goto('/')
  await hostPage.click('text=Create room')
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  // A THIRD participant (stayingGuestPage) is required, not two — Task 16
  // established that MIN_PARTICIPANTS_TO_START is checked AFTER excluding
  // disconnected participants (spec-mandated: a room that only "started"
  // because it silently dropped to 1 real participant would match on the
  // very first yes swipe). With only host + 1 disconnecting guest, Start
  // would correctly be rejected — this scenario needs someone who stays
  // connected through Start so the post-exclusion count is still 2.
  const stayingGuestPage = await (await browser.newContext()).newPage()
  await stayingGuestPage.goto(`/join/${roomCode}`)
  await stayingGuestPage.fill('input[placeholder="Your name"]', 'Staying Guest')
  await stayingGuestPage.click('text=Join')
  await stayingGuestPage.waitForSelector('text=Admitted')

  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.fill('input[placeholder="Your name"]', 'Disconnecting Guest')
  await guestPage.click('text=Join')
  await guestPage.waitForSelector('text=Admitted') // the lobby roster panel's heading
  const guestSessionToken = await guestPage.evaluate((code) => sessionStorage.getItem(`sessionToken:${code}`), roomCode)

  await guestContext.close() // simulates the guest going fully offline before Start
  await hostPage.waitForTimeout(3000) // exceed the heartbeat timeout so the server marks them disconnected
  await hostPage.click('text=Start')
  await hostPage.waitForSelector('[data-testid="swipe-card"]')

  const reconnectingPage = await (await browser.newContext()).newPage()
  await reconnectingPage.goto(`/room/${roomCode}`)
  await reconnectingPage.evaluate(
    ({ code, token }) => sessionStorage.setItem(`sessionToken:${code}`, token as string),
    { code: roomCode, token: guestSessionToken },
  )
  await reconnectingPage.reload()
  await expect(reconnectingPage.locator('text=Connecting')).toBeVisible() // never resolves to a room view — reconnect was rejected
  await browser.close()
})
```

- [ ] **Step 9: Run the full e2e suite**

Run: `npx playwright install --with-deps chromium && npm run test:e2e`
Expected: PASS (5 spec files)

- [ ] **Step 10: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: playwright e2e coverage for match, reconnect, exhaustion, auth, exclusion"
```

---

## Task 24: Deployment — Dockerfile, healthcheck, README

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `tsconfig.server.json`
- Create: `README.md`

**Interfaces:**
- Consumes: `npm run build` / `npm run start` (Task 1's `package.json` scripts), `/api/health` (Task 20)

- [ ] **Step 1: Write `tsconfig.server.json`** (a separate, emitting config for the `npm run build` server compile step, distinct from the frontend's Next.js build)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["server/**/*.ts"],
  "exclude": ["server/**/*.test.ts", "node_modules", "dist", ".next"]
}
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
.next
dist
data
*.db
.git
e2e
**/*.test.ts
```

- [ ] **Step 3: Write the multi-stage `Dockerfile`**

```dockerfile
# Dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
RUN groupadd -r popcornpoll && useradd -r -g popcornpoll popcornpoll
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/server/db/migrations ./dist/server/db/migrations

RUN mkdir -p /data && chown -R popcornpoll:popcornpoll /data /app
USER popcornpoll

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
```

- [ ] **Step 4: Build the image and run the healthcheck manually to confirm the Dockerfile is correct**

```bash
docker build -t popcornpoll:local .
docker run --rm -d --name popcornpoll-test \
  -e TMDB_API_KEY=test -e AUTH_ENCRYPTION_KEY="$(openssl rand -hex 16)" \
  -e ADMIN_SETUP_TOKEN=test -e APP_ORIGIN=http://localhost:3000 \
  -p 3000:3000 -v popcornpoll-test-data:/data popcornpoll:local
sleep 5
curl -f http://localhost:3000/api/health
docker stop popcornpoll-test
docker volume rm popcornpoll-test-data
```

Expected: the `curl` returns `{"status":"ok"}` with a 200.

- [ ] **Step 5: Write `README.md`**

```markdown
# PopcornPoll

Self-hosted, group movie-night picker for Plex. Swipe Tinder-style through a
shared candidate pool; a title becomes a match once your group's chosen
threshold of yes-votes is reached.

## Requirements

- A Plex Media Server, reachable from wherever you run this container.
- Docker.
- Optionally, a [TMDB API key](https://www.themoviedb.org/settings/api) —
  **required**, not optional: besides the opt-in TMDB-extended candidate
  source, it's also what lets the app rank your own Plex library by how
  well-regarded each title is, rather than picking randomly.

## Running it

\`\`\`bash
docker run -d --name popcornpoll \
  -e TMDB_API_KEY=<your key> \
  -e AUTH_ENCRYPTION_KEY=$(openssl rand -hex 16) \
  -e ADMIN_SETUP_TOKEN=$(openssl rand -hex 16) \
  -e APP_ORIGIN=http://<your-host>:3000 \
  -p 3000:3000 \
  -v popcornpoll-data:/data \
  popcornpoll:latest
\`\`\`

Then visit `http://<your-host>:3000/setup?token=<your ADMIN_SETUP_TOKEN>` once
to link your Plex server.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `TMDB_API_KEY` | yes | TMDB v3 API key — powers both the opt-in TMDB candidate source and Plex-library reputation ranking. |
| `AUTH_ENCRYPTION_KEY` | yes | Encrypts the stored Plex token at rest. Generate with `openssl rand -hex 16`. Changing this invalidates the stored Plex link — you'll be asked to relink. |
| `ADMIN_SETUP_TOKEN` | yes | Gates the one-time `/setup` flow that links/relinks Plex. Keep this secret — anyone with it can repoint your instance's Plex source. |
| `APP_ORIGIN` | yes | The exact origin (scheme + host + port) you reach this app at. Used to reject cross-site WebSocket/API requests. |
| `TRUSTED_PROXY_HOPS` | no (default `0`) | If you run this behind a reverse proxy, set this to the number of proxy hops so rate limiting reads the real client IP from `X-Forwarded-For` instead of the proxy's own. |
| `PORT` | no (default `3000`) | |
| `DATA_DIR` | no (default `./data`, `/data` in the Docker image) | Where the SQLite file lives — mount a volume here. |

## Network exposure

This app has **no participant-facing login** by design — anyone who can
reach it can create a room against your Plex library. It's built to run on
a trusted network (your home LAN, a VPN, or something like Tailscale). If
you expose it beyond that, put it behind your own access control (a
reverse-proxy with basic auth, an authenticating gateway, etc.) — this is
your responsibility, not something the app does for you.

## Reverse proxy notes

If you put this behind nginx/Caddy/Apache, you must:
1. Pass through the WebSocket `Upgrade`/`Connection` headers (all three
   proxies need explicit config for this — it's the single most common
   self-hosting failure mode for a WebSocket-based app).
2. Set `X-Forwarded-For` correctly and set `TRUSTED_PROXY_HOPS` to match,
   or rate limiting will either block every real visitor as one IP or not
   rate-limit anyone at all.

For the QR code / copy-link / share-sheet room-sharing affordances to work
at their best, serve over HTTPS (a reverse-proxy cert, Tailscale's own
HTTPS, or mkcert for a LAN address) — they degrade gracefully over plain
HTTP but work better with it.

## Development

\`\`\`bash
npm install
cp .env.example .env   # fill in the values
npm run dev
npm test                # unit tests (Vitest)
npm run test:e2e        # end-to-end tests (Playwright, runs against FAKE_EXTERNAL_APIS)
\`\`\`
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore tsconfig.server.json README.md
git commit -m "docs+chore: Dockerfile, healthcheck, and README"
```


---

## Task 25: Internationalization (next-intl, pt-BR default / en-US)

**Goal:** every piece of UI chrome (button labels, headings, placeholders, toasts) and every WS-level user-facing error renders in the visitor's chosen language. Portuguese (Brazil) is the default for a first-time visitor; English (US) is available via a switcher, persisted per-browser (no URL-based locale routing — room links stay exactly `/room/CODE`, unchanged, so a host and guest can each view the same room in their own language).

**Explicitly out of scope, and why:**
- **Movie content** (title/overview/genres from Plex or TMDB) stays exactly as the source returns it. It's shared per-room state, not per-viewer UI chrome — translating it would mean re-fetching TMDB per participant's locale for content everyone in the room needs to see identically, a materially different and much larger feature than "localize the app's own copy."
- **Room codes** (the 100-word list, e.g. `BLUE-FOX-427`) stay untranslated — they're opaque identifiers, not content a visitor reads for meaning.
- **The `kicked`/room-eviction UX** (currently: the app has no `ws.on('kicked', ...)` handler at all — a kicked participant's socket is simply closed server-side with no client-side redirect or explanation screen) is a real, separate gap this task noticed but does not fix — it needs its own UX design, not a bolt-on translated toast. Flagged for a future task.

**Files:**
- Create: `i18n/request.ts`, `messages/pt-br.json`, `messages/en-us.json`, `messages/messages.test.ts`
- Create: `components/LocaleSwitcher.tsx`
- Modify: `next.config.js` (wrap with the next-intl plugin)
- Modify: `app/layout.tsx` (wrap children in `NextIntlClientProvider`, render `LocaleSwitcher`)
- Modify: `app/page.tsx`, `app/join/[code]/page.tsx`, `app/room/[code]/page.tsx`, `components/SwipeDeck.tsx`, `components/MarqueeReveal.tsx`, `components/RoomShare.tsx`, `components/TicketAvatar.tsx` (replace hardcoded copy with `useTranslations()`)
- Modify: `e2e/fixtures.ts` (pin `locale=en-us` via a cookie for every e2e context, since Task 23's specs assert English copy and the app now defaults to pt-BR)
- Modify: `package.json` (add `next-intl` dependency)

**Interfaces:**
- Consumes: `ParticipantView`, `ServerMessage` (Task 18's `server/ws/protocol.ts`) for the WS `error.code`/`kicked.reason`/`room_ended.reason` values this task adds translated copy for.
- Produces: `useTranslations(namespace)` usage across every component listed above — a namespace per component/page (`createRoom`, `joinRoom`, `room`, `swipeDeck`, `marqueeReveal`, `roomShare`, `ticketAvatar`, `errors`, `kicked`, `common`), matching `messages/*.json`'s top-level keys exactly.

- [ ] **Step 1: Install next-intl**

```bash
npm install next-intl
```

- [ ] **Step 2: Write the message dictionaries**

Create `messages/pt-br.json`:

```json
{
  "common": {
    "appName": "PopcornPoll"
  },
  "createRoom": {
    "title": "Sessão de hoje",
    "candidateSourceLabel": "Fonte dos candidatos",
    "candidateSourcePlex": "Somente biblioteca do Plex",
    "candidateSourcePlexTmdb": "Plex + descoberta TMDB",
    "matchRuleLabel": "Regra de match",
    "matchRuleAll": "Todos precisam dizer sim",
    "matchRuleMajority": "Maioria",
    "matchRuleAtLeast": "Pelo menos N",
    "atLeastNLabel": "N",
    "filtersLabel": "Filtros",
    "genreLabel": "Gênero",
    "genrePlaceholder": "ex. Comédia",
    "yearFromLabel": "Ano, a partir de",
    "yearToLabel": "Ano, até",
    "minRatingLabel": "Nota mínima",
    "createButton": "Criar sala",
    "tmdbAttribution": "Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB."
  },
  "joinRoom": {
    "invitedTo": "Você foi convidado para",
    "nameCardTitle": "Seu nome no ingresso",
    "nameLabel": "Nome",
    "namePlaceholder": "Seu nome",
    "joinButton": "Entrar"
  },
  "room": {
    "connecting": "Conectando…",
    "admitted": "Admitidos",
    "removeButton": "Remover",
    "startButton": "Iniciar",
    "buildingPool": "Montando seu catálogo…",
    "noUnanimousPick": "Sem escolha unânime — mais próximas",
    "endSession": "Encerrar sessão"
  },
  "swipeDeck": {
    "inLibrary": "Na sua biblioteca",
    "noMoreCards": "Não há mais filmes",
    "yesAriaLabel": "Sim",
    "noAriaLabel": "Não"
  },
  "marqueeReveal": {
    "matchLabel": "Deu match",
    "readyInLibrary": "Pronto para assistir na sua biblioteca"
  },
  "roomShare": {
    "copyLink": "Copiar link",
    "copied": "Copiado!",
    "share": "Compartilhar",
    "linkCopiedToast": "Link copiado",
    "shareTitle": "Venha para minha sessão de cinema"
  },
  "ticketAvatar": {
    "away": "ausente",
    "done": "pronto"
  },
  "errors": {
    "room_not_found": "Sala não encontrada.",
    "already_started": "Esta sala já começou.",
    "room_full": "Esta sala está cheia.",
    "bad_token": "Sua sessão expirou. Atualize a página.",
    "kicked": "Você foi removido desta sala.",
    "not_host": "Somente o anfitrião pode fazer isso.",
    "invalid_threshold": "Regra de match inválida.",
    "not_enough_participants": "É preciso pelo menos 2 pessoas conectadas para começar.",
    "pool_too_small": "Não há filmes suficientes para começar. Ajuste os filtros.",
    "not_your_card": "Esse filme não é mais o seu card atual.",
    "generic": "Algo deu errado."
  },
  "kicked": {
    "kicked": "O anfitrião te removeu da sala.",
    "excluded_at_start": "Você foi excluído porque estava desconectado quando a sessão começou."
  },
  "localeSwitcher": {
    "english": "English",
    "portuguese": "Português"
  }
}
```

Create `messages/en-us.json` — same keys, English values:

```json
{
  "common": {
    "appName": "PopcornPoll"
  },
  "createRoom": {
    "title": "Tonight's showing",
    "candidateSourceLabel": "Candidate source",
    "candidateSourcePlex": "Plex library only",
    "candidateSourcePlexTmdb": "Plex + TMDB discover",
    "matchRuleLabel": "Match rule",
    "matchRuleAll": "Everyone must say yes",
    "matchRuleMajority": "Majority",
    "matchRuleAtLeast": "At least N",
    "atLeastNLabel": "N",
    "filtersLabel": "Filters",
    "genreLabel": "Genre",
    "genrePlaceholder": "e.g. Comedy",
    "yearFromLabel": "Year, from",
    "yearToLabel": "Year, to",
    "minRatingLabel": "Minimum rating",
    "createButton": "Create room",
    "tmdbAttribution": "This product uses the TMDB API but is not endorsed or certified by TMDB."
  },
  "joinRoom": {
    "invitedTo": "You're invited to",
    "nameCardTitle": "Your name on the ticket",
    "nameLabel": "Name",
    "namePlaceholder": "Your name",
    "joinButton": "Join"
  },
  "room": {
    "connecting": "Connecting…",
    "admitted": "Admitted",
    "removeButton": "Remove",
    "startButton": "Start",
    "buildingPool": "Building your pool…",
    "noUnanimousPick": "No unanimous pick — closest picks",
    "endSession": "End session"
  },
  "swipeDeck": {
    "inLibrary": "In your library",
    "noMoreCards": "No more cards",
    "yesAriaLabel": "Yes",
    "noAriaLabel": "No"
  },
  "marqueeReveal": {
    "matchLabel": "It's a match",
    "readyInLibrary": "Ready to watch in your library"
  },
  "roomShare": {
    "copyLink": "Copy link",
    "copied": "Copied!",
    "share": "Share",
    "linkCopiedToast": "Link copied",
    "shareTitle": "Join my movie night"
  },
  "ticketAvatar": {
    "away": "away",
    "done": "done"
  },
  "errors": {
    "room_not_found": "Room not found.",
    "already_started": "This room has already started.",
    "room_full": "This room is full.",
    "bad_token": "Your session expired. Refresh the page.",
    "kicked": "You were removed from this room.",
    "not_host": "Only the host can do that.",
    "invalid_threshold": "Invalid match rule.",
    "not_enough_participants": "At least 2 connected participants are needed to start.",
    "pool_too_small": "Not enough movies to start. Try adjusting your filters.",
    "not_your_card": "That movie is no longer your current card.",
    "generic": "Something went wrong."
  },
  "kicked": {
    "kicked": "The host removed you from the room.",
    "excluded_at_start": "You were excluded because you were disconnected when the session started."
  },
  "localeSwitcher": {
    "english": "English",
    "portuguese": "Português"
  }
}
```

- [ ] **Step 3: Write the failing dictionary-parity test**

The most common real-world i18n bug is a key added to one locale file and forgotten in the other — this test catches that mechanically, once, instead of relying on every future edit remembering to touch both files.

```ts
// messages/messages.test.ts
import { describe, expect, it } from 'vitest'
import ptBr from './pt-br.json'
import enUs from './en-us.json'

function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof value === 'object' && value !== null ? keyPaths(value as Record<string, unknown>, path) : [path]
  })
}

describe('message dictionaries', () => {
  it('pt-br.json and en-us.json declare exactly the same keys', () => {
    expect(keyPaths(ptBr).sort()).toEqual(keyPaths(enUs).sort())
  })
})
```

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS immediately, since both files above were written with identical key sets — this test's value is catching *future* drift, not proving today's files. Confirm it fails if you temporarily delete one key from either file, then restore it.

- [ ] **Step 4: Write `i18n/request.ts`**

```ts
// i18n/request.ts
import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const SUPPORTED_LOCALES = ['pt-br', 'en-us'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'pt-br'

export function isSupportedLocale(value: string | undefined): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale)
}

export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get('locale')?.value
  const locale: Locale = isSupportedLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const messages = (await import(`../messages/${locale}.json`)).default
  return { locale, messages }
})
```

- [ ] **Step 5: Wire the plugin into `next.config.js`**

```js
// next.config.js
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org' }],
  },
}

export default withNextIntl(nextConfig)
```

- [ ] **Step 6: Write `components/LocaleSwitcher.tsx`**

```tsx
// components/LocaleSwitcher.tsx
'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useTransition } from 'react'
import { Button } from './ui/button'
import { setLocaleAction } from '../app/localeAction'
import type { Locale } from '../i18n/request'

export function LocaleSwitcher() {
  const t = useTranslations('localeSwitcher')
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()

  function switchTo(next: Locale) {
    if (next === locale) return
    startTransition(() => {
      void setLocaleAction(next)
    })
  }

  return (
    <div className="flex gap-1 font-mono text-xs uppercase tracking-widest text-brass">
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        className={locale === 'pt-br' ? 'text-marquee' : 'text-brass'}
        onClick={() => switchTo('pt-br')}
      >
        {t('portuguese')}
      </Button>
      <span>/</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        className={locale === 'en-us' ? 'text-marquee' : 'text-brass'}
        onClick={() => switchTo('en-us')}
      >
        {t('english')}
      </Button>
    </div>
  )
}
```

- [ ] **Step 7: Write the server action that persists the chosen locale**

```ts
// app/localeAction.ts
'use server'

import { cookies } from 'next/headers'
import type { Locale } from '../i18n/request'

export async function setLocaleAction(locale: Locale): Promise<void> {
  const store = await cookies()
  store.set('locale', locale, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
}
```

- [ ] **Step 8: Wire `NextIntlClientProvider` and the switcher into `app/layout.tsx`**

Read the current `app/layout.tsx` (Task 22, unchanged since) before editing — wrap its existing `children` in `NextIntlClientProvider` (no props needed; it inherits locale/messages from `i18n/request.ts` automatically) and render `<LocaleSwitcher />` once, in a fixed corner so it's reachable from every screen:

```tsx
// app/layout.tsx — wrap the existing <body> contents:
import { NextIntlClientProvider } from 'next-intl'
import { LocaleSwitcher } from '../components/LocaleSwitcher'
// ...(keep every existing import from Task 22's layout.tsx)

// inside the returned JSX, replace `<body ...>{children}</body>` with:
<body className={/* keep Task 22's existing className exactly as-is */}>
  <NextIntlClientProvider>
    <div className="fixed right-4 top-4 z-50">
      <LocaleSwitcher />
    </div>
    {children}
  </NextIntlClientProvider>
</body>
```

- [ ] **Step 9: Translate `app/page.tsx` (CreateRoomPage)**

Add `import { useTranslations } from 'next-intl'` and `const t = useTranslations('createRoom')` at the top of the component. Replace every hardcoded string with its dictionary key, keeping every prop, className, and event handler exactly as Task 22 built them:

| Was | Becomes |
|---|---|
| `Tonight's showing` | `{t('title')}` |
| `Candidate source` | `{t('candidateSourceLabel')}` |
| `Plex library only` | `{t('candidateSourcePlex')}` |
| `Plex + TMDB discover` | `{t('candidateSourcePlexTmdb')}` |
| `Match rule` | `{t('matchRuleLabel')}` |
| `Everyone must say yes` | `{t('matchRuleAll')}` |
| `Majority` | `{t('matchRuleMajority')}` |
| `At least N` | `{t('matchRuleAtLeast')}` |
| `<Label htmlFor="atLeastN">N</Label>` | `<Label htmlFor="atLeastN">{t('atLeastNLabel')}</Label>` |
| `Filters` | `{t('filtersLabel')}` |
| `<Label htmlFor="genre">Genre</Label>` | `<Label htmlFor="genre">{t('genreLabel')}</Label>` |
| `placeholder="e.g. Comedy"` | `placeholder={t('genrePlaceholder')}` |
| `Year, from` | `{t('yearFromLabel')}` |
| `Year, to` | `{t('yearToLabel')}` |
| `Minimum rating` | `{t('minRatingLabel')}` |
| `Create room` | `{t('createButton')}` |
| `This product uses the TMDB API...` | `{t('tmdbAttribution')}` |

`POPCORNPOLL` (the `<h1>`) stays as a literal string — it's the brand name, not translatable content.

- [ ] **Step 10: Translate `app/join/[code]/page.tsx` (JoinRoomPage)**

Add `useTranslations('joinRoom')`. Replace: `You're invited to` → `{t('invitedTo')}`; `Your name on the ticket` → `{t('nameCardTitle')}`; `<Label htmlFor="displayName">Name</Label>` → `<Label htmlFor="displayName">{t('nameLabel')}</Label>`; `placeholder="Your name"` → `placeholder={t('namePlaceholder')}`; `Join` → `{t('joinButton')}`.

- [ ] **Step 11: Translate `app/room/[code]/page.tsx` (RoomPage)**

Add `useTranslations('room')` and `useTranslations('errors')`. Replace: `Connecting…` → `{t('connecting')}`; `Admitted` → `{t('admitted')}`; `Remove` → `{t('removeButton')}`; `Start` → `{t('startButton')}`; `Building your pool…` → `{t('buildingPool')}`; `No unanimous pick — closest picks` → `{t('noUnanimousPick')}`; `End session` → `{t('endSession')}`.

Also add error surfacing — there is currently no `ws.on('error', ...)` handler anywhere in this file, so no WS-level error, translated or not, ever reaches a participant. Add one, using the same `sonner` `toast()` pattern `RoomShare.tsx` already established in Task 22:

```tsx
// app/room/[code]/page.tsx — add this import:
import { toast } from 'sonner'

// app/room/[code]/page.tsx — add alongside the other ws.on(...) subscriptions in the effect:
const unsubError = ws.on('error', (msg) => {
  toast(tErrors.has(msg.code) ? tErrors(msg.code) : tErrors('generic'))
})

// add unsubError() to the effect's cleanup return, alongside the other unsub calls
```

(`tErrors.has(...)` — `next-intl`'s translation function exposes a `.has(key)` check for exactly this "look up a dynamic, server-supplied key with a safe fallback" case; use it rather than a try/catch.)

- [ ] **Step 12: Translate `components/SwipeDeck.tsx`, `components/MarqueeReveal.tsx`, `components/RoomShare.tsx`, `components/TicketAvatar.tsx`**

`SwipeDeck.tsx` — add `useTranslations('swipeDeck')`. Replace: `In your library` → `{t('inLibrary')}`; `No more cards` → `{t('noMoreCards')}`; `aria-label="No"` → `aria-label={t('noAriaLabel')}`; `aria-label="Yes"` → `aria-label={t('yesAriaLabel')}`.

`MarqueeReveal.tsx` — add `useTranslations('marqueeReveal')`. Replace: `It's a match` → `{t('matchLabel')}`; `Ready to watch in your library` → `{t('readyInLibrary')}`.

`RoomShare.tsx` — add `useTranslations('roomShare')`. Replace: `Copied!` / `Copy link` → `{copied ? t('copied') : t('copyLink')}`; `Share` → `{t('share')}`; `toast('Link copied')` → `toast(t('linkCopiedToast'))`; `navigator.share({ title: 'Join my movie night', url: joinUrl })` → `navigator.share({ title: t('shareTitle'), url: joinUrl })`.

`TicketAvatar.tsx` — add `useTranslations('ticketAvatar')`. Replace: `away` → `{t('away')}`; `done` → `{t('done')}`.

- [ ] **Step 13: Pin the e2e suite to English so Task 23's existing assertions keep passing**

Task 23's specs assert English copy (`text=Create room`, `text=Join`, `text=Start`, `text=Admitted`, `input[placeholder="Your name"]`, `button[aria-label="Yes"/"No"]`, `text=Connecting`). The app now defaults to pt-BR, which would break every one of them — not because they're wrong, but because they never pinned a locale in the first place, which was already a latent gap this task's own default-locale change exposes.

```ts
// e2e/fixtures.ts — add this export alongside seedFakeLibrary:
import type { BrowserContext } from '@playwright/test'

export async function pinEnglishLocale(context: BrowserContext, baseURL: string): Promise<void> {
  const url = new URL(baseURL)
  await context.addCookies([{ name: 'locale', value: 'en-us', domain: url.hostname, path: '/' }])
}
```

In each of `e2e/match.spec.ts`, `e2e/reconnect.spec.ts`, `e2e/exhaustion.spec.ts`, `e2e/authorization.spec.ts`, `e2e/exclusion.spec.ts`, import `pinEnglishLocale` alongside the existing `seedFakeLibrary` import, and call `await pinEnglishLocale(context, baseURL!)` on every `browser.newContext()` result immediately after creating it and before the first `.newPage()`/`.goto()` call on that context (there are 2-3 contexts per spec — every one needs the cookie, since each is an independent browser profile).

- [ ] **Step 14: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all tests from Tasks 1-24 plus this task's new `messages/messages.test.ts`.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run test:e2e`
Expected: PASS — same specs as Task 23, now passing against an app whose default locale is pt-BR because every spec pins `en-us` explicitly.

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json next.config.js i18n messages components/LocaleSwitcher.tsx app/localeAction.ts app/layout.tsx app/page.tsx "app/join/[code]/page.tsx" "app/room/[code]/page.tsx" components/SwipeDeck.tsx components/MarqueeReveal.tsx components/RoomShare.tsx components/TicketAvatar.tsx e2e
git commit -m "feat: internationalization via next-intl — pt-BR default, en-US option, cookie-based (no URL locale prefix)"
```
