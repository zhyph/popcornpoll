// components/PlexPinReveal.tsx
'use client'

import DecryptedText from './ui/reactbits/DecryptedText'
import LetterGlitch from './ui/reactbits/LetterGlitch'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'

export function PlexPinReveal({ code }: { code: string }) {
  const reducedMotion = usePrefersReducedMotion()

  return (
    <div className="relative flex h-20 w-full items-center justify-center overflow-hidden border border-brass/40">
      {!reducedMotion && (
        <div className="absolute inset-0">
          <LetterGlitch
            glitchColors={['#221812', '#9A7A53', '#F5A623']}
            glitchSpeed={60}
            centerVignette={false}
            outerVignette
            smooth
            characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
          />
        </div>
      )}
      <div className="relative z-10">
        <DecryptedText
          text={code}
          sequential
          revealDirection="center"
          animateOn="view"
          speed={40}
          parentClassName="tracking-[.2em]"
          className="font-display text-4xl text-marquee"
          encryptedClassName="font-display text-4xl text-brass/70"
        />
      </div>
    </div>
  )
}
