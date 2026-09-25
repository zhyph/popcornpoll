// components/MarqueeReveal.tsx
'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import CodeSlats from './CodeSlats'
import type { PoolEntry } from '../server/pool/buildPool'

const BULB_COUNT = 28

export function MarqueeReveal({
  movie,
  matchRuleLabel,
  isHost,
  onContinue,
  onEndSession,
}: {
  movie: PoolEntry
  matchRuleLabel: string
  isHost: boolean
  onContinue: () => void
  onEndSession: () => void
}) {
  const t = useTranslations('marqueeReveal')
  const metaParts = [
    movie.year ? String(movie.year) : null,
    movie.genres.length > 0 ? movie.genres.map((g) => g.toLowerCase()).join(' · ') : null,
    movie.rating !== null ? `★ ${movie.rating.toFixed(1)}` : null,
    matchRuleLabel,
  ].filter((part): part is string => part !== null)

  return (
    // Holds until the host decides: keep (ends the session on this movie)
    // or keep going (back to the deck underneath, for everyone). A
    // full-viewport takeover (not an inline banner stacked above the still-
    // swipeable deck) so the reveal is a genuine pause, not something you
    // can swipe straight through.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[radial-gradient(circle_at_50%_45%,rgba(44,17,22,.92),rgba(16,12,9,.97))] p-4">
      <motion.div
        role="alert"
        className="relative w-full max-w-lg border-[3px] border-brass bg-velvet p-8 text-center shadow-[0_0_120px_-20px_rgba(245,166,35,.45)]"
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
        <p className="font-mono text-xs uppercase tracking-widest text-brass">{t('kicker')}</p>
        <div className="my-3">
          <CodeSlats code={movie.title.toUpperCase()} splitOn="space" />
        </div>
        {metaParts.length > 0 && (
          <p className="font-mono text-xs uppercase tracking-wider text-ticket/70">{metaParts.join(' · ')}</p>
        )}
        {movie.inLibrary && <p className="mt-2 text-sm text-marquee">{t('readyInLibrary')}</p>}
        {isHost ? (
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
            <button
              type="button"
              data-testid="match-keep"
              onClick={onEndSession}
              className="bg-marquee px-5 py-3.5 font-display text-base text-ink hover:bg-marquee/90"
            >
              {t('keepIt')}
            </button>
            <button
              type="button"
              data-testid="match-keep-going"
              onClick={onContinue}
              className="border border-brass/55 px-5 py-3.5 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
            >
              {t('keepGoing')}
            </button>
          </div>
        ) : (
          <p data-testid="match-waiting" className="mt-6 font-mono text-[11px] uppercase tracking-widest text-brass/80">
            {t('waitingForHost')}
          </p>
        )}
      </motion.div>
    </div>
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
