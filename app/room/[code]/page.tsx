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
