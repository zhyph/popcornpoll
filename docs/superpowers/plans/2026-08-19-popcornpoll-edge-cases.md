# PopcornPoll Edge Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "Edge state" screen the Claude Design mockup added since the last sync — a single reusable full-screen card, themed per case — and wire it to all 4 named states (`kicked`, `hostgone`, `poolfail`, `emptylib`), including the real backend behavior two of those states need (a host-disconnect grace period broadcast, and a library-empty vs. filters-too-strict distinction) that doesn't exist in the app yet.

**Architecture:** One new presentational component (`components/EdgeState.tsx`) driven by an `EdgeKind` prop that picks accent color/icon internally, with copy and actions supplied by the caller via i18n and callbacks — same shape the mockup's own `EDGE` lookup object uses. `app/room/[code]/page.tsx` renders it from four different triggers: the existing `kicked` terminal state (split out of today's shared "END OF SHOW" card), a new client-side `attemptingStartRef`-gated branch on `pool_too_small`/`library_empty` errors, and two new WS broadcast types (`host_disconnected`/`host_reconnected`) driven by a host-specific extension of the reconnect-grace-period logic `server/ws/server.ts` already has for every disconnect.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind (existing `ink`/`velvet`/`marquee`/`ticket`/`brass`/`exit-red` tokens — no new CSS variables needed, the mockup's 3 accent colors map onto existing tokens), next-intl, Vitest, Playwright.

**Spec:** No separate spec doc for this round (user explicitly chose to skip straight to the plan). The design was grounded directly in the live Claude Design project (`PopcornPoll Reimagined.dc.html`, project id `a50231a4-d081-44fc-a694-0848627f0b30`) re-pulled via DesignSync — its `isEdge` block (lines ~493-511 as of this pull) plus the `EDGE` config object (lines ~609-637) are the source of truth for copy, icon glyphs, and accent colors. Cross-referenced against the current backend (`server/room/actions.ts`, `server/room/activeActions.ts`, `server/pool/buildPool.ts`, `server/ws/server.ts`, `server/ws/router.ts`, `server/ws/protocol.ts`) and current i18n (`messages/en-us.json`, `messages/pt-br.json`).

## Global Constraints

- No new CSS custom properties or Tailwind color tokens — reuse `exit-red` (kicked/poolfail), `marquee` (hostgone), `brass` (emptylib), matching the mockup's own accent-per-kind mapping (`#CF4436`/`#F5A623`/`#9A7A53` are the existing token values already).
- All Tailwind classes are literal strings (no `` `border-${accent}` `` template interpolation) — this codebase's existing components (`SetupStepTracker.tsx`) use a lookup-object-of-literal-classes pattern; follow it so Tailwind's JIT scanner can find every class.
- Every new i18n key goes into BOTH `messages/en-us.json` and `messages/pt-br.json` in the same task — `messages/messages.test.ts` asserts the two files declare exactly the same key set and fails the whole suite otherwise.
- Preserve `data-testid="terminal-screen"` on both the kicked and the room_ended terminal renders, and preserve the exact existing body substrings `'removed you from the room'` (English `kicked.kicked`) and `'host ended this session'` (English `roomEnded.host_ended`) — `e2e/kicked.spec.ts` asserts on these today and this plan does not touch that file.
- `pool_too_small`/`library_empty` from a **Start** attempt (host still in the lobby, nothing to lose) shows the full-screen `EdgeState`. The same error codes from a **restart_reel** attempt (deck mid-session, votes already cast, nothing actually lost since `restartReel` fails before mutating room state) stay a toast, unchanged from today — swapping the whole screen there would be a regression.
- `library_empty` is only ever produced when `candidateSource === 'plex'` and the room's **unfiltered** eligible-Plex-row count is exactly 0. Any other `tooSmall` case (filters narrowed a non-empty library to nothing, or a `plex+tmdb` room) stays `pool_too_small`. This keeps the existing `buildPool.test.ts`/`activeActions.test.ts` cases (which seed 2-3 rows, always > 0) unchanged and green.
- The host-disconnect grace period reuses the existing `RECONNECT_GRACE_MS` constant (`server/ws/server.ts`) — already 2 minutes, already the exact duration the mockup's copy describes ("stays open for two minutes"). Do not introduce a second timing constant.

---

### Task 1: i18n — edge-state copy in both locales

**Files:**
- Modify: `messages/en-us.json`
- Modify: `messages/pt-br.json`

**Interfaces:**
- Produces: a new top-level `edgeState` namespace (sibling to `room`, `errors`, `kicked`, `roomEnded`) that Task 6 reads via `useTranslations('edgeState')`. Also adds `errors.library_empty` (toast fallback text — used only if `library_empty` ever surfaces outside the Start-attempt path Task 6 special-cases) and `roomEnded.host_disconnected_timeout` (shown by the existing "END OF SHOW" terminal card when the host-disconnect grace period expires without the host returning).
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Add the new keys to `messages/en-us.json`**

Insert `"library_empty": "This library doesn't have any movies yet. Pick a different library or run a sync."` into the existing `errors` object (after the `"room_not_active"` line, before the closing brace).

Insert `"host_disconnected_timeout": "The host disconnected and didn't return in time."` into the existing `roomEnded` object (after `"server_restarting"`).

Add a new top-level `"edgeState"` object (after the existing `"setup"` object, before the file's closing brace):

```json
  "edgeState": {
    "kickedKicker": "Your stub was torn",
    "kickedTitle": "THE USHER SHOWED YOU OUT",
    "kickedDetail": "If this was a mistake, ask them to send the code again — rejoining is instant.",
    "kickedPrimary": "Enter a new code",
    "hostGoneKicker": "Projector stopped",
    "hostGoneTitle": "THE HOST DROPPED OUT",
    "hostGoneBody": "We lost the host's connection. The room stays open for two minutes in case they come straight back.",
    "hostGoneDetail": "Reconnecting… your votes are held. If they do not return, the room closes on its own.",
    "hostGonePrimary": "Keep waiting",
    "hostGoneSecondary": "Leave the room",
    "poolFailKicker": "Reel jammed",
    "poolFailTitle": "COULD NOT BUILD THE POOL",
    "poolFailBody": "Your filters came back with nothing to show, or Plex did not answer in time.",
    "poolFailDetail": "Try widening the year range, dropping the minimum rating, or adding TMDB as a second source.",
    "poolFailPrimary": "Back to the filters",
    "poolFailSecondary": "Check the booth",
    "emptyLibraryKicker": "Nothing on the shelf",
    "emptyLibraryTitle": "THIS LIBRARY IS EMPTY",
    "emptyLibraryBody": "Plex is linked, but the libraries you picked have no movies in them yet.",
    "emptyLibraryDetail": "Pick different libraries in the booth, or run a sync if you have added titles since.",
    "emptyLibraryPrimary": "Open the booth"
  }
```

- [ ] **Step 2: Add the matching keys to `messages/pt-br.json`**

Insert `"library_empty": "Essa biblioteca ainda não tem filmes. Escolha outra biblioteca ou rode uma sincronização."` into `errors`.

Insert `"host_disconnected_timeout": "O anfitrião desconectou e não voltou a tempo."` into `roomEnded`.

Add the matching top-level `"edgeState"` object:

```json
  "edgeState": {
    "kickedKicker": "Seu ingresso foi rasgado",
    "kickedTitle": "O LANTERNISTA TE PÔS PRA FORA",
    "kickedDetail": "Se foi engano, peça o código de novo — entrar de novo é instantâneo.",
    "kickedPrimary": "Digitar um novo código",
    "hostGoneKicker": "Projetor parou",
    "hostGoneTitle": "O ANFITRIÃO CAIU DA SESSÃO",
    "hostGoneBody": "Perdemos a conexão do anfitrião. A sala continua aberta por dois minutos, caso ele volte rapidinho.",
    "hostGoneDetail": "Reconectando… seus votos estão guardados. Se ele não voltar, a sala se fecha sozinha.",
    "hostGonePrimary": "Continuar esperando",
    "hostGoneSecondary": "Sair da sala",
    "poolFailKicker": "Rolo emperrou",
    "poolFailTitle": "NÃO FOI POSSÍVEL MONTAR O CATÁLOGO",
    "poolFailBody": "Seus filtros não trouxeram nada para mostrar, ou o Plex não respondeu a tempo.",
    "poolFailDetail": "Tente ampliar o intervalo de anos, reduzir a nota mínima, ou adicionar o TMDB como segunda fonte.",
    "poolFailPrimary": "Voltar aos filtros",
    "poolFailSecondary": "Ver a cabine",
    "emptyLibraryKicker": "Nada na prateleira",
    "emptyLibraryTitle": "ESSA BIBLIOTECA ESTÁ VAZIA",
    "emptyLibraryBody": "O Plex está vinculado, mas as bibliotecas escolhidas ainda não têm filmes.",
    "emptyLibraryDetail": "Escolha outras bibliotecas na cabine, ou rode uma sincronização se você adicionou títulos desde então.",
    "emptyLibraryPrimary": "Abrir a cabine"
  }
```

- [ ] **Step 3: Verify key parity**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS — both files declare exactly the same key set.

- [ ] **Step 4: Commit**

```bash
git add messages/en-us.json messages/pt-br.json
git commit -m "i18n: add edge-state copy for kicked/hostgone/poolfail/emptylib"
```

---

### Task 2: Backend protocol types — new error code and message types

**Files:**
- Modify: `server/room/actions.ts`
- Modify: `server/ws/protocol.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ErrorCode` gains `'library_empty'` (Task 3 returns it from `startRoom`/`restartReel`). `ServerMessage` gains `{ type: 'host_disconnected' }` and `{ type: 'host_reconnected' }` (Task 4 broadcasts them, Task 6 subscribes to them). Neither carries a `seq` — both are always broadcast alongside a `state_update` in the same batch, which already carries the seq, matching the existing `exhausted`/`kicked`/`notice` messages that also have no `seq` field.

- [ ] **Step 1: Add `library_empty` to `ErrorCode`**

In `server/room/actions.ts`, in the `ErrorCode` union, add `| 'library_empty'` after `| 'pool_too_small'`:

```ts
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
  | 'not_enough_participants'
  | 'pool_too_small'
  | 'library_empty'
  | 'not_your_card'
  | 'internal_error'
  | 'room_not_active'
  | 'rate_limited'
  | 'room_cap_reached'
  | 'forbidden_origin'
  | 'invalid_filters'
```

- [ ] **Step 2: Add the two new `ServerMessage` variants**

In `server/ws/protocol.ts`, add these two lines to the `ServerMessage` union, right after `| { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' }`:

```ts
  | { type: 'host_disconnected' }
  | { type: 'host_reconnected' }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no consumers reference the new members yet, so nothing should break — this step only proves the union edits themselves are syntactically valid).

- [ ] **Step 4: Commit**

```bash
git add server/room/actions.ts server/ws/protocol.ts
git commit -m "feat: add library_empty error code and host_disconnected/host_reconnected message types"
```

---

### Task 3: `library_empty` detection in `buildPool` + wiring in `startRoom`/`restartReel`

**Files:**
- Modify: `server/pool/buildPool.ts`
- Modify: `server/room/activeActions.ts`
- Test: `server/pool/buildPool.test.ts`
- Test: `server/room/activeActions.test.ts`

**Interfaces:**
- Consumes: `ErrorCode` (Task 2) now includes `'library_empty'`.
- Produces: `BuildPoolResult` gains an optional `tooSmallReason?: 'library_empty'` field (present only when `tooSmall` is true AND the room is genuinely empty, not merely filtered down — absent means "stays `pool_too_small`", there is no `'filters'` variant to keep this a minimal, additive change). `startRoom` and `restartReel` (both in `activeActions.ts`) return `err('library_empty')` instead of `err('pool_too_small')` when `result.tooSmallReason === 'library_empty'`.

- [ ] **Step 1: Write the failing `buildPool` tests**

Add to `server/pool/buildPool.test.ts`, inside the `describe('buildPool', ...)` block, right after the existing `'returns tooSmall: true when fewer than 5 eligible candidates exist'` test:

```ts
  it('sets tooSmallReason to library_empty when a plex-only room has zero eligible rows at all', async () => {
    // No seedPlexRows call — the library genuinely has nothing in it.
    const result = await buildPool(db, noOpTmdb, 'plex', {}, 1)
    expect(result.tooSmall).toBe(true)
    expect(result.tooSmallReason).toBe('library_empty')
  })

  it('does not set tooSmallReason when the library has movies but a filter excludes all of them', async () => {
    seedPlexRows(10) // non-empty library
    const result = await buildPool(db, noOpTmdb, 'plex', { genre: 'Nonexistent Genre XYZ' }, 1)
    expect(result.tooSmall).toBe(true)
    expect(result.tooSmallReason).toBeUndefined()
  })

  it('does not set tooSmallReason for a plex+tmdb room even with zero Plex rows', async () => {
    // plex+tmdb can still fill a valid pool from TMDB alone — an empty Plex
    // library isn't the same dead end there that it is for a plex-only room.
    const tmdb: TmdbClient = {
      discoverMovies: vi.fn().mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          tmdbId: 5000 + i,
          title: `TMDB Movie ${i}`,
          overview: 'desc',
          posterPath: '/p.jpg',
          year: 2020,
          genreIds: [],
          rating: 7,
          voteCount: 1000,
        })),
      ),
      getMovieDetails: vi.fn(),
      findByImdbId: vi.fn(),
    }
    const result = await buildPool(db, tmdb, 'plex+tmdb', {}, 1)
    expect(result.tooSmall).toBe(false)
    expect(result.tooSmallReason).toBeUndefined()
  })
