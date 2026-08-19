'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { use, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createWsClient, type WsClient } from '../../../lib/wsClient'
import { useSetRoomStep, type ChapterStep } from '../../../components/chrome/RoomStatusContext'
import { EdgeState, type EdgeKind } from '../../../components/EdgeState'
import { MarqueeReveal } from '../../../components/MarqueeReveal'
import { RoomShare } from '../../../components/RoomShare'
import { SwipeDeck } from '../../../components/SwipeDeck'
import { TicketAvatar } from '../../../components/TicketAvatar'
import type { ParticipantView, RoomSnapshot } from '../../../server/ws/protocol'
import type { PoolEntry } from '../../../server/pool/buildPool'

type TerminalState = { type: 'kicked'; reason: 'kicked' | 'excluded_at_start' } | { type: 'room_ended'; reason: string }

// How long a match reveal stays on screen before it's dismissed and the
// swipe deck resumes — long enough to read the title, short enough not to
// block swiping on whatever remains unmatched.
const MATCH_REVEAL_MS = 4000

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const t = useTranslations('room')
  const tErrors = useTranslations('errors')
  const tKicked = useTranslations('kicked')
  const tRoomEnded = useTranslations('roomEnded')
  const tEdge = useTranslations('edgeState')
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [pool, setPool] = useState<PoolEntry[]>([])
  const [pendingCardId, setPendingCardId] = useState<number | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [client, setClient] = useState<WsClient | null>(null)
  const [terminal, setTerminal] = useState<TerminalState | null>(null)
  const [dismissedMatchId, setDismissedMatchId] = useState<number | null>(null)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [edgeOverride, setEdgeOverride] = useState<Exclude<EdgeKind, 'kicked'> | null>(null)
  // Guards against a double-click on Start sending two {type:'start'}
  // messages: the server rejects the second one synchronously with
  // 'already_started', which would consume attemptingStartRef before the
  // first one's real pool_too_small/library_empty error arrives — swallowing
  // the edge screen entirely.
  const [startPending, setStartPending] = useState(false)
  const lastSeqRef = useRef<number | null>(null)
  const confirmRestartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptingStartRef = useRef(false)

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
      // A start attempt whose response was lost to a dropped socket would
      // otherwise leave the Start button disabled forever; a `joined` means
      // that round-trip is over either way (the room is 'lobby' and the host
      // needs the button back, or it's 'active' and the button is gone).
      setStartPending(false)
      // `joined` is the one message that fires for BOTH a fresh join and
      // every reconnect, so it's the only place a client can re-derive the
      // truth about host connectivity. The live host_disconnected /
      // host_reconnected broadcasts only reach clients that were connected
      // when they fired, which leaves two bad states this fixes: a guest
      // that reconnects after the host already came back would stay stuck
      // on 'hostgone', and a guest that joins/reloads mid-outage would never
      // see 'hostgone' at all before the room closes on them.
      const host = msg.room.participants.find((p) => p.isHost)
      if (host) {
        const hostGone = host.connectionStatus === 'disconnected'
        setEdgeOverride((prev) => (hostGone ? 'hostgone' : prev === 'hostgone' ? null : prev))
      }
      if (msg.room.pool) setPool(msg.room.pool)
      if (msg.room.pendingCardId !== undefined) setPendingCardId(msg.room.pendingCardId)
      if (msg.hostToken) {
        setIsHost(true)
        localStorage.setItem(`hostToken:${code}`, msg.hostToken)
      }
      sessionStorage.setItem(`sessionToken:${code}`, msg.sessionToken)
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
      setStartPending(false)
      attemptingStartRef.current = false
      checkSeq(ws, msg.seq)
      setPool(msg.pool)
      // room_started fires for both 'start' and 'restart_reel' — the latter
      // rebuilds the pool and clears server-side matches, so a movie that
      // was previously matched (and dismissed) can legitimately match again.
      // Without this reset, latestMatchId === dismissedMatchId would still
      // hold for that id and the reveal would never show for the new match.
      setDismissedMatchId(null)
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
      setStartPending(false)
      const wasAttemptingStart = attemptingStartRef.current
      attemptingStartRef.current = false
      if (wasAttemptingStart && (msg.code === 'pool_too_small' || msg.code === 'library_empty')) {
        setEdgeOverride(msg.code === 'library_empty' ? 'emptylib' : 'poolfail')
        return
      }
      toast(tErrors.has(msg.code) ? tErrors(msg.code) : tErrors('generic'))
    })
    const unsubKicked = ws.on('kicked', (msg) => setTerminal({ type: 'kicked', reason: msg.reason }))
    const unsubRoomEnded = ws.on('room_ended', (msg) => setTerminal({ type: 'room_ended', reason: msg.reason }))
    const unsubSeqOnRoomEnded = ws.on('room_ended', (msg) => checkSeq(ws, msg.seq))
    const unsubHostDisconnected = ws.on('host_disconnected', () => setEdgeOverride('hostgone'))
    const unsubHostReconnected = ws.on('host_reconnected', () =>
      setEdgeOverride((prev) => (prev === 'hostgone' ? null : prev)),
    )

    const hostClaimToken = sessionStorage.getItem(`hostClaimToken:${code}`) ?? undefined
    const pendingDisplayName = sessionStorage.getItem('pendingDisplayName')

    const unsubOpen = ws.onOpen(() => {
      const storedSessionToken = sessionStorage.getItem(`sessionToken:${code}`)
      const storedHostToken = localStorage.getItem(`hostToken:${code}`) ?? undefined
      if (storedSessionToken) {
        ws.send({
          type: 'reconnect',
          roomCode: code,
          sessionToken: storedSessionToken,
          hostToken: storedHostToken,
        })
      } else {
        ws.send({
          type: 'join',
          roomCode: code,
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
      unsubHostDisconnected()
      unsubHostReconnected()
      unsubOpen()
      lastSeqRef.current = null
      clearInterval(heartbeat)
      ws.close()
    }
  }, [code])

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

  if (terminal?.type === 'kicked') {
    const body = tKicked.has(terminal.reason) ? tKicked(terminal.reason) : tKicked('kicked')
    // Same screen serves two reasons, but only one of them is anybody's
    // fault: 'excluded_at_start' means you were simply offline when the
    // session started, so the kicked copy's blame-shifting kicker/title
    // would contradict its own body. Detail/primary stay shared.
    const excluded = terminal.reason === 'excluded_at_start'
    return (
      <EdgeState
        kind="kicked"
        testId="terminal-screen"
        kicker={tEdge(excluded ? 'excludedKicker' : 'kickedKicker')}
        title={tEdge(excluded ? 'excludedTitle' : 'kickedTitle')}
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
    // Both failures leave the room fully retriable server-side (status stays
    // 'lobby', nobody is excluded, no session revoked), so the secondary
    // action dismisses back into the lobby instead of walking the host out
    // on guests who are still sitting there waiting.
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
        secondaryLabel={tEdge(kind === 'poolfail' ? 'poolFailSecondary' : 'emptyLibraryStayLabel')}
        onSecondary={() => setEdgeOverride(null)}
      />
    )
  }

  if (snapshot.status === 'lobby' || snapshot.status === 'starting') {
    return (
      <main className="mx-auto flex flex-1 max-w-md flex-col items-center gap-6 px-4 py-10">
        <RoomShare code={code} />
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
            disabled={startPending}
            onClick={() => {
              setStartPending(true)
              attemptingStartRef.current = true
              client?.send({ type: 'start' })
            }}
            className="relative h-[62px] w-full overflow-hidden bg-marquee font-display text-xl tracking-wide text-ink hover:bg-marquee/90 disabled:opacity-60"
          >
            {t('startButton')}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,transparent_35%,rgba(255,255,255,.5)_50%,transparent_65%)] bg-[length:200%_100%] [animation:shimmer_2.6s_linear_infinite]"
            />
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

  const currentCard = pool.find((entry) => entry.movieId === pendingCardId) ?? null
  const latestMatch =
    latestMatchId !== null && latestMatchId !== dismissedMatchId
      ? (pool.find((e) => e.movieId === latestMatchId) ?? null)
      : null

  if (snapshot.exhausted && snapshot.matches.length === 0) {
    return (
      <main className="mx-auto flex flex-1 max-w-2xl flex-col items-center gap-6 px-4 py-10">
        <div data-testid="fallback" className="w-full border-2 border-brass/60 bg-ink p-6 sm:p-9">
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
}
