# PopcornPoll — "Reimagined" UI Redesign Spec

Date: 2026-08-18

Builds on `2026-08-17-popcornpoll-design.md` (architecture, security model,
data model are unchanged and not repeated here). This spec covers only the
frontend visual/interaction rework and the backend additions it needs.

## Source material

- Design mock: Claude Design project `a50231a4-d081-44fc-a694-0848627f0b30`
  ("Popcornpoll nostalgic redesign"), file `PopcornPoll Reimagined.dc.html`.
- `github.md` in that project already maps every mockup screen to the repo
  files that implement it today — treated as accurate and reused below.

## Goals

- Restyle the app into the mockup's 1950s picture-palace direction: curtain
  open/countdown-to-start, marquee letterboard type, film-grain/light-beam
  ambient background, ticket/reel motifs — while keeping the app's existing
  color tokens, fonts, and route structure, since the mockup already matches
  them (see "What's already aligned" below).
- Preserve every current `data-testid` so the existing Playwright suite
  keeps passing through the visual change; add new testids only for new
  elements/behavior.
- Add the small amount of real backend capability the mockup implies
  (recent-match history, live pool-eligible count, mid-room reel restart)
  rather than faking it with static numbers.

## Non-goals

- No new client-side screen-state machine. The mockup's single `Component`
  class with a `screen` field (in its `support.js`/inline script) is
  scaffolding for previewing host and guest views side by side in one
  static file — it is not a pattern to import. The real app keeps its
  existing per-route pages and the WS-driven state `RoomPage` already owns.
- No role-toggle control ("View: host" / "View: guest" in the mockup's
  header). Real host/guest is derived from `hostToken`/`sessionToken`, not
  a UI toggle.
- No public link to `/setup` from the box office screen. `/setup` requires
  `ADMIN_SETUP_TOKEN` (see base spec's Network exposure section) and is not
  meant for ordinary visitors; the mockup's "Projection booth" button is
  dropped from the box office screen. Operators keep reaching `/setup` the
  way they do today (direct URL with the token).
- No clickable/backward-navigable chapter breadcrumb. See "Chapter
  indicator" below.

## What's already aligned

The current app is not a blank slate for this mock — it already uses the
mockup's exact palette and type system:

- Fonts: Anton (display), Work Sans (body), JetBrains Mono (mono) — same
  three families, same roles, in `app/layout.tsx` and the mockup's
  `<helmet>` block.
- Colors: `app/globals.css`'s `--ink`/`--velvet`/`--marquee`/`--ticket`/
  `--brass`/`--exit-red` tokens resolve to the same hex family the mockup
  hardcodes (`#100C09`/`#2C1116`/`#F5A623`/`#F3E9D2`/`#9A7A53`/`#CF4436`).
- `components/ui/Aurora.tsx` is already a real vendored React Bits
  component (WebGL/`ogl`), used by `SpotlightBackground` — proof of the
  vendoring pattern this spec extends to the rest of the tagged components.

This is a restyle-and-upgrade, not a rebuild.

## Shared chrome

New `components/chrome/` holding cross-screen pieces currently duplicated
or absent:

- `CurtainOverlay` — the open/close curtain transition shown around
  `startShow`'s countdown (mirrors mockup's curtain + reel-countdown
  sequence, wired to the real `'start'` WS round trip instead of a fake
  timer).
- `AtmosphereLayer` — replaces `SpotlightBackground` as the fixed-position
  film-grain / light-beam-sway / radial-flicker background. Every layer in
  here is disabled (frozen to a static frame) when
  `prefers-reduced-motion: reduce` is set — app-wide default, not a user
  toggle, because these are full-viewport looping animations.
- `PictureBoothHeader` — replaces the ad hoc per-page headers with the
  marquee-bulb wordmark, the chapter indicator (below), and the usher-lamp
  toggle button (off by default; independent of the reduced-motion gate
  above since it's an explicit opt-in the user requested, not an ambient
  loop — still, enabling it while `prefers-reduced-motion` is set shows a
  static spotlight with no cursor-tracking transition).
- `PictureBoothFooter` — the existing attribution line, restyled.

### Chapter indicator

