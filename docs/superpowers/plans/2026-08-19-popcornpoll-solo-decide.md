# PopcornPoll Solo Decide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a solo movie-picking track — `/solo` — that lets a single user filter their Plex/TMDB pool, browse a reputation-ranked shortlist, pick a title directly or let the house shuffle a weighted-random pick ("Surprise me"), and land on a confirmed-pick screen that writes to the same `match_history` table group rooms use.

**Architecture:** No room, no WebSocket, no participants — solo is a stateless HTTP flow layered directly on existing pool-building primitives (`buildPool`, `reputationScore`, `weightedSample`). A single client component (`app/solo/page.tsx`) drives three screens (`filters` → `shortlist` → `pick`) via local React state, calling three new HTTP endpoints (`GET /api/solo/pool`, `POST /api/solo/surprise`, `POST /api/solo/pick`) served by a new `server/http/solo.ts` module wired into the existing manual router in `server/index.ts`. A presentational `SurpriseReveal` overlay component (same shape as the existing `EdgeState` component) handles the shuffle animation and reveal. The header's chapter tracker (`PictureBoothHeader`/`RoomStatusContext`) gains a second, parallel 3-step track for the `/solo` route.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind (existing `ink`/`velvet`/`marquee`/`ticket`/`brass`/`exit-red` tokens — no new tokens needed), next-intl, Vitest, Playwright, better-sqlite3.

**Spec:** No separate spec doc for this round (user explicitly chose to skip straight to the plan, same as the Edge-states precedent). The design is grounded directly in the live Claude Design project (`PopcornPoll Reimagined.dc.html`, project id `a50231a4-d081-44fc-a694-0848627f0b30`), pulled via DesignSync this session — its `isSoloFilters` (~line 254), `isShortlist` (~332), `surpriseVisible` (~406), and `isSoloPick` (~446) blocks, plus the `isBoxOffice` block's new "FLYING SOLO?" panel (~240-249) and the JS state machine (`goSolo`/`submitSolo`/`surpriseMe`/`landSurprise`/`watchThis`/`pickTitle`/`soloAgain`, ~1064-1300, `FLOW.solo`/`STEP_OF` ~911-918) are the source of truth for copy, layout, and state transitions. Cross-referenced against the current backend (`server/pool/buildPool.ts`, `server/ranking/reputation.ts`, `server/ranking/rng.ts`, `server/room/tmdbFilters.ts`, `server/db/movies.ts`, `server/db/matchHistory.ts`, `server/auth/tokens.ts`, `server/http/rooms.ts`, `server/http/eligibleCount.ts`, `server/index.ts`) and current frontend chrome (`components/chrome/RoomStatusContext.tsx`, `components/chrome/PictureBoothHeader.tsx`, `components/EdgeState.tsx`, `components/CodeSlats.tsx`, `components/MarqueeReveal.tsx`, `app/page.tsx`) and i18n (`messages/en-us.json`, `messages/pt-br.json`).

## Global Constraints

