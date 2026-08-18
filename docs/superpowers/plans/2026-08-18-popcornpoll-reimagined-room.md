# Room Screens (Lobby / Now Showing / Match / Runners-up / End of Show) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every screen state `app/room/[code]/page.tsx` renders — Lobby, Now showing, Match reveal (overlay), Runners-up, End of show — to match the approved "PopcornPoll Reimagined" mockup, and add the `restart_reel` host action the mockup introduces on both the Now-showing and Runners-up screens.

**Architecture:** `RoomPage` currently branches into three states with Runners-up oddly nested inside the "active" branch alongside a dead `SwipeDeck` mount. Task 1 flattens this into four real top-level branches (`lobby | active | exhausted (Runners-up) | ended`) matching how the mockup and the server already think about room status, and wires the already-built `useSetRoomStep` chapter-indicator hook (built in an earlier plan, never called yet). Tasks 2-4 build shared prerequisites (copy, backend, a generalized `CodeSlats`). Tasks 5-9 restyle each screen state in the spec's build order, each consuming the shared prerequisites. Task 10 hardens e2e locators and adds coverage for the new `restart_reel` action.

**Tech Stack:** Next.js 14 App Router, React, framer-motion (existing SwipeDeck/MarqueeReveal drag/animation stays — this is a visual restyle, not an engine rewrite), Tailwind, next-intl, Vitest, Playwright, `better-sqlite3`.

**Spec:** `docs/superpowers/specs/2026-08-18-popcornpoll-reimagined-design.md` (Lobby / Now showing / Match / Runners-up / End of show rows in the screen-by-screen mapping table). This plan also encodes detail gathered by directly reading the mockup (`PopcornPoll Reimagined.dc.html`) beyond the spec's one-line-per-screen mapping — each task's Design Notes cite exactly what came from the mockup.

## Global Constraints

