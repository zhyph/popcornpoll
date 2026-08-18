# PopcornPoll "Reimagined" Box Office — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Box office screen (`app/page.tsx`, the create-room form) to match the approved "Reimagined" mockup, and add the three backend pieces it needs: persistent match history, a stats endpoint, and a live eligible-count endpoint.

**Architecture:** Backend first (migration, match-history writes, two new `GET` endpoints, all following the existing `server/http/*.ts` factory-handler pattern), then frontend (a small reusable `BulbFrame` component, then the screen itself rebuilt section by section against the vendored React Bits components from the foundation plan). `app/page.tsx`'s existing data flow (`POST /api/rooms` → `sessionStorage` → `router.push`) is unchanged — this is a visual and copy rework, not a logic rework.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Tailwind, `better-sqlite3`, the vendored `SplitText`/`BlurText`/`CountUp`/`StarBorder` (from `docs/superpowers/plans/2026-08-18-popcornpoll-reimagined-foundation.md`, already merged), `next-intl`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-popcornpoll-reimagined-design.md` — this plan implements that spec's Box office row of the "Screen-by-screen mapping" table and the "Backend additions" section (match history, stats endpoint; "eligible-count" endpoint). Three refinements beyond the spec's original text, made while writing this plan (see Global Constraints) — flagged there rather than silently applied.

## Global Constraints

