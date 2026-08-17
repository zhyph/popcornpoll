# PopcornPoll — Design Spec

Date: 2026-08-17

## Overview

PopcornPoll is a self-hosted, group movie-night picker for Plex. A group
swipes Tinder-style through a shared deck of movies; a title becomes a
"match" once it crosses a host-configured vote threshold. The primary
candidate source is the host's own Plex library; a host can opt a session
into also pulling in TMDB `/discover/movie` results (filtered by genre,
year, rating), cross-referenced against the Plex library via Plex's `guid`
field (`tmdb://<id>`) so each candidate is flagged "in library, ready to
watch" vs "not in library."

Deployment target: a single Docker container, self-hosted by the household
that owns the Plex server.

## Goals

- UI quality is a first-class requirement, not a nice-to-have — the
  existing tools in this space (MovieMatch, Voterr, etc.) are functionally
  fine but visually dated.
- No user accounts, no long-term profiles. Sessions (rooms) are ephemeral.

## Non-goals

- No user accounts / long-term profiles.
- Not replacing Plex's own UI for anything outside the picking flow.
- No invite delivery (email/SMS/contacts) — sharing a room happens through
  whatever channel the host already uses.
- Overseerr/Radarr "Request it" integration — explicitly deferred as a
  stretch goal, out of scope for this spec.

## Architecture

Single Next.js (App Router, Node runtime) app with a custom Node server
that also handles WebSocket connections (`ws` library) for realtime room
sync — one process, one Docker container. Room/session state lives in an
in-memory `Map<roomCode, RoomState>` in that process. A SQLite file on a
mounted volume holds the durable movie-metadata cache. No Redis, no
separate database service.

## Components

### Plex integration
Host links their Plex server once via the OAuth PIN flow (no manual token
pasting). The resulting token is stored server-side — this is a
single-household server, so persisting it is the expected model. Used to
enumerate the library and check "in library" status via `guid`
(`tmdb://<id>`).

### TMDB integration
Optional, opt-in per session, filtered by genre/year/rating. Keyed by a
single env-configured API key set by whoever runs the container.

### Cross-reference
TMDB results are checked against the cached Plex library index by
`tmdb://<id>` — exact match, no fuzzy title matching.

### Room/session engine
In-memory state machine: create, join, swipe, match, end. Match threshold
is host-configurable at room creation (e.g. "all yes," "at least N,"
"majority" — no fixed default baked into the engine).

Room lifecycle: a room ends when the host explicitly closes it, or after
an inactivity timeout (e.g. 30 minutes) with no swipes/joins/host action.

### Room sharing
Room creation generates a short human-readable code (e.g. `BLUE-FOX-42`)
and a canonical URL `https://<host>/join/<code>`. The host's screen shows
the code prominently, with:

- a "Copy link" button (Clipboard API),
- a QR code for participants to scan directly (useful for same-room,
  same-couch sessions),
- a native share-sheet button (`navigator.share`) on browsers that
  support it, for one-tap sharing to Messages/WhatsApp/Discord/etc.

The app never sends invites itself (no email/SMS/contacts integration) —
the host shares the code/link/QR through whatever channel they're already
using. This is a deliberate scope cut that also keeps the app from ever
touching real contact information.

### Swipe UI
Tinder-style stacked cards: current poster on top, next 1-2 peeking
behind, drag left/right (or tap X/heart) to decide, card exits with a
spring-physics animation (Framer Motion drag + gesture APIs).

## Data flow

1. Host links Plex (OAuth PIN flow, one-time) and creates a room: picks
   candidate source (Plex-only, or +TMDB with filters), sets the
   match-threshold rule, gets a room code/link/QR.
2. Participants join via link/code/QR with just a display name — no
   account.
3. Server builds one shared deck order from cached (or freshly fetched
   and cached) metadata, so everyone swipes the same sequence.
4. Swipes go over WebSocket; server updates room state and broadcasts a
   "match" event the instant a title crosses the host's threshold, with
   an "in library, ready to watch" vs "not in library" flag.
5. Host ends the session explicitly, or it's cleaned up after the
   inactivity timeout.

## Data model

**In-memory `RoomState`**: `{ code, hostId, participants: [{id, name,
swipes}], deck, matchThreshold, candidateSource, status, lastActivityAt,
matches }`. Deck entries carry denormalized display data (title,
poster_path, overview, in_library) rather than bare IDs, so swiping never
needs a re-fetch mid-session.

**SQLite `movies` table** (durable cache, mounted volume):
`tmdb_id (PK), plex_guid, title, poster_path, overview, year, genres,
rating, in_library, cached_at`. Shared by both Plex-sourced and
TMDB-sourced entries.

## Error handling

- Plex unreachable/token invalid: blocks room creation at the host step —
  participants never join a broken room.
- TMDB failure (rate limit/network): degrades to Plex-only for that
  session rather than failing the room; surfaced to the host as a
  non-blocking notice.
- WebSocket disconnects: client reconnects with `roomCode` +
  `participantId`; server holds a short grace period before dropping a
  participant, and resyncs their swipe position and current room state on
  reconnect.

## Testing

- Vitest for pure logic: match-threshold evaluation, deck building,
  Plex/TMDB cross-reference, room lifecycle transitions — all easy to
  unit test in isolation.
- Playwright: two browser contexts joining the same room and reaching a
  match. This is load-bearing for the realtime/swipe/reconnect path
  specifically, since that's exactly the kind of real-browser
  gesture/timing/reconnect behavior unit tests can't catch.

## Deployment

Multi-stage Dockerfile; runtime image runs the custom Node server; one
volume mount (e.g. `/data`) for the SQLite cache; env vars for
`TMDB_API_KEY` (optional) and Plex config. Schema init is a
`CREATE TABLE IF NOT EXISTS` on boot, no migration tooling needed at this
scope.

## Explicitly deferred

- Overseerr/Radarr "Request it" integration on TMDB-only matches.
- A hosted (Vercel or otherwise), multi-tenant deployment mode — considered
  and deliberately dropped for this spec in favor of keeping the project
  self-hosted-only. Revisit as a separate spec if this changes later.
