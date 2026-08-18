// Renders a room code as individually staggered "split-flap" letter tiles.
// Hyphens in the real WORD-WORD-### code format become gaps between tile
// groups rather than their own tile — the mockup's own demo code had no
// separators to model that case on, so this grouping is a deliberate call.
// Modeled on BulbFrame.tsx's pattern of precomputing an array of per-item
// inline styles.
export type Slat = { letter: string; delay: string }

export function slatGroups(code: string): Slat[][] {
  let i = 0
  return code.split('-').map((group) =>
    group.split('').map((letter) => {
      const delay = (i * 0.09).toFixed(2)
      i += 1
      return { letter, delay }
    }),
  )
}

export default function CodeSlats({ code }: { code: string }) {
  const groups = slatGroups(code)
  return (
    <div className="flex items-center gap-3 sm:gap-4" aria-label={code}>
      {groups.map((letters, gi) => (
        <div key={gi} className="flex gap-1 sm:gap-1.5">
          {letters.map(({ letter, delay }, li) => (
            <span
              key={li}
              aria-hidden
              className="flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[clamp(24px,6vw,64px)] text-ticket shadow-[inset_0_-6px_12px_rgba(0,0,0,.6)]"
              style={{
                width: 'clamp(27px, 6.4vw, 68px)',
                height: 'clamp(37px, 8.4vw, 90px)',
                animation: `slatFlip .5s ease-out both ${delay}s`,
              }}
            >
              {letter}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