- **Refinement 1 — `match_history` gains a `year INTEGER` column.** The spec's original schema (in the design spec doc) omitted it, but the mockup's "Last week at this house" reel strip needs a release year per tile (`{{ f.year }}`) and `movies.year` is already nullable — `match_history.year` follows the same nullability.
- **Refinement 2 — the stats endpoint's contract grows two fields beyond the spec:** `plexLinked: boolean` and `lastSyncAt: number | null` (epoch ms, straight from `librarySync.lastSyncAt()` — no ISO conversion). The mockup's "Plex linked · library synced 8 min ago" footer line needs this and the original spec didn't account for it.
- **Refinement 3 — the mockup's "Someone sent you a code? Join their room" button is dropped from this plan.** It implies a generic `/join` code-entry landing page; the app only has `/join/[code]` (code already in the URL). Building that landing page is the Join screen's own future plan's job, not this one's — out of scope here.
- **`data-testid="create-room"` is added to the submit button** (the spec's own screen-mapping table already called this out: "new `data-testid="create-room"` on the submit button (none exists today)"). This is load-bearing: the button's visible text changes from "Create room" to "PRINT THE TICKETS" as part of this restyle, and **7 existing Playwright spec files** click it by literal text (`'text=Create room'`) — Task 9 updates every one of them to the testid. This is the one place this plan legitimately touches pre-existing screen/test files outside its own scope, and it's unavoidable: the button text is exactly what's changing.
- **Every new UI string needs matching `en-us.json`/`pt-br.json` keys.** `messages/messages.test.ts` enforces identical key sets between the two files — a lesson the foundation plan's final review already paid for once. Where the mockup's copy duplicates an already-existing key's *meaning* (not just similar wording), reuse the existing key rather than adding a near-duplicate — the plan calls out each reuse explicitly.
- **This codebase has no component-level unit test infrastructure** (`vitest.config.ts` is `environment: 'node'`, `.test.ts` only) — visual/UI work is verified by `npm run typecheck` + `npm run build` + Playwright, matching the foundation plan's established pattern.
- **`app/globals.css` already has a global `@media (prefers-reduced-motion: reduce)` rule** (added by the foundation plan) that neutralizes every CSS `animation`/`transition` duration app-wide. Every new keyframe animation this plan adds (`bulb`, `chaseGlow`, `shimmer`, `sprocket`, `marqueeSlide`, `star-movement-*`) is automatically covered by it — no per-component reduced-motion logic needed here, unlike the foundation plan's WebGL/JS-driven layers.
- **`GET /api/eligible-count` reuses `rooms.ts`'s existing filter-validation logic** (`validateTmdbFilters`, its `MIN_YEAR`/`MAX_RATING` constants) rather than duplicating it — Task 4 exports it from `server/http/rooms.ts`.
- **The room-creation POST flow (`createRoom()` in `app/page.tsx`, `POST /api/rooms`, `server/room/roomStore.ts`) is completely unchanged.** Every task here is additive (new endpoints, new visuals) or copy/testid changes to the existing form — never touch `createRoom()`'s logic, `MatchThreshold`/`TmdbFilters`/`CandidateSource` types, or the room-creation validation.

---

## Task 1: `match_history` migration

**Files:**
- Create: `server/db/migrations/002_match_history.sql`
- Modify: `server/db/index.ts`
- Test: `server/db/index.test.ts` (check if this file exists first — if it doesn't, create it; if it does, add to it)

**Interfaces:**
- Produces: a `match_history` table with columns `id, movie_id, room_code, title, poster_path, poster_source, year, matched_at`, migrated automatically the same way `001_init.sql` already is.

- [ ] **Step 1: Write `server/db/migrations/002_match_history.sql`**

```sql
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
```

- [ ] **Step 2: Register the migration in `server/db/index.ts`**

Change:
```ts
const MIGRATIONS: Array<{ version: number; file: string }> = [
  { version: 1, file: '001_init.sql' },
]
```
to:
```ts
const MIGRATIONS: Array<{ version: number; file: string }> = [
  { version: 1, file: '001_init.sql' },
  { version: 2, file: '002_match_history.sql' },
]
```

- [ ] **Step 3: Write a failing test confirming the migration runs**

Check whether `server/db/index.test.ts` already exists (`ls server/db/`). If it doesn't, create it:

```ts
// server/db/index.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import type Database from 'better-sqlite3'

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-db-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('migrations', () => {
  it('creates the match_history table with the expected columns', () => {
    const columns = (db.prepare('PRAGMA table_info(match_history)').all() as { name: string }[]).map((c) => c.name)
    expect(columns.sort()).toEqual(
      ['id', 'movie_id', 'room_code', 'title', 'poster_path', 'poster_source', 'year', 'matched_at'].sort(),
    )
  })

  it('inserts and reads back a match_history row', () => {
    db.prepare(
      `INSERT INTO movies (title, poster_source, cached_at) VALUES ('Rear Window', 'plex', '2026-01-01T00:00:00.000Z')`,
    ).run()
    const movieId = (db.prepare('SELECT id FROM movies WHERE title = ?').get('Rear Window') as { id: number }).id
    db.prepare(
      `INSERT INTO match_history (movie_id, room_code, title, poster_path, poster_source, year, matched_at)
       VALUES (?, 'BLUE-FOX-427', 'Rear Window', NULL, 'plex', 1954, '2026-01-01T00:00:00.000Z')`,
    ).run(movieId)
    const row = db.prepare('SELECT * FROM match_history WHERE room_code = ?').get('BLUE-FOX-427') as {
      title: string
      year: number
    }
    expect(row.title).toBe('Rear Window')
    expect(row.year).toBe(1954)
  })
})
```

If `server/db/index.test.ts` already exists with different content, add these two `it()` blocks to its existing `describe` block (or a new one) instead of overwriting the file.

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run server/db/index.test.ts`
Expected: FAIL — `no such table: match_history` (migration not yet registered/applied) — but Step 1-2 above already did both, so this should actually PASS once you've done them. If you did Steps 1-2 first, skip straight to Step 5's PASS check; the point of this task's TDD shape is that the migration file existing is what makes the test pass, not a separate code change.

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run server/db/index.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/002_match_history.sql server/db/index.ts server/db/index.test.ts
git commit -m "feat: add match_history migration"
```

---

## Task 2: `server/db/matchHistory.ts` + write rows from `server/ws/router.ts`

**Files:**
- Create: `server/db/matchHistory.ts`
- Test: `server/db/matchHistory.test.ts`
- Modify: `server/ws/router.ts`

**Interfaces:**
- Consumes: `match_history` table (Task 1).
- Produces:
  ```ts
  interface MatchHistoryEntry {
    title: string
    posterPath: string | null
    posterSource: 'plex' | 'tmdb'
    year: number | null
  }
  function insertMatch(db: Database.Database, params: {
    movieId: number
    roomCode: string
    title: string
    posterPath: string | null
    posterSource: 'plex' | 'tmdb'
    year: number | null
  }): void
  function recentMatches(db: Database.Database, limit: number): MatchHistoryEntry[]
  function nightsSettled(db: Database.Database): number
  ```
  Consumed by Task 3 (`GET /api/stats`) and by this task's own `server/ws/router.ts` change.

- [ ] **Step 1: Write the failing test**

```ts
// server/db/matchHistory.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import { insertMatch, nightsSettled, recentMatches } from './matchHistory'
import type Database from 'better-sqlite3'

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-matchhistory-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('insertMatch + recentMatches + nightsSettled', () => {
  it('records a match and reads it back via recentMatches, newest first', () => {
    insertMatch(db, {
      movieId: 1,
      roomCode: 'BLUE-FOX-427',
      title: 'Rear Window',
      posterPath: null,
      posterSource: 'plex',
      year: 1954,
    })
    insertMatch(db, {
      movieId: 2,
      roomCode: 'RED-CAT-118',
      title: 'Vertigo',
      posterPath: '/vertigo.jpg',
      posterSource: 'tmdb',
      year: 1958,
    })
    const rows = recentMatches(db, 12)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.title).toBe('Vertigo') // inserted second, so newest
    expect(rows[1]!.title).toBe('Rear Window')
  })

  it('caps recentMatches at the given limit', () => {
    for (let i = 0; i < 15; i++) {
      insertMatch(db, {
        movieId: i,
        roomCode: `ROOM-${i}`,
        title: `Movie ${i}`,
        posterPath: null,
        posterSource: 'plex',
        year: 2000 + i,
      })
    }
    expect(recentMatches(db, 12)).toHaveLength(12)
  })

  it('counts nightsSettled as the number of distinct rooms with at least one match', () => {
    insertMatch(db, { movieId: 1, roomCode: 'ROOM-A', title: 'A', posterPath: null, posterSource: 'plex', year: null })
    insertMatch(db, { movieId: 2, roomCode: 'ROOM-A', title: 'B', posterPath: null, posterSource: 'plex', year: null }) // same room, second match — should NOT double-count
    insertMatch(db, { movieId: 3, roomCode: 'ROOM-B', title: 'C', posterPath: null, posterSource: 'plex', year: null })
    expect(nightsSettled(db)).toBe(2)
  })

  it('returns an empty array and zero when no matches have happened yet', () => {
    expect(recentMatches(db, 12)).toEqual([])
    expect(nightsSettled(db)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/db/matchHistory.test.ts`
Expected: FAIL with "Cannot find module './matchHistory'" (file doesn't exist yet).

- [ ] **Step 3: Write `server/db/matchHistory.ts`**

```ts
// server/db/matchHistory.ts
import type Database from 'better-sqlite3'

export interface MatchHistoryEntry {
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
    .prepare('SELECT title, poster_path, poster_source, year FROM match_history ORDER BY matched_at DESC LIMIT ?')
    .all(limit) as { title: string; poster_path: string | null; poster_source: 'plex' | 'tmdb'; year: number | null }[]
  return rows.map((r) => ({ title: r.title, posterPath: r.poster_path, posterSource: r.poster_source, year: r.year }))
}

export function nightsSettled(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(DISTINCT room_code) AS n FROM match_history').get() as { n: number }).n
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/db/matchHistory.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Wire `insertMatch` into `server/ws/router.ts`'s match-broadcast branches**

`handleMessage` (the function you're editing) already takes `db: Database.Database` as a parameter — use it directly, no new parameter needed.

In the `'swipe'` case, find this block (it loops over `result.data.newMatches` to build `match` broadcast messages):
```ts
      const room = store.get(state.roomCode)!
      const toRoom: ServerMessage[] = [stateUpdate(room)]
      for (const movieId of result.data.newMatches) {
        const movie = room.pool.find((p) => p.movieId === movieId)!
        toRoom.push({ type: 'match', movieId, movie, seq: room.seq })
      }
```
Add an `insertMatch` call inside that same loop, right after `const movie = ...`:
```ts
      const room = store.get(state.roomCode)!
      const toRoom: ServerMessage[] = [stateUpdate(room)]
      for (const movieId of result.data.newMatches) {
        const movie = room.pool.find((p) => p.movieId === movieId)!
        insertMatch(db, {
          movieId: movie.movieId,
          roomCode: room.code,
          title: movie.title,
          posterPath: movie.posterPath,
          posterSource: movie.posterSource,
          year: movie.year,
        })
        toRoom.push({ type: 'match', movieId, movie, seq: room.seq })
      }
```

Do the exact same edit in the `'kick'` case's equivalent loop (it has the identical shape: `for (const movieId of result.data.newMatches) { const movie = updatedRoom.pool.find(...)!; toRoom.push({ type: 'match', ... }) }` — use `updatedRoom` in place of `room` there, matching that case's existing variable name).

Add the import at the top of the file:
```ts
import { insertMatch } from '../db/matchHistory'
```

- [ ] **Step 6: Add a router test confirming the write happens**

Find `server/ws/router.test.ts` and locate its existing test setup for the `'swipe'` case reaching a match (search for `newMatches` or `'match'` in that file to find the right spot — follow its existing `db`/`store` setup pattern exactly, don't invent a new one). Add:

```ts
it('writes a match_history row when a swipe produces a new match', async () => {
  // Reuse this file's existing room-setup helper to get a room in 'active'
  // status with exactly one participant one swipe away from a unanimous
  // match — follow the same setup as this file's other 'swipe'-produces-a-match
  // tests above, then:
  const before = (db.prepare('SELECT COUNT(*) AS n FROM match_history').get() as { n: number }).n
  // ... perform the swipe that produces the match, via handleMessage, exactly
  // as the neighboring test(s) in this file already do ...
  const after = (db.prepare('SELECT COUNT(*) AS n FROM match_history').get() as { n: number }).n
  expect(after).toBe(before + 1)
})
```

Adapt the setup to match this file's actual existing helpers precisely — read the file first and copy its established pattern for constructing a room one swipe away from a match rather than reinventing one.

- [ ] **Step 7: Run the full router test file**

Run: `npx vitest run server/ws/router.test.ts`
Expected: PASS, including the new test.

- [ ] **Step 8: Commit**

```bash
git add server/db/matchHistory.ts server/db/matchHistory.test.ts server/ws/router.ts server/ws/router.test.ts
git commit -m "feat: write match_history rows when a match happens"
```

---

## Task 3: `GET /api/stats`

**Files:**
- Create: `server/http/stats.ts`
- Test: `server/http/stats.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `recentMatches`, `nightsSettled` (Task 2); `getPlexLink` (`server/plex/link.ts`, already exists — `getPlexLink(db, encryptionKey): PlexLink | null`); `librarySync.lastSyncAt()` (`server/sync/librarySync.ts`, already exists).
- Produces:
  ```ts
  function createStatsHandler(
    db: Database.Database,
    encryptionKey: string,
    librarySync: { lastSyncAt(): number | null },
  ): (req: Request) => Promise<Response>
  ```
  Response body:
  ```ts
  interface StatsResponse {
    libraryCount: number
    nightsSettled: number
    recentMatches: MatchHistoryEntry[] // from Task 2, max 12
    plexLinked: boolean
    lastSyncAt: number | null
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// server/http/stats.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { insertMatch } from '../db/matchHistory'
import { savePlexLink } from '../plex/link'
import { createStatsHandler } from './stats'
import type Database from 'better-sqlite3'

const KEY = 'a'.repeat(32)
let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-stats-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createStatsHandler', () => {
  it('returns libraryCount, nightsSettled, recentMatches, plexLinked, lastSyncAt', async () => {
    db.prepare(
      `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, cached_at)
       VALUES ('pk1', 'Rear Window', 'plex', 1, '2026-01-01T00:00:00.000Z')`,
    ).run()
    insertMatch(db, { movieId: 1, roomCode: 'BLUE-FOX-427', title: 'Rear Window', posterPath: null, posterSource: 'plex', year: 1954 })
    savePlexLink(db, KEY, {
      clientIdentifier: 'client-1',
      serverUrl: 'http://plex.local',
      authToken: 'tok',
      librarySectionIds: ['1'],
      linkedAt: new Date().toISOString(),
    })

    const handler = createStatsHandler(db, KEY, { lastSyncAt: () => 1_700_000_000_000 })
    const res = await handler(new Request('http://localhost/api/stats'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.libraryCount).toBe(1)
    expect(body.nightsSettled).toBe(1)
    expect(body.recentMatches).toEqual([{ title: 'Rear Window', posterPath: null, posterSource: 'plex', year: 1954 }])
    expect(body.plexLinked).toBe(true)
    expect(body.lastSyncAt).toBe(1_700_000_000_000)
  })

  it('returns plexLinked: false and empty stats on a fresh, unlinked instance', async () => {
    const handler = createStatsHandler(db, KEY, { lastSyncAt: () => null })
    const res = await handler(new Request('http://localhost/api/stats'))
    const body = await res.json()
    expect(body.libraryCount).toBe(0)
    expect(body.nightsSettled).toBe(0)
    expect(body.recentMatches).toEqual([])
    expect(body.plexLinked).toBe(false)
    expect(body.lastSyncAt).toBeNull()
  })
})
```

(`savePlexLink(db, key, link): void` is synchronous — confirmed directly against `server/plex/link.ts` — hence no `await` above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/http/stats.test.ts`
Expected: FAIL — "Cannot find module './stats'".

- [ ] **Step 3: Write `server/http/stats.ts`**

```ts
// server/http/stats.ts
import type Database from 'better-sqlite3'
import { nightsSettled, recentMatches } from '../db/matchHistory'
import { getPlexLink } from '../plex/link'

const RECENT_MATCHES_LIMIT = 12

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
      plexLinked: getPlexLink(db, encryptionKey) !== null,
      lastSyncAt: librarySync.lastSyncAt(),
    })
  }
}
```

Check `getPlexLink`'s actual signature/behavior in `server/plex/link.ts` before finalizing this — `server/index.ts`'s `safeGetPlexLink` wrapper already shows the exact call shape (`getPlexLink(db, config.authEncryptionKey)`) and that it can throw `DecryptionError`. This handler doesn't need `safeGetPlexLink`'s try/catch-and-treat-as-unlinked behavior duplicated verbatim, but DO wrap the `getPlexLink` call in the same kind of guard (a thrown `DecryptionError` here must not 500 the stats endpoint — treat it as `plexLinked: false`, same fallback `server/index.ts` already uses at boot).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/http/stats.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Wire the handler into `server/index.ts`**

Add the import:
```ts
import { createStatsHandler } from './http/stats'
```
Instantiate it alongside the other handlers (near `const roomsHandler = ...`):
```ts
  const statsHandler = createStatsHandler(db, config.authEncryptionKey, librarySync)
