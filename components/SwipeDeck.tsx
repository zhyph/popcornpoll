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
  disabled = false,
}: {
  card: PoolEntry | null
  onDecide: (vote: 'yes' | 'no') => void
  // The Match Reveal overlay (app/room/[code]/page.tsx) sits fixed on top of
  // this deck rather than unmounting it, so a drag/click can't reach the
  // card underneath — but the keydown listener below is bound to `window`
  // and isn't affected by stacking order. Without this guard, arrow keys
  // would keep voting on cards the player can't see while the overlay is
  // up, which is exactly the "swipe straight through" behavior the overlay
  // is meant to prevent.
  disabled?: boolean
}) {
  const t = useTranslations('swipeDeck')
  const controls = useAnimation()
  const [dragDirection, setDragDirection] = useState<'yes' | 'no' | null>(null)
  // Tracks which card's poster has actually finished loading, so a card
  // change shows a skeleton instead of the *previous* card's poster —
  // <img> keeps painting its last decoded frame while a new src is still
  // in flight, which otherwise looks like the swipe didn't do anything for
  // the 1-2s it takes the next poster to load.
  const [loadedMovieId, setLoadedMovieId] = useState<number | null>(null)

  async function animateDecision(vote: 'yes' | 'no') {
    if (!card || disabled) return
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
        <span className="font-mono text-[9px] uppercase tracking-widest opacity-70 sm:hidden">{t('passHintMobile')}</span>
        <span className="hidden font-mono text-[9px] uppercase tracking-widest opacity-70 sm:inline">{t('passHintDesktop')}</span>
      </button>

      <motion.div
        className="ticket-edge relative w-64 origin-bottom overflow-hidden rounded bg-velvet shadow-xl sm:w-80"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))' }}
        drag="x"
        animate={controls}
        onDrag={(_, info) => setDragDirection(info.offset.x > 0 ? 'yes' : info.offset.x < 0 ? 'no' : null)}
        onDragEnd={handleDragEnd}
        data-drag-direction={dragDirection ?? undefined}
        data-testid="swipe-card"
      >
        {/* Ink-stamp overlays that fade in once the drag crosses into a
            direction — real interaction feedback the mockup calls out
            explicitly, not one of its decorative-stub elements. z-20 because
            the poster wrapper below is also `relative` (for its own library
            badge) and, being later in DOM order, would otherwise win the
            default stacking-order tie against these — painting the poster
            over the stamps instead of under them. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-4 top-4 z-20 -rotate-12 border-2 border-admit-teal px-2 py-0.5 font-display text-lg tracking-wider text-admit-teal transition-opacity"
          style={{ opacity: dragDirection === 'yes' ? 1 : 0 }}
        >
          {t('admitLabel')}
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute right-4 top-4 z-20 rotate-12 border-2 border-exit-red px-2 py-0.5 font-display text-lg tracking-wider text-exit-red transition-opacity"
          style={{ opacity: dragDirection === 'no' ? 1 : 0 }}
        >
          {t('voidStampLabel')}
        </span>
        <div className="p-4">
          {(card.posterSource === 'plex' || card.posterPath) && (
            <div className="relative mb-3 aspect-[2/3] w-full overflow-hidden rounded bg-brass/10">
              {loadedMovieId !== card.movieId && <div className="absolute inset-0 animate-pulse bg-brass/15" />}
              <img
                key={card.movieId}
                className="aspect-[2/3] w-full rounded object-cover"
                src={card.posterSource === 'plex' ? `/api/plex-image?movieId=${card.movieId}` : `https://image.tmdb.org/t/p/w342${card.posterPath}`}
                alt={card.title}
                onLoad={() => setLoadedMovieId(card.movieId)}
              />
              {card.inLibrary && (
                <span className="absolute left-3 top-3 z-10 bg-marquee px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-widest text-ink">
                  {t('inLibrary')}
                </span>
              )}
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl text-ticket">{card.title}</h2>
            {card.year !== null && <span className="font-mono text-sm text-brass">{card.year}</span>}
          </div>
          {(card.genres.length > 0 || card.rating !== null) && (
            <p className="mt-1 font-mono text-xs uppercase tracking-wider text-exit-red">
              {[card.genres.join(' · '), card.rating !== null ? `★ ${card.rating.toFixed(1)}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{card.overview}</p>
          {card.inLibrary && !(card.posterSource === 'plex' || card.posterPath) && (
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
        <span className="font-mono text-[9px] uppercase tracking-widest opacity-70 sm:hidden">{t('admitHintMobile')}</span>
        <span className="hidden font-mono text-[9px] uppercase tracking-widest opacity-70 sm:inline">{t('admitHintDesktop')}</span>
      </button>
    </div>
  )
}
