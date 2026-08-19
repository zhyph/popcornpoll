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
      <div className="my-3">
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