```
Add a dispatch branch alongside the existing `else if (url.pathname === '/api/health') ...` chain:
```ts
        else if (url.pathname === '/api/stats' && req.method === 'GET') webRes = await statsHandler(webReq)
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/http/stats.ts server/http/stats.test.ts server/index.ts
git commit -m "feat: add GET /api/stats endpoint"
```

---

## Task 4: `GET /api/eligible-count`

**Files:**
- Modify: `server/http/rooms.ts` (export `validateTmdbFilters`, `MIN_YEAR`, `MAX_RATING`)
- Create: `server/http/eligibleCount.ts`
- Test: `server/http/eligibleCount.test.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: `findEligiblePlexRows` (`server/db/movies.ts`, already exists, signature `findEligiblePlexRows(db, filters: { genre?, yearMin?, yearMax?, ratingMin? }): MovieRow[]`); `validateTmdbFilters` (this task exports it from `rooms.ts`).
- Produces: `function createEligibleCountHandler(db: Database.Database): (req: Request) => Promise<Response>`. Response body: `{ count: number }`. `400` with `{ error: { code: 'invalid_filters', message } }` on `yearMin > yearMax`, matching `POST /api/rooms`'s existing error shape.

- [ ] **Step 1: Export `validateTmdbFilters` from `server/http/rooms.ts`**

Change:
```ts
function validateTmdbFilters(raw: TmdbFilters): { ok: true; filters: TmdbFilters } | { ok: false } {
```
to:
```ts
export function validateTmdbFilters(raw: TmdbFilters): { ok: true; filters: TmdbFilters } | { ok: false } {
```
No other change to that file.

- [ ] **Step 2: Write the failing test**

```ts
// server/http/eligibleCount.test.ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../db'
import { createEligibleCountHandler } from './eligibleCount'
import type Database from 'better-sqlite3'

let db: Database.Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-eligible-'))
  db = openDb(dir)
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, year, rating, genres, cached_at)
     VALUES ('pk1', 'Rear Window', 'plex', 1, 1954, 8.5, '["Thriller"]', '2026-01-01T00:00:00.000Z')`,
  ).run()
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, year, rating, genres, cached_at)
     VALUES ('pk2', 'Some Like It Hot', 'plex', 1, 1959, 8.2, '["Comedy"]', '2026-01-01T00:00:00.000Z')`,
  ).run()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('createEligibleCountHandler', () => {
  it('returns the count of movies matching the given filters', async () => {
    const handler = createEligibleCountHandler(db)
    const res = await handler(new Request('http://localhost/api/eligible-count?genre=Thriller'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
  })

  it('returns the full library count with no filters', async () => {
    const handler = createEligibleCountHandler(db)
    const res = await handler(new Request('http://localhost/api/eligible-count'))
    expect(await res.json()).toEqual({ count: 2 })
  })

  it('rejects yearMin > yearMax with 400 invalid_filters', async () => {
    const handler = createEligibleCountHandler(db)
    const res = await handler(new Request('http://localhost/api/eligible-count?yearMin=2000&yearMax=1990'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_filters')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/http/eligibleCount.test.ts`
