// components/SurpriseReveal.tsx
// A fixed overlay for solo's "Surprise me" — mirrors MarqueeReveal's
// split-flap-title treatment for the revealed state, and EdgeState's
// caller-supplies-copy shape. Two internal states driven by `spinning`:
// a reel-spinner while the pick is in flight, then the revealed card with
// watch/re-roll actions.
'use client'

import { useTranslations } from 'next-intl'
import CodeSlats from './CodeSlats'
import type { PoolEntry } from '../server/pool/buildPool'

export interface SurpriseRevealProps {
  visible: boolean
  spinning: boolean
  card: PoolEntry | null
  seenCount: number
  totalCount: number
  onWatchThis: () => void
  onReroll: () => void
  onClose: () => void
}

// Pure, exported separately from the component so it's directly unit-testable
// without a DOM/render harness — this project's tests don't use jsdom or
// @testing-library/react (see components/CodeSlats.tsx's slatGroups() for
// the same pattern: pure logic extracted and tested standalone, rendering
// left to e2e coverage).
export function buildMetaParts(card: PoolEntry | null): string[] {
  if (!card) return []
  return [
    card.year ? String(card.year) : null,
    card.genres.length > 0 ? card.genres.join(', ').toLowerCase() : null,
    card.rating !== null ? `★ ${card.rating.toFixed(1)}` : null,
  ].filter((part): part is string => part !== null)
}

export function SurpriseReveal({ visible, spinning, card, seenCount, totalCount, onWatchThis, onReroll, onClose }: SurpriseRevealProps) {
  const t = useTranslations('solo')
  if (!visible) return null

  const metaParts = buildMetaParts(card)

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[42] flex flex-col items-center justify-center gap-6 overflow-auto bg-[radial-gradient(circle_at_50%_45%,rgba(44,17,22,.93),rgba(16,12,9,.98))] p-4 sm:p-10"
      style={{ animation: 'revealUp .4s ease-out both' }}
    >
      <div className="relative box-border w-full max-w-[880px] border-[3px] border-brass bg-gradient-to-b from-velvet/90 to-ink/95 px-6 py-8 text-center shadow-[0_0_120px_-20px_rgba(245,166,35,.4)] sm:px-10 sm:py-11">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[.5em] text-marquee">{t('housePicksLabel')}</p>

        {spinning && (
          <div className="flex flex-col items-center gap-5 py-3.5">
            <div
              className="relative aspect-square w-[min(30vmin,150px)] rounded-full border-2 border-ticket/30"
              aria-hidden
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, rgba(245,166,35,.5) 0 70deg, transparent 70deg 180deg, rgba(245,166,35,.5) 180deg 250deg, transparent 250deg)',
                  animation: 'reelSpin .9s linear infinite',
                }}
              />
            </div>
            <p className="font-mono text-[10.5px] uppercase tracking-[.24em] text-brass">
              {t('shufflingLabel', { count: totalCount })}
            </p>
          </div>
        )}

        {!spinning && card && (
          <div className="flex flex-col items-center gap-4">
            <CodeSlats code={card.title.toUpperCase()} splitOn="space" />
            {metaParts.length > 0 && (
              <p className="font-mono text-xs uppercase tracking-widest text-ticket/70">{metaParts.join(' · ')}</p>
            )}
            {card.overview && <p className="max-w-[52ch] text-sm leading-relaxed text-ticket/70">{card.overview}</p>}
            <div className="mt-2.5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={onWatchThis}
                data-testid="watch-this"
                className="bg-marquee px-7 py-4 font-display text-lg text-ink hover:bg-marquee/90"
              >
                {t('watchThisButton')}
              </button>
              <button
                type="button"
                onClick={onReroll}
                data-testid="reroll"
                className="border border-brass/60 px-5 py-4 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
              >
                {t('rerollButton')}
              </button>
            </div>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-brass/85">
              {t('seenNote', { seen: seenCount, total: totalCount })}
            </p>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="border border-brass/40 px-4.5 py-3 font-mono text-[10.5px] uppercase tracking-widest text-brass hover:border-marquee hover:text-ticket"
      >
        {t('backToBillButton')}
      </button>
    </div>
  )
}
