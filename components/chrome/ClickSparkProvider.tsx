// components/chrome/ClickSparkProvider.tsx
'use client'

import ClickSpark from '../ui/reactbits/ClickSpark'

// Thin client wrapper around the vendored ClickSpark, following the exact
// precedent components/SpotlightBackground.tsx already sets for Aurora:
// the vendored file itself has no 'use client' directive (true of every
// React Bits pull in this plan), so a Server Component (app/layout.tsx)
// can't import it directly — this wrapper is the client boundary, with the
// spark's tuning baked in rather than exposed as props, same as
// SpotlightBackground bakes in Aurora's colorStops/amplitude/speed.
export function ClickSparkProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClickSpark sparkColor="#F5A623" sparkCount={8} duration={460} extraScale={1.0}>
      {children}
    </ClickSpark>
  )
}
