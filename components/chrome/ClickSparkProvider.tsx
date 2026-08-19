// components/chrome/ClickSparkProvider.tsx
'use client'

import ClickSpark from '../ui/reactbits/ClickSpark'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'

// Thin client wrapper around the vendored ClickSpark, following the same
// client-boundary pattern components/ui/Aurora.tsx uses via AtmosphereLayer:
// the vendored file itself has no 'use client' directive (true of every
// React Bits pull in this plan), so a Server Component (app/layout.tsx)
// can't import it directly — this wrapper is the client boundary, with the
// spark's tuning baked in rather than exposed as props, same as
// AtmosphereLayer bakes in Aurora's colorStops/amplitude/speed.
//
// ClickSpark draws a canvas burst on every click anywhere in the app; unlike
// AtmosphereLayer/PlexPinReveal it never checked prefers-reduced-motion at
// all, so reduced-motion users got it regardless. Skip mounting it under
// reduced motion rather than passing it a "disabled" prop, for the same
// reason AtmosphereLayer unmounts Aurora/LightRays instead of zeroing their
// speed — a mounted-but-told-not-to-animate canvas effect isn't guaranteed
// to actually stop doing work per click.
export function ClickSparkProvider({ children }: { children: React.ReactNode }) {
  const reducedMotion = usePrefersReducedMotion()
  if (reducedMotion) return <>{children}</>

  return (
    <ClickSpark sparkColor="#F5A623" sparkCount={8} duration={460} extraScale={1.0}>
      {children}
    </ClickSpark>
  )
}
