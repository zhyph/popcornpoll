// components/MarqueeReveal.tsx
'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import type { PoolEntry } from '../server/pool/buildPool'

const BULB_COUNT = 20

export function MarqueeReveal({ movie }: { movie: PoolEntry }) {
  const t = useTranslations('marqueeReveal')
  return (
    <motion.div
      role="alert"
      className="relative border-2 border-brass bg-velvet p-8 text-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
    >
      {Array.from({ length: BULB_COUNT }).map((_, i) => (
        <motion.span
          key={i}
          className="absolute h-2 w-2 rounded-full bg-marquee"
          style={bulbPosition(i, BULB_COUNT)}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: (i / BULB_COUNT) * 1.2, ease: 'easeInOut' }}
        />
      ))}
      <p className="font-mono text-xs uppercase tracking-widest text-brass">{t('matchLabel')}</p>
      <motion.h2
        className="font-display text-4xl text-ticket"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        {movie.title}
      </motion.h2>
      {movie.inLibrary && <p className="mt-2 text-sm text-marquee">{t('readyInLibrary')}</p>}
    </motion.div>
  )
}

// Places bulb i of n evenly around a rectangle's perimeter, expressed as
// inset-based absolute positioning (no layout dependency on the frame's
// exact pixel size).
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