```

This mirrors the exact TMDB discover-result shape the file's other fixtures already use (see the `'dedups a film...'` test a few lines above: `tmdbId`/`title`/`overview`/`posterPath`/`year`/`genreIds`/`rating`/`voteCount`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/pool/buildPool.test.ts`
Expected: FAIL — `result.tooSmallReason` is `undefined` in the first new test (property doesn't exist yet on `BuildPoolResult`), giving a clear "expected 'library_empty', received undefined" failure.

- [ ] **Step 3: Add `tooSmallReason` to `buildPool`**

In `server/pool/buildPool.ts`, add the field to the interface:

```ts
export interface BuildPoolResult {
  pool: PoolEntry[]
  tooSmall: boolean
  tooSmallReason?: 'library_empty'
  degraded: boolean
}
```

Then, at the end of `buildPool` (replacing the current `return` statement), compute the reason only when needed:

```ts
  const tooSmall = finalRows.length < POOL_MIN_SIZE
  let tooSmallReason: 'library_empty' | undefined
  if (tooSmall && candidateSource === 'plex') {
    // plexRows above is already filtered — check the UNFILTERED count to
    // tell "library has nothing in it" apart from "filters excluded
    // everything". Only a hard 0 counts as library_empty; a non-empty but
    // sparse library still gets the generic pool_too_small treatment (its
    // advice — widen filters, add TMDB — still applies).
    const unfilteredCount = findEligiblePlexRows(db, {}).length
    if (unfilteredCount === 0) tooSmallReason = 'library_empty'
  }

  return {
    pool: finalRows.map(toEntry),
    tooSmall,
    tooSmallReason,
    degraded,
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/pool/buildPool.test.ts`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 5: Write the failing `activeActions` tests**

Add to `server/room/activeActions.test.ts`, inside the `describe('startRoom', ...)` block, right after the existing `'rejects Start when the resulting pool has fewer than POOL_MIN_SIZE candidates'` test:

```ts
  it('rejects Start with library_empty when the plex library has zero movies at all', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    // No seedPlexRows call.
    const result = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'library_empty' })
    expect(store.get(code)!.status).toBe('lobby')
  })
```

Add a matching case inside `describe('restartReel', ...)`, following the same setup pattern its neighboring tests already use (a prior successful `startRoom` call moves the room to `'active'` before exercising `restartReel`):

```ts
  it('rejects restart with library_empty when the plex library has zero movies at all', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'B')
    seedPlexRows(10)
    const started = await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(started.ok).toBe(true)

    // Library goes empty between Start and this restart attempt (e.g. the
    // synced titles were removed from Plex).
    db.prepare('DELETE FROM movies').run()

    const result = await restartReel(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'library_empty' })
  })
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run server/room/activeActions.test.ts`
Expected: FAIL — both new tests get `code: 'pool_too_small'` back instead of `'library_empty'`.

- [ ] **Step 7: Wire the reason through `startRoom` and `restartReel`**

In `server/room/activeActions.ts`, `startRoom` currently has (around line 116): `if (result.tooSmall) return err('pool_too_small')`. Change it to:

```ts
  if (result.tooSmall) return err(result.tooSmallReason === 'library_empty' ? 'library_empty' : 'pool_too_small')
```

`restartReel` has the identical line (around line 159: `if (result.tooSmall) return err('pool_too_small')`). Apply the same change there.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run server/room/activeActions.test.ts server/pool/buildPool.test.ts`
Expected: PASS, all tests.

- [ ] **Step 9: Commit**

```bash
git add server/pool/buildPool.ts server/pool/buildPool.test.ts server/room/activeActions.ts server/room/activeActions.test.ts
git commit -m "feat: distinguish library_empty from pool_too_small in buildPool/startRoom/restartReel"
```

---

### Task 4: Host-disconnect grace-period broadcast

**Files:**
- Modify: `server/ws/server.ts`
- Modify: `server/ws/router.ts`
- Test: `server/ws/server.test.ts`

**Interfaces:**
- Consumes: `ServerMessage` (Task 2) now includes `host_disconnected`/`host_reconnected`. `RoomState.hostParticipantId` (`server/room/types.ts`, already exists) identifies which participant is the host — no participant-list changes needed, this is a dedicated broadcast, not a per-participant flag.
- Produces: when the host's connection drops, every other connected participant in the room receives `{ type: 'host_disconnected' }` immediately (same broadcast batch as the existing `state_update`). If the host reconnects within `RECONNECT_GRACE_MS`, the room receives `{ type: 'host_reconnected' }`. If the host does not reconnect in time, the room closes via the existing `broadcastRoomEnded` path with reason `'host_disconnected_timeout'` — reusing `room_ended`, not inventing a new terminal message type.

- [ ] **Step 1: Write the failing test for the disconnect broadcast**

Add to `server/ws/server.test.ts`, right after the existing `'broadcasts a state_update immediately on disconnect, and only recomputes exhaustion after the reconnect grace period'` test (same `describe` block, same helpers already imported in this file — `connect`, `nextMessage`, `collectMessages`, `seedPlexRows`, `RECONNECT_GRACE_MS`):

```ts
  it('broadcasts host_disconnected to the room when the host drops, and host_reconnected when they return in time', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(db, 5)

    const hostWs = await connect()
    hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
    const hostJoined = await nextMessage(hostWs)

    const guestWs = await connect()
    guestWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
    await nextMessage(guestWs) // joined
    await nextMessage(hostWs) // state_update for the guest's join

    // Host drops. The guest should see host_disconnected land alongside (not
    // instead of) the usual state_update.
    const guestMessages = collectMessages(guestWs, 2)
    hostWs.close()
    const [first, second] = await guestMessages
    const types = [first.type, second.type].sort()
    expect(types).toEqual(['host_disconnected', 'state_update'].sort())

    // Host reconnects well within the grace period using the same session.
    const hostWs2 = await connect()
    const guestReconnectMessage = nextMessage(guestWs)
    hostWs2.send(
      JSON.stringify({
        type: 'reconnect',
        roomCode: code,
        sessionToken: hostJoined.sessionToken as string,
        hostToken: hostJoined.hostToken as string,
      }),
    )
    await nextMessage(hostWs2) // joined
    const reconnectBroadcast = await guestReconnectMessage
    expect(reconnectBroadcast.type === 'host_reconnected' || reconnectBroadcast.type === 'state_update').toBe(true)

    hostWs2.close()
    guestWs.close()
  })

  it('closes the room with reason host_disconnected_timeout if the host never returns within the grace period', async () => {
    const store = (globalThis as { __testStore?: ReturnType<typeof createRoomStore> }).__testStore!
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(db, 5)

    const hostWs = await connect()
    hostWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Host', hostClaimToken }))
    await nextMessage(hostWs)

    const guestWs = await connect()
    guestWs.send(JSON.stringify({ type: 'join', roomCode: code, displayName: 'Guest' }))
    await nextMessage(guestWs)
    await nextMessage(hostWs) // state_update for the guest's join

    vi.useFakeTimers()
    try {
      const hostGoneMessage = nextMessage(guestWs)
      hostWs.close()
      await vi.advanceTimersByTimeAsync(0)
      await hostGoneMessage

      const roomEndedMessage = nextMessage(guestWs)
      await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_MS)
      const roomEnded = await roomEndedMessage
      expect(roomEnded.type).toBe('room_ended')
      expect((roomEnded as { reason: string }).reason).toBe('host_disconnected_timeout')
      expect(store.get(code)!.status).toBe('ended')
    } finally {
      vi.useRealTimers()
    }

    guestWs.close()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/ws/server.test.ts`
Expected: FAIL — no `host_disconnected`/`host_reconnected`/`host_disconnected_timeout` behavior exists yet; the guest never receives those message types.

- [ ] **Step 3: Broadcast `host_disconnected` and start the host-timeout timer in `markDisconnected`**

In `server/ws/server.ts`, replace `markDisconnected`:

```ts
  function finalizeHostDisconnect(roomCode: string, participantId: string): void {
    const room = store.get(roomCode)
    if (!room || room.status === 'ended') return
    if (room.hostParticipantId !== participantId) return
    const participant = room.participants.get(participantId)
    if (!participant || participant.connectionStatus !== 'disconnected') return
    broadcastRoomEnded(roomCode, 'host_disconnected_timeout')
  }

  function markDisconnected(state: ConnectionState): void {
    if (!state.roomCode || !state.participantId) return
    const roomCode = state.roomCode
    const participantId = state.participantId
    const room = store.get(roomCode)
    const participant = room?.participants.get(participantId)
    if (!room || !participant || participant.connectionStatus === 'disconnected') return
    participant.connectionStatus = 'disconnected'
    participant.disconnectedAt = Date.now()
    const isHost = room.hostParticipantId === participantId
    const toRoom: ServerMessage[] = [stateUpdate(room)]
    if (isHost) toRoom.push({ type: 'host_disconnected' })
    broadcastToRoom(roomCode, toRoom)
    setTimeout(() => finalizeDisconnect(roomCode, participantId), RECONNECT_GRACE_MS).unref()
    if (isHost) setTimeout(() => finalizeHostDisconnect(roomCode, participantId), RECONNECT_GRACE_MS).unref()
  }
```

`finalizeHostDisconnect` must be defined before `markDisconnected` references it (both are closures over the same `store`/`broadcastRoomEnded`/etc. already in scope in this function body — place it directly above `markDisconnected`, same as shown).

- [ ] **Step 4: Broadcast `host_reconnected` on the router's `reconnect` case**

In `server/ws/router.ts`, in the `case 'reconnect':` block, change the returned `toRoom` from `[stateUpdate(result.data.room)]` to include the new message when the reconnecting participant is the host:

```ts
      const update = stateUpdate(result.data.room)
      const toRoom: ServerMessage[] = result.data.isHost ? [update, { type: 'host_reconnected' }] : [update]
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
        toRoom,
        toParticipant: [],
        closeSender: false,
        newState,
      }