Read-only, derived from real state, not the mockup's clickable
`goStep`/`maxStep` breadcrumb: Box office → Lobby → Now showing → Wrap-up
for hosts, Your ticket → Lobby → Now showing → Wrap-up for guests, current
step computed from the route + `RoomSnapshot.status` (`isBoxOffice`/
`isJoin` from the route itself; `lobby`/`starting` → Lobby; `active` →
Now showing; `ended` or the exhausted-no-match state → Wrap-up). Not
clickable — going "back" to box office from an existing room isn't a real
operation (a room is already created), and lobby/deck/wrap-up are only
ever reached by the room's actual status changing.

## React Bits components

Vendored under new `components/ui/reactbits/` (kept separate from the
existing 10 shadcn-style wrappers directly in `components/ui/`, and from
`Aurora.tsx`, which stays where it is — moving it is out of scope here).
Adapted from React Bits' published source the same way `Aurora.tsx` was,
not installed as an npm package (no such package exists):

| Component | Used for | Notes |
|---|---|---|
| `SplitText` | Box office title, match-reveal title | |
| `BlurText` | Box office subhead | |
| `CountUp` | "The house tonight" stat numbers | |
| `Stack` / `CardSwap` | Now-showing swipe deck | Replaces hand-rolled stacking in `SwipeDeck` |
| `TiltedCard` | Deck card poster | |
| `ClickSpark` | Global click feedback | Already partially hand-rolled in the mockup's `onSpark`; vendored version replaces it |
| `StarBorder` | "Print the tickets" / primary CTAs | |
| `AnimatedList` | Lobby participant row | |
| `LetterGlitch` / `DecryptedText` | Setup screen's Plex link code | |
| `MetaBalls` | Swipe-vote "popcorn kernel" burst | |
| `Dither` | Ambient grain layer (`AtmosphereLayer`) | |
| `LightRays` | Ambient light-beam layer (`AtmosphereLayer`) | |

New dependency: `gsap` (used by React Bits' `SplitText`, `DecryptedText`,
`CardSwap` implementations). `MetaBalls`/`Dither`/`LightRays` are WebGL via
`ogl`, already a dependency.

## Backend additions

### Match history (new persistence)

New migration `server/db/migrations/002_match_history.sql`:

```sql
CREATE TABLE match_history (
  id INTEGER PRIMARY KEY,
  movie_id INTEGER NOT NULL REFERENCES movies(id),
  room_code TEXT NOT NULL,
  title TEXT NOT NULL,
  poster_path TEXT,
  poster_source TEXT NOT NULL CHECK (poster_source IN ('plex', 'tmdb')),
  matched_at TEXT NOT NULL
);
CREATE INDEX match_history_matched_at_idx ON match_history(matched_at);
```

Written from `server/ws/router.ts`'s existing match-broadcast branches
(the `'swipe'` and `'kick'` cases, both of which already loop over
`result.data.newMatches` to build `match` `ServerMessage`s) — one insert
per new match, alongside the existing broadcast, not a separate code path.
Denormalized title/poster columns so history reads don't depend on
`movies` rows that TMDB-only entries (`pruneStaleTmdbOnlyRows`) may later
delete.

### Stats endpoint

New `server/http/stats.ts`, `GET /api/stats`, no auth (same trust model as
room creation/join — see base spec's Network exposure section):

```ts
{
  libraryCount: number       // movies WHERE plex_rating_key IS NOT NULL AND in_library = 1
  nightsSettled: number      // COUNT(DISTINCT room_code) FROM match_history
  recentMatches: Array<{ title: string; posterPath: string | null; posterSource: 'plex' | 'tmdb'; year: number | null }>
                              // last 12 match_history rows, newest first
}
```

If `recentMatches` is empty, the box office's "Last week at this house"
strip is omitted client-side — never backfilled with placeholder titles.

"In the pool" on the box office screen is **not** sourced from this
endpoint. It's a live count that recomputes from the screen's own
genre/rating/year filter fields as the host edits them, via the existing
`findEligiblePlexRows` query (`server/db/movies.ts`) exposed through a
small new `GET /api/eligible-count?genre=&yearMin=&yearMax=&ratingMin=`,
validated the same way `POST /api/rooms`' `validateTmdbFilters` validates
its JSON-body equivalents (`server/http/rooms.ts`) — same clamping rules,
just read from query params instead of a body. This is more accurate than
a static mockup number and needs no new persistence.

### Restart reel (`restart_reel` WS action)

New action in `server/room/activeActions.ts`, alongside `startRoom`:

```ts
restartReel(store, code, callerIsHost, db, tmdb, librarySync, tmdbFilters?)
```

- Host-only (`not_host` otherwise); room must be `active` with
  `exhausted && matches.length === 0`. Two distinct failure cases need two
  distinct codes: a room that isn't `active` at all (still `lobby`, or
  already `ended`) returns the existing `room_not_active`; an `active` room
  that hasn't reached an exhausted-no-match state yet returns a new
  `not_exhausted` (added to `ErrorCode` in `server/room/actions.ts`, with a
  matching `errors.not_exhausted` i18n string) — reusing `room_not_active`
  for that second case would be misleading, since the room *is* active.
