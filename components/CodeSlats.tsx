// components/CodeSlats.tsx
// Renders text as individually staggered "split-flap" letter tiles. Room
// codes group on hyphens (WORD-WORD-###); movie titles (Match reveal) group
// on spaces instead — `splitOn` controls which. Two sizes: `default`
// (Join's big room-code tiles, ticket-cream text) and `small` (Lobby's door-
// code recap, marquee-gold text, exact values from the mockup's own
// `smallStyle`). Modeled on BulbFrame.tsx's precompute-an-array-of-per-item-
// styles pattern.
export type Slat = { letter: string; delay: string }

export function slatGroups(text: string, splitOn: 'hyphen' | 'space' = 'hyphen'): Slat[][] {
  let i = 0
  const groups = splitOn === 'space' ? text.split(' ') : text.split('-')
  return groups.map((group) =>
    group.split('').map((letter) => {
      const delay = (i * 0.09).toFixed(2)
      i += 1
      return { letter, delay }
    }),
  )
}

export default function CodeSlats({
  code,
  size = 'default',
  splitOn = 'hyphen',
}: {
  code: string
  size?: 'default' | 'small'
  splitOn?: 'hyphen' | 'space'
}) {
  const groups = slatGroups(code, splitOn)
  const letterCount = Math.max(
    groups.reduce((n, g) => n + g.length, 0),
    1,
  )
  const tileClass =
    size === 'small'
      ? 'flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[22px] text-marquee'
      : 'flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-ticket shadow-[inset_0_-6px_12px_rgba(0,0,0,.6)]'

  // Default-size tiles are sized off viewport width (`vw`), which the
  // mockup tuned against its own demo data — a 6-char code (Join) or a
  // short placeholder title (Match reveal) — with no upper bound tied to
  // how many letters actually need to fit. Real content is much longer:
  // room codes are `WORD-WORD-###` (server/auth/tokens.ts, up to 17
  // letters), and movie titles reusing this same size (MarqueeReveal) can
  // run well past that. At the mockup's fixed 68px-per-tile ceiling, a long
  // code/title is wider than this component's own container (Join's ticket
  // card tops out at 640px) regardless of how much space the rest of the
  // page has — so the row wraps mid-word. Deriving the ceiling from the
  // letter count keeps short content at exactly the mockup's numbers while
  // shrinking long content to fit on one line instead. (`small` — Lobby's
  // fixed-size door-code recap — isn't part of this: it was never
  // viewport-responsive in the mockup and isn't the screen this bug was
  // reported on.)
  const ROW_BUDGET_PX = 600 // usable width of the Join ticket's ~640px container
  const GAP_BUDGET_PX = 8 // per letter, rounded up from the gap-1/1.5 + gap-3/4 tokens below
  const maxWidth =
    size === 'default'
      ? Math.min(68, Math.max(27, Math.floor((ROW_BUDGET_PX - letterCount * GAP_BUDGET_PX) / letterCount)))
      : 26
  const maxHeight = size === 'default' ? Math.round((maxWidth * 90) / 68) : 34
  const maxFont = size === 'default' ? Math.round((maxWidth * 64) / 68) : 22

  const tileStyle =
    size === 'small'
      ? { width: 26, height: 34 }
      : {
          width: `clamp(27px, 6.4vw, ${maxWidth}px)`,
          height: `clamp(37px, 8.4vw, ${maxHeight}px)`,
          fontSize: `clamp(24px, 6vw, ${maxFont}px)`,
        }
  const gap = size === 'small' ? 'gap-1' : 'gap-3 sm:gap-4'
  const innerGap = size === 'small' ? 'gap-0.5' : 'gap-1 sm:gap-1.5'

  return (
    <div className={`flex flex-wrap items-center justify-center ${gap}`} role="img" aria-label={code}>
      {groups.map((letters, gi) => (
        <div key={gi} className={`flex ${innerGap}`}>
          {letters.map(({ letter, delay }, li) => (
            <span
              key={li}
              aria-hidden
              className={tileClass}
              style={{ ...tileStyle, animation: `slatFlip .5s ease-out both ${delay}s` }}
            >
              {letter}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
