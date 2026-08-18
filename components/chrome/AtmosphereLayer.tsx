'use client'

import Aurora from '../ui/Aurora'
import LightRays from '../ui/reactbits/LightRays'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'

// Three stacked ambient layers behind every screen, replacing
// components/SpotlightBackground.tsx: Aurora (existing colour wash),
// LightRays (the mockup's beam-sway), and a hand-authored film-grain layer
// (the mockup's own grainShift keyframe/repeating-radial-gradient recipe —
// Dither was dropped, see Task 2). All freeze to a static frame under
// prefers-reduced-motion instead of animating — this is the one app-wide
// motion gate, not a per-screen or per-user toggle.
export function AtmosphereLayer() {
  const reducedMotion = usePrefersReducedMotion()

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <Aurora colorStops={['#2C1116', '#F5A623', '#17110E']} amplitude={0.6} speed={reducedMotion ? 0 : 0.3} />
      </div>
      {!reducedMotion && (
        <div className="absolute inset-0 opacity-40">
          <LightRays raysOrigin="top-center" raysColor="#F5A623" raysSpeed={0.6} lightSpread={1.4} rayLength={1.6} followMouse={false} />
        </div>
      )}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.22,
          mixBlendMode: 'overlay',
          animation: reducedMotion ? 'none' : 'grainShift 900ms steps(3) infinite',
          backgroundImage:
            'repeating-radial-gradient(circle at 17% 29%, rgba(243,233,210,.11) 0 1px, transparent 1px 3px), repeating-radial-gradient(circle at 71% 63%, rgba(16,12,9,.16) 0 1px, transparent 1px 4px), repeating-radial-gradient(circle at 43% 88%, rgba(243,233,210,.08) 0 1px, transparent 1px 5px)',
          backgroundSize: '37px 37px, 53px 53px, 71px 71px',
        }}
      />
    </div>
  )
}
