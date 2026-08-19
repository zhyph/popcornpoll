// components/chrome/PictureBoothHeader.tsx
'use client'

import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { LocaleSwitcher } from '../LocaleSwitcher'
import { useRoomStep, type ChapterStep } from './RoomStatusContext'

const ROOM_STEPS: ChapterStep[] = ['entry', 'lobby', 'deck', 'wrapup']
const SOLO_STEPS: ChapterStep[] = ['soloFilters', 'soloShortlist', 'soloPick']

// Route-only inference for screens this plan doesn't wire real state into
// yet: '/' and '/join/[code]' are always 'entry' (nothing else they could
// be); '/room/[code]' defaults to 'lobby' unless a room page has pushed a
// more specific step via useSetRoomStep; '/solo' defaults to 'soloFilters'
// the same way, pushed by app/solo/page.tsx as its own screen state
// changes; '/setup' isn't part of this flow, so no step highlights there.
function stepFromPath(pathname: string, pushedStep: ChapterStep | null): ChapterStep | null {
  if (pathname === '/') return 'entry'
  if (pathname.startsWith('/join/')) return 'entry'
  if (pathname.startsWith('/room/')) return pushedStep ?? 'lobby'
  if (pathname === '/solo') return pushedStep ?? 'soloFilters'
  return null
}

export function PictureBoothHeader() {
  const t = useTranslations('common')
  const tChrome = useTranslations('chrome')
  const pathname = usePathname()
  const pushedStep = useRoomStep()
  // Recomputed every render from the reactive usePathname() value, not
  // captured once in state — otherwise a client-side navigation between
  // routes (e.g. '/' -> '/join/xyz' without a full reload) would leave this
  // stuck on whichever flow the header first mounted under.
  const isGuestFlow = pathname.startsWith('/join/')
  const isSoloFlow = pathname.startsWith('/solo')
  const currentStep = stepFromPath(pathname, pushedStep)
  const STEPS = isSoloFlow ? SOLO_STEPS : ROOM_STEPS
  const hostLabels: Record<'entry' | 'lobby' | 'deck' | 'wrapup', string> = {
    entry: tChrome('hostStepEntry'),
    lobby: tChrome('hostStepLobby'),
    deck: tChrome('hostStepDeck'),
    wrapup: tChrome('hostStepWrapup'),
  }
  const guestLabels: Record<'entry' | 'lobby' | 'deck' | 'wrapup', string> = {
    entry: tChrome('guestStepEntry'),
    lobby: tChrome('guestStepLobby'),
    deck: tChrome('guestStepDeck'),
    wrapup: tChrome('guestStepWrapup'),
  }
  const soloLabels: Record<'soloFilters' | 'soloShortlist' | 'soloPick', string> = {
    soloFilters: tChrome('soloStepFilters'),
    soloShortlist: tChrome('soloStepShortlist'),
    soloPick: tChrome('soloStepPick'),
  }
  const labels: Record<string, string> = isSoloFlow ? soloLabels : isGuestFlow ? guestLabels : hostLabels

  return (
    <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 border-b border-brass/35 bg-gradient-to-b from-velvet/90 to-ink/70 px-4 py-3.5 backdrop-blur-sm sm:px-10">
      <div className="flex items-center gap-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-marquee" />
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-marquee [animation-delay:140ms]" />
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-marquee [animation-delay:280ms]" />
        </span>
        <span className="font-display text-xl uppercase tracking-wide text-ticket">{t('appName')}</span>
        <span className="border border-brass/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-brass">
          {tChrome('estYear')}
        </span>
      </div>

      {currentStep !== null && (
        <nav className="flex flex-wrap items-center justify-center gap-0" data-testid="chapter-indicator" aria-label="Progress">
          {STEPS.map((step, i) => {
            const isCurrent = step === currentStep
            const isPast = STEPS.indexOf(currentStep) > i
            return (
              <span key={step} className="flex items-center gap-0">
                <span
                  className="flex items-center gap-1.5 border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-all"
                  style={{
                    background: isCurrent ? 'rgba(245,166,35,.14)' : 'transparent',
                    borderColor: isCurrent ? '#F5A623' : 'transparent',
                    color: isCurrent ? '#F5A623' : isPast ? 'rgba(243,233,210,.75)' : 'rgba(154,122,83,.55)',
                  }}
                >
                  {labels[step]}
                </span>
                {i < STEPS.length - 1 && (
                  <span
                    className="h-px w-[18px]"
                    style={{ background: isPast ? 'rgba(245,166,35,.6)' : 'rgba(154,122,83,.3)' }}
                  />
                )}
              </span>
            )
          })}
        </nav>
      )}

      <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-widest text-brass">
        <span>{tChrome('selfHosted')}</span>
        <LocaleSwitcher />
      </div>
    </header>
  )
}
