// components/EdgeState.tsx
// A single reusable full-screen card for transient/dead-end room states —
// the Claude Design mockup's own isEdge block drives all 4 cases (kicked,
// hostgone, poolfail, emptylib) from one EDGE lookup object; this mirrors
// that shape. kind picks the icon/accent/border internally so every caller
// stays visually consistent; copy and actions are the caller's job (i18n).
'use client'

export type EdgeKind = 'kicked' | 'hostgone' | 'poolfail' | 'emptylib'

const ICON: Record<EdgeKind, string> = {
  kicked: '✕',
  hostgone: '⏻',
  poolfail: '!',
  emptylib: '□',
}

const ACCENT: Record<EdgeKind, { text: string; border: string; bg: string }> = {
  kicked: { text: 'text-exit-red', border: 'border-exit-red/60', bg: 'bg-exit-red' },
  poolfail: { text: 'text-exit-red', border: 'border-exit-red/60', bg: 'bg-exit-red' },
  hostgone: { text: 'text-marquee', border: 'border-marquee/50', bg: 'bg-marquee' },
  emptylib: { text: 'text-brass', border: 'border-brass/55', bg: 'bg-brass' },
}

export function edgeAccentClasses(kind: EdgeKind): { text: string; border: string; bg: string } {
  return ACCENT[kind]
}

export interface EdgeStateProps {
  kind: EdgeKind
  kicker: string
  title: string
  body: string
  detail?: string
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  testId?: string
}

export function EdgeState({
  kind,
  kicker,
  title,
  body,
  detail,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  testId,
}: EdgeStateProps) {
  const accent = edgeAccentClasses(kind)
  return (
    <main data-testid={testId} className="mx-auto flex flex-1 max-w-md flex-col items-center justify-center px-4 py-10">
      <div
        className={`flex w-full flex-col items-center gap-4 border-2 ${accent.border} bg-gradient-to-b from-velvet/70 to-ink/95 px-6 py-10 text-center sm:px-10`}
      >
        <span
          aria-hidden="true"
          className={`flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 ${accent.border} font-display text-2xl ${accent.text}`}
        >
          {ICON[kind]}
        </span>
        <p className={`font-mono text-[10.5px] uppercase tracking-[.34em] ${accent.text}`}>{kicker}</p>
        <h2 className="font-display text-3xl leading-tight text-ticket sm:text-4xl">{title}</h2>
        <p className="max-w-[46ch] text-[15px] leading-relaxed text-ticket/70">{body}</p>
        {detail && (
          <p className="max-w-[44ch] border border-dashed border-brass/45 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-brass/95">
            {detail}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap justify-center gap-2.5">
          <button type="button" onClick={onPrimary} className={`${accent.bg} px-6 py-3.5 font-display text-base text-ink hover:opacity-90`}>
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="border border-brass/55 px-5 py-3.5 font-mono text-[11px] uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
