// Persistent step tracker for the Setup flow. Ground truth is
// Screen13-ProjectionBooth.dc.html's static `setupSteps` array: 4 rows,
// each with its own done/now/next state (not a single "current index" —
// the mockup's example freezes on row 2 "now" with row 1 already "done"
// and rows 3-4 "next", which is exactly the shape reproduced below). The
// real flow has 8 states (see Step below); this collapses pin/polling into
// the "Approve the sign-in on plex.tv" row and servers/sections into
// "Pick the server and libraries", matching the mockup's row count exactly
// rather than inventing a wider tracker it never showed.
'use client'

import { useTranslations } from 'next-intl'

export type Step = 'checking' | 'linked' | 'token' | 'pin' | 'polling' | 'servers' | 'sections' | 'done'
type TrackerKey = 'token' | 'link' | 'library' | 'sync'
type RowState = 'done' | 'now' | 'next'

const TRACKER_ORDER: TrackerKey[] = ['token', 'link', 'library', 'sync']

export function trackerStepFor(step: Step): TrackerKey {
  // 'checking' (the brief on-mount already-linked probe) and 'linked' (the
  // resulting landing state) both read as "sync" on the tracker — the real
  // link/library work is already done in both cases, same as 'done'.
  if (step === 'checking' || step === 'linked') return 'sync'
  if (step === 'token') return 'token'
  if (step === 'pin' || step === 'polling') return 'link'
  if (step === 'servers' || step === 'sections') return 'library'
  return 'sync'
}

export function stateFor(row: TrackerKey, current: TrackerKey, step: Step): RowState {
  // 'linked' and 'done' land on the sync row with every prior row already
  // done — there's nothing left "now" or "next" once the owner is fully
  // linked, unlike a freshly-started 'token'/'pin'/'servers' flow.
  if (step === 'linked' || step === 'done') return 'done'
  const rowIndex = TRACKER_ORDER.indexOf(row)
  const currentIndex = TRACKER_ORDER.indexOf(current)
  if (rowIndex < currentIndex) return 'done'
  if (rowIndex === currentIndex) return 'now'
  return 'next'
}

export function SetupStepTracker({ step }: { step: Step }) {
  const t = useTranslations('setup')
  const current = trackerStepFor(step)
  const labels: Record<TrackerKey, string> = {
    token: t('stepTokenLabel'),
    link: t('stepLinkLabel'),
    library: t('stepLibraryLabel'),
    sync: t('stepSyncLabel'),
  }
  const stateLabels: Record<RowState, string> = {
    done: t('stepStateDone'),
    now: t('stepStateCurrent'),
    next: t('stepStateNext'),
  }

  return (
    <div className="flex flex-col gap-0.5">
      {TRACKER_ORDER.map((key, i) => {
        const rowState = stateFor(key, current, step)
        return (
          <div key={key} className="flex items-center gap-3.5 border border-brass/30 bg-velvet/35 px-4 py-3.5">
            <span
              className={
                rowState === 'now'
                  ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marquee font-mono text-xs text-ink [animation:bulb_1.6s_ease-in-out_infinite]'
                  : rowState === 'done'
                    ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-setup-done font-mono text-xs text-ticket'
                    : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brass/50 font-mono text-xs text-brass/70'
              }
            >
              {i + 1}
            </span>
            <span
              className={
                rowState === 'now'
                  ? 'flex-1 font-mono text-xs uppercase tracking-wide text-marquee'
                  : rowState === 'done'
                    ? 'flex-1 font-mono text-xs uppercase tracking-wide text-ticket/60'
                    : 'flex-1 font-mono text-xs uppercase tracking-wide text-ticket/45'
              }
            >
              {labels[key]}
            </span>
            {/* the mockup keeps this trailing state word brass-colored on every
                row, done/now/next alike — it never follows the row's own color */}
            <span className="font-mono text-[9.5px] uppercase tracking-widest text-brass">{stateLabels[rowState]}</span>
          </div>
        )
      })}
    </div>
  )
}
