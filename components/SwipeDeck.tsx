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
        <span className="font-display text-base tracking-widest sm:text-lg">{t('passLabel')}</span>
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
          {(card.posterSource === 'plex' || card.posterPath) && (
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
        className="flex h-32 w-16 flex-col items-center justify-center gap-1 border border-admit-teal text-admit-teal hover:bg-admit-teal/10 sm:h-44 sm:w-20"
      >
        <span className="font-display text-base tracking-widest sm:text-lg">{t('admitLabel')}</span>
      </button>
    </div>
  )
}
