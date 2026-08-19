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
  const tileClass =
    size === 'small'
      ? 'flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[22px] text-marquee'
      : 'flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[clamp(24px,6vw,64px)] text-ticket shadow-[inset_0_-6px_12px_rgba(0,0,0,.6)]'
  const tileStyle = size === 'small' ? { width: 26, height: 34 } : { width: 'clamp(27px, 6.4vw, 68px)', height: 'clamp(37px, 8.4vw, 90px)' }
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
