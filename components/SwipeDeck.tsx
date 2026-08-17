// components/SwipeDeck.tsx
'use client'

import { motion, useAnimation, type PanInfo } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import type { PoolEntry } from '../server/pool/buildPool'

const SWIPE_THRESHOLD_PX = 120

export function SwipeDeck({
  card,
  onDecide,
}: {
  card: PoolEntry | null
  onDecide: (vote: 'yes' | 'no') => void
}) {
  const controls = useAnimation()
  const [dragDirection, setDragDirection] = useState<'yes' | 'no' | null>(null)

  async function animateDecision(vote: 'yes' | 'no') {
    if (!card) return // nothing to decide on yet (deck is empty or hasn't loaded)
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
    return <p className="font-display text-xl text-brass">No more cards</p>
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
    <div className="flex flex-col items-center gap-6" style={{ touchAction: 'pan-y', overscrollBehaviorX: 'none' }}>
      <motion.div
        className="ticket-edge relative w-80 origin-bottom -rotate-1 rounded bg-velvet p-4 shadow-xl"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
        drag="x"
        animate={controls}
        onDrag={(_, info) => setDragDirection(info.offset.x > 0 ? 'yes' : info.offset.x < 0 ? 'no' : null)}
        onDragEnd={handleDragEnd}
        data-drag-direction={dragDirection ?? undefined}
      >
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
          <Badge className="mt-2 bg-marquee text-ink">In your library</Badge>
        )}
      </motion.div>
      <div className="flex gap-6">
        <Button
          size="icon"
          variant="outline"
          className="h-14 w-14 rounded-full border-exit-red text-exit-red hover:bg-exit-red hover:text-ticket"
          onClick={() => animateDecision('no')}
          aria-label="No"
        >
          ✕
        </Button>
        <Button
          size="icon"
          className="h-14 w-14 rounded-full bg-marquee text-ink hover:bg-marquee/90"
          onClick={() => animateDecision('yes')}
          aria-label="Yes"
        >
          ♥
        </Button>
      </div>
    </div>
  )
}