Expected: FAIL — "Cannot find module './eligibleCount'".

- [ ] **Step 4: Write `server/http/eligibleCount.ts`**

```ts
// server/http/eligibleCount.ts
import type Database from 'better-sqlite3'
import { findEligiblePlexRows } from '../db/movies'
import { validateTmdbFilters } from './rooms'
import type { TmdbFilters } from '../room/types'

function numOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

export function createEligibleCountHandler(db: Database.Database): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url)
    const raw: TmdbFilters = {
      genre: url.searchParams.get('genre') ?? undefined,
      yearMin: numOrUndefined(url.searchParams.get('yearMin')),
      yearMax: numOrUndefined(url.searchParams.get('yearMax')),
      ratingMin: numOrUndefined(url.searchParams.get('ratingMin')),
    }
    const result = validateTmdbFilters(raw)
    if (!result.ok) {
      return Response.json(
        { error: { code: 'invalid_filters', message: 'yearMin must be <= yearMax' } },
        { status: 400 },
      )
    }
    const count = findEligiblePlexRows(db, result.filters).length
    return Response.json({ count })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/http/eligibleCount.test.ts`
Expected: PASS (3/3).

- [ ] **Step 6: Wire the handler into `server/index.ts`**

Add the import:
```ts
import { createEligibleCountHandler } from './http/eligibleCount'
```
Instantiate:
```ts
  const eligibleCountHandler = createEligibleCountHandler(db)
```
Add the dispatch branch:
```ts
        else if (url.pathname === '/api/eligible-count' && req.method === 'GET') webRes = await eligibleCountHandler(webReq)
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/http/rooms.ts server/http/eligibleCount.ts server/http/eligibleCount.test.ts server/index.ts
git commit -m "feat: add GET /api/eligible-count endpoint"
```

---

## Task 5: Tailwind + globals.css keyframes

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: Tailwind utilities `animate-star-movement-bottom`, `animate-star-movement-top` (required by the vendored `StarBorder`, `components/ui/reactbits/StarBorder.tsx`, per its own source comment). CSS `@keyframes bulb`, `chaseGlow`, `shimmer`, `sprocket`, `marqueeSlide` (consumed by Task 6's `BulbFrame` and Tasks 7-10's inline styles).

- [ ] **Step 1: Add StarBorder's required keyframes to `tailwind.config.ts`**

