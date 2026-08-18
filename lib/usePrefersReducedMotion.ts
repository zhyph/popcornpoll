'use client'

import { useEffect, useState } from 'react'

// Mirrors app/room/[code]/page.tsx's existing matchMedia-listener pattern for
// the narrow-viewport check — same shape, different query. Defaults to false
// (motion allowed) so server-rendered and first-paint markup match; the real
// value is available a tick later, before any animation actually starts.
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