- Reuse the existing `POOL_MIN_SIZE` constant from `server/pool/buildPool.ts` (currently `5`) everywhere a minimum-pool-size check is needed. The mockup's own prototype hardcodes a local `POOL_MIN_SIZE = 12` purely to make its demo chips easier to trigger — that is a prototype artifact, not a second real threshold. Do not introduce a second magic number.
- Generate a real per-pick `room_code` for `match_history` (`solo-XXXX`, 4 random uppercase-alphanumeric characters) via a new `generateSoloCode()` — never the mockup's literal demo constant `'solo-7QK4'`. `match_history.room_code` has no FK constraint (`server/db/migrations/002_match_history.sql`), and `nightsSettled()`'s `COUNT(DISTINCT room_code)` needs each solo pick to be its own "night," not collapsed under one shared literal.
- The following mockup elements are Claude Design preview/demo scaffolding and are explicitly OUT of scope — do not build them as real product surface: `soloDemoChips` (filter-preset preview chips), `listStateChips` (Loading/Populated/Degraded/Too-small preview toggle), `toggleRole` (host/guest/solo cycle button in the header — the real app decides "solo" purely by the `/solo` route), and the "Edge states…" dev dropdown (already excluded from the real app per the prior Edge-states work).
- The mockup's shortlist screen models a `soloListState: 'loading' | 'small'` as demo-only toggles with no real trigger condition behind them (`soloList()` just does `state === 'small' ? SOLO_POOL.slice(0,4) : SOLO_POOL`, never computed from a real threshold). In the real app, `GET /api/solo/pool` already rejects (422) any pool below `POOL_MIN_SIZE` before the client ever navigates to the shortlist screen, so a shortlist that renders is always populated with at least `POOL_MIN_SIZE` titles — there is no reachable "thin bill"/"too small" state to build on that screen, and no reachable loading-skeleton transition either (the fetch already resolved before `screen` becomes `'shortlist'`). Do not build `soloListSmall`/"THIN BILL TONIGHT" or a skeleton-card loading grid for the shortlist screen. The only loading affordance in scope is the "ROLLING THE REEL…" submitting state on the filters screen's submit button.
- A submit-time `pool_too_small`/`library_empty` failure (i.e., the live eligible-count preview was stale and the real `buildPool()` call still comes back too small) is a "nothing to lose yet" moment — same rule the Edge-states plan established for the room's Start action — so it shows the full-screen `EdgeState` component (reusing the already-shipped `edgeState.poolFail*`/`edgeState.emptyLibrary*` i18n keys and `errors.pool_too_small`/`errors.library_empty`), not a toast. This differs from the mockup's own prototype (which only has a `soloToast` banner for this case, because the prototype has no real `EdgeState` wiring for solo) — deliberately follow the app's own established pattern instead of the prototype here.
- All Tailwind classes are literal strings (no `` `border-${accent}` `` template interpolation) — matches `SetupStepTracker.tsx`/`EdgeState.tsx`'s existing lookup-object-of-literal-classes pattern.
- Every new i18n key goes into BOTH `messages/en-us.json` and `messages/pt-br.json` in the same task — `messages/messages.test.ts` asserts the two files declare exactly the same key set and fails the whole suite otherwise.
- `POST /api/solo/pick` checks `req.headers.get('origin') === config.appOrigin` before writing to `match_history`, matching `server/http/rooms.ts`'s existing origin check for the one other state-mutating room-creation endpoint. `GET /api/solo/pool` and `POST /api/solo/surprise` skip the origin check — neither mutates anything (mirrors `server/http/eligibleCount.ts`, which is GET-only and has no origin check); a cross-origin call to either can only make the server compute a movie pick and return it in a response the calling page's JS cannot read cross-origin without CORS headers (none are sent), so there is no real CSRF surface to defend there. Only `GET /api/solo/pool` gets a rate-limit bucket (mirrors `server/http/rooms.ts`'s bucket) — it is the only solo endpoint that can trigger a TMDB network call via `buildPool`; `surprise` and `pick` only touch this app's own SQLite and are cheap.
- `POST /api/solo/surprise` re-samples only from the exact set of `movieId`s the client's current shortlist already contains (looked up fresh from the DB by id, never trusting client-supplied rating/title data) — it does **not** call `buildPool`/TMDB again. This guarantees "Surprise me" and "Re-roll" only ever land on a title the user can already see in their shortlist, and keeps the endpoint cheap and rate-limit-free.

---

### Task 1: `generateSoloCode()` — solo's per-pick history code

**Files:**
- Modify: `server/auth/tokens.ts`
- Test: `server/auth/tokens.test.ts`

**Interfaces:**
- Produces: `generateSoloCode(): string`, format `solo-XXXX` (4 uppercase-alphanumeric characters, no `0`/`O`/`1`/`I` to avoid visual ambiguity when a user reads it off the confirmed-pick screen). Consumed by Task 2's `POST /api/solo/pick` handler.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `server/auth/tokens.test.ts` (after the existing `describe('generateRoomCode', ...)` block, before `describe('WORDS', ...)`):

```ts
describe('generateSoloCode', () => {
  it('matches the solo-XXXX format (4 unambiguous uppercase-alphanumeric chars)', () => {
    const code = generateSoloCode()
    expect(code).toMatch(/^solo-[A-HJ-NP-Z2-9]{4}$/)
  })

  it('generates different codes across calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateSoloCode()))
    expect(codes.size).toBeGreaterThan(1)
  })
})
```

Add `generateSoloCode` to the existing import line at the top of the file:

```ts
import { generateRoomCode, generateSoloCode, generateToken, WORDS } from './tokens'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/auth/tokens.test.ts`
Expected: FAIL — `generateSoloCode is not a function` (or similar import error).

- [ ] **Step 3: Implement `generateSoloCode`**

Add to `server/auth/tokens.ts` (after `generateRoomCode`):

```ts
// Solo picks aren't stored in a room — match_history.room_code still needs
// a stable per-pick value (no FK constraint on it, see
// server/db/migrations/002_match_history.sql). Excludes 0/O/1/I: the code
// is shown back to the user on the confirmed-pick screen, and those pairs
// are easy to misread in the app's monospace UI. Not a security boundary —
// nothing gates access by this value, unlike generateToken's tokens.
const SOLO_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateSoloCode(): string {
  let suffix = ''
  for (let i = 0; i < 4; i++) suffix += SOLO_CODE_CHARS[randomInt(SOLO_CODE_CHARS.length)]
  return `solo-${suffix}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/auth/tokens.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/auth/tokens.ts server/auth/tokens.test.ts
git commit -m "feat: add generateSoloCode for solo match_history entries"
```

---

### Task 2: `server/http/solo.ts` — pool/surprise/pick handlers

**Files:**
- Modify: `server/pool/buildPool.ts` (export `toEntry`)
- Create: `server/http/solo.ts`
- Test: `server/http/solo.test.ts`
- Modify: `server/index.ts` (wire the three routes)

**Interfaces:**
- Consumes: `buildPool`, `POOL_MIN_SIZE`, `toEntry`, `type PoolEntry` from `../pool/buildPool`; `computeCAndM`, `reputationScore` from `../ranking/reputation`; `createRng`, `weightedSample` from `../ranking/rng`; `validateTmdbFilters` from `../room/tmdbFilters`; `type CandidateSource`, `type TmdbFilters` from `../room/types`; `findById` from `../db/movies`; `insertMatch` from `../db/matchHistory`; `generateSoloCode` from `../auth/tokens` (Task 1); `createDefaultRateLimitBucket`, `getClientIp` from `../rateLimit`; `type AppConfig` from `../config`; `type TmdbClient` from `../tmdb/client`; `type createLibrarySync` from `../sync/librarySync`.
- Produces: `createSoloHandlers(db, tmdb, config, librarySync): { pool: (req, remoteAddress) => Promise<Response>, surprise: (req) => Promise<Response>, pick: (req) => Promise<Response> }`. Consumed by this task's own `server/index.ts` wiring and by Task 7's frontend fetches (`GET /api/solo/pool`, `POST /api/solo/surprise`, `POST /api/solo/pick`).

- [ ] **Step 1: Export `toEntry` from `buildPool.ts`**

In `server/pool/buildPool.ts`, change:

```ts
function toEntry(row: MovieRow): PoolEntry {
```

to:

```ts
export function toEntry(row: MovieRow): PoolEntry {
```

- [ ] **Step 2: Write the failing tests**

Create `server/http/solo.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb } from '../db'
import type { AppConfig } from '../config'
import { createFakeTmdbClient } from '../tmdb/fakeClient'
import { createSoloHandlers } from './solo'
import type Database from 'better-sqlite3'
import type { createLibrarySync } from '../sync/librarySync'

const config: AppConfig = {
  tmdbApiKey: 'x',
  authEncryptionKey: 'a'.repeat(32),
  adminSetupToken: 'admin',
  appOrigin: 'http://localhost:3100',
  trustedProxyHops: 0,
  port: 0,
  dataDir: '',
}

function fakeLibrarySync(): ReturnType<typeof createLibrarySync> {
  return {
    run: vi.fn().mockResolvedValue({ runId: 1, itemCount: 0 }),
    isRunning: vi.fn().mockReturnValue(false),
    waitForCurrent: vi.fn().mockResolvedValue(undefined),
    lastSyncAt: vi.fn().mockReturnValue(Date.now()),
  } as ReturnType<typeof createLibrarySync>
}

let db: Database.Database
let dir: string

function insertMovie(overrides: Partial<{ ratingKey: string; title: string; rating: number; voteCount: number; genres: string; year: number }> = {}) {
  const o = { ratingKey: `pk-${Math.random()}`, title: 'Fixture Title', rating: 7.5, voteCount: 500, genres: '["Drama"]', year: 1955, ...overrides }
  db.prepare(
    `INSERT INTO movies (plex_rating_key, title, poster_source, in_library, year, rating, vote_count, genres, cached_at)
     VALUES (@ratingKey, @title, 'plex', 1, @year, @rating, @voteCount, @genres, '2026-01-01T00:00:00.000Z')`,
  ).run(o)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'popcornpoll-solo-'))
  db = openDb(dir)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('pool', () => {
  it('returns a pool ranked by reputation score (highest first)', async () => {
    insertMovie({ title: 'Low Rep', rating: 6.0, voteCount: 50 })
    insertMovie({ title: 'High Rep', rating: 9.0, voteCount: 5000 })
    insertMovie({ title: 'Mid Rep', rating: 7.5, voteCount: 500 })
    insertMovie({ title: 'Fourth', rating: 7.0, voteCount: 300 })
    insertMovie({ title: 'Fifth', rating: 8.0, voteCount: 800 })

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool'), '127.0.0.1')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pool).toHaveLength(5)
    expect(body.pool[0].title).toBe('High Rep')
    expect(body.degraded).toBe(false)
  })

  it('returns 422 pool_too_small when fewer than POOL_MIN_SIZE titles are eligible', async () => {
    insertMovie()
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool'), '127.0.0.1')
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('pool_too_small')
  })

  it('returns 422 library_empty when the unfiltered library has zero eligible rows', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool'), '127.0.0.1')
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('library_empty')
  })

  it('rejects yearMin > yearMax with 400 invalid_filters', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pool(new Request('http://localhost/api/solo/pool?yearMin=2000&yearMax=1990'), '127.0.0.1')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_filters')
  })
})

describe('surprise', () => {
  it('picks one of the given movieIds and excludes ids in `exclude`', async () => {
    insertMovie({ title: 'A' })
    insertMovie({ title: 'B' })
    const rows = db.prepare('SELECT id, title FROM movies ORDER BY title').all() as { id: number; title: string }[]
    const aId = rows.find((r) => r.title === 'A')!.id
    const bId = rows.find((r) => r.title === 'B')!.id

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', {
        method: 'POST',
        body: JSON.stringify({ movieIds: [aId, bId], exclude: [aId] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entry.movieId).toBe(bId)
  })

  it('falls back to the full candidate set when exclude would empty it', async () => {
    insertMovie({ title: 'Only One' })
    const row = db.prepare('SELECT id FROM movies').get() as { id: number }

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', {
        method: 'POST',
        body: JSON.stringify({ movieIds: [row.id], exclude: [row.id] }),
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).entry.movieId).toBe(row.id)
  })

  it('rejects a malformed body with 400 invalid_body', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.surprise(
      new Request('http://localhost/api/solo/surprise', { method: 'POST', body: JSON.stringify({ movieIds: 'nope' }) }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_body')
  })
})

