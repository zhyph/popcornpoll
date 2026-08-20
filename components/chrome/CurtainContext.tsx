// components/chrome/CurtainContext.tsx
'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

// Exact timing from the mockup's own startShow(): curtains close first
// (a separate 1.5s CSS transition on CurtainOverlay itself), *then* the
// countdown starts once the close has had time to actually finish, each
// digit holds for a full 1000ms (matching its own countdownZoom animation
// duration — ticking faster than that cuts the zoom off mid-animation),
// the last digit holds a beat longer before the screen swaps underneath
// the still-closed curtain, and only then does the curtain part.
const COUNTDOWN_START_DELAY_MS = 1700
const COUNTDOWN_TICK_MS = 1000
const HOLD_LAST_FRAME_MS = 700
const REVEAL_DELAY_MS = 200

const CurtainContext = createContext<{
  curtainOpen: boolean
  countdownNumber: number | null
  playReveal: (onSwap: () => void) => void
} | null>(null)

// Drives components/chrome/CurtainOverlay.tsx (mounted once, at the root
// layout, so it can cover the whole viewport regardless of which page is
// under it). Was previously wired with hardcoded `open countdownNumber=
// {null}` props — permanently open, so the mockup's close-curtain / 3-2-1
// countdown / reopen-on-reveal sequence never played at all.
export function CurtainProvider({ children }: { children: React.ReactNode }) {
  const [curtainOpen, setCurtainOpen] = useState(true)
  const [countdownNumber, setCountdownNumber] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // `onSwap` fires at the moment the mockup itself swaps `screen` — after
  // the countdown clears, while the curtain is still fully closed — so
  // callers should flip whatever they're revealing (e.g. lobby -> deck)
  // from inside it, not the instant their own data arrives.
  const playReveal = useCallback((onSwap: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setCurtainOpen(false)
    setCountdownNumber(null)
    timerRef.current = setTimeout(() => {
      let n = 3
      setCountdownNumber(n)
      const tick = () => {
        n -= 1
        if (n <= 0) {
          timerRef.current = setTimeout(() => {
            setCountdownNumber(null)
            onSwap()
            timerRef.current = setTimeout(() => setCurtainOpen(true), REVEAL_DELAY_MS)
          }, HOLD_LAST_FRAME_MS)
        } else {
          setCountdownNumber(n)
          timerRef.current = setTimeout(tick, COUNTDOWN_TICK_MS)
        }
      }
      timerRef.current = setTimeout(tick, COUNTDOWN_TICK_MS)
    }, COUNTDOWN_START_DELAY_MS)
  }, [])

  return (
    <CurtainContext.Provider value={{ curtainOpen, countdownNumber, playReveal }}>{children}</CurtainContext.Provider>
  )
}

function useCurtainContext() {
  const ctx = useContext(CurtainContext)
  if (!ctx) throw new Error('useCurtainContext must be used within CurtainProvider')
  return ctx
}

export function useCurtain(): { curtainOpen: boolean; countdownNumber: number | null } {
  const { curtainOpen, countdownNumber } = useCurtainContext()
  return { curtainOpen, countdownNumber }
}

// A room page calls this once, the moment it knows a reveal should start
// (e.g. right when a `room_started` message arrives), passing a callback
// that actually swaps what's showing underneath — called mid-sequence,
// while the curtain is still closed, not immediately.
export function usePlayCurtainReveal(): (onSwap: () => void) => void {
  return useCurtainContext().playReveal
}
