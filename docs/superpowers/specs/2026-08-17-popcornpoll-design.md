# PopcornPoll — Design Spec

Date: 2026-08-17

## Overview

PopcornPoll is a self-hosted, group movie-night picker for Plex. A group
swipes Tinder-style through a shared deck of movies; a title becomes a
"match" once it crosses a host-configured vote threshold. The primary
candidate source is the host's own Plex library; a host can opt a session
into also pulling in TMDB `/discover/movie` results (filters: genre, year,
rating), cross-referenced against the Plex library so each candidate is
flagged "in library, ready to watch" vs "not in library."

Deployment target: a single Docker container, self-hosted by the household
that owns the Plex server.

## Goals

- UI quality is a first-class requirement, not a nice-to-have.
- No user accounts, no long-term profiles for participants. Sessions
  (rooms) are ephemeral. (The host's Plex link is an instance-level
  configuration concept, not a user account — see Network exposure below.)

## Non-goals

- No participant accounts / long-term profiles.
- Not replacing Plex's own UI for anything outside the picking flow.
- No invite delivery (email/SMS/contacts) — sharing a room happens through
  whatever channel the host already uses.
- Overseerr/Radarr "Request it" integration — deferred, out of scope.
- No built-in multi-user authentication system — see Network exposure.

## Architecture

Single Next.js (App Router, Node runtime) app with a custom Node server
that also handles WebSocket connections (`ws` library) — one process, one
Docker container. Room/session state lives in an in-memory
`Map<roomCode, RoomState>`. A SQLite file on a mounted volume holds the
Plex link/config and the movie-metadata cache. No Redis, no separate
database service.

Using a custom server forfeits some Next.js conveniences that assume
`next start` (e.g. certain build-output optimizations) — accepted
tradeoff, WebSocket support requires it. `next/image` needs
`remotePatterns` configured for `image.tmdb.org` and the app's own image
proxy route (see Image delivery).

## Network exposure & security assumptions

This app has no participant-facing authentication by design (non-goal).
That means anyone who can reach the server can create rooms against the
household's linked Plex library. This is acceptable only under a stated
assumption: **the app is intended to be reachable only over a trusted
network** (LAN, VPN, or a tool like Tailscale) or placed behind
self-hoster-managed access control (reverse-proxy basic auth, an
authenticating proxy, etc.). This assumption must be documented
prominently in the README, since Plex households commonly do expose
self-hosted tools beyond the LAN.

Regardless of that assumption, the app includes baseline abuse guards so a
misconfigured or briefly-exposed instance fails safely rather than
catastrophically:

- Room codes use a 2-word + 3-digit format (e.g. `BLUE-FOX-427`), giving a
  large enough space that combined with rate limiting, brute-forcing a
  code is impractical.
- Join attempts and room-creation attempts are rate-limited per source IP
  (e.g. 10/minute) via an in-memory token bucket.
- Hard caps bound total memory use: max concurrent rooms (e.g. 50), max
  participants per room (e.g. 20), max deck size per room (see Deck
  construction).

## Components

### Plex integration
Host links their Plex server once via the OAuth PIN flow (no manual token
pasting). This requires a stable `X-Plex-Client-Identifier`: generated
once on first link and persisted (see Plex link storage), since Plex
treats a changed client identifier as a new device.

Used to enumerate the library and to determine "in library" status. Plex
does not consistently expose a `tmdb://<id>` guid — the modern Plex Movie
agent puts a `plex://movie/<hash>` opaque id in the top-level `guid` and
exposes external ids (`tmdb://`, `imdb://`, `tvdb://`) only in a child
`Guid[]` array, which requires requesting the library with
`includeGuids=1`. Legacy agents instead emit
`com.plexapp.agents.themoviedb://<id>` or
`com.plexapp.agents.imdb://tt<id>` directly in the top-level `guid`. Some
locally-matched or unmatched items expose no external id at all.

