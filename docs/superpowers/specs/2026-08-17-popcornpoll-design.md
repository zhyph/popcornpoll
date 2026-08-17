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
  (rooms) are ephemeral. (The instance's Plex link is a one-time setup
  concept, not a user account — see Network exposure below.)

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
Docker container, **single replica only**: the in-memory room `Map` does
not survive a restart and is not shared across processes, so PM2 cluster
mode, Docker replicas, or any multi-worker setup breaks room state
silently. This is a documented, load-bearing constraint, not an
oversight.

Room/session state lives in an in-memory `Map<roomCode, RoomState>`. A
SQLite file (`better-sqlite3`) on a mounted volume holds the Plex link,
schema version, and the movie-metadata cache. No Redis, no separate
database service.

`next/image` needs `remotePatterns` configured for `image.tmdb.org` only
— the app's own image-proxy route is same-origin and needs no entry.

## Network exposure & security assumptions

This app has no participant-facing authentication by design (non-goal).
**The app is intended to be reachable only over a trusted network** (LAN,
VPN, or Tailscale) or placed behind self-hoster-managed access control.
This assumption is documented prominently in the README, since a
malicious page loaded by *any browser on that trusted network* can still
attempt to reach the app — network trust alone doesn't stop a
same-network browser from acting maliciously, so the guards below are not
optional even under the trusted-network assumption:

- **Origin/Host validation**: every state-changing HTTP route and the
  WebSocket upgrade handler validate the `Origin` header against an
  allowlist derived from a required `APP_ORIGIN` env var (the self-hoster
  sets this to how they actually reach the app, e.g.
  `http://popcornpoll.lan:3000`). Requests with a missing or mismatched
  Origin are rejected. This closes cross-site WebSocket hijacking and
  DNS-rebinding attacks from any page loaded by a browser on the trusted
  network.
- **Instance setup is separately gated.** Linking/relinking Plex and
  triggering a manual library resync are instance-wide, not per-room,
  actions — letting any room participant trigger them would let any
  stranger with the join link repoint the household's Plex source. These
  routes require a required `ADMIN_SETUP_TOKEN` env var, supplied by the
  self-hoster, presented as a bearer token when visiting the one-time
  `/setup` flow. Room creation and joining never require this token.
- **Rate limiting**: room creation and join attempts are rate-limited per
  resolved client IP (e.g. 10/minute), via an in-memory token bucket.
  Behind a reverse proxy, the raw socket IP is the proxy's, not the
  client's — a `TRUSTED_PROXY_HOPS` env var (default 0, meaning "trust no
  forwarding header") tells the app how many `X-Forwarded-For` hops to
  trust, documented alongside the reverse-proxy WebSocket-upgrade note in
  Deployment. Without this configured correctly, either every real client
  behind the proxy is rate-limited as one IP, or none are — get it wrong
  in the safe direction (under-trust) by default.
- **WebSocket-level guards**: `maxPayload` capped (e.g. 16KB) on the
  upgrade handler; a per-connection swipe rate limit (e.g. 5/second)
  independent of the HTTP rate limiter.
- **Caps**: max concurrent rooms (e.g. 50, counting `ended` rooms until
  they're evicted — see Room eviction), max participants per room (e.g.
  20), max deck size per room (see Deck construction).

Room codes use a 2-word + 3-digit format (e.g. `BLUE-FOX-427`) from a
100-word list, giving roughly 10^7 possible codes; combined with the rate
limit above, brute-forcing a code is impractical. Codes are checked for
collision against currently-live rooms at creation and regenerated on
collision.

## Components

### Plex integration
The instance owner links the household's Plex server once via the OAuth
PIN flow, through the admin-token-gated `/setup` flow (no manual token
pasting). This requires a stable `X-Plex-Client-Identifier`: generated
once on first link and persisted (see Plex link storage). After PIN auth
succeeds, the flow calls `/api/v2/resources?includeHttps=1`, and — if
more than one server or connection is available — the setup UI lets the
owner pick which server and which of its libraries (`library_section_ids`)
to use. This one-time server/connection/library selection is the fiddly
part of any Plex integration and is deliberately scoped to a guided setup
step rather than something the app tries to infer automatically.

