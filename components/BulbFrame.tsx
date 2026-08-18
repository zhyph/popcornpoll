// components/BulbFrame.tsx
// Places `count` bulbs evenly around a rectangle's perimeter (expressed as
// inset-based absolute positioning, so it has no dependency on the parent's
// exact pixel size — same technique components/MarqueeReveal.tsx's
// bulbPosition() already uses for its own bulb ring, just generalized to
// walk all four sides instead of MarqueeReveal's specific case). Ported
// from the approved mockup's own bulbRing() helper.
export function BulbFrame({ count }: { count: number }) {
  const bulbs = Array.from({ length: count }, (_, i) => {
    const f = i / count
    const side = Math.floor(f * 4)
    const t = `${((f * 4) % 1) * 100}%`
    let pos: React.CSSProperties
    if (side === 0) pos = { top: '-5px', left: t }
    else if (side === 1) pos = { right: '-5px', top: t }
    else if (side === 2) pos = { bottom: '-5px', left: t }
    else pos = { left: '-5px', top: t }
    return {
      key: i,
      style: {
        position: 'absolute' as const,
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: '#F5A623',
        animation: `bulb 1.4s ease-in-out infinite ${(f * 1.4).toFixed(2)}s`,
        ...pos,
      },
    }
  })

  return (
    <>
      {bulbs.map((b) => (
        <span key={b.key} aria-hidden style={b.style} />
      ))}
    </>
  )
}
