// Persistent step tracker for the Setup flow. The real flow has 6 states
// (see Step below) but the mockup's own step list shows 4 rows — this
// collapses pin/polling into one "Link Plex account" row and
// servers/sections into one "Choose server & libraries" row, matching that
// count exactly rather than inventing a 6-row tracker the mockup never showed.
'use client'

import { useTranslations } from 'next-intl'

export type Step = 'token' | 'pin' | 'polling' | 'servers' | 'sections' | 'done'
type TrackerKey = 'token' | 'link' | 'library' | 'sync'

const TRACKER_ORDER: TrackerKey[] = ['token', 'link', 'library', 'sync']

export function trackerStepFor(step: Step): TrackerKey {
  if (step === 'token') return 'token'
  if (step === 'pin' || step === 'polling') return 'link'
  if (step === 'servers' || step === 'sections') return 'library'
  return 'sync'
}

export function SetupStepTracker({ step }: { step: Step }) {
  const t = useTranslations('setup')
  const current = trackerStepFor(step)
  const currentIndex = TRACKER_ORDER.indexOf(current)
  const labels: Record<TrackerKey, string> = {
    token: t('stepTokenLabel'),
    link: t('stepLinkLabel'),
    library: t('stepLibraryLabel'),
    sync: t('stepSyncLabel'),
  }

  return (
    <div className="flex flex-col gap-0.5">
      {TRACKER_ORDER.map((key, i) => {
        const isDone = i < currentIndex
        const isCurrent = i === currentIndex
        return (
          <div key={key} className="flex items-center gap-3.5 border border-brass/30 bg-velvet/35 px-4 py-3.5">
            <span
              className={
                isCurrent
                  ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marquee font-mono text-xs text-ink'
                  : isDone
                    ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brass font-mono text-xs text-ink'
                    : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brass/50 font-mono text-xs text-brass/70'
              }
            >
              {i + 1}
            </span>
            <span
              className={
                isCurrent
                  ? 'flex-1 font-mono text-xs uppercase tracking-wide text-marquee'
                  : isDone
                    ? 'flex-1 font-mono text-xs uppercase tracking-wide text-ticket/80'
                    : 'flex-1 font-mono text-xs uppercase tracking-wide text-brass/60'
              }
            >
              {labels[key]}
            </span>
            {isCurrent && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-marquee">
                {t('stepStateCurrent')}
              </span>
            )}
            {isDone && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-brass/70">
                {t('stepStateDone')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