In the `theme.extend` object (alongside the existing `borderRadius`/`colors` entries), add:
```ts
  		keyframes: {
  			'star-movement-bottom': {
  				'0%': { transform: 'translate(0%, 0%)', opacity: '1' },
  				'100%': { transform: 'translate(-100%, 0%)', opacity: '0' },
  			},
  			'star-movement-top': {
  				'0%': { transform: 'translate(0%, 0%)', opacity: '1' },
  				'100%': { transform: 'translate(100%, 0%)', opacity: '0' },
  			},
  		},
  		animation: {
  			'star-movement-bottom': 'star-movement-bottom linear infinite alternate',
  			'star-movement-top': 'star-movement-top linear infinite alternate',
  		},
```
(This is `StarBorder-TS-TW.tsx`'s own documented required config, copied verbatim from its source comment — not invented here.)

- [ ] **Step 2: Add the five new keyframes to `app/globals.css`**

Append, after the existing `grainShift` block and before the `@media (prefers-reduced-motion: reduce)` block:

```css
@keyframes bulb {
  0%, 100% { opacity: .28; box-shadow: 0 0 0 rgba(245,166,35,0); }
  50% { opacity: 1; box-shadow: 0 0 12px 3px rgba(245,166,35,.55); }
}

@keyframes chaseGlow {
  0%, 100% { text-shadow: 0 0 18px rgba(245,166,35,.35), 0 0 60px rgba(245,166,35,.12); }
  50% { text-shadow: 0 0 26px rgba(245,166,35,.6), 0 0 90px rgba(245,166,35,.2); }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes sprocket {
  from { background-position-x: 0; }
  to { background-position-x: -32px; }
}

@keyframes marqueeSlide {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
```

(Values copied verbatim from the approved mockup, `PopcornPoll Reimagined.dc.html`, same as every other keyframe this redesign has added.)

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS. (Tailwind config changes aren't typechecked by `tsc`, but a broken `tailwind.config.ts` would fail `next build`'s CSS compilation — this is the real check for Step 1.)

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "feat: add StarBorder Tailwind keyframes and box-office CSS keyframes"
```

---

## Task 6: `BulbFrame` component

**Files:**
- Create: `components/BulbFrame.tsx`

**Interfaces:**
- Produces: `function BulbFrame({ count }: { count: number }): JSX.Element` — renders `count` small amber bulbs evenly spaced around the perimeter of its (relatively-positioned) parent, each pulsing via the `bulb` keyframe (Task 5) with a staggered delay. Absolutely positioned, `pointer-events-none`, meant to be placed as the first child inside a `position: relative` container.

This is the mockup's `bulbRing(count)` helper (from its embedded script), ported to a real component — it's reused by at least the Lobby and Match-reveal screens in later plans (per the spec's screen table, both show a bulb-ringed frame), which is why it's a standalone component now rather than inlined into `app/page.tsx`.

- [ ] **Step 1: Write `components/BulbFrame.tsx`**

```tsx
// components/BulbFrame.tsx
// Places `count` bulbs evenly around a rectangle's perimeter (expressed as
// inset-based absolute positioning, so it has no dependency on the parent's
// exact pixel size — same technique components/MarqueeReveal.tsx's
// bulbPosition() already uses for its own bulb ring, just generalized to
// walk all four sides instead of MarqueeReveal's specific case). Ported
// from the approved mockup's own bulbRing() helper.
export function BulbFrame({ count }: { count: number }) {
  const bulbs = Array.from({ length: count }, (_, i) => {
    const f = i / count
    const side = Math.floor(f * 4)
    const t = `${((f * 4) % 1) * 100}%`
    let pos: React.CSSProperties
    if (side === 0) pos = { top: '-5px', left: t }
    else if (side === 1) pos = { right: '-5px', top: t }
    else if (side === 2) pos = { bottom: '-5px', left: t }
    else pos = { left: '-5px', top: t }
    return {
      key: i,
      style: {
        position: 'absolute' as const,
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: '#F5A623',
        animation: `bulb 1.4s ease-in-out infinite ${(f * 1.4).toFixed(2)}s`,
        ...pos,
      },
    }
  })

  return (
    <>
      {bulbs.map((b) => (
        <span key={b.key} aria-hidden style={b.style} />
      ))}
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/BulbFrame.tsx
git commit -m "feat: add BulbFrame component"
```

---

## Task 7: Box office hero block (title/subhead)

**Files:**
- Modify: `app/page.tsx`
- Modify: `messages/en-us.json`
- Modify: `messages/pt-br.json`

**Interfaces:**
- Consumes: `BulbFrame` (Task 6, `count` prop); `SplitText` (`components/ui/reactbits/SplitText.tsx`, props `{ text, className?, delay?, duration?, ease?, splitType?, from?, to?, threshold?, rootMargin?, tag?, textAlign?, onLetterAnimationComplete? }`); `BlurText` (`components/ui/reactbits/BlurText.tsx`, props `{ text, delay?, className?, animateBy?, direction?, threshold?, rootMargin?, animationFrom?, animationTo?, easing?, onAnimationComplete?, stepDuration? }`).

- [ ] **Step 1: Add new i18n keys**

`messages/en-us.json` — inside the existing `"createRoom"` object, add:
```json
    "performancesTag": "Continuous performances · Balcony open",
    "titleSubhead": "Everybody swipes, nobody argues. The house picks tonight's feature from your own library — and the marquee lights up the second you agree.",
```

`messages/pt-br.json` — inside its `"createRoom"` object, add:
```json
    "performancesTag": "Sessões contínuas · Camarote aberto",
    "titleSubhead": "Todo mundo desliza, ninguém discute. A casa escolhe o filme da noite direto da sua biblioteca — e o letreiro acende assim que todos concordam.",
```

- [ ] **Step 2: Replace `app/page.tsx`'s title block**

Change:
```tsx
    <main className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-5xl text-marquee">POPCORNPOLL</h1>
      <Card className="w-full border-2 border-brass bg-velvet">
```
to:
```tsx
    <main className="mx-auto flex flex-1 max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="relative flex flex-col items-center gap-4 border-2 border-brass/75 bg-gradient-to-b from-velvet/85 to-ink/90 px-6 py-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)] sm:px-10 sm:py-11">
        <BulbFrame count={24} />
        <p className="font-mono text-[11px] uppercase tracking-[.42em] text-brass">{t('performancesTag')}</p>
        <SplitText
          text="POPCORNPOLL"
          tag="h1"
          className="font-display text-center text-[clamp(46px,11vw,132px)] leading-[.9] tracking-wide text-marquee [animation:chaseGlow_3.4s_ease-in-out_infinite]"
          splitType="chars"
          delay={60}
        />
        <BlurText
          text={t('titleSubhead')}
          animateBy="words"
          direction="top"
          className="max-w-[52ch] text-center text-sm leading-relaxed text-ticket/80 sm:text-base"
        />
      </div>
      <Card className="w-full border-2 border-brass bg-velvet">
```

Note the container width changes from `max-w-md` to `max-w-5xl` and the layout goes from a single centered column to a wider spread — this is intentional (Task 9 turns the `Card` below into a two-column grid matching the mockup's ticket-panel + sidebar layout; a narrow `max-w-md` column can't hold that). The closing `</main>` tag and everything else in the file is untouched by this task.

`t` is already in scope (`const t = useTranslations('createRoom')`, line 17 of the existing file) — no new import needed for it. Add these two imports at the top of the file, alongside the existing ones:
```tsx
import { BulbFrame } from '../components/BulbFrame'
import BlurText from '../components/ui/reactbits/BlurText'
import SplitText from '../components/ui/reactbits/SplitText'
```

(Both are default exports — `export default SplitText` / `export default BlurText` — confirmed directly against the vendored files, not a guess.)

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Run the message parity test**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx messages/en-us.json messages/pt-br.json
git commit -m "feat: restyle box office hero block (title, subhead, bulb frame)"
```

---

## Task 8: Ticket panel restyle + `data-testid="create-room"`

**Files:**
- Modify: `app/page.tsx`
- Modify: `messages/en-us.json`
- Modify: `messages/pt-br.json`

**Interfaces:**
- Consumes: `StarBorder` (`components/ui/reactbits/StarBorder.tsx`, polymorphic — `as="button"` needed here, props include `className`, `color`, `speed`, `thickness`, plus every native `<button>` prop via `React.ComponentPropsWithoutRef<T>`, including `onClick`, `disabled`, `data-testid`, `type`).
- Produces: the create-room submit button now carries `data-testid="create-room"` — Task 9 depends on this exact value.

- [ ] **Step 1: Add new i18n keys, reusing existing ones where the meaning already matches**

`messages/en-us.json`, inside `"createRoom"`:
- **Reused as-is** (already correct, no change): `matchRuleAll`, `matchRuleMajority`, `matchRuleAtLeast`, `genreLabel`, `genrePlaceholder`, `yearFromLabel`, `yearToLabel`, `minRatingLabel`, `atLeastNLabel`.
- **Change `createButton`'s value** from `"Create room"` to `"PRINT THE TICKETS"`.
- **Add these new keys:**
```json
    "ticketNoLabel": "no. 01",
    "sourcesPlexTitle": "PLEX ONLY",
    "sourcesPlexNote": "Everything is already on your shelf.",
    "sourcesTmdbTitle": "PLEX + TMDB",
    "sourcesTmdbNote": "Add the ones you have been meaning to get.",
    "housePicturesLabel": "Where the pictures come from",
    "houseRuleLabel": "House rule for a match",
    "yesVotesNeededLabel": "Yes votes needed",
    "trimTheBillLabel": "Trim the bill",
    "tearHereLabel": "Tear here · admit up to 12",
    "tonightsShowingLabel": "TONIGHT'S SHOWING"
```

`messages/pt-br.json`, inside `"createRoom"`:
- **Change `createButton`'s value** from `"Criar sala"` to `"IMPRIMA OS INGRESSOS"`.
- **Add:**
```json
    "ticketNoLabel": "nº 01",
    "sourcesPlexTitle": "SÓ PLEX",
    "sourcesPlexNote": "Já está tudo na sua prateleira.",
    "sourcesTmdbTitle": "PLEX + TMDB",
    "sourcesTmdbNote": "Adicione os que você anda querendo ver.",
    "housePicturesLabel": "De onde vêm as imagens",
    "houseRuleLabel": "Regra da casa para um match",
    "yesVotesNeededLabel": "Votos a favor necessários",
    "trimTheBillLabel": "Ajuste a sessão",
    "tearHereLabel": "Destaque aqui · admite até 12",
    "tonightsShowingLabel": "SESSÃO DE HOJE"
```

- [ ] **Step 2: Replace `app/page.tsx`'s `Card` with the restyled ticket panel**

Change the `<Card className="w-full border-2 border-brass bg-velvet">...</Card>` block (everything from that opening tag through its matching `</Card>`) to a two-column grid whose first column is the ticket-panel form. Full replacement:

```tsx
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div
          className="relative bg-gradient-to-br from-ticket to-ticket/80 p-6 text-ink shadow-[0_30px_60px_-25px_rgba(0,0,0,.9)] sm:p-8"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)' }}
        >
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b-2 border-dashed border-ink/35 pb-3">
            <p className="font-display text-2xl tracking-wide sm:text-[28px]">{t('tonightsShowingLabel')}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink/60">{t('ticketNoLabel')}</p>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('housePicturesLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCandidateSource('plex')}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${
                candidateSource === 'plex' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'
              }`}
            >
              <span className="font-display text-[15px]">{t('sourcesPlexTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{t('sourcesPlexNote')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCandidateSource('plex+tmdb')}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${
                candidateSource === 'plex+tmdb' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'
              }`}
            >
              <span className="font-display text-[15px]">{t('sourcesTmdbTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{t('sourcesTmdbNote')}</span>
            </button>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('houseRuleLabel')}</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {(['all', 'majority', 'atLeast'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setThresholdKind(kind)}
                className={`px-3.5 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-all ${
                  thresholdKind === kind ? 'bg-ink text-ticket' : 'border border-ink/35 text-ink/70'
                }`}
              >
                {kind === 'all' ? t('matchRuleAll') : kind === 'majority' ? t('matchRuleMajority') : t('matchRuleAtLeast')}
              </button>
            ))}
          </div>

          {thresholdKind === 'atLeast' && (
            <div className="mb-4 flex items-center justify-between gap-3.5 border border-ink/25 bg-ink/5 p-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-ink/70">{t('yesVotesNeededLabel')}</span>
              <div className="flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={() => setAtLeastN(Math.max(1, atLeastN - 1))}
                  className="h-[34px] w-[34px] border border-ink/40 text-lg leading-none"
                >
                  −
                </button>
                <span className="min-w-8 text-center font-display text-2xl">{atLeastN}</span>
                <button
                  type="button"
                  onClick={() => setAtLeastN(atLeastN + 1)}
                  className="h-[34px] w-[34px] border border-ink/40 text-lg leading-none"
                >
                  +
                </button>
              </div>
            </div>
          )}

          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('trimTheBillLabel')}</p>
          <div className="mb-6 grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('genreLabel')}
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={t('genrePlaceholder')}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('minRatingLabel')}
              <input
                type="number"
                step={0.1}
                min={0}
                max={10}
                value={ratingMin}
                onChange={(e) => setRatingMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('yearFromLabel')}
              <input
                type="number"
                value={yearMin}
                onChange={(e) => setYearMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/62">
              {t('yearToLabel')}
              <input
                type="number"
                value={yearMax}
                onChange={(e) => setYearMax(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
          </div>

          <StarBorder
            as="button"
            type="button"
            onClick={createRoom}
            data-testid="create-room"
            color="#F3E9D2"
            speed="3.2s"
            className="w-full [&>div:last-child]:w-full [&>div:last-child]:rounded-none [&>div:last-child]:border-0 [&>div:last-child]:bg-exit-red [&>div:last-child]:py-4 [&>div:last-child]:font-display [&>div:last-child]:text-lg [&>div:last-child]:tracking-wider [&>div:last-child]:text-ticket"
          >
            {t('createButton')}
          </StarBorder>
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-wider text-ink/50">{t('tearHereLabel')}</p>

          {candidateSource === 'plex+tmdb' && (
            <p className="mt-3 text-center text-xs text-ink/55">{t('tmdbAttribution')}</p>
          )}
        </div>
        {/* TODO(Task 10): remove this placeholder and add the real second grid column here, then close the grid */}
      </div>
    </main>
  )
}
```

**Amendment (mid-execution, Task 8):** the original plan text said to leave the grid `<div>` unclosed for Task 10 to close — that produced an unparseable file (a real execution found `app/page.tsx` truncated with no `</main>`, no closing `)`/`}` at all, since the file's pre-existing trailing lines were never restated here and got silently dropped). Fixed: this task now closes the grid with a placeholder `<div>` (commented as temporary) immediately followed by the exact `</main>\n  )\n}` that must always follow the JSX — every task must leave `app/page.tsx` in a genuinely parseable, buildable state, full stop. Task 10 below is amended to remove the placeholder `<div>` and TODO comment before adding its real second column.

Every `useState` variable referenced above (`candidateSource`, `setCandidateSource`, `thresholdKind`, `setThresholdKind`, `atLeastN`, `setAtLeastN`, `genre`, `setGenre`, `ratingMin`, `setRatingMin`, `yearMin`, `setYearMin`, `yearMax`, `setYearMax`, `createRoom`) already exists in `app/page.tsx` exactly as before — this task changes only the JSX, never the component's state/logic.

Add the import:
```tsx
import StarBorder from '../components/ui/reactbits/StarBorder'
```
(Default export — `export default StarBorder` — confirmed directly against the vendored file.)

**On the `StarBorder` className hack above** (`[&>div:last-child]:...`): `StarBorder`'s own source renders `{children}` inside a fixed inner `<div className="relative z-1 bg-gradient-to-b from-black to-gray-900 border border-gray-800 ...">` that isn't independently prop-configurable — the only way to restyle that inner div without forking the vendored component is to target it with a Tailwind arbitrary child-selector from the outer `className`, which is what this does. Read `components/ui/reactbits/StarBorder.tsx` before writing this to confirm that inner div is genuinely the last child of the outer element (matching the plan's assumption) — if the vendored file's structure differs even slightly (extra wrapper, different child order), adjust the selector to actually target that specific div rather than leaving a selector that silently matches nothing.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 4: Run the message parity test**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Manually verify the create-room flow still works**

Run: `npm run dev` (with `FAKE_EXTERNAL_APIS=true` set, matching how the e2e suite runs it — check `playwright.config.ts`'s `webServer` command for the exact env it sets, and replicate it), open `http://localhost:3000`, click the "PRINT THE TICKETS" button, confirm it navigates to `/room/<code>`. This is exactly the flow Task 9's e2e-locator updates depend on — confirm it by hand before touching those 7 files, so a real break here doesn't get masked by also changing the tests in the same pass.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx messages/en-us.json messages/pt-br.json
git commit -m "feat: restyle box office ticket panel, add data-testid=create-room"
```

---

## Task 9: Update existing e2e specs' `Create room` locator

**Files:**
- Modify: `e2e/authorization.spec.ts` (3 occurrences)
- Modify: `e2e/match.spec.ts` (1)
- Modify: `e2e/exhaustion.spec.ts` (1)
- Modify: `e2e/kicked.spec.ts` (2)
- Modify: `e2e/reconnect.spec.ts` (1)
- Modify: `e2e/exclusion.spec.ts` (1)

**Interfaces:**
- Consumes: `data-testid="create-room"` (Task 8).

This task exists because Task 8 changed the create-room button's visible text from "Create room" to "PRINT THE TICKETS" — every one of these 9 call sites currently does `.click('text=Create room')` and would silently stop matching anything otherwise.

- [ ] **Step 1: Replace every occurrence**

In each of the 6 files listed above, replace every instance of:
```ts
  await hostPage.click('text=Create room')
```
with:
```ts
  await hostPage.getByTestId('create-room').click()
```

Run `grep -n "text=Create room" e2e/*.spec.ts` first to get the exact current line numbers (they may have drifted slightly from this plan's earlier count), and confirm the replacement count matches (9 occurrences across 6 files) before moving on.

- [ ] **Step 2: Run each touched spec individually**

Per this plan's own precedent (and the foundation plan's confirmed finding that the full suite is pre-existing-flaky under concurrency — not something to re-litigate here), run each file **on its own**, not as a batch:

```bash
npx playwright test e2e/authorization.spec.ts --project=chromium
npx playwright test e2e/match.spec.ts --project=chromium
npx playwright test e2e/exhaustion.spec.ts --project=chromium
npx playwright test e2e/kicked.spec.ts --project=chromium
npx playwright test e2e/reconnect.spec.ts --project=chromium
npx playwright test e2e/exclusion.spec.ts --project=chromium
```

Expected: every one PASSES. If any fails, read its output carefully — a failure here means either the locator swap is wrong (e.g. `data-testid="create-room"` isn't actually reaching the DOM the way Task 8 intended — check `StarBorder`'s rendered output directly) or Task 8's restyle broke something functional, not the pre-existing concurrency flakiness (that only shows up running many files *together*, which this step deliberately avoids).

- [ ] **Step 3: Commit**

```bash
git add e2e/authorization.spec.ts e2e/match.spec.ts e2e/exhaustion.spec.ts e2e/kicked.spec.ts e2e/reconnect.spec.ts e2e/exclusion.spec.ts
git commit -m "test: update e2e specs to use data-testid=create-room instead of button text"
```

---

## Task 10: Sidebar (stats, reel strip, Plex status)

**Files:**
- Modify: `app/page.tsx`
- Modify: `messages/en-us.json`
- Modify: `messages/pt-br.json`

**Interfaces:**
- Consumes: `GET /api/stats` (Task 3, response shape `StatsResponse`); `CountUp` (`components/ui/reactbits/CountUp.tsx`, props `{ to, from?, direction?, delay?, duration?, className?, startWhen?, separator?, onStart?, onEnd? }`); `Skeleton` (`components/ui/skeleton.tsx`, already exists, already used by `app/setup/page.tsx`).

- [ ] **Step 1: Add new i18n keys**

`messages/en-us.json`, inside `"createRoom"`:
```json
    "houseTonightLabel": "The house tonight",
    "inLibraryLabel": "in library",
    "inThePoolLabel": "in the pool",
    "nightsSettledLabel": "nights settled",
    "lastWeekLabel": "Last week at this house",
    "plexLinkedStatus": "Plex linked · library synced {minutes} min ago",
    "plexNotLinkedStatus": "Plex not linked yet",
    "projectionBoothLabel": "Projection booth"
```

`messages/pt-br.json`, inside `"createRoom"`:
```json
    "houseTonightLabel": "A casa hoje",
    "inLibraryLabel": "na biblioteca",
    "inThePoolLabel": "no catálogo",
    "nightsSettledLabel": "sessões resolvidas",
    "lastWeekLabel": "Na casa, semana passada",
    "plexLinkedStatus": "Plex vinculado · biblioteca sincronizada há {minutes} min",
    "plexNotLinkedStatus": "Plex ainda não vinculado",
    "projectionBoothLabel": "Cabine de projeção"
```

(`{minutes}` is a next-intl ICU interpolation placeholder — `t('plexLinkedStatus', { minutes })` at the call site, matching how other interpolated strings in this codebase already work; check an existing example, e.g. search `messages/en-us.json`/call sites for `{` placeholders, if this codebase has an established convention that differs from plain `{minutes}`.)

- [ ] **Step 2: Add stats-fetching state to `app/page.tsx`**

Add near the top of `CreateRoomPage`, alongside the existing `useState` calls:
```tsx
  const [stats, setStats] = useState<{
    libraryCount: number
    nightsSettled: number
    recentMatches: { title: string; posterPath: string | null; posterSource: 'plex' | 'tmdb'; year: number | null }[]
    plexLinked: boolean
    lastSyncAt: number | null
  } | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then(setStats)
      .catch(() => {}) // stats are decorative — a failed fetch just keeps the skeleton state, no error UI
  }, [])
```
Add `useEffect` to the existing `import { useState } from 'react'` line, making it `import { useEffect, useState } from 'react'`.

- [ ] **Step 3: Add the sidebar column, replacing Task 8's placeholder**

Task 8 left a placeholder in place of the second grid column:
```tsx
        {/* TODO(Task 10): remove this placeholder and add the real second grid column here, then close the grid */}
      </div>
    </main>
  )
}
```
Delete that placeholder `<div>` and the TODO comment. Replace it with the real second column below, which itself closes the grid `<div>` and is immediately followed by the same `</main>\n  )\n}` the placeholder had (don't drop those three closing lines — they must survive this edit):

```tsx
        <div className="flex flex-col gap-4">
          <div className="border border-brass/40 bg-gradient-to-b from-velvet/60 to-ink/80 p-5 sm:p-6">
            <p className="mb-4 font-mono text-[10.5px] uppercase tracking-[.24em] text-brass">{t('houseTonightLabel')}</p>
            <div className="grid grid-cols-3 gap-3.5">
              <div className="flex flex-col gap-1">
                {stats ? (
                  <CountUp to={stats.libraryCount} className="font-display text-[clamp(30px,4vw,44px)] leading-none text-marquee" />
                ) : (
                  <Skeleton className="h-10 w-16" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-wider text-ticket/60">{t('inLibraryLabel')}</span>
              </div>
              <div className="flex flex-col gap-1">
                {eligibleCount !== null ? (
                  <CountUp to={eligibleCount} className="font-display text-[clamp(30px,4vw,44px)] leading-none text-marquee" />
                ) : (
                  <Skeleton className="h-10 w-16" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-wider text-ticket/60">{t('inThePoolLabel')}</span>
              </div>
              <div className="flex flex-col gap-1">
                {stats ? (
                  <CountUp to={stats.nightsSettled} className="font-display text-[clamp(30px,4vw,44px)] leading-none text-marquee" />
                ) : (
                  <Skeleton className="h-10 w-16" />
                )}
                <span className="font-mono text-[10px] uppercase tracking-wider text-ticket/60">{t('nightsSettledLabel')}</span>
              </div>
            </div>
          </div>

          {stats && stats.recentMatches.length > 0 && (
            <div className="relative overflow-hidden border border-brass/40 bg-[#17110E] py-4">
              <p className="mb-3 px-4 font-mono text-[10.5px] uppercase tracking-[.24em] text-brass sm:px-6">{t('lastWeekLabel')}</p>
              <div
                className="flex w-max gap-3.5"
                style={{ animation: 'marqueeSlide 32s linear infinite' }}
              >
                {[...stats.recentMatches, ...stats.recentMatches].map((m, i) => (
                  <div key={i} className="flex w-[104px] flex-none flex-col gap-1.5">
                    <div className="flex h-[150px] w-[104px] items-end border border-brass/35 bg-[repeating-linear-gradient(135deg,#241A15_0_7px,#2E211A_7px_14px)] p-1.5">
                      <span className="font-mono text-[8.5px] leading-tight tracking-wider text-ticket/50">{m.title}</span>
                    </div>
                    <span className="font-mono text-[9px] tracking-wider text-brass">{m.year ?? ''}</span>
                  </div>
                ))}
              </div>
              <div
                className="absolute inset-x-0 top-0 h-3 bg-[repeating-linear-gradient(90deg,rgba(243,233,210,.22)_0_10px,transparent_10px_26px)]"
                style={{ animation: 'sprocket 1.1s linear infinite' }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-3 bg-[repeating-linear-gradient(90deg,rgba(243,233,210,.22)_0_10px,transparent_10px_26px)]"
                style={{ animation: 'sprocket 1.1s linear infinite' }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 border border-dashed border-brass/45 px-4.5 py-3.5 font-mono text-[11px] tracking-wider text-ticket/65">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: stats?.plexLinked ? '#1C6666' : '#CF4436',
                boxShadow: stats?.plexLinked ? '0 0 10px 2px rgba(28,102,102,.6)' : 'none',
              }}
            />
            {stats?.plexLinked
              ? t('plexLinkedStatus', { minutes: stats.lastSyncAt ? Math.max(0, Math.round((Date.now() - stats.lastSyncAt) / 60_000)) : 0 })
              : t('plexNotLinkedStatus')}
            <a
              href="/setup"
              className="ml-auto border border-brass/50 px-2.5 py-1.5 text-brass hover:border-marquee hover:text-ticket"
            >
              {t('projectionBoothLabel')}
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
```

This closes the `grid` `<div>` Task 8 opened, followed immediately by the `</main>`/return-paren/function-brace that were part of the file's original tail (restored here after Task 8's placeholder amendment above — do not drop them again). `stats.recentMatches` is duplicated (`[...stats.recentMatches, ...stats.recentMatches]`) to make the `marqueeSlide` keyframe's `-50%` translation loop seamlessly (the same doubling technique the mockup itself uses, and the same as `components/RoomShare.tsx`-adjacent screens will likely reuse later — not invented here). `eligibleCount` (used above) is real state, but its `useState`/fetch effect isn't added until Task 11 — this task must still typecheck and build on its own (every task does), so add this placeholder alongside the `stats` state from Step 2 for now:
```tsx
  const eligibleCount: number | null = null // placeholder — Task 11 replaces this with real useState + a debounced fetch effect
```
Task 11 deletes this exact line and replaces it with the real `useState` declaration — call this out explicitly in this task's commit message/report so the reviewer knows it's intentional and short-lived, not a forgotten stub.

Add `CountUp` and `Skeleton` imports:
```tsx
import CountUp from '../components/ui/reactbits/CountUp'
import { Skeleton } from '../components/ui/skeleton'
```
(`CountUp` is a default export — `export default function CountUp(...)` — confirmed directly against the vendored file; `Skeleton` is a named export — `export { Skeleton }` — confirmed against `components/ui/skeleton.tsx`.)

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS (once Task 11's `eligibleCount` state exists, or the temporary placeholder from Step 3 is in place).

- [ ] **Step 5: Run the message parity test**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx messages/en-us.json messages/pt-br.json
git commit -m "feat: add box office sidebar (stats, last-week reel strip, Plex status)"
```

---

## Task 11: Live eligible-count wiring

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/eligible-count` (Task 4, response shape `{ count: number }`).
- Produces: `eligibleCount: number | null` state that Task 10's sidebar already renders.

- [ ] **Step 1: Add the debounced-fetch effect**

Delete Task 10's `const eligibleCount: number | null = null` placeholder line and replace it with:
```tsx
  const [eligibleCount, setEligibleCount] = useState<number | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (genre) params.set('genre', genre)
    if (ratingMin) params.set('ratingMin', ratingMin)
    if (yearMin) params.set('yearMin', yearMin)
    if (yearMax) params.set('yearMax', yearMax)

    const timer = setTimeout(() => {
      fetch(`/api/eligible-count?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => body && setEligibleCount(body.count))
        .catch(() => {}) // decorative — a failed fetch just leaves the previous count (or the skeleton) in place
    }, 400)

    return () => clearTimeout(timer)
  }, [genre, ratingMin, yearMin, yearMax])
```

This depends on `genre`, `ratingMin`, `yearMin`, `yearMax` — all already existing `useState` values in this file (unchanged by this plan). No new imports needed (`useEffect` was already added to the import line in Task 10).

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Manually verify the live count**

`npm run dev` with `FAKE_EXTERNAL_APIS=true`, open the box office screen, type into the Genre field, confirm the "in the pool" number updates about 400ms after you stop typing (not on every keystroke).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire live eligible-count into box office filters"
```

---

## Task 12: `e2e/boxOffice.spec.ts` + final verification

**Files:**
- Create: `e2e/boxOffice.spec.ts`

**Interfaces:**
- Consumes: `seedFakeLibrary`, `pinEnglishLocale` (`e2e/fixtures.ts`, already exist).

- [ ] **Step 1: Write the test**

```ts
// e2e/boxOffice.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('box office shows real stats and a live eligible count, and still creates a room', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  // Stats load from the real fixture library seeded above — not zero.
  await expect(page.getByText('in library')).toBeVisible()
  const statsBlock = page.locator('text=in library').locator('..')
  await expect(statsBlock).not.toContainText('0', { timeout: 10000 })

  // Live eligible count responds to a filter edit.
  const genreInput = page.getByPlaceholder('e.g. Comedy')
  await genreInput.fill('Nonexistent Genre XYZ')
  await expect(page.getByText('in the pool').locator('..')).toContainText('0', { timeout: 5000 })
  await genreInput.fill('')

  // The restyled CTA still creates a room.
  await page.getByTestId('create-room').click()
  await page.waitForURL(/\/room\//)
})
```

Check the actual DOM structure Task 10 produced before finalizing the `statsBlock`/eligible-count locators above — `.locator('..')` (parent-selector) is fragile if the real JSX nesting doesn't put the number and its label in a simple parent/child relationship; if it doesn't match, use a more specific `data-testid` instead (add one to the relevant `<div>` in Task 10 if needed, e.g. `data-testid="stat-library"`/`data-testid="stat-pool"`, and use `getByTestId(...)` here instead of the text-based traversal above).

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/boxOffice.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 3: Final full verification**

```bash
npm run verify
```
Expected: PASS (typecheck + build + all Vitest tests).

Then, individually (not batched — see Task 9's note on pre-existing full-suite concurrency flakiness):
```bash
npx playwright test e2e/chrome.spec.ts --project=chromium
npx playwright test e2e/boxOffice.spec.ts --project=chromium
npx playwright test e2e/authorization.spec.ts --project=chromium
npx playwright test e2e/match.spec.ts --project=chromium
npx playwright test e2e/exhaustion.spec.ts --project=chromium
npx playwright test e2e/kicked.spec.ts --project=chromium
npx playwright test e2e/reconnect.spec.ts --project=chromium
npx playwright test e2e/exclusion.spec.ts --project=chromium
npx playwright test e2e/rateLimit.spec.ts --project=chromium
```
Expected: every one PASSES individually. (This is the same standard the foundation plan's final review established: the full suite together is pre-existing-flaky under concurrency, but every spec must pass on its own.)

- [ ] **Step 4: Commit**

```bash
git add e2e/boxOffice.spec.ts
git commit -m "test: add e2e coverage for box office stats and live eligible count"
```
