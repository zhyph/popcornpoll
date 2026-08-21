'use client'

import dynamic from 'next/dynamic'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'

// Loaded on demand rather than imported directly. This layer sits in the root
// layout, so a static import puts ogl — the WebGL library both effects use,
// ~21KB gzipped — plus the two components into the first-load JS of every
// route, including the ones that never get to show the effect because the
// visitor has reduced motion on. Neither canvas is content: they are ambient
// wash behind the page, so nothing about the first paint depends on them.
//
// ssr:false because both mount a WebGL context against a real canvas; there
// is nothing for the server to render, and prerendering them only produces
// markup the client immediately replaces.
const Aurora = dynamic(() => import('../ui/Aurora'), { ssr: false })
const LightRays = dynamic(() => import('../ui/reactbits/LightRays'), { ssr: false })

// Three stacked ambient layers behind every screen: Aurora (existing colour wash),
// LightRays (the mockup's beam-sway), and a hand-authored film-grain layer
// (the mockup's own grainShift keyframe/repeating-radial-gradient recipe —
// Dither was dropped, see Task 2). All stop animating under
// prefers-reduced-motion instead — this is the one app-wide motion gate, not
// a per-screen or per-user toggle. Aurora and LightRays are unmounted rather
// than merely told to stop (passing speed:0 to Aurora doesn't stop its
// requestAnimationFrame loop — it keeps rendering a static frame every tick
// at full GPU cost, just with uTime frozen), since a mounted-but-frozen
// WebGL canvas is not actually reduced motion's point (less CPU/GPU work),
// only reduced visual motion.
export function AtmosphereLayer() {
  const reducedMotion = usePrefersReducedMotion()

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {!reducedMotion && (
        <div className="absolute inset-0 opacity-30">
          <Aurora colorStops={['#2C1116', '#F5A623', '#17110E']} amplitude={0.6} speed={0.3} />
        </div>
      )}
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