Guid parsing, used to determine each library item's external ids: check
the item's `Guid[]` child array (requires `includeGuids=1` on the library
query) for a `tmdb://` entry first; if absent, fall back to parsing a
legacy-agent top-level `guid` string, stripping any trailing query suffix
before parsing id (e.g. `com.plexapp.agents.themoviedb://278?lang=en` →
`278`). Five cases exist in practice: modern agent with a TMDB guid in
`Guid[]`; legacy `com.plexapp.agents.themoviedb://`; legacy
`com.plexapp.agents.imdb://tt...`; manually-matched items with no agent
guid (`local://...`); and modern-agent items with only an opaque
`plex://movie/<hash>` top-level guid and no external id in `Guid[]` at
all. The last two cases yield `tmdb_id = NULL` at parse time — resolved,
where possible, by the imdb backfill described under Library metadata
cache, not at cross-reference time.

### Plex link storage
A `plex_link` table in SQLite, enforced single-row via `CHECK (id = 1)`:
`client_identifier` (generated once, persisted forever), `server_url`,
`auth_token` (encrypted at rest — AES-256-GCM, a random IV per row, key
derived via HKDF from the required `AUTH_ENCRYPTION_KEY` env var; the app
refuses to boot if that var is unset), `library_section_ids`,
`linked_at`. If the stored token starts failing with 401s (revoked via
"sign out all devices," password change, etc.) — including the case where
`AUTH_ENCRYPTION_KEY` itself changed and decryption fails — the app
surfaces the same "Plex link expired — visit /setup to relink" state at
room-creation time, reusing the persisted `client_identifier`.

### TMDB integration
Optional, opt-in per session, filtered by genre/year/rating. Keyed by a
single env-configured v3 API key (`TMDB_API_KEY`).

- `/discover/movie` returns 20 results/page; building a deck issues
  sequential (not concurrent) paginated requests up to the configured
  cap.
- Poster URLs: `https://image.tmdb.org/t/p/w342<poster_path>`.
- A TMDB failure *before* deck construction completes degrades that
  session to Plex-only, surfaced to the host as a non-blocking notice. A
  failure *after* the deck is dealt has no effect — the deck's already
  fixed.
- The app displays TMDB attribution ("This product uses the TMDB API but
  is not endorsed or certified by TMDB") plus the TMDB logo, per TMDB's
  terms of use.

### Cross-reference
A candidate is flagged "in library" purely by `tmdb_id` match against the
cached Plex library index — no fallback at query time. TMDB's
`/discover/movie` results don't carry `imdb_id` (that requires a separate
per-title request), so a live imdb-based fallback isn't practical; instead,
Plex rows that only have an `imdb_id` (no `tmdb_id` from guid parsing) are
backfilled once, at library-sync time, via one `/find/{imdb_id}
?external_source=imdb_id` call per unmatched item (capped at e.g. 50 new
lookups per sync run, continuing across subsequent syncs), caching the
resolved `tmdb_id` permanently. This keeps the real-time cross-reference
rule simple (one column, one equality check) while still resolving most
legacy-agent library items over time.

### Library metadata cache
SQLite `movies` table, keyed by an internal surrogate id (not `tmdb_id`,
which many Plex items lack, and not usable as a single key across both
sources — see dedup rule in Deck construction):

```
id              INTEGER PRIMARY KEY
plex_rating_key TEXT UNIQUE      -- Plex's stable item id, nullable (TMDB-only rows)
tmdb_id         INTEGER          -- nullable, indexed
imdb_id         TEXT             -- nullable, indexed
title           TEXT
poster_path     TEXT
poster_source   TEXT             -- 'plex' | 'tmdb', selects which URL builder / proxy to use
overview        TEXT
year            INTEGER
genres          TEXT             -- JSON array
rating          REAL             -- TMDB's 0-10 vote_average scale, always; Plex's own
                                  -- rating fields are not stored, to keep filter/clamp logic single-scale
vote_count      INTEGER          -- TMDB's vote_count; feeds the reputation-weighting formula
in_library      BOOLEAN
cached_at       DATETIME

-- partial unique index: prevents duplicate TMDB-only rows (plex_rating_key
-- is NULL for these, and SQLite's UNIQUE treats NULLs as distinct)
CREATE UNIQUE INDEX movies_tmdb_only_uq
  ON movies(tmdb_id) WHERE plex_rating_key IS NULL;
```