- Room status already has 4 real values (`lobby | starting | active | ended`) plus an `exhausted` boolean — Task 1's branch split is `lobby|starting → Lobby`, `active with exhausted && matches.length===0 → Runners-up`, `active otherwise → Now-showing (+ Match overlay)`, `terminal || ended → End of show`. This exactly matches the room's real shape; don't invent a fifth status.
- Use existing Tailwind color tokens (`ink`, `velvet`, `marquee`, `ticket`, `brass`, `exit-red`) — no new hardcoded hex except where a task's code block says otherwise (CodeSlats' dark tile gradient, already established precedent from the Join plan).
- CTA/label copy is stored uppercase verbatim in i18n JSON where the mockup shows it uppercase (matching Box office's `"createButton": "PRINT THE TICKETS"` and Join's `"joinButton": "TAKE MY SEAT"` precedent).
- `en-us.json` and `pt-br.json` must always declare the same key set — `messages/messages.test.ts` enforces this.
- **Ruling — Lobby's "Pool built"/"Runtime tonight" stat cards are dropped, not just "Concessions."** The mockup shows three flavor-stat cards in Lobby. "Concessions: Popped" was confirmed dropped (no data, pure joke). "Runtime tonight" has no data source anywhere in this app (no per-movie runtime field is tracked) — same category as Concessions. "Pool built" would need the room's *real* pool, which doesn't exist until Start is clicked (the frozen `room.pool` is empty during `lobby`) — showing it here would mean either a fake number or a new eligible-count-style backend call this plan doesn't scope. All three cards are dropped; Lobby ships without a stats row. If you want a stats row back later, it needs its own design/backend pass, not a fabricated number here.
- **Ruling — no literal `Stack`/`CardSwap`/`TiltedCard`/`MetaBalls` component mounts.** The mockup's own dev-tag comment names these for the Now-showing deck, but they're raw React Bits ports that manage their own internal state (independent of any parent's server-driven data) — SwipeDeck's current hand-rolled `motion.div` + drag engine is already working, tested, and server-driven. This plan restyles SwipeDeck's *visuals* (3-column reel layout, poster treatment) to match the mockup while keeping the existing drag/keyboard/vote engine untouched. Same call for Match reveal's "burst: MetaBalls" tag — no WebGL burst in this pass.
- **Ruling — `restart_reel` has no confirmation-step gate beyond the client-side two-tap pattern below**, and works whenever `room.status === 'active'` (not gated by `exhausted`) — the mockup shows two real entry points (Now-showing's tally-strip button, mid-session; Runners-up's "SECOND REEL," post-exhaustion) and only the first needs a confirm, since only it can discard in-flight votes.
- **Ruling — `restart_reel` reuses the room's existing `candidateSource`/`tmdbFilters`.** The mockup's "looser filters" copy is flavor text, not a spec for a filter-editing UI (none exists anywhere in this app); don't build one here.

---

### Task 1: Flatten RoomPage's branches + wire the chapter-indicator step

**Files:**
- Modify: `app/room/[code]/page.tsx` (full replacement, ~296 lines → ~300 lines, structure only — no visual changes)

**Design notes:** Purely structural. The existing single trailing `return` mixes the "active, still swiping" and "active, exhausted with no match" cases behind an inline conditional `<Card>`. This task splits that into a real 4th branch, and calls `useSetRoomStep` (from `components/chrome/RoomStatusContext.tsx`, built in an earlier plan — its own comment says "wired by a later plan," this is that plan) with the step this room is actually in. Per the spec's Chapter indicator section, both the exhausted-no-match state and the `ended` state map to the same `'wrapup'` step.

**Interfaces:**
- Consumes: `useSetRoomStep(step: ChapterStep | null)` and `type ChapterStep = 'entry' | 'lobby' | 'deck' | 'wrapup'`, both already exported from `../../../components/chrome/RoomStatusContext`.
- Produces: no new exports — later tasks restyle *inside* the four branches this task creates, without changing the branch conditions themselves.

- [ ] **Step 1: Replace the file**

```tsx
// app/room/[code]/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createWsClient, type WsClient } from '../../../lib/wsClient'
import { useSetRoomStep, type ChapterStep } from '../../../components/chrome/RoomStatusContext'
import { MarqueeReveal } from '../../../components/MarqueeReveal'
import { RoomShare } from '../../../components/RoomShare'
import { SwipeDeck } from '../../../components/SwipeDeck'
import { TicketAvatar } from '../../../components/TicketAvatar'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader } from '../../../components/ui/card'
import type { ParticipantView, RoomSnapshot } from '../../../server/ws/protocol'
import type { PoolEntry } from '../../../server/pool/buildPool'

type TerminalState = { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' } | { type: 'room_ended'; reason: string }

// How long a match reveal stays on screen before it's dismissed and the
// swipe deck resumes — long enough to read the title, short enough not to
// block swiping on whatever remains unmatched.
const MATCH_REVEAL_MS = 4000

export default function RoomPage({ params }: { params: { code: string } }) {
  const t = useTranslations('room')
  const tErrors = useTranslations('errors')
  const tKicked = useTranslations('kicked')
  const tRoomEnded = useTranslations('roomEnded')
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [pool, setPool] = useState<PoolEntry[]>([])
  const [pendingCardId, setPendingCardId] = useState<number | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [client, setClient] = useState<WsClient | null>(null)
  const [terminal, setTerminal] = useState<TerminalState | null>(null)
  const [dismissedMatchId, setDismissedMatchId] = useState<number | null>(null)
  const lastSeqRef = useRef<number | null>(null)

  useEffect(() => {
    function applySeq(seq: number) {
      lastSeqRef.current = seq
    }
    function checkSeq(socket: WsClient, seq: number) {
      if (lastSeqRef.current !== null && seq > lastSeqRef.current + 1) {
        socket.send({ type: 'resync' })
      }
      if (lastSeqRef.current === null || seq > lastSeqRef.current) {
        lastSeqRef.current = seq
      }
    }

    const ws = createWsClient(`${location.origin.replace('http', 'ws')}/ws`)
    setClient(ws)

    const unsubJoined = ws.on('joined', (msg) => {
      setSnapshot(msg.room)
      setParticipants(msg.room.participants)
      if (msg.room.pool) setPool(msg.room.pool)
      if (msg.room.pendingCardId !== undefined) setPendingCardId(msg.room.pendingCardId)
      if (msg.hostToken) {
        setIsHost(true)
        localStorage.setItem(`hostToken:${params.code}`, msg.hostToken)
      }
      sessionStorage.setItem(`sessionToken:${params.code}`, msg.sessionToken)
      applySeq(msg.room.seq)
    })
    const unsubState = ws.on('state_update', (msg) => {
      checkSeq(ws, msg.seq)
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
          totalVotes: msg.totalVotes,
          seq: msg.seq,
        },
      )
    })
    const unsubStarted = ws.on('room_started', (msg) => {
      checkSeq(ws, msg.seq)
      setPool(msg.pool)
    })
    const unsubNextCard = ws.on('next_card', (msg) => setPendingCardId(msg.movieId))
    const unsubMatch = ws.on('match', (msg) => {
      checkSeq(ws, msg.seq)
      setPool((prev) => (prev.some((e) => e.movieId === msg.movieId) ? prev : [...prev, msg.movie]))
    })
    const unsubExhausted = ws.on('exhausted', (msg) =>
      setSnapshot((prev) => prev && { ...prev, topCandidates: msg.topCandidates }),
    )
    const unsubError = ws.on('error', (msg) => {
      toast(tErrors.has(msg.code) ? tErrors(msg.code) : tErrors('generic'))
    })
    const unsubKicked = ws.on('kicked', (msg) => setTerminal({ type: 'kicked', reason: msg.reason }))
    const unsubRoomEnded = ws.on('room_ended', (msg) => setTerminal({ type: 'room_ended', reason: msg.reason }))
    const unsubSeqOnRoomEnded = ws.on('room_ended', (msg) => checkSeq(ws, msg.seq))

    const hostClaimToken = sessionStorage.getItem(`hostClaimToken:${params.code}`) ?? undefined
    const pendingDisplayName = sessionStorage.getItem('pendingDisplayName')

    const unsubOpen = ws.onOpen(() => {
      const storedSessionToken = sessionStorage.getItem(`sessionToken:${params.code}`)
      const storedHostToken = localStorage.getItem(`hostToken:${params.code}`) ?? undefined
      if (storedSessionToken) {
        ws.send({
          type: 'reconnect',
          roomCode: params.code,
          sessionToken: storedSessionToken,
          hostToken: storedHostToken,
        })
      } else {
        ws.send({
          type: 'join',
          roomCode: params.code,
          displayName: pendingDisplayName ?? 'Guest',
          hostClaimToken,
        })
      }
    })

    const heartbeat = setInterval(() => ws.send({ type: 'heartbeat' }), 15_000)

    return () => {
      unsubJoined()
      unsubState()
      unsubStarted()
      unsubNextCard()
      unsubMatch()
      unsubExhausted()
      unsubError()
      unsubKicked()
      unsubRoomEnded()
      unsubSeqOnRoomEnded()
      unsubOpen()
      lastSeqRef.current = null
      clearInterval(heartbeat)
      ws.close()
    }
  }, [params.code])

  const latestMatchId = snapshot && snapshot.matches.length > 0 ? snapshot.matches[snapshot.matches.length - 1]! : null
  useEffect(() => {
    if (latestMatchId === null || latestMatchId === dismissedMatchId) return
    const timer = setTimeout(() => setDismissedMatchId(latestMatchId), MATCH_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [latestMatchId, dismissedMatchId])

  // Computed before any early return (Rules of Hooks: useSetRoomStep must
  // run every render). Both the exhausted-no-match branch and the terminal
  // branch map to 'wrapup' — the spec's Chapter indicator section treats
  // them as the same step despite being visually distinct screens.
  const step: ChapterStep | null = !snapshot
    ? null
    : terminal || snapshot.status === 'ended'
      ? 'wrapup'
      : snapshot.status === 'lobby' || snapshot.status === 'starting'
        ? 'lobby'
        : snapshot.exhausted && snapshot.matches.length === 0
          ? 'wrapup'
          : 'deck'
  useSetRoomStep(step)

  if (!snapshot) return <p className="p-8 font-mono text-brass">{t('connecting')}</p>

  if (terminal || snapshot.status === 'ended') {
    const message =
      terminal?.type === 'kicked'
        ? tKicked.has(terminal.reason)
          ? tKicked(terminal.reason)
          : tKicked('kicked')
        : tRoomEnded.has(terminal?.reason ?? 'host_ended')
          ? tRoomEnded(terminal?.reason ?? 'host_ended')
          : tRoomEnded('host_ended')
    return (
      <main
        data-testid="terminal-screen"
        className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center"
      >
        <p className="font-display text-2xl text-ticket">{message}</p>
      </main>
    )
  }

  if (snapshot.status === 'lobby' || snapshot.status === 'starting') {
    return (
      <main className="mx-auto flex flex-1 max-w-md flex-col items-center gap-6 px-4 py-10">
        <RoomShare code={params.code} />
        <Card className="w-full border border-brass/50 bg-velvet">
          <CardHeader className="font-mono text-xs uppercase tracking-widest text-brass">
            {t('admitted')}
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
                    {t('removeButton')}
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
            {t('startButton')}
          </Button>
        )}
        {snapshot.status === 'starting' && (
          <p className="font-mono text-sm text-brass">{t('buildingPool')}</p>
        )}
      </main>
    )
  }

  const currentCard = pool.find((entry) => entry.movieId === pendingCardId) ?? null
  const latestMatch =
    latestMatchId !== null && latestMatchId !== dismissedMatchId
      ? (pool.find((e) => e.movieId === latestMatchId) ?? null)
      : null

  if (snapshot.exhausted && snapshot.matches.length === 0) {
    return (
      <main className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
        <Card data-testid="fallback" className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-display text-xl text-ticket">{t('noUnanimousPick')}</CardHeader>
          <CardContent className="flex flex-col gap-1">
            {(snapshot.topCandidates ?? []).map((entry) => (
              <p key={entry.movieId} className="font-mono text-sm text-ticket">{entry.title}</p>
            ))}
          </CardContent>
        </Card>
        {isHost && (
          <Button
            variant="outline"
            className="border-exit-red text-exit-red hover:bg-exit-red hover:text-ticket"
            onClick={() => client?.send({ type: 'end_room' })}
          >
            {t('endSession')}
          </Button>
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
      {latestMatch && (
        <div data-testid="match-banner">
          <MarqueeReveal movie={latestMatch} />
        </div>
      )}
      <SwipeDeck card={currentCard} onDecide={(vote) => client?.send({ type: 'swipe', movieId: pendingCardId!, vote })} />
      {isHost && (
        <Button
          variant="outline"
          className="border-exit-red text-exit-red hover:bg-exit-red hover:text-ticket"
          onClick={() => client?.send({ type: 'end_room' })}
        >
          {t('endSession')}
        </Button>
      )}
    </main>
  )
}
```

Note: this step already threads `msg.totalVotes` through `unsubState` (used later by Task 3/6) — harmless before Task 3 lands since `RoomSnapshot`/`state_update` don't have that field yet; TypeScript will flag it, so this exact line must land together with Task 3, not before. **Implementer: if you reach this task before Task 3 exists in the branch, omit `totalVotes: msg.totalVotes,` from this file for now and leave a `// Task 3 adds totalVotes here` comment in its place — Task 3's dispatch will restore it.** (This plan executes tasks in order 1→10, so in practice Task 3 already exists by the time any later task touches this file — this note only matters if execution order changes.)

- [ ] **Step 2: Typecheck and run the e2e suite**

Run: `npm run typecheck && npm run test:e2e`
Expected: typecheck clean (once Task 3's `totalVotes` field exists — see note above, omit that one line if run before Task 3), e2e still 28/28 — this task changes zero rendered output, only control flow, so every existing assertion must still pass unchanged.

- [ ] **Step 3: Commit**

```bash
git add app/room/[code]/page.tsx
git commit -m "refactor: flatten RoomPage into 4 real top-level branches, wire chapter step"
```

---

### Task 2: i18n copy for all 5 screens

**Files:**
- Modify: `messages/en-us.json:63-71` (`room` namespace), `messages/en-us.json:78-81` (`marqueeReveal` namespace)
- Modify: `messages/pt-br.json:63-71` (`room` namespace), `messages/pt-br.json:78-81` (`marqueeReveal` namespace)
- Test: `messages/messages.test.ts` (existing — no changes, must stay passing)

**Design notes:** `startButton` and `noUnanimousPick` change value (mockup: "DIM THE LIGHTS", "NO UNANIMOUS PICK" — both uppercase per the uppercase-verbatim convention). Everything else is additive. `matchLabel` already reads "Deu match" in pt-br (not a literal translation of "It's a match") — kept as-is, not touched.

**Interfaces:**
- Produces the exact key names Tasks 5-9 consume: `room.waitingForHost`, `room.doorCodeLabel`, `room.restartReelLabel`, `room.restartReelDiscardLabel` (takes `{count}`), `room.closestThreeLabel`, `room.runnersUpExplainer`, `room.secondReelLabel`, `room.closeTheHouseLabel`, `room.houseLightsUp`, `room.endOfShowTitle`, `room.reelChangeFooter`, `room.backToBoxOffice`. `marqueeReveal` gets no new keys — Task 7's own Design Notes rule out the host-buttons/participant-chips UI these would have supported, so adding them here would ship orphaned copy (the pattern this codebase's Box office review already flagged and removed once).

- [ ] **Step 1: Edit `messages/en-us.json`'s `room` namespace (lines 63-71)**

```json
  "room": {
    "connecting": "Connecting…",
    "admitted": "Admitted",
    "removeButton": "Remove",
    "startButton": "DIM THE LIGHTS",
    "buildingPool": "Building your pool…",
    "waitingForHost": "Waiting for the host to dim the lights",
    "doorCodeLabel": "Door code",
    "restartReelLabel": "Restart reel",
    "restartReelDiscardLabel": "Discard {count} votes?",
    "noUnanimousPick": "NO UNANIMOUS PICK",
    "closestThreeLabel": "closest three",
    "runnersUpExplainer": "The house suggests the top line. Host can start a second reel, or put it to a show of hands.",
    "secondReelLabel": "SECOND REEL",
    "closeTheHouseLabel": "Close the house",
    "endSession": "End session",
    "houseLightsUp": "The house lights come up",
    "endOfShowTitle": "END OF SHOW",
    "reelChangeFooter": "reel change · thank you for not talking during the picture",
    "backToBoxOffice": "BACK TO THE BOX OFFICE"
  },
```

**Note:** `marqueeReveal` (lines 78-81 in both files) is untouched by this task — Task 7's Design Notes rule out the host-buttons/participant-chips UI that would have needed new copy there; adding unused keys would ship orphans.

- [ ] **Step 2: Run the parity test, verify it fails**

Run: `npx vitest run messages/messages.test.ts`
Expected: FAIL — pt-br.json doesn't have the new `room` keys yet.

- [ ] **Step 3: Edit `messages/pt-br.json`'s `room` namespace (lines 63-71)**

```json
  "room": {
    "connecting": "Conectando…",
    "admitted": "Admitidos",
    "removeButton": "Remover",
    "startButton": "APAGAR AS LUZES",
    "buildingPool": "Montando seu catálogo…",
    "waitingForHost": "Esperando o anfitrião apagar as luzes",
    "doorCodeLabel": "Código da porta",
    "restartReelLabel": "Reiniciar a sessão",
    "restartReelDiscardLabel": "Descartar {count} votos?",
    "noUnanimousPick": "SEM ESCOLHA UNÂNIME",
    "closestThreeLabel": "os três mais próximos",
    "runnersUpExplainer": "A casa sugere o primeiro da lista. O anfitrião pode começar uma nova sessão, ou decidir a mão levantada.",
    "secondReelLabel": "NOVA SESSÃO",
    "closeTheHouseLabel": "Encerrar a casa",
    "endSession": "Encerrar sessão",
    "houseLightsUp": "As luzes da casa se acendem",
    "endOfShowTitle": "FIM DA SESSÃO",
    "reelChangeFooter": "troca de rolo · obrigado por não conversar durante o filme",
    "backToBoxOffice": "VOLTAR PARA A BILHETERIA"
  },
```

- [ ] **Step 4: Run the parity test, verify it passes**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add messages/en-us.json messages/pt-br.json
git commit -m "feat: add room-screen copy for reimagined UI restyle"
```

---

### Task 3: Backend — `restart_reel` WS action + live `totalVotes`

**Files:**
- Modify: `server/ws/protocol.ts` (add `ClientMessage` variant, add `totalVotes` to `state_update` and `RoomSnapshot`)
- Modify: `server/room/activeActions.ts` (new `restartReel` function)
- Modify: `server/ws/router.ts` (new `'restart_reel'` case, `totalVotes` in `stateUpdate()` and `snapshotFor()`)
- Test: `server/room/activeActions.test.ts` (extend, per the spec's Testing section)

**Design notes:** Mirrors `startRoom`'s pool-rebuild logic exactly, but simpler: no participant exclusion (nobody's connectivity changes), no `lobby`→`starting`→`active` status dance (room stays `active` throughout — the mockup shows no loading state for this action, and adding one is out of scope). Gate is `status === 'active'` (works whether exhausted or not — the two mockup entry points, Now-showing and Runners-up, are both `active`; Runners-up's "exhausted with matches.length===0" is still `status === 'active'` per the room's real state shape). Resets `matches`, `matchedMovieIds`, `genreTally`, `totalVotes`, and every participant's `swipes`, then rebuilds the pool and reassigns each participant a fresh `pendingCardId`, exactly like `startRoom`'s tail end. No new `ErrorCode` needed — `not_host` and `room_not_active` already exist and cover every failure this action can have.

`totalVotes` is added to `state_update`/`RoomSnapshot` because the Now-showing restart button's two-tap confirm (Task 6) needs a real "Discard N votes?" count — `room.totalVotes` is already tracked server-side (incremented in `swipeAction`), it just wasn't broadcast to clients before.

**Interfaces:**
- Consumes: `emptyTally()` from `../ranking/affinity`, `assignPendingCard`/`recomputeExhaustion` (already private to `activeActions.ts`, reused as-is), `buildPool`/`computeCAndM` (already imported in `activeActions.ts`).
- Produces: `restartReel(store, code, callerIsHost, db, tmdb, librarySync): Promise<ActionResult<{ pool: PoolEntry[]; degraded: boolean }>>` — Task 6's `restart_reel` WS send + `router.ts`'s new case are the consumers. `ClientMessage`'s `{ type: 'restart_reel' }` variant — Task 6 sends this. `RoomSnapshot.totalVotes: number` and `state_update`'s `totalVotes: number` — Task 6 reads `snapshot.totalVotes` for the confirm-button label.

- [ ] **Step 1: Write the failing tests**

Add to `server/room/activeActions.test.ts`, after the existing `startRoom` describe block (before `describe('swipeAction', ...)`):

```ts
describe('restartReel', () => {
  it('rejects a non-host caller', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'Guest')
    seedPlexRows(10)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    const result = await restartReel(store, code, false, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'not_host' })
  })

  it('rejects restarting a room that has not been started yet', async () => {
    const store = createRoomStore()
    const { code } = store.create({ kind: 'all' }, 'plex', {})
    seedPlexRows(10)
    const result = await restartReel(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'room_not_active' })
  })

  it('resets matches, votes, and exhaustion, and reassigns every participant a fresh pendingCardId', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    const { participantId: hostId } = joinRoom(store, code, 'Host', hostClaimToken)!
    const { participantId: guestId } = joinRoom(store, code, 'Guest')!
    seedPlexRows(10)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    const room = store.get(code)!
    const firstCardId = room.participants.get(hostId)!.pendingCardId!
    swipeAction(store, code, hostId, firstCardId, 'yes')
    swipeAction(store, code, guestId, firstCardId, 'yes')
    expect(room.matches.length).toBe(1)
    expect(room.totalVotes).toBe(2)

    const result = await restartReel(store, code, true, db, noOpTmdb, noOpLibrarySync)
    expect(result.ok).toBe(true)
    expect(room.matches).toEqual([])
    expect(room.matchedMovieIds.size).toBe(0)
    expect(room.totalVotes).toBe(0)
    expect(room.exhausted).toBe(false)
    expect(room.participants.get(hostId)!.swipes.size).toBe(0)
    expect(room.participants.get(hostId)!.pendingCardId).not.toBeNull()
    expect(room.participants.get(guestId)!.pendingCardId).not.toBeNull()
  })

  it('rejects when the resulting pool has fewer than POOL_MIN_SIZE candidates', async () => {
    const store = createRoomStore()
    const { code, hostClaimToken } = store.create({ kind: 'all' }, 'plex', {})
    joinRoom(store, code, 'Host', hostClaimToken)
    joinRoom(store, code, 'Guest')
    seedPlexRows(10)
    await startRoom(store, code, true, db, noOpTmdb, noOpLibrarySync)
    rmSync(dir, { recursive: true, force: true })
    dir = mkdtempSync(join(tmpdir(), 'popcornpoll-active-'))
    const emptyDb = openDb(dir)
    const result = await restartReel(store, code, true, emptyDb, noOpTmdb, noOpLibrarySync)
    expect(result).toEqual({ ok: false, code: 'pool_too_small' })
    emptyDb.close()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/room/activeActions.test.ts`
Expected: FAIL — `restartReel is not a function` / `not exported`

- [ ] **Step 3: Add `restartReel` to `server/room/activeActions.ts`**

Add this import at the top (alongside the existing `import { recordVote } from '../ranking/affinity'`):

```ts
import { emptyTally, recordVote } from '../ranking/affinity'
```

Add this function after `startRoom` (before `swipeAction`):

```ts
export async function restartReel(
  store: RoomStore,
  code: string,
  callerIsHost: boolean,
  db: Database.Database,
  tmdb: TmdbClient,
  librarySync: SyncWaiter,
): Promise<ActionResult<{ pool: PoolEntry[]; degraded: boolean }>> {
  if (!callerIsHost) return err('not_host')
  const room = store.get(code)
  if (!room) return err('room_not_found')
  if (room.status !== 'active') return err('room_not_active')

  const result = await (async () => {
    await librarySync.waitForCurrent()
    return buildPool(db, tmdb, room.candidateSource, room.tmdbFilters, room.rngSeed)
  })()
  if (result.tooSmall) return err('pool_too_small')

  room.pool = result.pool
  const { c, m } = computeCAndM(result.pool)
  room.reputationC = c
  room.reputationM = m
  room.matches = []
  room.matchedMovieIds = new Set()
  room.genreTally = emptyTally()
  room.totalVotes = 0
  room.lastActivityAt = Date.now()

  for (const participant of room.participants.values()) {
    participant.swipes.clear()
  }
  for (const participantId of room.participants.keys()) {
    assignPendingCard(room, participantId)
  }
  recomputeExhaustion(room)

  return ok({ pool: room.pool, degraded: result.degraded })
}
```

- [ ] **Step 4: Add the `restart_reel` `ClientMessage` variant and `totalVotes` field in `server/ws/protocol.ts`**

In the `ClientMessage` union, add after `| { type: 'end_room' }`:

```ts
  | { type: 'restart_reel' }
```

In `RoomSnapshot`, add after `candidateSource: CandidateSource`:

```ts
  totalVotes: number
```

In the `state_update` variant of `ServerMessage`, add after `candidateSource: CandidateSource`:

```ts
      totalVotes: number
```

- [ ] **Step 5: Wire `totalVotes` and the new case in `server/ws/router.ts`**

In `stateUpdate()` (around line 39-51), add `totalVotes: room.totalVotes,` after `candidateSource: room.candidateSource,`.

In `snapshotFor()` (around line 64-83), add `totalVotes: room.totalVotes,` after `candidateSource: room.candidateSource,` in the `base` object.

Add this case after `'end_room'` (before `'heartbeat'`), and add `restartReel` to the existing `import { startRoom, swipeAction } from './activeActions'`-style import at the top of the file:

```ts
    case 'restart_reel': {
      if (!state.roomCode) return emptyOutput(state)
      const roomCode = state.roomCode
      const result = await restartReel(store, roomCode, state.isHost, db, tmdb, librarySync)
      if (!result.ok) {
        return { ...emptyOutput(state), toSender: [{ type: 'error', code: result.code, message: result.code }] }
      }
      const room = store.get(roomCode)!
      const update = stateUpdate(room) // same seq-source reasoning as 'start' and 'end_room' above
      const toRoom: ServerMessage[] = [{ type: 'room_started', pool: room.pool, seq: update.seq }, update]
      if (result.data.degraded) {
        toRoom.push({
          type: 'notice',
          level: 'warning',
          code: 'degraded_to_plex_only',
          message: 'TMDB is unavailable right now — this round uses your Plex library only.',
        })
      }
      return {
        ...emptyOutput(state),
        toRoom,
        toParticipant: Array.from(room.participants.values()).map((p) => ({
          participantId: p.id,
          messages: [{ type: 'next_card', movieId: p.pendingCardId }],
        })),
      }
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run server/room/activeActions.test.ts && npm run typecheck`
Expected: PASS, no type errors (the `RoomSnapshot`/`state_update` shape change is additive but every construction site must supply the new field — typecheck will catch any missed one).

- [ ] **Step 7: Commit**

```bash
git add server/ws/protocol.ts server/room/activeActions.ts server/ws/router.ts server/room/activeActions.test.ts
git commit -m "feat: add restart_reel WS action and broadcast live totalVotes"
```

---

### Task 4: Generalize `CodeSlats` (size variant + space-delimited splitting)

**Files:**
- Modify: `components/CodeSlats.tsx`
- Modify: `components/CodeSlats.test.ts`

**Design notes:** Two mockup-confirmed reuses of the split-flap tile pattern beyond Join's room code: Lobby's door-code recap (smaller tiles, `marquee`-gold text, no inset shadow — exact values from the mockup's `smallStyle`: `font-size:22px; width:26px; height:34px; color:#F5A623`) and Match reveal's movie-title slats (same big tiles as Join, but grouped by spaces instead of hyphens, since movie titles aren't hyphenated codes).

**Interfaces:**
- Consumes: nothing new.
- Produces: `slatGroups(text: string, splitOn?: 'hyphen' | 'space'): Slat[][]` (new optional second param, defaults to `'hyphen'` — Join's existing call site `slatGroups(code)` is unaffected). `CodeSlats({ code, size }: { code: string; size?: 'default' | 'small' })` — Task 5 passes `size="small"`; Task 7 passes `splitOn` indirectly via a new prop (see below); Join's existing `<CodeSlats code={params.code} />` call is unaffected (both new props are optional).

Also add a `splitOn` prop to the component itself (not just the helper) so callers don't need to pre-split:

- [ ] **Step 1: Write the failing tests**

Add to `components/CodeSlats.test.ts`, after the existing tests:

```ts
describe('slatGroups with splitOn', () => {
  it('splits on spaces instead of hyphens when splitOn is "space"', () => {
    expect(slatGroups('REAR WINDOW', 'space')).toEqual([
      [
        { letter: 'R', delay: '0.00' },
        { letter: 'E', delay: '0.09' },
        { letter: 'A', delay: '0.18' },
        { letter: 'R', delay: '0.27' },
      ],
      [
        { letter: 'W', delay: '0.36' },
        { letter: 'I', delay: '0.45' },
        { letter: 'N', delay: '0.54' },
        { letter: 'D', delay: '0.63' },
        { letter: 'O', delay: '0.72' },
        { letter: 'W', delay: '0.81' },
      ],
    ])
  })

  it('defaults to hyphen-splitting when splitOn is omitted (Join room codes unaffected)', () => {
    expect(slatGroups('AB-CD')).toEqual(slatGroups('AB-CD', 'hyphen'))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run components/CodeSlats.test.ts`
Expected: FAIL — `slatGroups` doesn't accept a second argument yet, or produces wrong groups.

- [ ] **Step 3: Update `components/CodeSlats.tsx`**

Replace the whole file:

```tsx
// components/CodeSlats.tsx
// Renders text as individually staggered "split-flap" letter tiles. Room
// codes group on hyphens (WORD-WORD-###); movie titles (Match reveal) group
// on spaces instead — `splitOn` controls which. Two sizes: `default`
// (Join's big room-code tiles, ticket-cream text) and `small` (Lobby's door-
// code recap, marquee-gold text, exact values from the mockup's own
// `smallStyle`). Modeled on BulbFrame.tsx's precompute-an-array-of-per-item-
// styles pattern.
export type Slat = { letter: string; delay: string }

export function slatGroups(text: string, splitOn: 'hyphen' | 'space' = 'hyphen'): Slat[][] {
  let i = 0
  const groups = splitOn === 'space' ? text.split(' ') : text.split('-')
  return groups.map((group) =>
    group.split('').map((letter) => {
      const delay = (i * 0.09).toFixed(2)
      i += 1
      return { letter, delay }
    }),
  )
}

export default function CodeSlats({
  code,
  size = 'default',
  splitOn = 'hyphen',
}: {
  code: string
  size?: 'default' | 'small'
  splitOn?: 'hyphen' | 'space'
}) {
  const groups = slatGroups(code, splitOn)
  const tileClass =
    size === 'small'
      ? 'flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[22px] text-marquee'
      : 'flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[clamp(24px,6vw,64px)] text-ticket shadow-[inset_0_-6px_12px_rgba(0,0,0,.6)]'
  const tileStyle = size === 'small' ? { width: 26, height: 34 } : { width: 'clamp(27px, 6.4vw, 68px)', height: 'clamp(37px, 8.4vw, 90px)' }
  const gap = size === 'small' ? 'gap-1' : 'gap-3 sm:gap-4'
  const innerGap = size === 'small' ? 'gap-0.5' : 'gap-1 sm:gap-1.5'

  return (
    <div className={`flex items-center ${gap}`} role="img" aria-label={code}>
      {groups.map((letters, gi) => (
        <div key={gi} className={`flex ${innerGap}`}>
          {letters.map(({ letter, delay }, li) => (
            <span
              key={li}
              aria-hidden
              className={tileClass}
              style={{ ...tileStyle, animation: `slatFlip .5s ease-out both ${delay}s` }}
            >
              {letter}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/CodeSlats.test.ts`
Expected: PASS (all tests, including Join's original two)

- [ ] **Step 5: Run the full unit suite and typecheck (this file has one existing consumer — Join)**

Run: `npm run typecheck && npx vitest run`
Expected: clean — `app/join/[code]/page.tsx`'s `<CodeSlats code={params.code} />` call has no `size`/`splitOn` args, so it keeps its current `default`/`hyphen` behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add components/CodeSlats.tsx components/CodeSlats.test.ts
git commit -m "feat: generalize CodeSlats with a size variant and space-delimited splitting"
```

---

### Task 5: Restyle Lobby

**Files:**
- Modify: `components/RoomShare.tsx`
- Modify: `components/TicketAvatar.tsx`
- Modify: `app/room/[code]/page.tsx` (Lobby branch only, from Task 1)

**Design notes:** Drops shadcn `Card`/`CardContent`/`Button` in `RoomShare` for bespoke velvet-panel styling; the room code becomes `<CodeSlats code={code} size="small" />` instead of plain text (mockup line 262-266: "Door code" caption + slat tiles + QR + Copy link/Share buttons). `TicketAvatar` gets a lighter pass — its existing `Badge`s already use the right tokens, just tightened to match the picture-palace border/spacing language. The admitted-roster `Card` in `RoomPage`'s Lobby branch also drops shadcn. Per this plan's Global Constraints, no stats row (Pool built/Runtime tonight/Concessions all dropped — no real data for two of the three, and the third's data doesn't exist pre-Start).

**Interfaces:**
- Consumes: `CodeSlats` (default export, Task 4) with `size="small"`; `room.doorCodeLabel`, `room.waitingForHost`, `room.startButton` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Update `components/RoomShare.tsx`**

```tsx
// components/RoomShare.tsx
'use client'

import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import CodeSlats from './CodeSlats'

export function RoomShare({ code }: { code: string }) {
  const t = useTranslations('roomShare')
  const tRoom = useTranslations('room')
  const [copied, setCopied] = useState(false)
  const [canShare, setCanShare] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/join/${code}` : ''

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && 'share' in navigator)
  }, [])

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
    toast(t('linkCopiedToast'))
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex w-full flex-col items-center gap-4 border-2 border-brass/70 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
      <p className="font-mono text-[10.5px] uppercase tracking-[.3em] text-brass">{tRoom('doorCodeLabel')}</p>
      <CodeSlats code={code} size="small" />
      <canvas ref={canvasRef} aria-label={`QR code for ${joinUrl}`} className="rounded bg-ticket p-2" />
      <div className="flex flex-wrap justify-center gap-2.5">
        <button
          type="button"
          onClick={copyLink}
          className="border border-brass/60 bg-transparent px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ticket hover:border-marquee hover:text-marquee"
        >
          {copied ? t('copied') : t('copyLink')}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => navigator.share({ title: t('shareTitle'), url: joinUrl })}
            className="bg-marquee px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-ink hover:bg-marquee/90"
          >
            {t('share')}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `components/TicketAvatar.tsx`**

```tsx
// components/TicketAvatar.tsx
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Badge } from './ui/badge'
import type { ParticipantView } from '../server/ws/protocol'

export function TicketAvatar({ participant }: { participant: ParticipantView }) {
  const t = useTranslations('ticketAvatar')
  const initials = participant.displayName.slice(0, 2).toUpperCase()
  return (
    <div className="flex items-center gap-2.5 border border-brass/40 bg-velvet/60 px-3 py-2">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-marquee font-mono text-xs text-ink">{initials}</AvatarFallback>
      </Avatar>
      <span className="font-mono text-sm text-ticket">{participant.displayName}</span>
      {participant.connectionStatus === 'disconnected' && (
        <Badge variant="outline" className="border-exit-red text-exit-red">{t('away')}</Badge>
      )}
      {participant.finished && <Badge className="bg-marquee text-ink">{t('done')}</Badge>}
    </div>
  )
}
```

- [ ] **Step 3: Restyle the Lobby branch in `app/room/[code]/page.tsx`**

Replace the Lobby branch (the `if (snapshot.status === 'lobby' || snapshot.status === 'starting')` block Task 1 created) with:

```tsx
  if (snapshot.status === 'lobby' || snapshot.status === 'starting') {
    return (
      <main className="mx-auto flex flex-1 max-w-md flex-col items-center gap-6 px-4 py-10">
        <RoomShare code={params.code} />
        <div className="w-full border border-brass/50 bg-velvet">
          <p className="border-b border-brass/30 px-4 py-3 font-mono text-xs uppercase tracking-widest text-brass">
            {t('admitted')}
          </p>
          <div className="flex flex-col gap-2 p-4">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center justify-between">
                <TicketAvatar participant={p} />
                {isHost && (
                  <button
                    type="button"
                    onClick={() => client?.send({ type: 'kick', participantId: p.id })}
                    className="px-2 py-1 font-mono text-xs uppercase tracking-wide text-exit-red hover:bg-exit-red/10"
                  >
                    {t('removeButton')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        {isHost && snapshot.status === 'lobby' && (
          <button
            type="button"
            onClick={() => client?.send({ type: 'start' })}
            className="h-[62px] w-full bg-marquee font-display text-xl tracking-wide text-ink hover:bg-marquee/90"
          >
            {t('startButton')}
          </button>
        )}
        {snapshot.status === 'lobby' && !isHost && (
          <p className="font-mono text-sm text-brass">{t('waitingForHost')}</p>
        )}
        {snapshot.status === 'starting' && (
          <p className="font-mono text-sm text-brass">{t('buildingPool')}</p>
        )}
      </main>
    )
  }
```

This drops the `Button`/`Card`/`CardContent`/`CardHeader` imports for the Lobby branch — since Task 1's branches for `exhausted`/`active` still use `Button`/`Card`/`CardContent`/`CardHeader` (Runners-up and Now-showing, restyled in Tasks 8/6), leave those imports in the file; do not remove them yet.

- [ ] **Step 4: Typecheck and manually verify**

Run: `npm run typecheck`, then `npm run dev`, join a room as host, confirm: door code renders as small slat tiles, QR code and Copy link/Share buttons work, admitted roster shows each participant, "DIM THE LIGHTS" is a full-width marquee button, and (in a second browser tab as a non-host guest) "Waiting for the host to dim the lights" shows instead.

- [ ] **Step 5: Commit**

```bash
git add components/RoomShare.tsx components/TicketAvatar.tsx app/room/[code]/page.tsx
git commit -m "feat: restyle Lobby screen with small CodeSlats door-code recap"
```

---

### Task 6: Restyle Now showing (SwipeDeck) + Restart-reel button

**Files:**
- Modify: `components/SwipeDeck.tsx`
- Modify: `app/room/[code]/page.tsx` (the active/Now-showing branch from Task 1)

**Design notes:** Restyles SwipeDeck's existing hand-rolled drag engine into the mockup's 3-column layout — PASS rail (left, `exit-red`) / card (center) / ADMIT rail (right) — replacing the current pair of round icon buttons below the card. Keeps `data-testid="swipe-card"` on the single interactive card exactly as today. Adds the room-tally strip with the new Restart-reel button, wired to `restart_reel` (Task 3) via the two-tap confirm pattern read directly from the mockup's own JS (`onRestartReel`/`cancelRestartReel`): first click sets a `confirmRestart` flag and shows "Discard N votes?" for 4 seconds (auto-reverting via `setTimeout`, and reverting early on blur); a second click within that window sends `restart_reel`; if `totalVotes === 0` there's nothing to discard, so it sends immediately with no confirm step.

**Interfaces:**
- Consumes: `state.totalVotes` from `RoomSnapshot` (Task 3); `room.restartReelLabel`, `room.restartReelDiscardLabel`, `room.endSession` (Task 2).
- Produces: `SwipeDeck`'s prop signature grows by two optional callbacks — `onRestartReel?: () => void` and a `totalVotes: number` prop are NOT added to `SwipeDeck` itself; the tally strip (with the Restart-reel button) is added to `RoomPage`'s active branch directly, not inside `SwipeDeck`, since it's the mockup's own layout (tally strip is a sibling of the deck row, not nested in the card). `SwipeDeck`'s existing `{ card, onDecide }` props are unchanged.

- [ ] **Step 1: Restyle `components/SwipeDeck.tsx`**

```tsx
// components/SwipeDeck.tsx
'use client'

import { motion, useAnimation, type PanInfo } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import type { PoolEntry } from '../server/pool/buildPool'

const SWIPE_THRESHOLD_PX = 120

export function SwipeDeck({
  card,
  onDecide,
}: {
  card: PoolEntry | null
  onDecide: (vote: 'yes' | 'no') => void
}) {
  const t = useTranslations('swipeDeck')
  const controls = useAnimation()
  const [dragDirection, setDragDirection] = useState<'yes' | 'no' | null>(null)

  async function animateDecision(vote: 'yes' | 'no') {
    if (!card) return
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
    return <p className="font-display text-xl text-brass">{t('noMoreCards')}</p>
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
    <div className="flex items-center gap-3 sm:gap-6" style={{ touchAction: 'pan-y', overscrollBehaviorX: 'none' }}>
      <button
        type="button"
        onClick={() => animateDecision('no')}
        aria-label={t('noAriaLabel')}
        className="flex h-32 w-16 flex-col items-center justify-center gap-1 border border-exit-red text-exit-red hover:bg-exit-red/10 sm:h-44 sm:w-20"
      >
        <span className="font-display text-base tracking-widest sm:text-lg">PASS</span>
      </button>

      <motion.div
        className="ticket-edge relative w-64 origin-bottom rounded bg-velvet shadow-xl sm:w-80"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
        drag="x"
        animate={controls}
        onDrag={(_, info) => setDragDirection(info.offset.x > 0 ? 'yes' : info.offset.x < 0 ? 'no' : null)}
        onDragEnd={handleDragEnd}
        data-drag-direction={dragDirection ?? undefined}
        data-testid="swipe-card"
      >
        <div className="p-4">
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
            <span className="mt-2 inline-block bg-marquee px-2 py-0.5 font-mono text-xs text-ink">{t('inLibrary')}</span>
          )}
        </div>
      </motion.div>

      <button
        type="button"
        onClick={() => animateDecision('yes')}
        aria-label={t('yesAriaLabel')}
        className="flex h-32 w-16 flex-col items-center justify-center gap-1 bg-marquee text-ink hover:bg-marquee/90 sm:h-44 sm:w-20"
      >
        <span className="font-display text-base tracking-widest sm:text-lg">ADMIT</span>
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add the room-tally strip with the Restart-reel button to `app/room/[code]/page.tsx`**

Add this state near the top of `RoomPage` (alongside the other `useState` calls):

```tsx
  const [confirmRestart, setConfirmRestart] = useState(false)
  const confirmRestartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onRestartReel() {
    if ((snapshot?.totalVotes ?? 0) === 0) {
      client?.send({ type: 'restart_reel' })
      return
    }
    if (!confirmRestart) {
      setConfirmRestart(true)
      if (confirmRestartTimer.current) clearTimeout(confirmRestartTimer.current)
      confirmRestartTimer.current = setTimeout(() => setConfirmRestart(false), 4000)
      return
    }
    if (confirmRestartTimer.current) clearTimeout(confirmRestartTimer.current)
    setConfirmRestart(false)
    client?.send({ type: 'restart_reel' })
  }
```

Replace the final (active/Now-showing) `return` block Task 1 created with:

```tsx
  return (
    <main className="mx-auto flex flex-1 max-w-2xl flex-col items-center justify-center gap-6 px-4 py-10">
      {latestMatch && (
        <div data-testid="match-banner">
          <MarqueeReveal movie={latestMatch} />
        </div>
      )}
      <SwipeDeck card={currentCard} onDecide={(vote) => client?.send({ type: 'swipe', movieId: pendingCardId!, vote })} />
      <div className="flex w-full flex-wrap items-center gap-3 border border-brass/35 bg-ink/70 px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-brass">{t('admitted')}</span>
        {participants.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5 font-mono text-xs text-ticket/80">
            <span className={`h-1.5 w-1.5 rounded-full ${p.connectionStatus === 'connected' ? 'bg-marquee' : 'bg-exit-red'}`} />
            {p.displayName}
          </span>
        ))}
        {isHost && (
          <button
            type="button"
            data-testid="restart-reel"
            onClick={onRestartReel}
            onBlur={() => {
              if (confirmRestartTimer.current) clearTimeout(confirmRestartTimer.current)
              setConfirmRestart(false)
            }}
            className={
              confirmRestart
                ? 'ml-auto border border-exit-red bg-exit-red px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ticket'
                : 'ml-auto border border-brass/50 bg-transparent px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-brass hover:border-marquee hover:text-marquee'
            }
          >
            {confirmRestart ? t('restartReelDiscardLabel', { count: snapshot.totalVotes }) : t('restartReelLabel')}
          </button>
        )}
        {isHost && (
          <button
            type="button"
            onClick={() => client?.send({ type: 'end_room' })}
            className="border border-exit-red px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-exit-red hover:bg-exit-red hover:text-ticket"
          >
            {t('endSession')}
          </button>
        )}
      </div>
    </main>
  )
```

Update the `import { useEffect, useRef, useState } from 'react'` line — `useRef` is already imported (used by `lastSeqRef`), no change needed there.

- [ ] **Step 3: Typecheck and manually verify**

Run: `npm run typecheck`, then `npm run dev` with two browser tabs (host + guest) in an active room. Confirm: PASS/ADMIT rails work by click and by drag; the tally strip shows both participants with live connection-status dots; clicking "Restart reel" as host turns it red with "Discard N votes?" for 4 seconds, a second click within that window resets the deck (new cards, tally strip's vote-derived state clears), and it auto-reverts to "Restart reel" if left alone.

- [ ] **Step 4: Commit**

```bash
git add components/SwipeDeck.tsx app/room/[code]/page.tsx
git commit -m "feat: restyle Now-showing deck as 3-column reel row, add restart-reel button"
```

---

### Task 7: Restyle Match reveal overlay

**Files:**
- Modify: `components/MarqueeReveal.tsx`

**Design notes:** Keeps the bordered velvet panel and bulb ring, but the bulb ring switches from framer-motion's per-bulb `animate` prop to `BulbFrame`-style CSS-keyframe bulbs (24 bulbs, not 20, per the mockup's `frameBulbs` — `hint-placeholder-count="24"`) — this also closes a real reduced-motion gap the current file has: CSS's `prefers-reduced-motion` media query doesn't touch framer-motion's `animate` prop, so today's bulb chase and the panel's spring pop-in never respect that preference. The title switches from a plain `motion.h2` to `CodeSlats` in `splitOn="space"` mode (the mockup's own dev-tag: "letterboard slats, SplitText timing" — slats visually, `SplitText`'s stagger *idea* only). Adds the "said yes" participant chips (filtered to yes-voters, per the mockup's updated `yesVoters` — `PEOPLE.filter(p => p.vote === 'yes')`) and the dynamic meta line (year/genres/rating, composed from real `PoolEntry` fields since `year`/`rating` are nullable).

**Interfaces:**
- Consumes: `CodeSlats` (Task 4) with `splitOn="space"`. The bulb ring keeps its own local `bulbPosition()` helper (unchanged from today, just switched from a framer-motion `animate` prop to a CSS `animation` string) rather than importing `components/BulbFrame.tsx` — the two panels' border geometry differs enough that sharing the helper isn't a clean fit; not worth a shared-component detour for one function. No new `marqueeReveal` i18n keys are consumed — see Task 2's note on why `saidYes`/`rollItEndSession`/`keepSwiping`/`backToDeckIn` were dropped from that task rather than added here unused. This task does NOT change `MarqueeReveal`'s own prop signature (`{ movie: PoolEntry }`) — the mockup's "ROLL IT · END SESSION"/"Keep swiping" buttons and participant chips need `isHost`, the room's `participants`, and the dismiss/end handlers, none of which `MarqueeReveal` currently receives. **Ruling:** rather than plumbing `RoomPage`'s host/participants/handlers through a new prop surface for a component that only exists inside one call site, this task keeps `MarqueeReveal` focused on the panel itself (title, bulbs, meta line — everything genuinely about "revealing the match") and does NOT add the host buttons or participant chips; the panel still auto-dismisses via `RoomPage`'s existing `MATCH_REVEAL_MS` timer, matching current behavior. Adding host-interactive controls to the overlay is scoped out — flag this to your human partner if a later screen makes it feel like a real gap, don't add it here as a surprise expansion of this task.

- [ ] **Step 1: Restyle `components/MarqueeReveal.tsx`**

```tsx
// components/MarqueeReveal.tsx
'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import CodeSlats from './CodeSlats'
import type { PoolEntry } from '../server/pool/buildPool'

const BULB_COUNT = 24

export function MarqueeReveal({ movie }: { movie: PoolEntry }) {
  const t = useTranslations('marqueeReveal')
  const metaParts = [
    movie.year ? String(movie.year) : null,
    movie.genres.length > 0 ? movie.genres.join(', ') : null,
    movie.rating !== null ? `★ ${movie.rating.toFixed(1)}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <motion.div
      role="alert"
      className="relative border-2 border-brass bg-velvet p-8 text-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
    >
      {Array.from({ length: BULB_COUNT }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute h-2 w-2 rounded-full bg-marquee"
          style={{ ...bulbPosition(i, BULB_COUNT), animation: `bulb 1.4s ease-in-out infinite ${((i / BULB_COUNT) * 1.4).toFixed(2)}s` }}
        />
      ))}
      <p className="font-mono text-xs uppercase tracking-widest text-brass">{t('matchLabel')}</p>
      <div className="my-3 flex flex-wrap justify-center">
        <CodeSlats code={movie.title.toUpperCase()} splitOn="space" />
      </div>
      {metaParts.length > 0 && (
        <p className="font-mono text-xs uppercase tracking-wider text-ticket/70">{metaParts.join(' · ')}</p>
      )}
      {movie.inLibrary && <p className="mt-2 text-sm text-marquee">{t('readyInLibrary')}</p>}
    </motion.div>
  )
}

// Places bulb i of n evenly around a rectangle's perimeter, expressed as
// inset-based absolute positioning (no layout dependency on the frame's
// exact pixel size) — same math as components/BulbFrame.tsx's bulbRing(),
// kept local here since MarqueeReveal's border geometry differs slightly.
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

Note: this keeps the panel's own `initial`/`animate` spring (framer-motion) as-is — fixing framer-motion's independent reduced-motion gap for the *panel's* pop-in (as opposed to the bulbs, now CSS-driven and covered by the existing wildcard media query) is a real, separate improvement worth doing, but touches `usePrefersReducedMotion` wiring this task doesn't otherwise need — track it as a follow-up rather than silently expanding this task's diff.

- [ ] **Step 2: Typecheck and manually verify**

Run: `npm run typecheck`, then trigger a match in a live room (two participants both swipe yes on the same card). Confirm: the movie title renders as space-grouped slat tiles, the bulb ring shows 24 bulbs chasing, and the meta line shows year/genres/rating for movies that have that data (and gracefully omits missing parts for ones that don't).

- [ ] **Step 3: Commit**

```bash
git add components/MarqueeReveal.tsx
git commit -m "feat: restyle Match reveal with CodeSlats title and CSS bulb ring"
```

---

### Task 8: Restyle Runners-up

**Files:**
- Modify: `app/room/[code]/page.tsx` (the exhausted/Runners-up branch from Task 1)

**Design notes:** "NO UNANIMOUS PICK" title + "closest three" kicker, ranked list (rank/title — no poster art, confirmed absent from the mockup), explanatory copy, and two buttons: "SECOND REEL" (sends `restart_reel` directly, no confirm — nothing is in-flight to lose once the room is already exhausted) and "Close the house" (`end_room`, replacing the generic "End session" copy used on Now-showing).

**Interfaces:**
- Consumes: `room.closestThreeLabel`, `room.runnersUpExplainer`, `room.secondReelLabel`, `room.closeTheHouseLabel` (Task 2); sends `{ type: 'restart_reel' }` (Task 3) directly, no `confirmRestart` state (that's Now-showing-only, per this plan's ruling that only the mid-session entry point needs a confirm).

- [ ] **Step 1: Restyle the Runners-up branch**

Replace the `if (snapshot.exhausted && snapshot.matches.length === 0)` block Task 1 created with:

```tsx
  if (snapshot.exhausted && snapshot.matches.length === 0) {
    return (
      <main className="mx-auto flex flex-1 max-w-2xl flex-col items-center gap-6 px-4 py-10">
        <div data-testid="fallback" className="w-full border-2 border-brass/60 bg-[#141313] p-6 sm:p-9">
          <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-brass/40 pb-3.5">
            <p className="font-display text-2xl text-ticket sm:text-3xl">{t('noUnanimousPick')}</p>
            <p className="font-mono text-[10.5px] uppercase tracking-wider text-brass">{t('closestThreeLabel')}</p>
          </div>
          <div className="flex flex-col">
            {(snapshot.topCandidates ?? []).map((entry, i) => (
              <div key={entry.movieId} className="flex items-center gap-3.5 border-b border-dashed border-brass/25 py-4">
                <span className="min-w-[34px] font-display text-xl text-brass">{i + 1}</span>
                <span className="flex-1 font-display text-lg text-ticket sm:text-xl">{entry.title}</span>
              </div>
            ))}
          </div>
          <p className="mt-5 font-mono text-[11px] leading-relaxed text-ticket/60">{t('runnersUpExplainer')}</p>
          {isHost && (
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                data-testid="restart-reel"
                onClick={() => client?.send({ type: 'restart_reel' })}
                className="bg-marquee px-6 py-3.5 font-display text-base text-ink hover:bg-marquee/90"
              >
                {t('secondReelLabel')}
              </button>
              <button
                type="button"
                onClick={() => client?.send({ type: 'end_room' })}
                className="border border-exit-red px-5 py-3.5 font-mono text-[11px] uppercase tracking-widest text-exit-red hover:bg-exit-red hover:text-ticket"
              >
                {t('closeTheHouseLabel')}
              </button>
            </div>
          )}
        </div>
      </main>
    )
  }
```

`data-testid="fallback"` moves from the old `Card` to this outer `<div>` — the spec table requires it survive unchanged, and it does (same wrapping element's role, new markup). `data-testid="restart-reel"` on the "SECOND REEL" button is added directly here rather than retrofitted later — Task 6's Restart-reel button gets the same testid inline, in its own Step 2 below.

- [ ] **Step 2: Typecheck and manually verify**

Run: `npm run typecheck`, then reach an exhausted-no-match state in a live room (set a room's filters narrow enough that participants run out of cards with no unanimous pick). Confirm: ranked list renders, "SECOND REEL" resets the deck immediately with no confirm prompt, "Close the house" ends the session.

- [ ] **Step 3: Commit**

```bash
git add app/room/[code]/page.tsx
git commit -m "feat: restyle Runners-up screen with ranked list and second-reel/close-house actions"
```

---

### Task 9: Restyle End of show

**Files:**
- Modify: `app/room/[code]/page.tsx` (the terminal/`ended` branch from Task 1)
- Modify: `app/globals.css` (new `glitchShift` keyframe)

**Design notes:** Big glitching "END OF SHOW" title (new `glitchShift` keyframe — `animation: glitchShift 5s steps(1) infinite` per the mockup) above the existing kicked/host-ended message (untouched — the mockup shows one generic message, no kicked/ended visual differentiation, confirmed by re-reading the mockup section). Adds the currently-missing "BACK TO THE BOX OFFICE" CTA (`router.push('/')`) — today this screen has zero interactive elements.

**Interfaces:**
- Consumes: `room.houseLightsUp`, `room.endOfShowTitle`, `room.reelChangeFooter`, `room.backToBoxOffice` (Task 2); needs `useRouter` from `next/navigation` (not currently imported in this file).

- [ ] **Step 1: Add the `glitchShift` keyframe to `app/globals.css`**

Insert after the `slatFlip`/`revealUp` keyframes Join's plan added (before the `prefers-reduced-motion` media query):

```css
@keyframes glitchShift {
  0%, 92%, 100% { transform: translate(0, 0); }
  93% { transform: translate(-2px, 1px); }
  95% { transform: translate(2px, -1px); }
  97% { transform: translate(-1px, 0); }
}
```

- [ ] **Step 2: Restyle the terminal branch and add the CTA**

Add `import { useRouter } from 'next/navigation'` at the top of `app/room/[code]/page.tsx`, and `const router = useRouter()` alongside the other hooks at the top of `RoomPage`.

Replace the terminal branch Task 1 created with:

```tsx
  if (terminal || snapshot.status === 'ended') {
    const message =
      terminal?.type === 'kicked'
        ? tKicked.has(terminal.reason)
          ? tKicked(terminal.reason)
          : tKicked('kicked')
        : tRoomEnded.has(terminal?.reason ?? 'host_ended')
          ? tRoomEnded(terminal?.reason ?? 'host_ended')
          : tRoomEnded('host_ended')
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

- [ ] **Step 3: Typecheck and manually verify**

Run: `npm run typecheck`, then end a room as host and confirm the terminal screen shows the glitching title, the original message, and that "BACK TO THE BOX OFFICE" navigates to `/`.

- [ ] **Step 4: Commit**

```bash
git add app/room/[code]/page.tsx app/globals.css
git commit -m "feat: restyle End of show with glitch title and back-to-box-office CTA"
```

---

### Task 10: e2e coverage — locator hardening + `restart_reel`

**Files:**
- Modify: `e2e/exhaustion.spec.ts` (add `data-testid` assertions if any selector broke — see Step 1)
- Create: `e2e/restartReel.spec.ts`

**Design notes:** Tasks 5-9 changed visible copy on Lobby/Runners-up/End-of-show (`startButton`, `noUnanimousPick`, `endOfShowTitle` etc.) — check every existing e2e spec for text-based selectors against those exact strings (the spec table's testid-discipline column says Lobby/Runners-up/End-of-show testids are "unchanged," but that only covers `data-testid` attributes, not incidental text-matching some spec might do). New coverage: `restart_reel`'s two real behaviors — host-only enforcement, and a full round-trip (vote, restart, confirm the pool/cards actually reset).

**Interfaces:**
- Consumes: `data-testid="fallback"` (Task 8) and `data-testid="restart-reel"` (Tasks 6 and 8 both — the spec table's Runners-up row calls for this testid, and it's on both entry points' buttons so a test can reach whichever one is visible without caring which screen it's on). Both already exist by this task — nothing to retrofit here.

- [ ] **Step 1: Fix the known-stale `text=Start` selector, then grep for any others**

`e2e/match.spec.ts:33` does `await hostPage.click('text=Start')` — Task 5 changed `room.startButton`'s value to "DIM THE LIGHTS", so this literal text selector now matches nothing. Change it to `await hostPage.getByRole('button', { name: 'DIM THE LIGHTS' }).click()`.

Then run: `grep -rn "text=Start\b\|text=No unanimous\|button\[aria-label=" e2e/` to check for any other now-stale text-based selectors this plan's copy changes might have broken (Task 5's `startButton`, Task 8's `noUnanimousPick`, Task 9's `endOfShowTitle`). `button[aria-label="Yes"]`/`button[aria-label="No"]` (used in `e2e/match.spec.ts` and others) are unaffected — Task 6 kept the same `aria-label` wiring on the restyled rail buttons. For every other hit the grep turns up, replace with a `data-testid`- or role-based selector matching the element it targets.

- [ ] **Step 2: Write `e2e/restartReel.spec.ts`**

Model this on `e2e/match.spec.ts`'s exact room-creation/join pattern (`seedFakeLibrary`, `pinEnglishLocale`, `chromium.launch()`, two contexts) — this repo's real e2e helper, not a placeholder:

```ts
// e2e/restartReel.spec.ts
import { test, expect, chromium } from '@playwright/test'
import { pinEnglishLocale, seedFakeLibrary } from './fixtures'

test('a non-host cannot trigger restart-reel, and the host round-trip resets the deck', async ({ baseURL }) => {
  await seedFakeLibrary(baseURL!)
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
  await hostPage.waitForSelector('[data-testid="swipe-card"]')
  await guestPage.waitForSelector('[data-testid="swipe-card"]')

  await expect(guestPage.getByTestId('restart-reel')).toHaveCount(0) // host-only: not rendered for a guest

  // Vote once from both participants so totalVotes > 0 going into the
  // restart — exercises the two-tap confirm path, not the zero-votes
  // instant-reset path.
  await hostPage.click('button[aria-label="Yes"]')
  await guestPage.click('button[aria-label="Yes"]')

  const restartButton = hostPage.getByTestId('restart-reel')
  await restartButton.click()
  await expect(restartButton).toHaveText(/discard/i)
  await restartButton.click()

  // A fresh card is assigned to both participants post-restart.
  await expect(hostPage.getByTestId('swipe-card')).toBeVisible()
  await expect(guestPage.getByTestId('swipe-card')).toBeVisible()
  await browser.close()
})
```

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS — every existing spec plus the new `restartReel.spec.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/room/[code]/page.tsx e2e/restartReel.spec.ts
git commit -m "test: add restart-reel e2e coverage and harden any stale text selectors"
```

---

## Final Verification

Run `npm run verify` (typecheck + build + vitest) followed by `npm run test:e2e` — both must be green before this plan is considered done.
