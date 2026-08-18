// app/room/[code]/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createWsClient, type WsClient } from '../../../lib/wsClient'
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
  // Tracks the last-seen per-room `seq` (server/ws/protocol.ts's monotonic
  // broadcast counter) so a missed update — one that happened while briefly
  // disconnected — can be detected and repaired via `resync` instead of
  // silently trusting state that skipped a change. A ref, not state: pure
  // bookkeeping that drives an outbound send, never a render.
  const lastSeqRef = useRef<number | null>(null)

  useEffect(() => {
    // Authoritative reset: 'joined' (the response to join/reconnect/resync)
    // always carries the room's true current seq as a full snapshot — adopt
    // it unconditionally rather than comparing against the previous value.
    function applySeq(seq: number) {
      lastSeqRef.current = seq
    }
    // Incremental check: a broadcast's seq should equal the last one seen
    // (multiple messages from the same server-side batch share a seq — see
    // server/ws/router.ts's 'start'/'end_room' cases) or be exactly one
    // higher. Anything further ahead means at least one broadcast was
    // missed — ask the server for a fresh snapshot rather than trust a gap.
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
        // localStorage, not sessionStorage: the design doc's Authorization
        // model requires hostToken to "survive a tab refresh" — sessionStorage
        // is cleared when the tab closes, which would silently strip host
        // control the next time this browser reopens the same room (a new
        // tab, or after the OS/browser restarts the tab). hostClaimToken is
        // single-use, so once it's consumed, this localStorage copy is the
        // only way this browser can ever prove host status for this room again.
        localStorage.setItem(`hostToken:${params.code}`, msg.hostToken)
      }
      sessionStorage.setItem(`sessionToken:${params.code}`, msg.sessionToken)
      applySeq(msg.room.seq)
    })
    // state_update carries every field that changes over a room's life except
    // pool/pendingCardId/topCandidates (those arrive via room_started/next_card/
    // exhausted) — apply it with a merge, not a replace, or status/matches/
    // exhausted never reach snapshot and the UI can never leave the lobby view.
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
          seq: msg.seq,
        },
      )
    })
    const unsubStarted = ws.on('room_started', (msg) => {
      checkSeq(ws, msg.seq)
      setPool(msg.pool)
    })
    const unsubNextCard = ws.on('next_card', (msg) => setPendingCardId(msg.movieId))
    // match/exhausted arrive alongside a state_update in the same toRoom batch;
    // state_update already updates snapshot.matches/exhausted, but the movie
    // itself (match) and the ranked runner-up list (exhausted) only ever
    // arrive on these two message types.
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
    // Task 27 already subscribes to 'room_ended' for the terminal-state UI —
    // this is a second, independent subscription (wsClient dispatches to
    // every registered handler for a type) purely for seq bookkeeping, so a
    // room_ended broadcast doesn't fall outside gap detection.
    const unsubSeqOnRoomEnded = ws.on('room_ended', (msg) => checkSeq(ws, msg.seq))

    const hostClaimToken = sessionStorage.getItem(`hostClaimToken:${params.code}`) ?? undefined
    const pendingDisplayName = sessionStorage.getItem('pendingDisplayName')

    // Fires on the initial connection AND every reconnect wsClient performs
    // after a live WS-level drop (socket closes while the tab stays open) —
    // not just once at mount, unlike the setTimeout(…, 0) this replaces.
    // Re-reading sessionToken/hostToken from storage on every call, instead
    // of a value captured once at mount, is what makes a single handler
    // correct across calls: the first call (nothing stored yet) sends
    // 'join'; by the time any later reconnect fires, this same handler's
    // own 'joined' response (Step 6) has already persisted both tokens, so
    // it naturally sends 'reconnect' — with hostToken — from then on.
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

  // Once a match's id has been shown for MATCH_REVEAL_MS, dismiss it and
  // don't show it again — without this, deriving latestMatch directly from
  // snapshot.matches every render means the reveal never goes away once a
  // match has happened, permanently blocking the swipe deck underneath it.
  const latestMatchId = snapshot && snapshot.matches.length > 0 ? snapshot.matches[snapshot.matches.length - 1]! : null
  useEffect(() => {
    if (latestMatchId === null || latestMatchId === dismissedMatchId) return
    const timer = setTimeout(() => setDismissedMatchId(latestMatchId), MATCH_REVEAL_MS)
    return () => clearTimeout(timer)
  }, [latestMatchId, dismissedMatchId])

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

  return (
    <main className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
      {latestMatch && (
        <div data-testid="match-banner">
          <MarqueeReveal movie={latestMatch} />
        </div>
      )}
      <SwipeDeck card={currentCard} onDecide={(vote) => client?.send({ type: 'swipe', movieId: pendingCardId!, vote })} />
      {snapshot.exhausted && snapshot.matches.length === 0 && (
        <Card data-testid="fallback" className="w-full border-2 border-brass bg-velvet">
          <CardHeader className="font-display text-xl text-ticket">{t('noUnanimousPick')}</CardHeader>
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
          {t('endSession')}
        </Button>
      )}
    </main>
  )
}
