// app/room/[code]/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
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

export default function RoomPage({ params }: { params: { code: string } }) {
  const t = useTranslations('room')
  const tErrors = useTranslations('errors')
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [participants, setParticipants] = useState<ParticipantView[]>([])
  const [pool, setPool] = useState<PoolEntry[]>([])
  const [pendingCardId, setPendingCardId] = useState<number | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [client, setClient] = useState<WsClient | null>(null)

  useEffect(() => {
    const ws = createWsClient(`${location.origin.replace('http', 'ws')}/ws`)
    setClient(ws)

    const unsubJoined = ws.on('joined', (msg) => {
      setSnapshot(msg.room)
      setParticipants(msg.room.participants)
      if (msg.room.pool) setPool(msg.room.pool)
      if (msg.room.pendingCardId !== undefined) setPendingCardId(msg.room.pendingCardId)
      if (msg.hostToken) setIsHost(true)
      sessionStorage.setItem(`sessionToken:${params.code}`, msg.sessionToken)
    })
    // state_update carries every field that changes over a room's life except
    // pool/pendingCardId/topCandidates (those arrive via room_started/next_card/
    // exhausted) — apply it with a merge, not a replace, or status/matches/
    // exhausted never reach snapshot and the UI can never leave the lobby view.
    const unsubState = ws.on('state_update', (msg) => {
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
    const unsubStarted = ws.on('room_started', (msg) => setPool(msg.pool))
    const unsubNextCard = ws.on('next_card', (msg) => setPendingCardId(msg.movieId))
    // match/exhausted arrive alongside a state_update in the same toRoom batch;
    // state_update already updates snapshot.matches/exhausted, but the movie
    // itself (match) and the ranked runner-up list (exhausted) only ever
    // arrive on these two message types.
    const unsubMatch = ws.on('match', (msg) =>
      setPool((prev) => (prev.some((e) => e.movieId === msg.movieId) ? prev : [...prev, msg.movie])),
    )
    const unsubExhausted = ws.on('exhausted', (msg) =>
      setSnapshot((prev) => prev && { ...prev, topCandidates: msg.topCandidates }),
    )
    const unsubError = ws.on('error', (msg) => {
      toast(tErrors.has(msg.code) ? tErrors(msg.code) : tErrors('generic'))
    })

    const hostClaimToken = sessionStorage.getItem(`hostClaimToken:${params.code}`) ?? undefined
    const pendingDisplayName = sessionStorage.getItem('pendingDisplayName')
    const storedSessionToken = sessionStorage.getItem(`sessionToken:${params.code}`)

    setTimeout(() => {
      if (storedSessionToken) {
        ws.send({ type: 'reconnect', roomCode: params.code, sessionToken: storedSessionToken })
      } else {
        ws.send({
          type: 'join',
          roomCode: params.code,
          displayName: pendingDisplayName ?? 'Guest',
          hostClaimToken,
        })
      }
    }, 0)

    const heartbeat = setInterval(() => ws.send({ type: 'heartbeat' }), 15_000)

    return () => {
      unsubJoined()
      unsubState()
      unsubStarted()
      unsubNextCard()
      unsubMatch()
      unsubExhausted()
      unsubError()
      clearInterval(heartbeat)
      ws.close()
    }
  }, [params.code])

  if (!snapshot) return <p className="p-8 font-mono text-brass">{t('connecting')}</p>

  if (snapshot.status === 'lobby' || snapshot.status === 'starting') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center gap-6 px-4 py-10">
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
  const latestMatch = snapshot.matches.length > 0
    ? pool.find((e) => e.movieId === snapshot.matches[snapshot.matches.length - 1])
    : null

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-4 py-10">
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