```

(This replaces the existing `toRoom: [stateUpdate(result.data.room)],` line and the `stateUpdate` call inside it — call `stateUpdate` once, store it in `update`, and build `toRoom` from that, so `broadcastToRoom`'s messages share one seq the same way `'start'`/`'end_room'`/`'restart_reel'` already do elsewhere in this file.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/ws/server.test.ts server/ws/router.ts`
Expected: PASS, all tests (note `server/ws/router.ts` has no direct test file of its own if that command errors on the second path — just run `npx vitest run server/ws/server.test.ts` alone in that case; router behavior is exercised through `server.test.ts`'s integration-style tests).

- [ ] **Step 6: Run the full server test suite to check for regressions**

Run: `npx vitest run server/`
Expected: PASS, no regressions in `activeActions.test.ts`, `router` coverage, or anything else touching `reconnect`/disconnect flows.

- [ ] **Step 7: Commit**

```bash
git add server/ws/server.ts server/ws/router.ts server/ws/server.test.ts
git commit -m "feat: broadcast host_disconnected/host_reconnected and close the room if the host never returns"
```

---

### Task 5: `components/EdgeState.tsx`

**Files:**
- Create: `components/EdgeState.tsx`
- Test: `components/EdgeState.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure presentational component; copy and handlers are passed in as props by Task 6).
- Produces: `export type EdgeKind = 'kicked' | 'hostgone' | 'poolfail' | 'emptylib'`, `export function edgeAccentClasses(kind: EdgeKind): { text: string; border: string; bg: string }` (pure, tested directly — same pattern as `SetupStepTracker.tsx`'s exported `trackerStepFor`), and `export function EdgeState(props: EdgeStateProps)` with:

```ts
export interface EdgeStateProps {
  kind: EdgeKind
  kicker: string
  title: string
  body: string
  detail?: string
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  testId?: string
}
```

- [ ] **Step 1: Write the failing test**

Create `components/EdgeState.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { edgeAccentClasses } from './EdgeState'

describe('edgeAccentClasses', () => {
  it('uses exit-red for kicked and poolfail (both are dead-end failures)', () => {
    expect(edgeAccentClasses('kicked').text).toBe('text-exit-red')
    expect(edgeAccentClasses('poolfail').text).toBe('text-exit-red')
  })

  it('uses marquee for hostgone (transient, not a failure)', () => {
    expect(edgeAccentClasses('hostgone').text).toBe('text-marquee')
  })

  it('uses brass for emptylib (a setup/config state, not a failure)', () => {
    expect(edgeAccentClasses('emptylib').text).toBe('text-brass')
  })

  it('every kind has matching border and bg classes for the same color family', () => {
    const kinds: Array<'kicked' | 'hostgone' | 'poolfail' | 'emptylib'> = ['kicked', 'hostgone', 'poolfail', 'emptylib']
    for (const kind of kinds) {
      const { text, border, bg } = edgeAccentClasses(kind)
      const family = text.replace('text-', '')
      expect(border).toContain(family)
      expect(bg).toBe(`bg-${family}`)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/EdgeState.test.ts`
Expected: FAIL with "Cannot find module './EdgeState'".

- [ ] **Step 3: Write `components/EdgeState.tsx`**

```tsx
// components/EdgeState.tsx
// A single reusable full-screen card for transient/dead-end room states —
// the Claude Design mockup's own isEdge block drives all 4 cases (kicked,
// hostgone, poolfail, emptylib) from one EDGE lookup object; this mirrors
// that shape. kind picks the icon/accent/border internally so every caller
// stays visually consistent; copy and actions are the caller's job (i18n).
'use client'

export type EdgeKind = 'kicked' | 'hostgone' | 'poolfail' | 'emptylib'

const ICON: Record<EdgeKind, string> = {
  kicked: '✕',
  hostgone: '⏻',
  poolfail: '!',
  emptylib: '□',
}

const ACCENT: Record<EdgeKind, { text: string; border: string; bg: string }> = {
  kicked: { text: 'text-exit-red', border: 'border-exit-red/60', bg: 'bg-exit-red' },
  poolfail: { text: 'text-exit-red', border: 'border-exit-red/60', bg: 'bg-exit-red' },
  hostgone: { text: 'text-marquee', border: 'border-marquee/50', bg: 'bg-marquee' },
  emptylib: { text: 'text-brass', border: 'border-brass/[0.55]', bg: 'bg-brass' },
}

export function edgeAccentClasses(kind: EdgeKind): { text: string; border: string; bg: string } {
  return ACCENT[kind]
}

export interface EdgeStateProps {
  kind: EdgeKind
  kicker: string
  title: string
  body: string
  detail?: string
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  testId?: string
}

export function EdgeState({
  kind,
  kicker,
  title,
  body,
  detail,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  testId,
}: EdgeStateProps) {
  const accent = edgeAccentClasses(kind)
  return (
    <main data-testid={testId} className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center px-4 py-10">
      <div
        className={`flex w-full flex-col items-center gap-4 border-2 ${accent.border} bg-gradient-to-b from-velvet/70 to-ink/95 px-6 py-10 text-center sm:px-10`}
      >
        <span
          className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 ${accent.border} font-display text-2xl ${accent.text}`}
        >
          {ICON[kind]}
        </span>
        <p className={`font-mono text-[10.5px] uppercase tracking-[.34em] ${accent.text}`}>{kicker}</p>
        <h2 className="font-display text-3xl leading-tight text-ticket sm:text-4xl">{title}</h2>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-ticket/70">{body}</p>
        {detail && (
          <p className="max-w-[44ch] border border-dashed border-brass/45 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-brass/95">
            {detail}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={onPrimary} className={`${accent.bg} px-6 py-3.5 font-display text-base text-ink hover:opacity-90`}>
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="border border-brass/55 px-5 py-3.5 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/EdgeState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/EdgeState.tsx components/EdgeState.test.ts
git commit -m "feat: add EdgeState component for kicked/hostgone/poolfail/emptylib screens"
```

---

### Task 6: Wire `EdgeState` into `app/room/[code]/page.tsx`

**Files:**
- Modify: `app/room/[code]/page.tsx`

**Interfaces:**
- Consumes: `EdgeState`/`EdgeKind` (Task 5), `edgeState`/`errors.library_empty`/`roomEnded.host_disconnected_timeout` i18n keys (Task 1), `host_disconnected`/`host_reconnected` WS messages and `library_empty` error code (Tasks 2/4).
- Produces: nothing new consumed elsewhere — this is the leaf wiring task.

- [ ] **Step 1: Add the new import and translation hook**

Add near the top with the other imports:

```ts
import { EdgeState, type EdgeKind } from '../../../components/EdgeState'
```

Add alongside the existing `useTranslations` calls (after `const tRoomEnded = useTranslations('roomEnded')`):

```ts
  const tEdge = useTranslations('edgeState')
```

- [ ] **Step 2: Add the new state and a ref for the in-flight Start attempt**

Add alongside the existing `useState`/`useRef` declarations:

```ts
  const [edgeOverride, setEdgeOverride] = useState<Exclude<EdgeKind, 'kicked'> | null>(null)
  const attemptingStartRef = useRef(false)
```

(`'kicked'` is excluded from `edgeOverride`'s type because it's driven by the existing `terminal` state, not this one — keeping the two mechanisms from overlapping in what they can represent.)

- [ ] **Step 3: Update the `error` handler to intercept Start-attempt pool failures**

Replace the existing `unsubError`:

```ts
    const unsubError = ws.on('error', (msg) => {
      const wasAttemptingStart = attemptingStartRef.current
      attemptingStartRef.current = false
      if (wasAttemptingStart && (msg.code === 'pool_too_small' || msg.code === 'library_empty')) {
        setEdgeOverride(msg.code === 'library_empty' ? 'emptylib' : 'poolfail')
        return
      }
      toast(tErrors.has(msg.code) ? tErrors(msg.code) : tErrors('generic'))
    })
```

- [ ] **Step 4: Reset the ref on a successful start (covers both `start` and `restart_reel` success)**

In the existing `unsubStarted` handler, add the reset as the first line inside the callback:

```ts
    const unsubStarted = ws.on('room_started', (msg) => {
      attemptingStartRef.current = false
      checkSeq(ws, msg.seq)
      setPool(msg.pool)
      // room_started fires for both 'start' and 'restart_reel' — the latter
      ...
```

(keep the rest of the existing handler body unchanged — this only adds the one new line at the top).

- [ ] **Step 5: Subscribe to `host_disconnected`/`host_reconnected`**

Add two new subscriptions alongside the existing `unsubKicked`/`unsubRoomEnded`:

```ts
    const unsubHostDisconnected = ws.on('host_disconnected', () => setEdgeOverride('hostgone'))
    const unsubHostReconnected = ws.on('host_reconnected', () =>
      setEdgeOverride((prev) => (prev === 'hostgone' ? null : prev)),
    )
```

Add both to the cleanup return alongside the other `unsub*()` calls:

```ts
      unsubHostDisconnected()
      unsubHostReconnected()
```

- [ ] **Step 6: Split the `kicked` case out of the shared terminal render**

Replace the current single `if (terminal || snapshot.status === 'ended')` block with two blocks — one for `kicked`, one for the unchanged `room_ended`/`ended` card:

```tsx
  if (terminal?.type === 'kicked') {
    const body = tKicked.has(terminal.reason) ? tKicked(terminal.reason) : tKicked('kicked')
    return (
      <EdgeState
        kind="kicked"
        testId="terminal-screen"
        kicker={tEdge('kickedKicker')}
        title={tEdge('kickedTitle')}
        body={body}
        detail={tEdge('kickedDetail')}
        primaryLabel={tEdge('kickedPrimary')}
        onPrimary={() => router.push('/')}
      />
    )
  }

  if (terminal?.type === 'room_ended' || snapshot.status === 'ended') {
    const reason = terminal?.type === 'room_ended' ? terminal.reason : 'host_ended'
    const message = tRoomEnded.has(reason) ? tRoomEnded(reason) : tRoomEnded('host_ended')
    return (
      <main
        data-testid="terminal-screen"
        className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-5 px-4 py-10 text-center"
      >
        <p className="font-mono text-[11px] uppercase tracking-[.45em] text-brass">{t('houseLightsUp')}</p>
        <h2
          className="font-display text-5xl leading-none text-ticket sm:text-7xl"
          style={{ animation: 'glitchShift 5s steps(1) infinite' }}
        >
          {t('endOfShowTitle')}
        </h2>
        <p className="font-display text-xl text-ticket">{message}</p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="mt-2 bg-marquee px-6 py-3.5 font-display text-base text-ink hover:bg-marquee/90"
        >
          {t('backToBoxOffice')}
        </button>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-brass/70">{t('reelChangeFooter')}</p>
      </main>
    )
  }
```

This is a pure split of the existing block — the `room_ended`/`ended` half's JSX is byte-for-byte what's there today, just re-scoped to its own `if`. `message`'s computation is simplified because it no longer needs to branch on `terminal?.type === 'kicked'` (that case now lives entirely in the block above).

- [ ] **Step 7: Add the `hostgone`/`poolfail`/`emptylib` branches**

Insert immediately after the two blocks from Step 6, still before the `if (snapshot.status === 'lobby' || snapshot.status === 'starting')` branch:

```tsx
  if (edgeOverride === 'hostgone') {
    return (
      <EdgeState
        kind="hostgone"
        testId="edge-hostgone"
        kicker={tEdge('hostGoneKicker')}
        title={tEdge('hostGoneTitle')}
        body={tEdge('hostGoneBody')}
        detail={tEdge('hostGoneDetail')}
        primaryLabel={tEdge('hostGonePrimary')}
        onPrimary={() => setEdgeOverride(null)}
        secondaryLabel={tEdge('hostGoneSecondary')}
        onSecondary={() => router.push('/')}
      />
    )
  }

  if (edgeOverride === 'poolfail' || edgeOverride === 'emptylib') {
    const kind = edgeOverride
    return (
      <EdgeState
        kind={kind}
        testId={kind === 'poolfail' ? 'edge-poolfail' : 'edge-emptylib'}
        kicker={tEdge(kind === 'poolfail' ? 'poolFailKicker' : 'emptyLibraryKicker')}
        title={tEdge(kind === 'poolfail' ? 'poolFailTitle' : 'emptyLibraryTitle')}
        body={tEdge(kind === 'poolfail' ? 'poolFailBody' : 'emptyLibraryBody')}
        detail={tEdge(kind === 'poolfail' ? 'poolFailDetail' : 'emptyLibraryDetail')}
        primaryLabel={tEdge(kind === 'poolfail' ? 'poolFailPrimary' : 'emptyLibraryPrimary')}
        onPrimary={() => router.push(kind === 'poolfail' ? '/' : '/setup')}
        secondaryLabel={kind === 'poolfail' ? tEdge('poolFailSecondary') : undefined}
        onSecondary={kind === 'poolfail' ? () => router.push('/setup') : undefined}
      />
    )
  }
```

- [ ] **Step 8: Set `attemptingStartRef` when Start is clicked**

Find the existing Start button (`onClick={() => client?.send({ type: 'start' })}`, inside the lobby branch) and change it to:

```tsx
            onClick={() => {
              attemptingStartRef.current = true
              client?.send({ type: 'start' })
            }}
```

- [ ] **Step 9: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx biome check app/room/\[code\]/page.tsx`
Expected: PASS (or apply `--write` if it only flags formatting).

- [ ] **Step 10: Run the existing room/e2e-adjacent unit and component tests**

Run: `npx vitest run`
Expected: PASS, no regressions — this task doesn't change any exported function signatures other tests depend on.

- [ ] **Step 11: Commit**

```bash
git add app/room/\[code\]/page.tsx
git commit -m "feat: wire EdgeState into the room page for kicked/hostgone/poolfail/emptylib"
```

---

### Task 7: e2e coverage

**Files:**
- Create: `e2e/hostDisconnect.spec.ts`
- Create: `e2e/edgePoolFail.spec.ts`

**Interfaces:**
- Consumes: `data-testid="edge-hostgone"`/`"edge-poolfail"`/`"edge-emptylib"` (Task 6), `seedFakeLibrary`/`pinEnglishLocale` (`e2e/fixtures.ts`, unchanged).
- Produces: nothing consumed elsewhere — this is the final verification task.

The 2-minute grace-period **expiry** (host never returns, room auto-closes) is already covered at the unit level by Task 4's `server.test.ts` addition, which fast-forwards a mocked timer — a real e2e test cannot fast-forward the actual server process's wall-clock `setTimeout`, and waiting 2 real minutes in an e2e run is not worth the wall-clock cost. This task's e2e coverage is limited to what's actually observable in real time: the disconnect appearing, and a reconnect-within-the-window dismissing it.

- [ ] **Step 1: Write `e2e/hostDisconnect.spec.ts`**

```ts
// e2e/hostDisconnect.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a guest sees the host-gone edge screen when the host drops, and it clears when the host reconnects', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const hostContext = await browser.newContext()
  await pinEnglishLocale(hostContext, baseURL!)
  const hostPage = await hostContext.newPage()
  await hostPage.goto('/')
  await hostPage.getByTestId('create-room').click()
  await hostPage.waitForURL(/\/room\//)
  const roomCode = hostPage.url().split('/room/')[1]

  const guestContext = await browser.newContext()
  await pinEnglishLocale(guestContext, baseURL!)
  const guestPage = await guestContext.newPage()
  await guestPage.goto(`/join/${roomCode}`)
  await guestPage.getByTestId('join-name-input').fill('Guest')
  await guestPage.getByTestId('join-submit').click()
  await guestPage.waitForURL(/\/room\//)
  await expect(hostPage.getByRole('button', { name: 'Remove' })).toHaveCount(2, { timeout: 15000 })

  await hostPage.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  // Simulate the host's connection dropping: a reload closes the existing
  // socket (triggering the disconnect broadcast) and, once the page comes
  // back up, re-establishes via the sessionToken/hostToken already in this
  // tab's storage (same technique e2e/reconnect.spec.ts uses).
  const hostGoneCard = guestPage.getByTestId('edge-hostgone')
  await hostPage.reload()
  await expect(hostGoneCard).toBeVisible({ timeout: 15000 })

  // The host's reload lands back on the deck once its own reconnect
  // round-trip completes — that reconnect is what broadcasts
  // host_reconnected to the guest.
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await expect(hostGoneCard).not.toBeVisible({ timeout: 15000 })

  await browser.close()
})
```

- [ ] **Step 2: Run it**

Run: `npm run build && npm run start &` then, once the server is up, `npx playwright test e2e/hostDisconnect.spec.ts` (this repo's Playwright config requires the production build — dev-mode hydration fails under Playwright's own launched Chromium in this environment; check `playwright.config.ts` lines ~20-32 for the documented reason if this needs re-confirming). Stop the background server afterward.
Expected: PASS, 1/1.

- [ ] **Step 3: Write `e2e/edgePoolFail.spec.ts`**

```ts
// e2e/edgePoolFail.spec.ts
import { test, expect } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('Start shows the empty-library edge screen when the plex library has no movies', async ({ page, context, baseURL }) => {
  // Deliberately no seedFakeLibrary call — the library starts empty.
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')
  await page.getByTestId('create-room').click()
  await page.waitForURL(/\/room\//)

  await page.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await expect(page.getByTestId('edge-emptylib')).toBeVisible({ timeout: 15000 })
})

test('Start shows the pool-fail edge screen when filters exclude every movie in a non-empty library', async ({
  page,
  context,
  baseURL,
}) => {
  await seedFakeLibrary(baseURL!)
  await pinEnglishLocale(context, baseURL!)
  await page.goto('/')

  const genreInput = page.getByPlaceholder('e.g. Comedy')
  await genreInput.fill('Nonexistent Genre XYZ')
  // Unlike e2e/boxOffice.spec.ts, deliberately do NOT clear the filter
  // before creating the room — this test needs it to carry into the
  // room's stored tmdbFilters so Start actually fails.
  await page.getByTestId('create-room').click()
  await page.waitForURL(/\/room\//)

  await page.getByRole('button', { name: 'DIM THE LIGHTS' }).click()
  await expect(page.getByTestId('edge-poolfail')).toBeVisible({ timeout: 15000 })
})
```

- [ ] **Step 4: Run it**

Run: `npx playwright test e2e/edgePoolFail.spec.ts` (against the same production server from Step 2, or rebuild/restart if it was already stopped).
Expected: PASS, 2/2.

- [ ] **Step 5: Run the full e2e suite to check for regressions**

Run: `npx playwright test`
Expected: PASS, all specs — in particular `e2e/kicked.spec.ts` (Task 6's split must not have changed its observable behavior) and `e2e/reconnect.spec.ts`/`e2e/restartReel.spec.ts` (Task 4's host-disconnect additions must not have changed guest-reconnect or restart-reel behavior).

- [ ] **Step 6: Commit**

```bash
git add e2e/hostDisconnect.spec.ts e2e/edgePoolFail.spec.ts
git commit -m "test: add e2e coverage for hostgone/poolfail/emptylib edge screens"
```