- Accepts an optional loosened `tmdbFilters` (validated the same way
  `POST /api/rooms` validates them); falls back to the room's current
  filters if omitted.
- Rebuilds via the existing `buildPool`, then resets `pool`, `matches`,
  `matchedMovieIds`, `exhausted`, and every participant's `swipes`,
  `pendingCardId`, `finished` — factored out of `startRoom`'s back half
  (from `room.pool = result.pool` down through `recomputeExhaustion`)
  into a shared helper both call, rather than duplicated.
- Broadcasts `room_started` + `state_update` exactly like `'start'` does,
  plus a `next_card` to every participant.
- New `ClientMessage`/`ServerMessage` protocol entry:
  `{ type: 'restart_reel'; tmdbFilters?: TmdbFilters }` in, existing
  `room_started`/`state_update`/`next_card` out (no new server message
  type needed).

## Screen-by-screen mapping

Reuses `github.md`'s screen map as-is. Restyle each existing component in
place; do not rewrite data/WS wiring:

| Screen | Files | testid discipline |
|---|---|---|
| Box office | `app/page.tsx` | new `data-testid="create-room"` on the submit button (none exists today) |
| Ticket (join) | `app/join/[code]/page.tsx` | unchanged testids |
| Lobby | `app/room/[code]/page.tsx`, `RoomShare`, `TicketAvatar` | unchanged |
| Now showing | `SwipeDeck`, `server/pool/buildPool.ts` | keep `data-testid="swipe-card"` on the top card |
| Match | `MarqueeReveal` | keep `data-testid="match-banner"` on the wrapping element in `RoomPage` |
| Runners-up | `RoomPage`'s exhausted branch | keep `data-testid="fallback"`; add `data-testid="restart-reel"` on the new button |
| End of show | `RoomPage`'s terminal branch | keep `data-testid="terminal-screen"` |
| Projection booth | `app/setup/page.tsx` | unchanged; no new entry point added |

## Accessibility & motion

- App-wide `prefers-reduced-motion` gate on `AtmosphereLayer` (grain shift,
  beam sway, flicker) and on the curtain/countdown transition (cuts to the
  end state instantly rather than animating).
- Usher-lamp cursor spotlight: opt-in toggle stays available even under
  reduced motion, but drops the cursor-tracking transition to a static
  vignette when that preference is set.
- `ClickSpark`/`MetaBalls` bursts are decorative-only (never the sole
  feedback for an action — the vote/click always has a non-animated state
  change alongside them) and also respect reduced motion (no burst spawn).

## Testing

- Every existing Playwright spec must keep passing unmodified against the
  restyled DOM — testid discipline above is what makes that possible.
- New Playwright coverage: `restart_reel` (host-only, exhausted-only,
  resets pool and clears prior votes), stats/eligible-count endpoints
  wired into the box office screen.
- New Vitest unit tests, one per new/changed module, matching the existing
  per-module `.test.ts` convention: `server/room/activeActions.test.ts`
  (extend for `restartReel`), `server/db/movies.test.ts` (extend for the
  library-count/eligible-count queries), a new `server/db/matchHistory.test.ts`.

## Build order

1. Shared chrome (`AtmosphereLayer`, `CurtainOverlay`, `PictureBoothHeader`/
   `Footer`, chapter indicator) + the `gsap` dependency addition.
2. React Bits vendoring (table above), unblocking every screen's restyle.
3. Screens in user-flow order: Box office → Join → Lobby → Now showing →
   Match reveal → Runners-up → End of show → Setup.
4. Backend additions land alongside the screen that first needs them:
   match history + stats endpoint with Box office (step 3's first item,
   for the "last week" strip and library count), eligible-count with Box
   office's filter fields, `restart_reel` with Runners-up.
5. Full Playwright + Vitest pass, `npm run verify`.
