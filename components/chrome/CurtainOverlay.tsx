// components/chrome/CurtainOverlay.tsx
'use client'

import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { useCurtain } from './CurtainContext'

// Values (colors, timing, dial layout) match the approved mockup
// (PopcornPoll Reimagined.dc.html) verbatim, not reinvented here. Reads its
// open/countdown state from CurtainContext rather than taking props — it's
// mounted once at the root layout, above whichever room page is actually
// driving the reveal (see usePlayCurtainReveal in CurtainContext.tsx).
export function CurtainOverlay() {
  const { curtainOpen: open, countdownNumber } = useCurtain()
  const reducedMotion = usePrefersReducedMotion()
  const transition = reducedMotion ? 'none' : 'transform 1.5s cubic-bezier(.66,0,.2,1)'

  return (
    <div className="pointer-events-none fixed inset-0 z-[35]" data-testid="curtain-overlay">
      <div
        className="absolute inset-y-0 left-0 w-[52%]"
        style={{
          transform: `translateX(${open ? '-100%' : '0%'})`,
          transition,
          background:
            'repeating-linear-gradient(90deg, #3B1218 0 18px, #601D26 18px 34px, #2A0D12 34px 52px)',
          boxShadow: 'inset -40px 0 60px rgba(0,0,0,.65), 12px 0 40px rgba(0,0,0,.5)',
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-[52%]"
        style={{
          transform: `translateX(${open ? '100%' : '0%'})`,
          transition,
          background:
            'repeating-linear-gradient(90deg, #2A0D12 0 18px, #601D26 18px 34px, #3B1218 34px 52px)',
          boxShadow: 'inset 40px 0 60px rgba(0,0,0,.65), -12px 0 40px rgba(0,0,0,.5)',
        }}
      />
      {countdownNumber !== null && (
        <div
          className="fixed inset-0 z-[44] flex items-center justify-center"
          style={{ background: 'radial-gradient(circle at 50% 50%, rgba(28,20,14,.86), rgba(16,12,9,.97))' }}
        >
          <div
            className="relative flex items-center justify-center rounded-full border-2"
            style={{
              width: 'min(52vmin, 420px)',
              aspectRatio: '1',
              borderColor: 'rgba(243,233,210,.35)',
              background: 'radial-gradient(circle, rgba(243,233,210,.06), transparent 70%)',
            }}
          >
            <span
              // Reduced motion: skip the zoom-in flourish (a static digit
              // swap is enough of a signal) rather than force a
              // now-invisible animation to still run.
              key={countdownNumber}
              className="font-display"
              style={{
                fontSize: 'clamp(90px, 22vmin, 200px)',
                lineHeight: 1,
                color: '#F3E9D2',
                textShadow: '0 0 40px rgba(245,166,35,.5)',
                animation: reducedMotion
                  ? undefined
                  : `${countdownNumber % 2 === 0 ? 'countdownZoomA' : 'countdownZoomB'} 1000ms ease-out both`,
              }}
            >
              {countdownNumber}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