describe('pick', () => {
  it('writes match_history with a fresh solo-XXXX code and returns it', async () => {
    insertMovie({ title: 'Picked One' })
    const row = db.prepare('SELECT id FROM movies').get() as { id: number }

    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: config.appOrigin },
        body: JSON.stringify({ movieId: row.id }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.roomCode).toMatch(/^solo-[A-HJ-NP-Z2-9]{4}$/)

    const history = db.prepare('SELECT title, room_code FROM match_history').get() as { title: string; room_code: string }
    expect(history.title).toBe('Picked One')
    expect(history.room_code).toBe(body.roomCode)
  })

  it('returns 404 movie_not_found for an unknown movieId', async () => {
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: config.appOrigin },
        body: JSON.stringify({ movieId: 999999 }),
      }),
    )
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('movie_not_found')
  })

  it('rejects a cross-origin request with 403 forbidden_origin', async () => {
    insertMovie()
    const row = db.prepare('SELECT id FROM movies').get() as { id: number }
    const handlers = createSoloHandlers(db, createFakeTmdbClient(), config, fakeLibrarySync())
    const res = await handlers.pick(
      new Request('http://localhost/api/solo/pick', {
        method: 'POST',
        headers: { origin: 'http://evil.example' },
        body: JSON.stringify({ movieId: row.id }),
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden_origin')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run server/http/solo.test.ts`
Expected: FAIL — `Cannot find module './solo'`

- [ ] **Step 4: Implement `server/http/solo.ts`**

```ts
// server/http/solo.ts
import type Database from 'better-sqlite3'
import { generateSoloCode } from '../auth/tokens'
import { findById } from '../db/movies'
import { insertMatch } from '../db/matchHistory'
import { buildPool, toEntry, type PoolEntry } from '../pool/buildPool'
import { computeCAndM, reputationScore } from '../ranking/reputation'
import { createRng, weightedSample } from '../ranking/rng'
import { createDefaultRateLimitBucket, getClientIp } from '../rateLimit'
import { validateTmdbFilters } from '../room/tmdbFilters'
import type { CandidateSource, TmdbFilters } from '../room/types'
import type { AppConfig } from '../config'
import type { TmdbClient } from '../tmdb/client'
import type { createLibrarySync } from '../sync/librarySync'

function numOrUndefined(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function isSurpriseBody(v: unknown): v is { movieIds: number[]; exclude?: number[] } {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.movieIds) || o.movieIds.length === 0 || !o.movieIds.every((x) => typeof x === 'number')) return false
  if (o.exclude !== undefined && (!Array.isArray(o.exclude) || !o.exclude.every((x) => typeof x === 'number'))) return false
  return true
}

function isPickBody(v: unknown): v is { movieId: number } {
  return typeof v === 'object' && v !== null && typeof (v as { movieId?: unknown }).movieId === 'number'
}

export function createSoloHandlers(
  db: Database.Database,
  tmdb: TmdbClient,
  config: AppConfig,
  librarySync: ReturnType<typeof createLibrarySync>,
) {
  // Only `pool` calls buildPool (the one call that can hit TMDB) — see
  // Global Constraints for why surprise/pick don't get a bucket.
  const poolRateLimitBucket = createDefaultRateLimitBucket()

  async function pool(req: Request, remoteAddress: string | undefined): Promise<Response> {
    const clientIp = getClientIp(req.headers.get('x-forwarded-for'), remoteAddress, config.trustedProxyHops)
    if (!poolRateLimitBucket.tryConsume(clientIp)) {
      return Response.json(
        { error: { code: 'rate_limited', message: 'too many requests, please slow down' } },
        { status: 429 },
      )
    }

    const url = new URL(req.url)
    const candidateSource: CandidateSource = url.searchParams.get('candidateSource') === 'plex+tmdb' ? 'plex+tmdb' : 'plex'
    const raw: TmdbFilters = {
      genre: url.searchParams.get('genre') ?? undefined,
      yearMin: numOrUndefined(url.searchParams.get('yearMin')),
      yearMax: numOrUndefined(url.searchParams.get('yearMax')),
      ratingMin: numOrUndefined(url.searchParams.get('ratingMin')),
    }
    const filterResult = validateTmdbFilters(raw)
    if (!filterResult.ok) {
      return Response.json(
        { error: { code: 'invalid_filters', message: 'yearMin must be <= yearMax' } },
        { status: 400 },
      )
    }

    await librarySync.waitForCurrent()
    const result = await buildPool(db, tmdb, candidateSource, filterResult.filters, Date.now())
    if (result.tooSmall) {
      const code = result.tooSmallReason === 'library_empty' ? 'library_empty' : 'pool_too_small'
      return Response.json({ error: { code, message: 'not enough eligible titles' } }, { status: 422 })
    }

    const { c, m } = computeCAndM(result.pool)
    const ranked = [...result.pool].sort((a, b) => reputationScore(b, c, m) - reputationScore(a, c, m))
    return Response.json({ pool: ranked, degraded: result.degraded })
  }

  async function surprise(req: Request): Promise<Response> {
    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_body', message: 'malformed JSON' } }, { status: 400 })
    }
    if (!isSurpriseBody(parsed)) {
      return Response.json(
        { error: { code: 'invalid_body', message: 'movieIds must be a non-empty number array' } },
        { status: 400 },
      )
    }

    const rows = parsed.movieIds.map((id) => findById(db, id)).filter((r) => r !== null)
    if (rows.length === 0) {
      return Response.json({ error: { code: 'pool_too_small', message: 'no eligible titles to shuffle' } }, { status: 422 })
    }

    const exclude = new Set(parsed.exclude ?? [])
    const fresh = rows.filter((r) => !exclude.has(r.id))
    const candidates = fresh.length > 0 ? fresh : rows

    const { c, m } = computeCAndM(rows)
    const rng = createRng(Date.now())
    const picked = weightedSample(candidates, (row) => reputationScore(row, c, m), rng)
    return Response.json({ entry: toEntry(picked) })
  }

  async function pick(req: Request): Promise<Response> {
    if (config.appOrigin && req.headers.get('origin') !== config.appOrigin) {
      return Response.json({ error: { code: 'forbidden_origin', message: 'request origin not allowed' } }, { status: 403 })
    }
    let parsed: unknown
    try {
      parsed = await req.json()
    } catch {
      return Response.json({ error: { code: 'invalid_body', message: 'malformed JSON' } }, { status: 400 })
    }
    if (!isPickBody(parsed)) {
      return Response.json({ error: { code: 'invalid_body', message: 'movieId must be a number' } }, { status: 400 })
    }

    const row = findById(db, parsed.movieId)
    if (!row) {
      return Response.json({ error: { code: 'movie_not_found', message: 'movie not found' } }, { status: 404 })
    }

    const roomCode = generateSoloCode()
    insertMatch(db, {
      movieId: row.id,
      roomCode,
      title: row.title,
      posterPath: row.posterPath,
      posterSource: row.posterSource,
      year: row.year,
    })
    return Response.json({ roomCode })
  }

  return { pool, surprise, pick }
}
```

Note: `PoolEntry` is imported for the module's own type-checking of `result.pool`/`toEntry`'s return — it is re-exported implicitly via `createSoloHandlers`' inferred return type, no explicit re-export needed here.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/http/solo.test.ts server/pool/buildPool.test.ts`
Expected: PASS (the `buildPool.test.ts` re-run confirms exporting `toEntry` didn't change its behavior)

- [ ] **Step 6: Wire the three routes into `server/index.ts`**

Add the import (after the existing `createEligibleCountHandler` import):

```ts
import { createSoloHandlers } from './http/solo'
```

Add the handler construction (after the existing `eligibleCountHandler` line):

```ts
  const soloHandlers = createSoloHandlers(db, tmdb, config, librarySync)
```

Add the three routes to the `else if` chain (after the existing `/api/eligible-count` branch):

```ts
        else if (url.pathname === '/api/solo/pool' && req.method === 'GET')
          webRes = await soloHandlers.pool(webReq, req.socket.remoteAddress)
        else if (url.pathname === '/api/solo/surprise' && req.method === 'POST') webRes = await soloHandlers.surprise(webReq)
        else if (url.pathname === '/api/solo/pick' && req.method === 'POST') webRes = await soloHandlers.pick(webReq)
```

- [ ] **Step 7: Run the full server test suite**

Run: `npx vitest run server`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/pool/buildPool.ts server/http/solo.ts server/http/solo.test.ts server/index.ts
git commit -m "feat: add solo pool/surprise/pick HTTP endpoints"
```

---

### Task 3: i18n — solo copy in both locales

**Files:**
- Modify: `messages/en-us.json`
- Modify: `messages/pt-br.json`
- Test: `messages/messages.test.ts` (existing — asserts key-set parity, no edits needed)

**Interfaces:**
- Produces: a new top-level `solo` namespace (sibling to `createRoom`/`room`), three new `chrome.soloStep*` keys, and `errors.movie_not_found`. Consumed by Task 4 (chrome), Task 6 (`SurpriseReveal`), and Task 7 (`app/solo/page.tsx`).
- Consumes: nothing new. The solo screens also reuse the existing `createRoom` namespace's filter-panel keys (`genreLabel`, `genrePlaceholder`, `yearFromLabel`, `yearToLabel`, `minRatingLabel`, `sourcesPlexTitle`, `sourcesPlexNote`, `sourcesTmdbTitle`, `sourcesTmdbNote`, `housePicturesLabel`, `trimTheBillLabel`) rather than duplicating them — DRY, and they're already proven-translated in both locales.

- [ ] **Step 1: Add the new keys to `messages/en-us.json`**

Insert into the existing `chrome` object (after `"tmdbAttribution"`, before the closing `}`):

```json
    "soloStepFilters": "Trim the bill",
    "soloStepShortlist": "Tonight's bill",
    "soloStepPick": "Your pick"
```

Insert into the existing `createRoom` object (after `"tonightsShowingLabel"`, before the closing `}`) — this is the "FLYING SOLO?" panel that lives on the Box Office screen, so it belongs in `createRoom`, not `solo`:

```json
    "flyingSoloKicker": "Single admission · no room needed",
    "flyingSoloTitle": "FLYING SOLO?",
    "flyingSoloBody": "Same filters, no votes to wait on. The house trims your shelf and hands you a shortlist — or picks one for you.",
    "flyingSoloButton": "TRIM THE BILL, SOLO →"
```

Insert into the existing `errors` object (after `"library_empty"`, before `"generic"`):

```json
    "movie_not_found": "That movie could not be found.",
```

Add a new top-level `"solo"` object (after the existing `"edgeState"` object, before the file's closing `}` — remember to add a comma after `edgeState`'s closing `}`):

```json
  "solo": {
    "kicker": "One seat · one picture · /solo",
    "title": "TRIM THE BILL, SOLO",
    "subhead": "No room, no house rule, nobody to out-vote you. Narrow the shelf and the house lays out a ranked bill — or picks one for you.",
    "singleAdmissionLabel": "SINGLE ADMISSION",
    "seatLabel": "Row A · Seat 01",
    "eligibleLabel": "Eligible on your shelf",
    "titlesLabel": "titles",
    "tooFewWarning": "Only {count} clear these filters. The house needs {min} to shuffle a fair bill — loosen the rating or widen the years.",
    "submitLabel": "ROLL THE REEL",
    "submittingLabel": "ROLLING THE REEL…",
    "noThresholdNote": "No threshold, no tally · this ticket admits one",
    "backToBoxOfficeLink": "Rather host a room? Back to the box office",
    "shortlistKicker": "Solo · ranked by house reputation",
    "shortlistTitle": "TONIGHT'S BILL",
    "shortlistCountLabel": "{count} titles cleared your filters · best first",
    "adjustFiltersButton": "Adjust filters",
    "surpriseMeButton": "SURPRISE ME",
    "degradedNotice": "TMDB did not answer in time. This bill is your Plex shelf only — still perfectly watchable.",
    "pickThisButton": "Pick this",
    "onShelfBadge": "ON SHELF",
    "footerNote": "Pick one outright, or let the house shuffle · nothing is saved until you confirm",
    "housePicksLabel": "The house picks",
    "shufflingLabel": "Shuffling {count} titles…",
    "watchThisButton": "WATCH THIS",
    "rerollButton": "Re-roll",
    "seenNote": "Seen {seen} of {total} this session · a re-roll will not repeat them",
    "backToBillButton": "Back to the bill",
    "pickDimLabel": "The house lights dim · just for you",
    "writtenToHistory": "Written to your history · {code} · one seat",
    "pickAgainButton": "PICK AGAIN",
    "enjoyFooter": "enjoy the picture · the projector is yours alone tonight"
  }
```

- [ ] **Step 2: Add the matching keys to `messages/pt-br.json`**

Insert into `chrome` (after `"tmdbAttribution"`):

```json
    "soloStepFilters": "Ajustar filtros",
    "soloStepShortlist": "A lista de hoje",
    "soloStepPick": "Sua escolha"
```

Insert into `createRoom` (after `"tonightsShowingLabel"`):

```json
    "flyingSoloKicker": "Entrada única · sem sala necessária",
    "flyingSoloTitle": "SOZINHO HOJE?",
    "flyingSoloBody": "Os mesmos filtros, sem votos para esperar. A casa reduz sua prateleira e te dá uma lista — ou escolhe por você.",
    "flyingSoloButton": "AJUSTAR SOZINHO →"
```

Insert into `errors` (after `"library_empty"`):

```json
    "movie_not_found": "Esse filme não foi encontrado.",
```

Add the new top-level `"solo"` object (after `"edgeState"`, with a comma after its closing `}`):

```json
  "solo": {
    "kicker": "Um assento · um filme · /solo",
    "title": "AJUSTE A SESSÃO, SOZINHO",
    "subhead": "Sem sala, sem regra da casa, ninguém pra te vencer no voto. Reduza a prateleira e a casa monta uma lista classificada — ou escolhe por você.",
    "singleAdmissionLabel": "ENTRADA ÚNICA",
    "seatLabel": "Fileira A · Assento 01",
    "eligibleLabel": "Elegíveis na sua prateleira",
    "titlesLabel": "títulos",
    "tooFewWarning": "Só {count} passam por esses filtros. A casa precisa de {min} para montar uma lista justa — reduza a nota ou amplie os anos.",
    "submitLabel": "GIRAR O ROLO",
    "submittingLabel": "GIRANDO O ROLO…",
    "noThresholdNote": "Sem regra, sem contagem · este ingresso vale para um",
    "backToBoxOfficeLink": "Prefere reunir um grupo? Voltar para a bilheteria",
    "shortlistKicker": "Sozinho · classificado pela reputação da casa",
    "shortlistTitle": "A LISTA DE HOJE",
    "shortlistCountLabel": "{count} títulos passaram pelos seus filtros · melhores primeiro",
    "adjustFiltersButton": "Ajustar filtros",
    "surpriseMeButton": "SURPREENDA-ME",
    "degradedNotice": "O TMDB não respondeu a tempo. Esta lista é só da sua prateleira do Plex — ainda ótima para assistir.",
    "pickThisButton": "Escolher este",
    "onShelfBadge": "NA PRATELEIRA",
    "footerNote": "Escolha um diretamente, ou deixe a casa sortear · nada é salvo até você confirmar",
    "housePicksLabel": "A casa escolhe",
    "shufflingLabel": "Sorteando {count} títulos…",
    "watchThisButton": "ASSISTIR ESTE",
    "rerollButton": "Sortear de novo",
    "seenNote": "Visto {seen} de {total} nesta sessão · um novo sorteio não vai repeti-los",
    "backToBillButton": "Voltar para a lista",
    "pickDimLabel": "As luzes da casa diminuem · só para você",
    "writtenToHistory": "Registrado no seu histórico · {code} · um assento",
    "pickAgainButton": "ESCOLHER DE NOVO",
    "enjoyFooter": "aproveite o filme · o projetor é só seu hoje"
  }
```

- [ ] **Step 3: Run the message parity test**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add messages/en-us.json messages/pt-br.json
git commit -m "i18n: add solo-decide copy for both locales"
```

---

### Task 4: Chrome — solo chapter track in the header

**Files:**
- Modify: `components/chrome/RoomStatusContext.tsx`
- Modify: `components/chrome/PictureBoothHeader.tsx`
- Test: no dedicated unit test file exists for either today (both are thin/presentational) — this task's `data-testid="chapter-indicator"` behavior is covered by Task 8's e2e test instead, matching how the room flow's existing chapter tracker has no unit test either.

**Interfaces:**
- Produces: `ChapterStep` gains three new members: `'soloFilters' | 'soloShortlist' | 'soloPick'`. Consumed by Task 7 (`app/solo/page.tsx` calls `useSetRoomStep('soloFilters' | 'soloShortlist' | 'soloPick')`).
- Consumes: nothing new.

- [ ] **Step 1: Extend `ChapterStep` in `RoomStatusContext.tsx`**

In `components/chrome/RoomStatusContext.tsx`, change:

```ts
export type ChapterStep = 'entry' | 'lobby' | 'deck' | 'wrapup'
```

to:

```ts
export type ChapterStep = 'entry' | 'lobby' | 'deck' | 'wrapup' | 'soloFilters' | 'soloShortlist' | 'soloPick'
```

No other change needed in this file — `useSetRoomStep`/`useRoomStep`/the context itself are already generic over `ChapterStep`.

- [ ] **Step 2: Add the solo step array, route inference, and label map to `PictureBoothHeader.tsx`**

Replace the file's `STEPS` constant and `stepFromPath` function:

```ts
const ROOM_STEPS: ChapterStep[] = ['entry', 'lobby', 'deck', 'wrapup']
const SOLO_STEPS: ChapterStep[] = ['soloFilters', 'soloShortlist', 'soloPick']

// Route-only inference for screens this plan doesn't wire real state into
// yet: '/' and '/join/[code]' are always 'entry' (nothing else they could
// be); '/room/[code]' defaults to 'lobby' unless a room page has pushed a
// more specific step via useSetRoomStep; '/solo' defaults to 'soloFilters'
// the same way, pushed by app/solo/page.tsx as its own screen state
// changes; '/setup' isn't part of this flow, so no step highlights there.
function stepFromPath(pathname: string, pushedStep: ChapterStep | null): ChapterStep | null {
  if (pathname === '/') return 'entry'
  if (pathname.startsWith('/join/')) return 'entry'
  if (pathname.startsWith('/room/')) return pushedStep ?? 'lobby'
  if (pathname === '/solo') return pushedStep ?? 'soloFilters'
  return null
}
```

Replace the body of `PictureBoothHeader` (from `const isGuestFlow = ...` through the `labels[step]` render) with:

```ts
  const isGuestFlow = pathname.startsWith('/join/')
  const isSoloFlow = pathname.startsWith('/solo')
  const currentStep = stepFromPath(pathname, pushedStep)
  const STEPS = isSoloFlow ? SOLO_STEPS : ROOM_STEPS
  const hostLabels: Record<'entry' | 'lobby' | 'deck' | 'wrapup', string> = {
    entry: tChrome('hostStepEntry'),
    lobby: tChrome('hostStepLobby'),
    deck: tChrome('hostStepDeck'),
    wrapup: tChrome('hostStepWrapup'),
  }
  const guestLabels: Record<'entry' | 'lobby' | 'deck' | 'wrapup', string> = {
    entry: tChrome('guestStepEntry'),
    lobby: tChrome('guestStepLobby'),
    deck: tChrome('guestStepDeck'),
    wrapup: tChrome('guestStepWrapup'),
  }
  const soloLabels: Record<'soloFilters' | 'soloShortlist' | 'soloPick', string> = {
    soloFilters: tChrome('soloStepFilters'),
    soloShortlist: tChrome('soloStepShortlist'),
    soloPick: tChrome('soloStepPick'),
  }
  const labels: Record<string, string> = isSoloFlow ? soloLabels : isGuestFlow ? guestLabels : hostLabels
```

The JSX below is unchanged (it already does `STEPS.map(...)`, `labels[step]`, `STEPS.indexOf(currentStep)`) — it now works for both tracks since `STEPS` and `labels` are computed per-flow above it.

- [ ] **Step 3: Typecheck and run the existing test suite (no regressions)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (this task adds no new test file, but must not break `e2e/*` compile or any existing unit test)

- [ ] **Step 4: Commit**

```bash
git add components/chrome/RoomStatusContext.tsx components/chrome/PictureBoothHeader.tsx
git commit -m "feat: add solo chapter track to the header"
```

---

### Task 5: Box Office — "FLYING SOLO?" panel

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation` (already imported in this file).
- Produces: nothing new consumed elsewhere — this is a pure UI addition.

- [ ] **Step 1: Add the panel**

In `app/page.tsx`, insert a new grid item as the last child of the `grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]` grid (i.e., immediately after the closing `</div>` of the `flex flex-col gap-4` right-column div, still inside the grid, before that grid's own closing `</div>`):

```tsx
        <div className="grid-column relative col-span-full flex flex-wrap items-center gap-5 border border-brass/40 bg-gradient-to-br from-ticket to-ticket/85 px-5 py-5 text-ink shadow-[0_18px_44px_-24px_rgba(0,0,0,.85)] sm:px-7">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[.24em] text-ink/60">{t('flyingSoloKicker')}</p>
            <p className="font-display text-xl tracking-wide sm:text-2xl">{t('flyingSoloTitle')}</p>
            <p className="max-w-[56ch] text-[12.5px] leading-relaxed text-ink/70">{t('flyingSoloBody')}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/solo')}
            data-testid="flying-solo"
            className="flex-none border-2 border-ink/50 px-5 py-3.5 font-display text-sm tracking-wide text-ink transition-colors hover:bg-ink hover:text-ticket sm:text-base"
          >
            {t('flyingSoloButton')}
          </button>
        </div>