Guid parsing rule: check the `Guid[]` array first for a `tmdb://` entry;
fall back to parsing a legacy-agent `guid` string; if neither yields a
TMDB id, the item has `tmdb_id = NULL` — it's still eligible for
Plex-only decks but is excluded from TMDB cross-reference (it can never
be flagged "in library" from the TMDB-result side, though a TMDB result
could still separately match it by `imdb_id` if that's populated).

### Plex link storage
A `plex_link` table in the SQLite database (one row): `client_identifier`
(generated once, persisted forever), `server_url`, `auth_token`
(encrypted at rest using a key derived from an env-provided secret, e.g.
`AUTH_ENCRYPTION_KEY`), `library_section_ids`, `linked_at`. If a stored
token starts failing with 401s (revoked via "sign out all devices,"
password change, etc.), the app surfaces an in-app "Plex link expired —
please relink" prompt at room-creation time, reusing the persisted
`client_identifier` so re-linking doesn't register as a new device.

### TMDB integration
Optional, opt-in per session, filtered by genre/year/rating. Keyed by a
single env-configured API key (`TMDB_API_KEY`, a v3 API key) set by
whoever runs the container.

- `/discover/movie` returns 20 results/page; building a deck of up to the
  configured cap issues sequential paginated requests (no concurrency —
  keeps well within TMDB's rate limit).
- Poster URLs are built as `https://image.tmdb.org/t/p/<size><poster_path>`
  using a hardcoded reasonable size (e.g. `w342`); no dependency on the
  `/configuration` endpoint.
- On failure after a session's deck has already been dealt, the session
  simply continues with whatever candidates were already fetched — "degrade
  to Plex-only" only applies to failures *before* deck construction
  completes.
- The app displays TMDB attribution ("This product uses the TMDB API but
  is not endorsed or certified by TMDB") plus the TMDB logo, per TMDB's
  terms of use — required since this is a Docker image others will run.

### Cross-reference
A TMDB candidate is flagged "in library" when its `tmdb_id` (or, absent
that, `imdb_id`) matches an entry in the cached Plex library index.

### Library metadata cache
SQLite `movies` table, keyed by an internal surrogate id (not `tmdb_id`,
which many Plex items lack):

```
id              INTEGER PRIMARY KEY
plex_rating_key TEXT UNIQUE      -- Plex's own stable item id, nullable (TMDB-only entries)
tmdb_id         INTEGER          -- nullable, indexed
imdb_id         TEXT             -- nullable, indexed
title           TEXT
poster_path     TEXT
overview        TEXT
year            INTEGER
genres          TEXT             -- JSON array
rating          REAL
in_library      BOOLEAN
cached_at       DATETIME
```

`in_library` is a mutable, per-server fact and needs an explicit refresh
policy, not just a `cached_at` timestamp: the library index is considered
stale after 6 hours and is refreshed automatically the next time a room
is created if stale; a host can also trigger a manual resync at any time.
A full-library sync blocks only new room creation while it runs (existing
rooms are unaffected), and the host sees a "syncing library" state with
progress for large libraries rather than a hung request.

### Image delivery
Plex poster/art URLs require the Plex auth token as a query param. The
server proxies these rather than exposing the token to participants'
browsers: a route (e.g. `/api/plex-image?ratingKey=...`) fetches the
image server-side using the stored token and streams it back. TMDB poster
URLs are public and are used directly, no proxy needed.

### Room/session engine — state machine
`status`: `lobby -> active -> ended`, with two flags on `active` state:
`matches: MovieId[]` (append-only, room keeps collecting after a match —
see below) and `exhausted: boolean`.

- **Room creation** starts in `lobby`. Anyone with the link/code can join
  during `lobby`. Host sets candidate source and match-threshold rule
  during `lobby`; settings cannot change after `active`.
- **Host clicks "Start"** (host-only action) transitions `lobby -> active`.
  This **freezes the participant set** — no further joins are accepted
  once active, and the match-threshold denominator is fixed to this set
  for the rest of the room's life. This single rule resolves the
  otherwise-ambiguous questions of what happens to an in-progress
  threshold when someone joins, disconnects, or reconnects mid-session.
- **Disconnects during `active`** do not remove a participant from the
  denominator. A disconnected participant's existing swipes still count;
  an "all yes" title they haven't yet swiped on simply can't match until
  they return (or are removed — see below). This trades "a match might be
  delayed by a dropped phone" for "a match can never be silently wrong,"
  which is the safer default.
- **Host may kick a participant** (host-only action) at any time during
  `active`, permanently removing them from the denominator. This
  immediately triggers re-evaluation of every already-decided title
  against the smaller set, which may produce one or more matches at once
  — an accepted consequence of an explicit host action, not something
  that happens automatically.
- **A title matches** the instant every currently-frozen (non-kicked)
  participant has swiped yes on it, guarded by a per-room
  `matchedMovieIds` set so a title can only ever fire its `match` event
  once, regardless of how many qualifying swipes land in the same tick.
  A match does not end the room or pause swiping — `matches` is
  append-only and the room keeps going until the host ends it or the deck
  is exhausted. Match reveals are a non-blocking banner/toast on every
  client.
- **Deck exhausted with no match**: when every frozen participant has
  swiped every card and `matches` is still empty, the room sets
  `exhausted = true` and shows a ranked fallback — the titles with the
  highest yes-vote count among the deck ("nobody hit all-yes, here's what
  came closest") — rather than a dead end.
- **"Majority"** means strictly more than half of the frozen participant
  count (e.g. 3 of 4, not 2 of 4).
- **Room end**: host-only explicit action, or an inactivity timeout (30
  minutes with no swipes/host action) as a fallback. On the app's own
  restart/redeploy, all in-memory rooms are lost; a `SIGTERM` handler
  broadcasts a `room_ended {reason: "server_restarting"}` message before
  shutdown so clients show an explanatory screen instead of an infinite
  reconnect spinner.

### Authorization model
Two participant-facing identifiers, plus one host-facing token:

- `participantId` — public, included in every broadcast so clients can
  render who's in the room. Not a credential.
- `sessionToken` — private, cryptographically random (>=128 bits), issued
  to a participant on join, never echoed to other clients, held in that
  client's memory/`sessionStorage`. Presented to reconnect/resync and to
  authenticate that participant's own swipes.
- `hostToken` — private, cryptographically random, issued once to whoever
  creates the room, held in the host's browser `localStorage` (so a tab
  refresh doesn't orphan the room). Required for every host-only action.
  No host-migration mechanism — if the host never returns, the room
  simply runs out via the inactivity timeout.

Action-to-role table:

| Action | Who | Auth |
|---|---|---|
| Create room | anyone | — (becomes host) |
| Join room | anyone, `lobby` only | — |
| Swipe | any active participant, own swipes only | `sessionToken` |
| Reconnect/resync | the owning participant | `sessionToken` |
| Start room | host | `hostToken` |
| Change settings | host, `lobby` only | `hostToken` |
| Kick participant | host | `hostToken` |
| End room | host | `hostToken` |

### WebSocket protocol
One WS connection per client. Every server broadcast carries a monotonic
per-room `seq` so a client can detect a gap (e.g. after a reconnect) and
request a full `room_state` resync instead of trusting a partial delta.

Client → server: `join {roomCode, displayName}`, `reconnect {roomCode,
sessionToken}`, `swipe {movieId, vote}`, `start {hostToken}`, `end_room
{hostToken}`, `update_settings {hostToken, matchThreshold,
candidateSource}`, `kick {hostToken, participantId}`, `heartbeat {}`.

Server → client: `joined {participantId, sessionToken, roomState}`,
`room_state {..full snapshot, seq}`, `participant_joined {participantId,
name}`, `participant_left {participantId}`, `match {movieId, movie,
seq}`, `exhausted {topCandidates, seq}`, `room_ended {reason}`, `error
{code, message}`, `heartbeat_ack {}`.

Heartbeat: client pings every 15s; if the server sees no heartbeat for
45s, the connection is treated as dead and the participant enters the
reconnect grace period (2 minutes) before being marked `disconnected`
(still counted in the threshold denominator per the state-machine rules
above, until kicked or reconnected).

### Swipe idempotency
Swipes are stored as `Map<movieId, 'yes'|'no'>` per participant, one
decision per card (no changing a vote once cast). A duplicate/replayed
`swipe` message for a `movieId` already recorded for that participant is
a no-op — this makes the reconnect-resync path safe against redelivery
without double-counting a vote.

### Deck construction
Deck size is capped (e.g. 100 candidates) to bound both UX (nobody wants
to swipe a 4,000-title library) and server memory (deck entries are
denormalized — title, poster_path, overview, in_library — stored inline
in `RoomState` so swiping never needs a mid-session re-fetch). For
Plex-only sessions, the deck is a uniform random sample of the library
capped at that size; for TMDB-extended sessions, sampled TMDB discover
results (filtered per the host's settings) are merged in, same cap.
Because the deck is materialized once at room creation and stored as part
of `RoomState`, every client (including one that reconnects) receives the
identical array via `room_state` — no separate shuffle-seed bookkeeping
needed. The deck cannot be extended once dealt; exhaustion is a terminal
outcome, not a trigger to fetch more (see state machine above).

### Room sharing
Room creation generates the room code and canonical URL
`https://<host>/join/<code>`. The host's screen shows the code
prominently, with a "Copy link" button, a QR code, and a native
share-sheet button (`navigator.share`) where supported.

These affordances depend on a secure context: `navigator.share` and the
async Clipboard API require HTTPS. Since self-hosted instances are
commonly served over plain HTTP on a LAN IP, this needs explicit handling
rather than silent failure:

- **Copy**: falls back to a hidden-input + `document.execCommand('copy')`
  when the async Clipboard API is unavailable.
- **QR code**: rendering the QR itself doesn't require a secure context
  (only in-app camera scanning would, and this app doesn't do in-app
  scanning — participants use their own phone's camera app, which works
  regardless of the target site's context).
- **Share-sheet button**: hidden entirely when `navigator.share` is
  undefined, rather than shown and silently failing.

The README documents HTTPS as recommended (reverse proxy with a cert,
Tailscale's HTTPS, mkcert for LAN) for the best experience, with the
above fallbacks covering the plain-HTTP case.

### Swipe UI
Tinder-style stacked cards: current poster on top, next 1-2 peeking
behind, drag left/right (or tap X/heart, or left/right arrow keys) to
decide, card exits with a spring-physics animation (Framer Motion drag +
gesture APIs). Target: latest two versions of Safari/Chrome/Firefox on
iOS/Android/desktop. iOS Safari specifics that need explicit handling:
`touch-action: pan-y` on the card surface so the horizontal drag doesn't
fight the OS edge-swipe-back gesture, `overscroll-behavior: contain`, and
`100dvh` instead of `100vh` for layout given the dynamic toolbar.

## Data flow

1. Host links Plex (OAuth PIN flow, one-time) and creates a room: picks
   candidate source, sets the match-threshold rule, gets a room
   code/link/QR. Room is in `lobby`.
2. Participants join via link/code/QR with a display name (validated —
   see Input validation) — no account. Duplicate display names are
   disambiguated automatically (e.g. a numeric suffix appended).
3. Host clicks Start: participant set and deck are frozen, room moves to
   `active`.
4. Swipes go over WebSocket; a `match` broadcasts the instant a title
   crosses the threshold; the room keeps going until end/exhaustion.
5. Host ends the session explicitly, the deck is exhausted, or the
   inactivity timeout fires.

## Input validation

- Display names: length-limited (e.g. 1-24 chars), HTML-escaped on
  render (names are attacker-controlled and shown to every participant),
  collision within a room resolved with an auto-appended suffix.
- Room codes: case-insensitive on lookup.
- `matchThreshold` values greater than the frozen participant count are
  rejected at Start time with a clear error, rather than producing a room
  that can mathematically never match.
- TMDB filters: genre ids validated against TMDB's known genre list; year
  range and rating (0-10) clamped to sane bounds.

## Error handling

- Plex unreachable/token invalid: blocks room creation at the host step.
- TMDB failure before deck construction completes: degrades to Plex-only
  for that session, surfaced to the host as a non-blocking notice.
- WebSocket disconnects: see heartbeat/reconnect rules above.

## Testing

- Vitest for pure logic: match-threshold evaluation against the frozen
  denominator (including kick-triggered re-evaluation), deck exhaustion
  with no match, swipe idempotency/replay, duplicate-name resolution, and
  Plex guid parsing across all three known formats. Plex and TMDB clients
  are behind an interface with a fake implementation used in tests, so
  the suite runs without live network access.
- Playwright: (a) two browser contexts joining a room and reaching a
  match — happy path; (b) a participant disconnecting mid-session and
  reconnecting, verifying their swipes and the room state survive; (c) a
  session that exhausts its deck with no match, verifying the fallback
  UI appears.

## Deployment

Multi-stage Dockerfile; runtime image runs the custom Node server; one
volume mount (e.g. `/data`) for the SQLite file (Plex link + metadata
cache); env vars for `TMDB_API_KEY` (optional), `AUTH_ENCRYPTION_KEY`
(for the stored Plex token). A `/api/health` endpoint backs a Docker
`HEALTHCHECK`. Logs are structured (info/warn/error) and never include
tokens; participant names are logged only at debug level if at all.

If deployed behind a reverse proxy (nginx, Apache, Caddy), the proxy must
be configured to pass through the WebSocket `Upgrade`/`Connection`
headers — documented explicitly in the README, since this is the most
common self-hosting failure mode for any WS-based app.

## Explicitly deferred

- Overseerr/Radarr "Request it" integration on TMDB-only matches.
- A hosted (Vercel or otherwise), multi-tenant deployment mode —
  considered and deliberately dropped in favor of self-hosted-only.
- Built-in multi-user authentication beyond the trusted-network assumption
  above — revisit only if real-world usage shows self-hosters routinely
  exposing instances beyond a trusted network.