**Sync procedure** (triggered automatically if stale >6h at room
creation, or manually via the admin-gated `/setup` resync action):
single-flight guarded (a module-level in-progress promise; concurrent
triggers await the same run rather than starting a second one), and
batched — processed in chunks of ~200 items with a `setImmediate` yield
between chunks so a large-library sync doesn't stall the Node event loop
(and therefore every other room's WebSocket traffic) for its full
duration. Within one transaction: upsert every item returned by the
current Plex scan, keyed by `plex_rating_key`; afterward, any row with a
non-null `plex_rating_key` not touched this run has `in_library` set to
`0` (soft — the row and its cached metadata are kept, not deleted, since
they're still useful for cross-reference display). TMDB-only rows
(`plex_rating_key IS NULL`) are pruned separately by simple age (e.g.
deleted if uncached-into-a-deck for 30 days).

**Plex-only deck filtering**: genre/year/rating filters apply to
Plex-only sessions too, not just TMDB-extended ones — they're plain
`WHERE` clauses against columns already in this table, so there's no
reason to withhold them from the primary candidate source.

**Schema migrations**: a `schema_version` table, with numbered migration
scripts run on boot — required since this is a Docker image people will
upgrade in place against an existing volume.

### Image delivery
Plex poster URLs require the household's Plex auth token, so the server
proxies them rather than exposing that token to participants' browsers.
The proxy is an **allowlist lookup, not a passthrough**: `GET
/api/plex-image?movieId=<internal id>` looks up `id` in the `movies`
table, rejects if not found or if `poster_source != 'plex'`, fetches the
corresponding Plex thumb path server-side using the stored token, forces
`Content-Type: image/*` on the response (rejecting anything else Plex
might return), and caps response size (e.g. 5MB) and timeout. TMDB poster
URLs are public and used directly by the client — no proxy involved.

### HTTP API surface
- `POST /api/rooms` — create a room. Body: `{candidateSource,
  matchThreshold, tmdbFilters?}`. No auth required (this mints the host's
  identity). Returns `{roomCode}`; the `hostToken` and `participantId`
  are minted on the subsequent WebSocket `join`, not here, so room
  creation and joining always go through the same identity-issuing path.
  Rate-limited per Network exposure.
- `GET /api/setup/plex/pin`, `GET /api/setup/plex/callback`, `POST
  /api/setup/plex/resync` — `ADMIN_SETUP_TOKEN`-gated, see Network
  exposure.
- `GET /api/plex-image?movieId=...` — allowlisted image proxy, see Image
  delivery.
- `GET /api/health` — liveness only (process is up, SQLite file is
  writable). Deliberately does *not* check Plex reachability, so a
  Plex-side hiccup doesn't restart-loop the app.
- WebSocket upgrade at `/ws` — see WebSocket protocol.

### Room/session engine — state machine
`status`: `lobby -> starting -> active -> ended`.

**Match threshold** is a tagged union, not a single implicit rule:
`{kind: 'all'}` | `{kind: 'majority'}` | `{kind: 'atLeast', n}`. A title
matches when the count of yes-votes among the frozen, non-kicked
participant set satisfies the chosen rule: `all` requires yesCount ===
frozenCount; `majority` requires yesCount > frozenCount / 2 (so 3 of 4,
not 2 of 4); `atLeast` requires yesCount >= n. `n` is validated <=
participant count at the `lobby -> starting` transition and is
**re-validated after every kick** (see below) — this is the one setting
whose validity depends on a count that can shrink after the room starts.

- **`lobby`**: anyone with the link/code can join. Host sets candidate
  source and match-threshold rule. Host may kick a participant at any
  time in `lobby` too (a troll shouldn't require ending and recreating
  the room to remove).
- **Host clicks Start**: the transition to `starting` happens
  **synchronously**, before any `await` — this closes a real race where a
  `join` arriving during deck construction could land in the frozen set
  after the freeze was already decided (see Concurrency). `starting`
  rejects joins exactly like `active` does; it exists so clients can show
  a "building your deck" state during the (multi-second, TMDB-paginated)
  fetch. On success, deck construction completes (see Deck construction)
  and the room moves to `active`, with the participant set now
  permanently frozen. On failure (Plex unreachable, TMDB fails and even
  the Plex-only fallback deck comes up too small — see Deck construction's
  minimum-size check), the room reverts to `lobby` with an error surfaced
  to the host, who can retry Start.
- **Disconnects during `active`** do not remove a participant from the
  match-threshold denominator or discard their existing swipes. An "all
  yes" title they haven't yet swiped on can't match until they either
  swipe, reconnect, or are kicked. Each participant carries a
  `connectionStatus: 'connected' | 'disconnected'`, set by the heartbeat
  mechanism (see WebSocket protocol) and included in every broadcast, so
  clients can show who's currently away without implying they've left the
  room's vote count.
- **Kick** (host-only, `lobby` or `active`): permanently removes a
  participant. Their recorded swipes are **discarded from every title's
  vote count** — kicking someone is a full retraction, not just a freeze.
  The server then recomputes the match predicate for every `movieId` that
  has at least one remaining recorded swipe, against the new, smaller
  frozen set; this can produce one or more `match` events immediately, an
  accepted consequence of an explicit host action. If the current
  `atLeast` threshold now exceeds the new participant count, it's clamped
  to the new count and a `settings_updated` change is included in the
  next broadcast. The kicked participant's `sessionToken` is added to a
  per-room revocation set; any subsequent `reconnect` with that token is
  rejected with `error {code: 'kicked'}`, and their live connection (if
  any) receives a `kicked {reason}` message immediately before the server
  closes it.
- **A participant is `finished`** once they've swiped every card in the
  pool; this is tracked per-participant and included in broadcasts so a
  finished participant's client can show "waiting for others" instead of
  an empty screen.
- **Exhaustion** (`exhausted: boolean`, re-evaluated continuously, not a
  one-way latch): true whenever no *connected* participant has any
  undecided card left — i.e. every participant in the frozen set is
  either `finished` or `disconnected`. This is deliberately weaker than
  "every participant swiped everything," specifically so one dropped
  phone can't block the no-match fallback forever; if a disconnected
  participant later reconnects and still has undecided cards, exhaustion
  re-evaluates back to `false`. `exhausted` and a non-empty `matches` list
  can coexist — the UI shows whatever matches were found *and* an
  "nothing more to see" state, rather than treating them as mutually
  exclusive. When exhausted with **no** matches, the ranked fallback
  (highest yes-vote-count titles in the pool; ties broken by reputation
  score — see Candidate pool & deck ordering) is shown.
- **Room end**: host-only explicit action, or a 30-minute inactivity
  timeout (a `join`, `swipe`, or any host action resets the timer — this
  applies in `lobby` too, so a room that's still filling up doesn't time
  out on its own). On the app's own restart/redeploy, a `SIGTERM` handler
  broadcasts `room_ended {reason: 'server_restarting'}` to every
  connected client (waiting briefly for send buffers to drain, well
  within Docker's default 10s stop grace) before exit, and all in-memory
  rooms are lost.
- **Room eviction**: an `ended` room is deleted from the in-memory `Map`
  10 minutes after entering `ended` (enough time for any last client to
  receive the terminal broadcast), and counts against the concurrent-room
  cap until then.
- **Minimums**: Start is rejected (same error path as an invalid
  threshold) if the participant count is below 2, or if pool construction
  would produce fewer than 5 candidates.

### Authorization model
Identity is established **once per WebSocket connection**, not
re-asserted on every message: a `join` or `reconnect` handshake binds
that socket, server-side, to a `participantId` and (for the room's
creator) `hostToken`-holder status. Subsequent messages on that
connection (`swipe`, `start`, `kick`, etc.) are authorized from that
server-side binding — no token needs to be repeated in every message
body.

- `participantId` — public, included in every broadcast so clients can
  render the roster. Not a credential.
- `sessionToken` — private, cryptographically random (>=128 bits), issued
  to a participant on `join`, never echoed to other clients, held
  client-side in memory/`sessionStorage`. Presented once, in the
  `reconnect` message, to re-bind a new socket to an existing identity. A
  `reconnect` with a `sessionToken` that already has a live connection
  takes over — the old socket is closed server-side.
- `hostToken` — private, cryptographically random, issued once to
  whoever creates the room, held in the host's browser `localStorage`
  (survives a tab refresh). Required to `reconnect` *as host* — a plain
  `join` never grants host status.
- Room creation and joining need no token; `/setup` routes require
  `ADMIN_SETUP_TOKEN` (see Network exposure) — a distinct, instance-level
  credential, not part of this per-room model.

### WebSocket protocol
One connection per client, at `/ws`. Every broadcast that reflects a
state change carries a monotonic per-room `seq`; a client that detects a
gap sends `resync` rather than trusting a partial delta.

**Client → server**: `join {roomCode, displayName}`, `reconnect
{roomCode, sessionToken}`, `resync {}`, `swipe {movieId, vote}`, `start
{}`, `end_room {}`, `update_settings {matchThreshold?, candidateSource?,
tmdbFilters?}` (host-only, `lobby`-only), `kick {participantId}`
(host-only), `heartbeat {}`.

**Server → client**:
- `joined {participantId, sessionToken, hostToken?, room}` — sent once,
  directly in response to `join`/`reconnect`/`resync`. `room` is the
  **full** snapshot: status, pool (denormalized candidate entries — see
  Candidate pool & deck ordering), this participant's own `mySwipes` map
  (needed to restore UI position on reconnect), participants (with
  `connectionStatus`/`finished`), matches, exhausted, matchThreshold,
  candidateSource, `seq`.
- `next_card {movieId}` — sent to a single participant (not broadcast),
  telling their client which pool entry to show next. Sent right after
  `joined` (their first card) and after each of their own `swipe`s (their
  next card); computed live at send time from the reputation + affinity
  scoring described in Candidate pool & deck ordering. Never sent
  reactively due to another participant's activity — see that section for
  why a displayed, unswiped card never changes out from under someone.
- `state_update {participants, status, matches, exhausted,
  matchThreshold, candidateSource, seq}` — broadcast to every connected
  client on any state change (join/reconnect/disconnect/kick, status
  transition, settings change). Deliberately omits the pool, since it's
  immutable after `starting` and every client already has it from its own
  `joined` payload.
- `match {movieId, movie, seq}`, `exhausted {topCandidates, seq}` — sent
  alongside a `state_update` with the same `seq`, as distinct events
  specifically so clients can trigger their own one-shot UI (banner,
  confetti) without diffing `state_update` for the change themselves.
- `kicked {reason}` — sent only to the participant being kicked,
  immediately before the server closes that connection.
- `room_ended {reason, seq}`, `error {code, message}` — `code` is one of
  `room_not_found | room_full | already_started | invalid_name |
  not_host | kicked | invalid_threshold | rate_limited | bad_token`.
- `heartbeat_ack {}`.

**Heartbeat**: client pings every 15s; if the server sees none for 45s,
`connectionStatus` flips to `disconnected` and the participant enters a
2-minute grace period before the connection is torn down server-side
(they remain `disconnected`, not removed — see state machine).

### Swipe idempotency
Swipes are `Map<movieId, 'yes'|'no'>` per participant — one decision per
card, no changing a vote once cast. A duplicate/replayed `swipe` for an
already-recorded `movieId` is a no-op, making redelivery during
resync/reconnect safe against double-counting. Match emission is guarded
by a per-room `matchedMovieIds` set so a title fires its `match` event
exactly once regardless of how many qualifying swipes land in the same
tick.

### Candidate pool & deck ordering
Two related but distinct things, named separately because they behave
differently: the **pool** is the room's fixed, immutable candidate set,
built once at the `lobby -> starting` transition (not at room creation —
settings are only final once Start is pressed) and never extended or
reshuffled afterward (exhaustion is a terminal product outcome, not a
trigger to fetch more). A participant's **deck** is their personal,
on-demand ordering through that pool — not a fixed array, computed live.

**Pool construction**: capped at e.g. 100 candidates, denormalized
(title, poster info, overview, in_library) so swiping never needs a
mid-session re-fetch. `MovieId` throughout this spec is the internal
`movies.id` surrogate key, **not** `tmdb_id` or `plex_rating_key`
directly — every candidate, whether sourced from the Plex sample or a
TMDB discover query, is resolved/upserted into the `movies` table
(matching existing rows by `tmdb_id`/`plex_rating_key` per the
guid/cross-reference rules) before being added to the pool, so the same
film pulled from both sources collapses to one card, not two. For a
TMDB-extended session, up to 70% of the cap is filled from the Plex
sample and the remainder from TMDB discover results (after dedup against
the Plex portion); a Plex-only session is 100% Plex. Both sources are
filtered per the host's genre/year/rating settings, and — this is the
part that keeps a huge TMDB catalog from surfacing obscure or poorly
regarded titles — both are **sampled weighted by reputation score**,
not uniformly at random.

**Reputation score**: IMDB's weighted-rating formula, deliberately *not*
TMDB's raw `popularity` field (which trends toward "recently searched,"
not "well-regarded") and *not* raw `vote_average` alone (dominated by
titles with a handful of 10/10 votes):

```
reputationScore = (v / (v + m)) * R + (m / (v + m)) * C
```

`R` = the candidate's `rating` (TMDB vote_average), `v` = its
`vote_count`, `C` = the mean `rating` across the eligible (post-filter,
pre-sampling) candidate set, `m` = the 60th-percentile `vote_count`
within that same set — this adapts "how many votes counts as credible"
to the pool's own scale rather than a fixed constant that might not fit
a small library. Candidates with no TMDB data (Plex items with no
resolved `tmdb_id`) get `reputationScore = C`: treated as average,
neither boosted nor excluded.

**Per-participant serving order**: each participant's next card is
chosen from the pool minus what they've already swiped, scored as
`score = reputationScore + affinityWeight * genreAffinity`.
`genreAffinity` comes from a live, room-wide (not per-individual — there
is no persisted per-person profile) tally of yes/no votes per genre so
far in the room, normalized to roughly [-1, 1] with Laplace smoothing so
a genre with one or two votes doesn't swing wildly. `affinityWeight`
ramps from 0 up to a capped maximum as total votes cast in the room
increase (e.g. `min(totalVotes / 20, 1) * maxWeight`) — early cards in a
session are reputation-driven since there's no group signal yet, later
cards increasingly reflect what this specific group is saying yes to.
The next card is a weighted-random pick among the top-scoring remaining
candidates, not a strict argmax, so the order has some variety rather
than feeling mechanically deterministic.

A participant's **currently-displayed, not-yet-swiped card never changes
out from under them**: `next_card` (see WebSocket protocol) is computed
and sent only at specific trigger points — their own `join`, their own
`swipe`, their own `reconnect`/`resync` — never reactively because
another participant's vote shifted the live affinity score in the
background.

The minimum pool size (5) and minimum participant count (2) from
Room/session engine gate on the pool, not on any particular serving
order, and are unaffected by this section.

### Room sharing
Room creation generates the room code and canonical URL
`https://<host>/join/<code>`. The host's screen shows the code
prominently, with a "Copy link" button, a QR code, and a native
share-sheet button (`navigator.share`) where supported.

- **Copy**: falls back to a hidden-input + `document.execCommand('copy')`
  when the async Clipboard API is unavailable (plain-HTTP contexts).
- **QR code**: rendering doesn't require a secure context — participants
  scan with their phone's own camera app, not an in-app scanner.
- **Share-sheet button**: hidden entirely when `navigator.share` is
  undefined, rather than shown and silently failing.

The README documents HTTPS as recommended (reverse proxy with a cert,
Tailscale's HTTPS, mkcert for LAN) for the best experience.

### Swipe UI
Tinder-style stacked cards: current poster on top, next 1-2 peeking
behind, drag left/right (or tap X/heart, or left/right arrow keys) to
decide, card exits with a spring-physics animation (Framer Motion drag +
gesture APIs). Primary targets: latest Chrome/Firefox/Safari desktop, and
Chrome/Safari mobile. Automated coverage (Playwright) uses
device-emulation for the mobile viewports; iOS-specific gesture behavior
(the drag surface competing with Safari's edge-swipe-back gesture,
dynamic toolbar height) is **not** reliably reproducible under Playwright's
WebKit and is verified manually on a physical device instead — real
mitigations (inset the drag surface from the screen edge,
`overscroll-behavior-x: none` on ancestors, `100dvh` layout) are applied,
but the claim of automated coverage for them would be false.

## Data flow

1. **One-time**: instance owner visits `/setup` with `ADMIN_SETUP_TOKEN`,
   completes the Plex PIN flow, picks server/libraries.
2. Host creates a room (candidate source, threshold) and joins it via
   WebSocket, receiving `hostToken`. Room is in `lobby`; code/link/QR
   shown for sharing.
3. Participants join via link/code/QR with a display name (validated —
   see Input validation) — no account.
4. Host clicks Start: room moves to `starting`, the candidate pool is
   built and the participant set frozen, then `active`.
5. Swipes go over WebSocket; `match` broadcasts the instant a title
   crosses the threshold; the room keeps going until end/exhaustion.
6. Host ends the session explicitly, the deck is exhausted, or the
   inactivity timeout fires; the room is evicted 10 minutes later.

## Input validation

- Display names: length-limited (1-24 chars), HTML-escaped on render,
  collisions within a room auto-suffixed (not deduped/rejected).
- Room codes: case-insensitive lookup; regenerated on generation-time
  collision.
- `matchThreshold` (`atLeast.n`): validated <= participant count at
  Start, and **re-validated (clamped) after every kick**.
- TMDB filters: genre ids validated against TMDB's known list; year and
  rating (0-10, TMDB's scale) clamped to sane bounds.
- Multiple joins from the same browser/person (two tabs, phone + laptop)
  are not deduped — each is a distinct `participantId`. A `reconnect`
  with a live `sessionToken` takes over that identity's existing
  connection rather than creating a new one.

## Error handling

- Plex unreachable/token invalid: blocks room creation at the host step,
  and blocks the `lobby -> starting` transition if it happens mid-sync;
  surfaced via the `error` code table above.
- TMDB failure before deck construction completes: degrades to Plex-only,
  non-blocking notice to host.
- WebSocket disconnects: see heartbeat/reconnect rules above.

## Concurrency

The in-memory `Map` is safe only under one invariant: **all `RoomState`
mutation happens in a single synchronous block**; any `await` (TMDB
fetch, Plex fetch, SQLite sync) computes into a local variable first, and
re-validates the room's current status/participant set before committing
the result. The `lobby -> starting` transition is the concrete case this
protects: it's set synchronously, before deck construction's first
`await`, specifically so a `join` arriving during that fetch is rejected
by the already-`starting` status rather than racing into the frozen set.
The library sync's single-flight guard (Library metadata cache) exists
for the same class of reason, applied to a cross-room resource instead of
one room's state.

## Testing

- Vitest for pure logic: match-threshold evaluation (all three kinds)
  against the frozen denominator, kick-triggered re-evaluation and
  threshold clamping, pool exhaustion with/without matches, swipe
  idempotency/replay, duplicate-name resolution, Plex guid parsing across
  all five cases, the pool dedup rule, the reputation-score formula
  (including the no-TMDB-data fallback), the affinity-weight ramp, and
  that `next_card` is only ever recomputed at its three defined trigger
  points (not reactively). Plex and TMDB clients are
  behind an interface with a fake implementation (`FAKE_EXTERNAL_APIS`
  env flag + a seeded fixture DB), used by both Vitest and Playwright so
  neither needs live network access or a real Plex/TMDB account.
- Playwright: (a) two contexts joining a room and reaching a match; (b) a
  participant disconnecting mid-session and reconnecting, verifying
  swipes and room state survive; (c) a session that exhausts with no
  match, verifying the fallback UI; (d) authorization enforcement — a
  non-host `start`/`kick`/`update_settings` is rejected; (e) rate-limit
  and cap behavior.

## Deployment

Multi-stage Dockerfile; runtime image runs the custom Node server as a
non-root user; **single replica only** (see Architecture); one volume
mount (e.g. `/data`) for the SQLite file. Env vars: `TMDB_API_KEY`
(optional), `AUTH_ENCRYPTION_KEY` (required), `ADMIN_SETUP_TOKEN`
(required), `APP_ORIGIN` (required), `TRUSTED_PROXY_HOPS` (optional,
default 0). `/api/health` backs a Docker `HEALTHCHECK` (liveness only).
Logs are structured (info/warn/error) and never include tokens;
participant names are logged only at debug level if at all.

If deployed behind a reverse proxy, it must pass through the WebSocket
`Upgrade`/`Connection` headers and set `X-Forwarded-For` correctly for
`TRUSTED_PROXY_HOPS` to work — documented explicitly in the README, since
both are common self-hosting failure modes for a WS-based app.

## Explicitly deferred

- Overseerr/Radarr "Request it" integration on TMDB-only matches.
- A hosted (Vercel or otherwise), multi-tenant deployment mode —
  considered and deliberately dropped in favor of self-hosted-only.
- Built-in multi-user authentication beyond the trusted-network
  assumption — revisit only if real-world usage shows self-hosters
  routinely exposing instances beyond a trusted network.
- Per-individual (as opposed to whole-room) taste profiles — out of scope
  given no accounts/no persistence; the live affinity signal in Candidate
  pool & deck ordering is deliberately a room-wide aggregate, not
  per-person.