```

`col-span-full` requires the grid item to sit as a direct child of the `lg:grid-cols-[...]` grid — verify by reading the surrounding JSX before inserting (the two existing direct children are the ticket-form panel and the `flex flex-col gap-4` stats column; this becomes the third).

- [ ] **Step 2: Run the box office e2e test (no regressions)**

Run: `npx playwright test e2e/boxOffice.spec.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add Flying Solo panel to the box office screen"
```

---

### Task 6: `components/SurpriseReveal.tsx` — shuffle overlay

**Files:**
- Modify: `app/globals.css` (new `reelSpin` keyframe)
- Create: `components/SurpriseReveal.tsx`
- Test: `components/SurpriseReveal.test.ts`

**Interfaces:**
- Consumes: `CodeSlats` from `./CodeSlats` (`slatGroups`/default export, `splitOn: 'space'`, same pattern as `MarqueeReveal.tsx`); `type PoolEntry` from `../server/pool/buildPool`.
- Produces: `SurpriseReveal` component with props `{ visible: boolean; spinning: boolean; card: PoolEntry | null; seenCount: number; totalCount: number; onWatchThis: () => void; onReroll: () => void; onClose: () => void }`. Consumed by Task 7 (`app/solo/page.tsx`).

- [ ] **Step 1: Add the `reelSpin` keyframe**

In `app/globals.css`, add (after the existing `@keyframes sprocket` block):

```css
@keyframes reelSpin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: Write the failing test**

