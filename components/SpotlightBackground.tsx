// components/SpotlightBackground.tsx
'use client'

import Aurora from './ui/Aurora'

export function SpotlightBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 opacity-30">
      <Aurora colorStops={['#2C1116', '#F5A623', '#17110E']} amplitude={0.6} speed={0.3} />
    </div>
  )
}
