// components/chrome/RoomStatusContext.tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type ChapterStep = 'entry' | 'lobby' | 'deck' | 'wrapup' | 'soloFilters' | 'soloShortlist' | 'soloPick'

const RoomStatusContext = createContext<{
  step: ChapterStep | null
  setStep: (step: ChapterStep | null) => void
} | null>(null)

export function RoomStatusProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<ChapterStep | null>(null)
  return <RoomStatusContext.Provider value={{ step, setStep }}>{children}</RoomStatusContext.Provider>
}

function useRoomStatusContext() {
  const ctx = useContext(RoomStatusContext)
  if (!ctx) throw new Error('useRoomStatusContext must be used within RoomStatusProvider')
  return ctx
}

export function useRoomStep(): ChapterStep | null {
  return useRoomStatusContext().step
}

// A room page calls this with its real step ('lobby' | 'deck' | 'wrapup') as
// snapshot.status changes, and with null on unmount so the header falls back
// to route-only inference again once you've left the room.
export function useSetRoomStep(step: ChapterStep | null): void {
  const { setStep } = useRoomStatusContext()
  useEffect(() => {
    setStep(step)
    return () => setStep(null)
  }, [step, setStep])
}