This project has no `@testing-library/react` dependency and `vitest.config.ts` sets `environment: 'node'` (no DOM) — component tests here follow `components/CodeSlats.tsx`/`.test.ts`'s pattern instead: extract pure, non-JSX logic into its own exported function and unit-test that directly; rendering is covered by e2e (Task 8's `e2e/solo.spec.ts` already exercises this component's `surprise-me`/`watch-this`/`reroll` data-testids). Do not add `@testing-library/react` or change `vitest.config.ts`.

Create `components/SurpriseReveal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMetaParts } from './SurpriseReveal'
import type { PoolEntry } from '../server/pool/buildPool'

const card: PoolEntry = {
  movieId: 1,
  title: 'Double Feature',
  posterPath: null,
  posterSource: 'plex',
  overview: 'Two stories, one screen.',
  genres: ['Drama'],
  year: 1958,
  inLibrary: true,
  rating: 8.1,
  voteCount: 900,
}

describe('buildMetaParts', () => {
  it('joins year, lowercased genres, and rating for a full card', () => {
    expect(buildMetaParts(card)).toEqual(['1958', 'drama', '★ 8.1'])
  })

  it('omits a null year', () => {
    expect(buildMetaParts({ ...card, year: null })).toEqual(['drama', '★ 8.1'])
  })

  it('omits empty genres', () => {
    expect(buildMetaParts({ ...card, genres: [] })).toEqual(['1958', '★ 8.1'])
  })

  it('omits a null rating', () => {
    expect(buildMetaParts({ ...card, rating: null })).toEqual(['1958', 'drama'])
  })

  it('returns an empty array when card is null', () => {
    expect(buildMetaParts(null)).toEqual([])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run components/SurpriseReveal.test.ts`
Expected: FAIL — `Cannot find module './SurpriseReveal'`

- [ ] **Step 4: Implement `components/SurpriseReveal.tsx`**

```tsx
// components/SurpriseReveal.tsx
// A fixed overlay for solo's "Surprise me" — mirrors MarqueeReveal's
// split-flap-title treatment for the revealed state, and EdgeState's
// caller-supplies-copy shape. Two internal states driven by `spinning`:
// a reel-spinner while the pick is in flight, then the revealed card with
// watch/re-roll actions.
'use client'

import { useTranslations } from 'next-intl'
import CodeSlats from './CodeSlats'
import type { PoolEntry } from '../server/pool/buildPool'

export interface SurpriseRevealProps {
  visible: boolean
  spinning: boolean
  card: PoolEntry | null
  seenCount: number
  totalCount: number
  onWatchThis: () => void
  onReroll: () => void
  onClose: () => void
}

// Pure, exported separately from the component so it's directly unit-testable
// without a DOM/render harness — this project's tests don't use jsdom or
// @testing-library/react (see components/CodeSlats.tsx's slatGroups() for
// the same pattern: pure logic extracted and tested standalone, rendering
// left to e2e coverage).
export function buildMetaParts(card: PoolEntry | null): string[] {
  if (!card) return []
  return [
    card.year ? String(card.year) : null,
    card.genres.length > 0 ? card.genres.join(', ').toLowerCase() : null,
    card.rating !== null ? `★ ${card.rating.toFixed(1)}` : null,
  ].filter((part): part is string => part !== null)
}

export function SurpriseReveal({ visible, spinning, card, seenCount, totalCount, onWatchThis, onReroll, onClose }: SurpriseRevealProps) {
  const t = useTranslations('solo')
  if (!visible) return null

  const metaParts = buildMetaParts(card)

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[42] flex flex-col items-center justify-center gap-6 overflow-auto bg-[radial-gradient(circle_at_50%_45%,rgba(44,17,22,.93),rgba(16,12,9,.98))] p-4 sm:p-10"
      style={{ animation: 'revealUp .4s ease-out both' }}
    >
      <div className="relative box-border w-full max-w-[880px] border-[3px] border-brass bg-gradient-to-b from-velvet/90 to-ink/95 px-6 py-8 text-center shadow-[0_0_120px_-20px_rgba(245,166,35,.4)] sm:px-10 sm:py-11">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[.5em] text-marquee">{t('housePicksLabel')}</p>

        {spinning && (
          <div className="flex flex-col items-center gap-5 py-3.5">
            <div
              className="relative aspect-square w-[min(30vmin,150px)] rounded-full border-2 border-ticket/30"
              aria-hidden
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, rgba(245,166,35,.5) 0 70deg, transparent 70deg 180deg, rgba(245,166,35,.5) 180deg 250deg, transparent 250deg)',
                  animation: 'reelSpin .9s linear infinite',
                }}
              />
            </div>
            <p className="font-mono text-[10.5px] uppercase tracking-[.24em] text-brass">
              {t('shufflingLabel', { count: totalCount })}
            </p>
          </div>
        )}

        {!spinning && card && (
          <div className="flex flex-col items-center gap-4">
            <CodeSlats code={card.title.toUpperCase()} splitOn="space" />
            {metaParts.length > 0 && (
              <p className="font-mono text-xs uppercase tracking-widest text-ticket/70">{metaParts.join(' · ')}</p>
            )}
            {card.overview && <p className="max-w-[52ch] text-sm leading-relaxed text-ticket/70">{card.overview}</p>}
            <div className="mt-2.5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={onWatchThis}
                data-testid="watch-this"
                className="bg-marquee px-7 py-4 font-display text-lg text-ink hover:bg-marquee/90"
              >
                {t('watchThisButton')}
              </button>
              <button
                type="button"
                onClick={onReroll}
                data-testid="reroll"
                className="border border-brass/60 px-5 py-4 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
              >
                {t('rerollButton')}
              </button>
            </div>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-brass/85">
              {t('seenNote', { seen: seenCount, total: totalCount })}
            </p>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="border border-brass/40 px-4.5 py-3 font-mono text-[10.5px] uppercase tracking-widest text-brass hover:border-marquee hover:text-ticket"
      >
        {t('backToBillButton')}
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run components/SurpriseReveal.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/globals.css components/SurpriseReveal.tsx components/SurpriseReveal.test.ts
git commit -m "feat: add SurpriseReveal overlay component"
```

---

### Task 7: `app/solo/page.tsx` — filters, shortlist, and pick screens

**Files:**
- Create: `app/solo/page.tsx`

**Interfaces:**
- Consumes: `useSetRoomStep` from `../../components/chrome/RoomStatusContext` (Task 4); `EdgeState` from `../../components/EdgeState`; `SurpriseReveal` from `../../components/SurpriseReveal` (Task 6); `type PoolEntry` from `../../server/pool/buildPool`; `type CandidateSource` from `../../server/room/types`; the `GET /api/solo/pool`, `POST /api/solo/surprise`, `POST /api/solo/pick` endpoints (Task 2); `solo`/`createRoom`/`errors`/`edgeState` i18n namespaces (Task 3).
- Produces: nothing consumed elsewhere — this is the flow's entry page.

- [ ] **Step 1: Implement `app/solo/page.tsx`**

```tsx
// app/solo/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import CodeSlats from '../../components/CodeSlats'
import { EdgeState } from '../../components/EdgeState'
import { SurpriseReveal } from '../../components/SurpriseReveal'
import { useSetRoomStep } from '../../components/chrome/RoomStatusContext'
import type { PoolEntry } from '../../server/pool/buildPool'
import type { CandidateSource } from '../../server/room/types'

type Screen = 'filters' | 'shortlist' | 'pick'
type SubmitError = 'pool_too_small' | 'library_empty' | null

export default function SoloPage() {
  const t = useTranslations('solo')
  const tCreateRoom = useTranslations('createRoom')
  const tErrors = useTranslations('errors')
  const tEdge = useTranslations('edgeState')
  const router = useRouter()

  const [screen, setScreen] = useState<Screen>('filters')
  const [candidateSource, setCandidateSource] = useState<CandidateSource>('plex')
  const [genre, setGenre] = useState('')
  const [ratingMin, setRatingMin] = useState('')
  const [yearMin, setYearMin] = useState('')
  const [yearMax, setYearMax] = useState('')
  const [eligibleCount, setEligibleCount] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<SubmitError>(null)

  const [shortlist, setShortlist] = useState<PoolEntry[]>([])
  const [degraded, setDegraded] = useState(false)
  const [seen, setSeen] = useState<number[]>([])

  const [surpriseVisible, setSurpriseVisible] = useState(false)
  const [surpriseSpinning, setSurpriseSpinning] = useState(false)
  const [surpriseCard, setSurpriseCard] = useState<PoolEntry | null>(null)

  const [pickedCard, setPickedCard] = useState<PoolEntry | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  useSetRoomStep(screen === 'filters' ? 'soloFilters' : screen === 'shortlist' ? 'soloShortlist' : 'soloPick')

  // Same live-count preview /api/eligible-count already powers on the box
  // office's create-room form — reused as-is (same 400ms debounce, same
  // Plex-only-undercounts-plex+tmdb caveat).
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
        .catch(() => {})
    }, 400)

    return () => clearTimeout(timer)
  }, [genre, ratingMin, yearMin, yearMax])

  function resetSolo() {
    setGenre('')
    setRatingMin('')
    setYearMin('')
    setYearMax('')
    setEligibleCount(null)
    setSubmitError(null)
    setShortlist([])
    setSeen([])
    setPickedCard(null)
    setRoomCode(null)
    setScreen('filters')
  }

  async function submitSolo() {
    if (submitting) return
    setSubmitting(true)
    setSubmitError(null)
    const params = new URLSearchParams()
    if (genre) params.set('genre', genre)
    if (ratingMin) params.set('ratingMin', ratingMin)
    if (yearMin) params.set('yearMin', yearMin)
    if (yearMax) params.set('yearMax', yearMax)
    params.set('candidateSource', candidateSource)

    const res = await fetch(`/api/solo/pool?${params.toString()}`)
    setSubmitting(false)
    if (!res.ok) {
      const code = await res
        .json()
        .then((b) => b?.error?.code as string | undefined)
        .catch(() => undefined)
      if (code === 'pool_too_small' || code === 'library_empty') {
        setSubmitError(code)
        return
      }
      toast(code && tErrors.has(code) ? tErrors(code) : tErrors('generic'))
      return
    }
    const body = await res.json()
    setShortlist(body.pool)
    setDegraded(body.degraded)
    setSeen([])
    setScreen('shortlist')
  }

  async function confirmPick(entry: PoolEntry) {
    // Guards against a double-click/double-tap firing two concurrent
    // POSTs — the server has no idempotency check on this endpoint (each
    // call generates a fresh solo-XXXX code and writes a new match_history
    // row), so without this a fast double-click would silently write two
    // rows and leave one orphaned.
    if (picking) return
    setPicking(true)
    const res = await fetch('/api/solo/pick', {
      method: 'POST',
      body: JSON.stringify({ movieId: entry.movieId }),
    })
    setPicking(false)
    if (!res.ok) {
      const code = await res
        .json()
        .then((b) => b?.error?.code as string | undefined)
        .catch(() => undefined)
      toast(code && tErrors.has(code) ? tErrors(code) : tErrors('generic'))
      return
    }
    const body = await res.json()
    setPickedCard(entry)
    setRoomCode(body.roomCode)
    setSurpriseVisible(false)
    setScreen('pick')
  }

  async function surpriseMe() {
    setSurpriseVisible(true)
    setSurpriseSpinning(true)
    // A brief minimum spin so the reveal reads as a real shuffle rather
    // than an instant swap, regardless of how fast the fetch resolves.
    const SPIN_MS = 1200
    try {
      const [res] = await Promise.all([
        fetch('/api/solo/surprise', {
          method: 'POST',
          body: JSON.stringify({ movieIds: shortlist.map((e) => e.movieId), exclude: seen }),
        }),
        new Promise((resolve) => setTimeout(resolve, SPIN_MS)),
      ])
      if (!res.ok) {
        setSurpriseVisible(false)
        toast(tErrors('generic'))
        return
      }
      const body = await res.json()
      setSurpriseCard(body.entry)
      setSeen((prev) => [...prev, body.entry.movieId])
      setSurpriseSpinning(false)
    } catch {
      setSurpriseVisible(false)
      toast(tErrors('generic'))
    }
  }

  if (submitError) {
    const kind = submitError === 'library_empty' ? 'emptylib' : 'poolfail'
    return (
      <EdgeState
        kind={kind}
        testId={kind === 'poolfail' ? 'edge-poolfail' : 'edge-emptylib'}
        kicker={tEdge(kind === 'poolfail' ? 'poolFailKicker' : 'emptyLibraryKicker')}
        title={tEdge(kind === 'poolfail' ? 'poolFailTitle' : 'emptyLibraryTitle')}
        body={tEdge(kind === 'poolfail' ? 'poolFailBody' : 'emptyLibraryBody')}
        detail={tEdge(kind === 'poolfail' ? 'poolFailDetail' : 'emptyLibraryDetail')}
        primaryLabel={tEdge(kind === 'poolfail' ? 'poolFailPrimary' : 'emptyLibraryPrimary')}
        onPrimary={() => (kind === 'poolfail' ? setSubmitError(null) : router.push('/setup'))}
        secondaryLabel={tEdge(kind === 'poolfail' ? 'poolFailSecondary' : 'emptyLibraryStayLabel')}
        onSecondary={() => setSubmitError(null)}
      />
    )
  }

  if (screen === 'filters') {
    const blocked = eligibleCount !== null && eligibleCount < 5
    return (
      <main className="mx-auto flex flex-1 max-w-2xl flex-col items-center gap-6 px-4 py-10 text-center sm:gap-7">
        <div className="flex flex-col items-center gap-2.5">
          <p className="font-mono text-[10.5px] uppercase tracking-[.4em] text-brass">{t('kicker')}</p>
          <h2 className="font-display text-[clamp(30px,6.4vw,58px)] leading-[.98] tracking-wide text-ticket">{t('title')}</h2>
          <p className="max-w-[52ch] text-sm leading-relaxed text-ticket/72">{t('subhead')}</p>
        </div>

        <div
          className="relative w-full bg-gradient-to-br from-ticket to-ticket/80 p-6 text-left text-ink shadow-[0_30px_60px_-25px_rgba(0,0,0,.9)] sm:p-8"
          style={{ clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)' }}
        >
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b-2 border-dashed border-ink/35 pb-3">
            <p className="font-display text-2xl tracking-wide">{t('singleAdmissionLabel')}</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink/60">{t('seatLabel')}</p>
          </div>

          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{tCreateRoom('housePicturesLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setCandidateSource('plex')}
              aria-pressed={candidateSource === 'plex'}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${candidateSource === 'plex' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'}`}
            >
              <span className="font-display text-[15px]">{tCreateRoom('sourcesPlexTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{tCreateRoom('sourcesPlexNote')}</span>
            </button>
            <button
              type="button"
              onClick={() => setCandidateSource('plex+tmdb')}
              aria-pressed={candidateSource === 'plex+tmdb'}
              className={`flex flex-col gap-1.5 border-2 p-3.5 text-left transition-all ${candidateSource === 'plex+tmdb' ? 'border-exit-red bg-exit-red/10' : 'border-ink/25'}`}
            >
              <span className="font-display text-[15px]">{tCreateRoom('sourcesTmdbTitle')}</span>
              <span className="text-[11.5px] leading-snug opacity-70">{tCreateRoom('sourcesTmdbNote')}</span>
            </button>
          </div>

          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/60">{tCreateRoom('trimTheBillLabel')}</p>
          <div className="mb-5 grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('genreLabel')}
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={tCreateRoom('genrePlaceholder')}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('minRatingLabel')}
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
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('yearFromLabel')}
              <input
                type="number"
                value={yearMin}
                onChange={(e) => setYearMin(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11.5px] uppercase tracking-wider text-ink/60">
              {tCreateRoom('yearToLabel')}
              <input
                type="number"
                value={yearMax}
                onChange={(e) => setYearMax(e.target.value)}
                className="h-10 border-0 border-b-2 border-ink/35 bg-transparent px-0.5 font-mono text-sm text-ink outline-none focus:border-exit-red"
              />
            </label>
          </div>

          <div className="mb-4 flex items-center justify-between gap-4 border border-ink/28 bg-ink/5 p-3.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[.2em] text-ink/62">{t('eligibleLabel')}</span>
            <span className="flex items-baseline gap-2" data-testid="solo-eligible-count">
              <span className={`font-display text-[30px] leading-none ${blocked ? 'text-exit-red' : 'text-ink'}`}>
                {eligibleCount === null ? '—' : eligibleCount}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-widest text-ink/55">{t('titlesLabel')}</span>
            </span>
          </div>

          {blocked && (
            <p className="mb-3.5 border-l-[3px] border-exit-red py-2 pl-3 font-mono text-[11px] leading-relaxed text-exit-red">
              {t('tooFewWarning', { count: eligibleCount ?? 0, min: 5 })}
            </p>
          )}

          <button
            type="button"
            onClick={submitSolo}
            disabled={submitting || eligibleCount === null}
            data-testid="submit-solo"
            className="relative h-[62px] w-full overflow-hidden border-none font-display text-[clamp(17px,2vw,22px)] tracking-wide disabled:cursor-not-allowed"
            style={{
              background: submitting || eligibleCount === null || blocked ? 'rgba(34,24,18,.2)' : '#CF4436',
              color: submitting || eligibleCount === null || blocked ? 'rgba(34,24,18,.45)' : '#F3E9D2',
            }}
          >
            {submitting && (
              <span
                className="absolute inset-x-0 bottom-0 h-2.5"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(90deg, rgba(243,233,210,.35) 0 10px, transparent 10px 26px)',
                  animation: 'sprocket .9s linear infinite',
                }}
              />
            )}
            <span className="relative">{submitting ? t('submittingLabel') : t('submitLabel')}</span>
          </button>
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest text-ink/50">{t('noThresholdNote')}</p>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="mt-3.5 w-full border border-dashed border-ink/40 bg-transparent p-3 font-mono text-[10.5px] uppercase tracking-[.18em] text-ink/75 hover:border-exit-red hover:text-exit-red"
          >
            {t('backToBoxOfficeLink')}
          </button>
        </div>
      </main>
    )
  }

  if (screen === 'shortlist') {
    return (
      <main className="mx-auto flex flex-1 max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-brass/35 pb-4">
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-[10.5px] uppercase tracking-[.34em] text-brass">{t('shortlistKicker')}</p>
            <h2 className="font-display text-[clamp(28px,5vw,52px)] leading-none tracking-wide text-ticket">{t('shortlistTitle')}</h2>
            <p className="font-mono text-[11px] tracking-wider text-ticket/60">{t('shortlistCountLabel', { count: shortlist.length })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setScreen('filters')}
              className="border border-brass/55 px-4 py-3.5 font-mono text-[10.5px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
            >
              {t('adjustFiltersButton')}
            </button>
            <button
              type="button"
              onClick={surpriseMe}
              data-testid="surprise-me"
              className="bg-marquee px-6 py-3.5 font-display text-base text-ink hover:bg-marquee/90"
            >
              {t('surpriseMeButton')}
            </button>
          </div>
        </div>

        {degraded && (
          <div className="flex items-center gap-3 border border-dashed border-marquee/60 bg-marquee/[.07] px-4 py-3.5 font-mono text-[11px] leading-relaxed text-ticket/80">
            <span className="h-2.5 w-2.5 rounded-full bg-marquee" style={{ animation: 'bulb 1.6s ease-in-out infinite' }} />
            {t('degradedNotice')}
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-4">
          {shortlist.map((entry, i) => (
            <div key={entry.movieId} className="flex flex-col border border-brass/35 bg-ink" data-testid="shortlist-card">
              <div className="relative box-border flex aspect-[2/3] items-end bg-velvet/40 p-2.5">
                {entry.posterPath && (
                  <img
                    className="absolute inset-0 h-full w-full object-cover"
                    src={entry.posterSource === 'plex' ? `/api/plex-image?movieId=${entry.movieId}` : `https://image.tmdb.org/t/p/w342${entry.posterPath}`}
                    alt={entry.title}
                  />
                )}
                <span className="absolute left-0 top-0 bg-marquee px-2.5 py-1 font-display text-[15px] text-ink">
                  {String(i + 1).padStart(2, '0')}
                </span>
                {entry.inLibrary && (
                  <span className="absolute bottom-0 right-0 bg-marquee/90 px-1.5 py-1 font-mono text-[8px] font-bold uppercase tracking-widest text-ink">
                    {t('onShelfBadge')}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1 px-3 pb-1.5 pt-2.5">
                <p className="font-display text-base leading-tight text-ticket">{entry.title}</p>
                <p className="font-mono text-[9.5px] uppercase tracking-wider text-brass">
                  {entry.year} · {entry.genres.join(', ')}
                </p>
                {entry.rating !== null && <p className="font-mono text-[10.5px] tracking-wider text-marquee">★ {entry.rating.toFixed(1)}</p>}
              </div>
              <button
                type="button"
                onClick={() => confirmPick(entry)}
                disabled={picking}
                className="mx-3 mb-3 border border-brass/55 py-2.5 font-mono text-[10px] uppercase tracking-[.2em] text-ticket transition-colors hover:border-marquee hover:bg-marquee hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('pickThisButton')}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center font-mono text-[10px] uppercase tracking-widest text-brass/75">{t('footerNote')}</p>

        <SurpriseReveal
          visible={surpriseVisible}
          spinning={surpriseSpinning}
          card={surpriseCard}
          seenCount={seen.length}
          totalCount={shortlist.length}
          onWatchThis={() => surpriseCard && confirmPick(surpriseCard)}
          onReroll={surpriseMe}
          onClose={() => setSurpriseVisible(false)}
        />
      </main>
    )
  }

  // screen === 'pick'
  const picked = pickedCard
  if (!picked || !roomCode) return null
  const metaParts = [
    picked.year ? String(picked.year) : null,
    picked.genres.length > 0 ? picked.genres.join(', ').toLowerCase() : null,
    picked.rating !== null ? `★ ${picked.rating.toFixed(1)}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <main className="mx-auto flex flex-1 max-w-3xl flex-col items-center gap-6 px-4 py-10 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[.45em] text-brass">{t('pickDimLabel')}</p>
      <div className="my-1">
        <CodeSlats code={picked.title.toUpperCase()} splitOn="space" />
      </div>
      <div className="flex w-full flex-wrap items-start justify-center gap-6 border-2 border-brass/60 bg-gradient-to-b from-velvet/70 to-ink/92 p-6 text-left sm:p-8">
        <div className="aspect-[2/3] w-[clamp(150px,22vw,200px)] flex-none bg-velvet/40">
          {picked.posterPath && (
            <img
              className="h-full w-full object-cover"
              src={picked.posterSource === 'plex' ? `/api/plex-image?movieId=${picked.movieId}` : `https://image.tmdb.org/t/p/w342${picked.posterPath}`}
              alt={picked.title}
            />
          )}
        </div>
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          {metaParts.length > 0 && <p className="font-mono text-[11px] uppercase tracking-widest text-marquee">{metaParts.join(' · ')}</p>}
          {picked.overview && <p className="text-[15px] leading-relaxed text-ticket/78">{picked.overview}</p>}
          <p className="border border-dashed border-brass/45 px-2.5 py-2 font-mono text-[10px] uppercase tracking-widest text-brass/90" data-testid="solo-room-code">
            {t('writtenToHistory', { code: roomCode })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={resetSolo} className="bg-marquee px-6 py-4 font-display text-[17px] text-ink hover:bg-marquee/90">
          {t('pickAgainButton')}
        </button>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="border border-brass/60 px-5 py-4 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
        >
          {t('backToBoxOfficeLink')}
        </button>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-brass/70">{t('enjoyFooter')}</p>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Manual smoke check in dev**

Run: `npm run dev` (with `FAKE_EXTERNAL_APIS=true` and a seeded fixture library per `e2e/fixtures.ts`'s `seedFakeLibrary`, or against a real linked Plex instance), then visit `/solo` and walk filters → shortlist → pick this / surprise me → confirmed pick, in a browser. This is a UI-facing change — Task 8's Playwright coverage is the durable check, but a manual pass here catches layout/overflow issues Playwright's assertions won't (per this project's own verification standards).

- [ ] **Step 4: Commit**

```bash
git add app/solo/page.tsx
git commit -m "feat: add /solo filters, shortlist, and pick screens"
```

---

### Task 8: e2e — `e2e/solo.spec.ts`

**Files:**
- Create: `e2e/solo.spec.ts`

**Interfaces:**
- Consumes: `pinEnglishLocale`, `seedFakeLibrary` from `./fixtures` (existing).

- [ ] **Step 1: Write the test**

The fixture Plex library (`server/plex/fakeClient.ts`, seeded by `seedFakeLibrary`) has a fixed 10-title set — comfortably above `POOL_MIN_SIZE` (5) with no filters, so a real, unfiltered walk through the whole flow is deterministic without needing to fabricate a larger fixture.

```ts
// e2e/solo.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('solo: box office links to /solo, filters produce a shortlist, and a direct pick reaches the confirmed screen', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  await page.getByTestId('flying-solo').click()
  await page.waitForURL('/solo')

  await expect(page.getByTestId('chapter-indicator')).toContainText("Trim the bill")

  await expect(page.getByTestId('solo-eligible-count')).not.toHaveText('—', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()

  await expect(page.getByTestId('chapter-indicator')).toContainText("Tonight's bill")
  const cards = page.getByTestId('shortlist-card')
  await expect(cards.first()).toBeVisible({ timeout: 15000 })

  await cards.first().getByRole('button', { name: 'Pick this' }).click()

  await expect(page.getByTestId('chapter-indicator')).toContainText('Your pick')
  await expect(page.getByTestId('solo-room-code')).toContainText('solo-')
})

test('solo: surprise me reveals a title from the shortlist and can be re-rolled before confirming', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/solo')

  await expect(page.getByTestId('solo-eligible-count')).not.toHaveText('—', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()
  await expect(page.getByTestId('shortlist-card').first()).toBeVisible({ timeout: 15000 })

  await page.getByTestId('surprise-me').click()
  await expect(page.getByTestId('watch-this')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('reroll').click()
  await expect(page.getByTestId('watch-this')).toBeVisible({ timeout: 5000 })

  await page.getByTestId('watch-this').click()
  await expect(page.getByTestId('solo-room-code')).toContainText('solo-')
})

test('solo: filters narrow enough to fail submission show the full-screen pool-fail edge state, not a toast', async ({ page, context, baseURL }) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/solo')

  // Fixture library's titles don't clear an impossible rating bar — see
  // server/plex/fakeClient.ts for the fixed 10-title set's actual ratings.
  await page.getByPlaceholder('e.g. Comedy').fill('Nonexistent Genre XYZ')
  await expect(page.getByTestId('solo-eligible-count')).toHaveText('0', { timeout: 15000 })
  await page.getByTestId('submit-solo').click()

  await expect(page.getByTestId('edge-poolfail')).toBeVisible({ timeout: 15000 })
})
```

- [ ] **Step 2: Run the new e2e spec**

Run: `npx playwright test e2e/solo.spec.ts`
Expected: PASS. If the third test's eligible-count assertion doesn't reach `0` for the fixture data, adjust the filter value used (check `server/plex/fakeClient.ts`'s fixture genres first) — the intent is any filter combination the fixture library can't clear, not this exact genre string.

- [ ] **Step 3: Run the full e2e suite (no regressions)**

Run: `npx playwright test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/solo.spec.ts
git commit -m "test: add e2e coverage for the solo decide flow"
```

---

## Self-Review Notes

- **Spec coverage**: every mockup block in scope (`isSoloFilters`, `isShortlist`, `surpriseVisible`, `isSoloPick`, the `isBoxOffice` panel addition) has a task. The three explicitly-excluded prototype-only elements (`soloDemoChips`/`listStateChips`/`toggleRole`) and the unreachable `soloListSmall` state are called out in Global Constraints with the reasoning, not silently dropped.
- **Type consistency checked**: `PoolEntry` (Task 2's `toEntry`/`buildPool` return) flows unchanged into `SurpriseReveal`'s `card` prop (Task 6) and `app/solo/page.tsx`'s `shortlist`/`pickedCard` state (Task 7) — same shape throughout, no renaming drift. `ChapterStep`'s three new members (Task 4) are the exact three strings `app/solo/page.tsx` passes to `useSetRoomStep` (Task 7). The `errors`/`edgeState` i18n keys `app/solo/page.tsx` reads (`poolFailKicker`, `emptyLibraryTitle`, etc., Task 7) are the same keys already shipped by the prior Edge-states work — verified present in `messages/en-us.json` and `messages/pt-br.json` by reading both files directly during planning, not assumed.
- **Placeholder scan**: no TBD/TODO markers or described-not-shown steps remain in any task.
