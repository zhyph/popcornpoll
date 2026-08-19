# Setup Screen (Reimagined UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `app/setup/page.tsx` (the spec's "Projection booth") to match the approved mockup: a persistent left-column step tracker, and a right-column panel per flow step, with the Plex PIN revealed through a combined `LetterGlitch`/`DecryptedText` treatment.

**Architecture:** Pure restyle — every existing async handler (`requestPin`, `startPolling`, `cancelPolling`, `loadResources`, `pickServer`, `toggleSection`, `submitLink`, `syncNow`) and the `Step` state machine stay byte-identical; only markup changes. Two new small components carry the two genuinely new pieces of UI: `SetupStepTracker` (maps the real 6-value `Step` type down to 4 tracker rows) and `PlexPinReveal` (the `LetterGlitch` + `DecryptedText` combo the mockup's own dev-tag names for this exact spot). No backend changes — confirmed via the spec's screen-mapping row ("unchanged; no new entry point added") and via `server/http/setup.ts`, which this plan does not touch.

**Tech Stack:** Next.js 14 App Router, React, next-intl, Tailwind, the vendored `LetterGlitch`/`DecryptedText` React Bits components, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-popcornpoll-reimagined-design.md` (Setup/Projection booth row; `LetterGlitch`/`DecryptedText` React Bits table entry: "Setup screen's Plex link code"). This plan also encodes detail gathered by directly reading the mockup's `isSetup` block, beyond the spec's one-line mapping.

## Global Constraints

- No backend/API changes — every `fetch('/api/setup/...')` call and its handling logic stays exactly as it is today.
- Drop shadcn `Card`/`CardHeader`/`CardContent`/`Input`/`Label`/`Button`/`Separator`/`Skeleton`/`Badge` for bespoke Tailwind, matching Box office/Join/Room screens' established precedent.
- Use existing Tailwind color tokens (`ink`, `velvet`, `marquee`, `ticket`, `brass`, `exit-red`) — no new hardcoded hex, except `LetterGlitch`'s themed `glitchColors` array (a prop value, not a CSS class — the component has no token-based color path).
- CTA copy is stored uppercase verbatim in i18n JSON where the mockup shows it uppercase, matching every prior screen's convention.
- `e2e/chrome.spec.ts`'s `'chapter indicator is hidden on the setup screen'` test must keep passing unmodified — it only checks `data-testid="chapter-indicator"` is absent from `/setup`, which this plan's changes don't touch.
- Continuous canvas animations (`LetterGlitch`'s `requestAnimationFrame` loop) must respect `prefers-reduced-motion`, matching `AtmosphereLayer`'s and every other ambient-loop component's existing precedent — use the already-built `usePrefersReducedMotion()` hook (`lib/usePrefersReducedMotion.ts`), don't mount `LetterGlitch` at all when it returns `true`.

---

### Task 1: i18n copy for the Setup screen

**Files:**
- Modify: `messages/en-us.json:136-161` (`setup` namespace)
- Modify: `messages/pt-br.json:136-161` (`setup` namespace)
- Test: `messages/messages.test.ts` (existing — no changes, must stay passing)

**Design notes:** `title`, `openPlexButton`, and `finishButton` change value to match the mockup's literal uppercase copy ("THREAD THE PROJECTOR", "OPEN PLEX TO AUTHORIZE", "FINISH LINKING · OPEN THE BOX OFFICE"). Everything else that's already real app copy (not shown literally in the mockup — error strings, server/library picker labels) stays unchanged. New keys: `kickerLabel` (the mockup's "Projection booth · one time, owner only" line, trimmed of the literal `/setup?token=…` bit since that's not meaningful UI copy) and the step-tracker's 4 labels + 2 state words.

**Interfaces:**
- Produces the exact key names Tasks 2-4 consume: `setup.kickerLabel`, `setup.stepTokenLabel`, `setup.stepLinkLabel`, `setup.stepLibraryLabel`, `setup.stepSyncLabel`, `setup.stepStateCurrent`, `setup.stepStateDone`.

- [ ] **Step 1: Edit `messages/en-us.json`'s `setup` namespace (lines 136-161)**

```json
  "setup": {
    "title": "THREAD THE PROJECTOR",
    "kickerLabel": "Projection booth · one time, owner only",
    "boxOffice": "Box office",
    "tokenExplainer": "Enter the admin token (ADMIN_SETUP_TOKEN) set in the server's environment variables.",
    "tokenLabel": "Admin token",
    "tokenPlaceholder": "Paste your token here",
    "startButton": "Generate Plex code",
    "linkPlexTitle": "Link your Plex server",
    "openPlexButton": "OPEN PLEX TO AUTHORIZE",
    "waitingForApproval": "Waiting for approval…",
    "cancelButton": "Cancel",
    "newCodeButton": "Generate a new code",
    "chooseServerTitle": "Choose your server",
    "noServersFound": "No servers found on this Plex account.",
    "chooseLibrariesTitle": "Choose your movie libraries",
    "noMovieLibraries": "No movie libraries found on this server.",
    "finishButton": "FINISH LINKING · OPEN THE BOX OFFICE",
    "successTitle": "Plex linked",
    "successMessage": "Your Plex server is linked. You can create rooms now.",
    "syncNowButton": "Sync now",
    "syncingButton": "Syncing…",
    "syncTriggeredToast": "Sync started",
    "genericError": "Something went wrong. Try again.",
    "unauthorizedError": "Invalid admin token.",
    "pollTimeoutError": "Timed out waiting for authorization. Generate a new code.",
    "stepTokenLabel": "Admin token",
    "stepLinkLabel": "Link Plex account",
    "stepLibraryLabel": "Choose server & libraries",
    "stepSyncLabel": "Sync complete",
    "stepStateCurrent": "Current",
    "stepStateDone": "Done"
  },
```

- [ ] **Step 2: Run the parity test, verify it fails**

Run: `npx vitest run messages/messages.test.ts`
Expected: FAIL — pt-br.json doesn't have the new keys yet.

- [ ] **Step 3: Edit `messages/pt-br.json`'s `setup` namespace (lines 136-161)**

```json
  "setup": {
    "title": "PREPARE O PROJETOR",
    "kickerLabel": "Cabine de projeção · uma vez, somente o proprietário",
    "boxOffice": "Bilheteria",
    "tokenExplainer": "Informe o token de administrador (ADMIN_SETUP_TOKEN) definido nas variáveis de ambiente do servidor.",
    "tokenLabel": "Token de administrador",
    "tokenPlaceholder": "Cole o token aqui",
    "startButton": "Gerar código do Plex",
    "linkPlexTitle": "Vincular ao Plex",
    "openPlexButton": "ABRIR PLEX PARA AUTORIZAR",
    "waitingForApproval": "Aguardando aprovação…",
    "cancelButton": "Cancelar",
    "newCodeButton": "Gerar novo código",
    "chooseServerTitle": "Escolha o servidor",
    "noServersFound": "Nenhum servidor encontrado nesta conta do Plex.",
    "chooseLibrariesTitle": "Escolha as bibliotecas de filmes",
    "noMovieLibraries": "Nenhuma biblioteca de filmes encontrada neste servidor.",
    "finishButton": "CONCLUIR VÍNCULO · ABRIR A BILHETERIA",
    "successTitle": "Plex vinculado",
    "successMessage": "Seu servidor Plex está vinculado. Você já pode criar salas.",
    "syncNowButton": "Sincronizar agora",
    "syncingButton": "Sincronizando…",
    "syncTriggeredToast": "Sincronização iniciada",
    "genericError": "Algo deu errado. Tente novamente.",
    "unauthorizedError": "Token de administrador inválido.",
    "pollTimeoutError": "Tempo esgotado aguardando a autorização. Gere um novo código.",
    "stepTokenLabel": "Token de administrador",
    "stepLinkLabel": "Vincular conta do Plex",
    "stepLibraryLabel": "Escolher servidor e bibliotecas",
    "stepSyncLabel": "Sincronização concluída",
    "stepStateCurrent": "Atual",
    "stepStateDone": "Concluído"
  },
```

- [ ] **Step 4: Run the parity test, verify it passes**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add messages/en-us.json messages/pt-br.json
git commit -m "feat: add Setup screen copy for reimagined UI restyle"
```

---

### Task 2: `SetupStepTracker` component

**Files:**
- Create: `components/SetupStepTracker.tsx`
- Create: `components/SetupStepTracker.test.ts`

**Design notes:** The mockup's step list (`setupSteps`, `hint-placeholder-count="4"`) has no literal mapping to the app's real 6-value `Step` type — this task collapses `pin`/`polling` into one "Link Plex account" row and `servers`/`sections` into one "Choose server & libraries" row, giving exactly 4 rows matching the mockup's own demo count. Each row shows a numbered dot (filled `marquee` for the current step, filled `brass` for completed steps, outlined `brass/50` for upcoming ones) and a state caption ("Current"/"Done", nothing for upcoming). The `Step` type itself moves here from `app/setup/page.tsx` (Task 4 imports it back) since this component owns the mapping logic that depends on it.

**Interfaces:**
- Produces: `export type Step = 'token' | 'pin' | 'polling' | 'servers' | 'sections' | 'done'`, `export function trackerStepFor(step: Step): 'token' | 'link' | 'library' | 'sync'` (pure, exported for testing), `export function SetupStepTracker({ step }: { step: Step })`. Task 4 imports `Step` and `SetupStepTracker` from this file.

- [ ] **Step 1: Write the failing test**

```ts
// components/SetupStepTracker.test.ts
import { describe, expect, it } from 'vitest'
import { trackerStepFor } from './SetupStepTracker'

describe('trackerStepFor', () => {
  it('maps token to the token tracker row', () => {
    expect(trackerStepFor('token')).toBe('token')
  })

  it('maps both pin and polling to the link tracker row', () => {
    expect(trackerStepFor('pin')).toBe('link')
    expect(trackerStepFor('polling')).toBe('link')
  })

  it('maps both servers and sections to the library tracker row', () => {
    expect(trackerStepFor('servers')).toBe('library')
    expect(trackerStepFor('sections')).toBe('library')
  })

  it('maps done to the sync tracker row', () => {
    expect(trackerStepFor('done')).toBe('sync')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/SetupStepTracker.test.ts`
Expected: FAIL — `Cannot find module './SetupStepTracker'`

- [ ] **Step 3: Implement `SetupStepTracker.tsx`**

```tsx
// components/SetupStepTracker.tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/SetupStepTracker.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/SetupStepTracker.tsx components/SetupStepTracker.test.ts
git commit -m "feat: add SetupStepTracker component"
```

---

### Task 3: `PlexPinReveal` component

**Files:**
- Create: `components/PlexPinReveal.tsx`

**Design notes:** The mockup's dev-tag names both `LetterGlitch` and `DecryptedText` for the Plex PIN spot — they do different jobs. `LetterGlitch` (`components/ui/reactbits/LetterGlitch.tsx`) is a canvas-based ambient background of continuously glitching random characters, unrelated to the actual PIN value. `DecryptedText` (`components/ui/reactbits/DecryptedText.tsx`) is what actually reveals a specific string via a shuffle/decrypt animation. This component layers them: `LetterGlitch` as a themed backdrop (ink/brass/marquee colors instead of its default green/teal), `DecryptedText` revealing the real PIN on top, gated behind `prefers-reduced-motion` for the continuous canvas loop specifically (the one-shot `DecryptedText` reveal is left running either way — a single short reveal animation, not a continuous ambient loop, doesn't need the same gate as `AtmosphereLayer`-style infinite loops).

**Interfaces:**
- Consumes: `LetterGlitch` (default export, `components/ui/reactbits/LetterGlitch.tsx`), `DecryptedText` (default export, `components/ui/reactbits/DecryptedText.tsx`), `usePrefersReducedMotion` (`lib/usePrefersReducedMotion.ts`).
- Produces: `PlexPinReveal({ code }: { code: string })` — Task 4 renders `<PlexPinReveal code={pin.code} />`.

- [ ] **Step 1: Implement `components/PlexPinReveal.tsx`**

```tsx
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
```

No test file for this task — it's a thin, purely presentational composition of two already-vendored, already-typed components with no new logic of its own (matches the precedent of not unit-testing purely presentational wrapper components in this codebase, e.g. `BulbFrame.tsx` has no test file either).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/PlexPinReveal.tsx
git commit -m "feat: add PlexPinReveal (LetterGlitch + DecryptedText) component"
```

---

### Task 4: Restyle `app/setup/page.tsx`

**Files:**
- Modify: `app/setup/page.tsx` (full rewrite of the `SetupFlow` function's `return`, plus imports; the `Step` type definition and every `async function`/handler above the `return` stay untouched)

**Design notes:** Two-column layout (`grid-template-columns` per the mockup, stacking on mobile) — left column is the kicker + title + `SetupStepTracker` (always visible, doesn't change per step); right column swaps its single panel based on `step`, exactly matching today's conditional-render structure just restyled. All 6 step-branches get bespoke Tailwind panels instead of shadcn `Card`. The `pin`/`polling` panel gets `PlexPinReveal` for the code display.

**Interfaces:**
- Consumes: `SetupStepTracker`, `Step` (Task 2, both from `components/SetupStepTracker`); `PlexPinReveal` (Task 3); `setup.kickerLabel`, `setup.title`, `setup.openPlexButton`, `setup.finishButton` (Task 1, changed values); all other `setup.*` keys (Task 1, unchanged values, already in use today).

- [ ] **Step 1: Replace `app/setup/page.tsx`'s imports and `Step` type**

Replace lines 1-34 (everything from the top through `type Step = ...`) with:

```tsx
// app/setup/page.tsx
'use client'

import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Suspense, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PlexPinReveal } from '../../components/PlexPinReveal'
import { SetupStepTracker, type Step } from '../../components/SetupStepTracker'

interface PinResponse {
  id: number
  code: string
  clientIdentifier: string
}

interface PlexResource {
  name: string
  clientIdentifier: string
  connections: { uri: string }[]
}

interface LibrarySection {
  id: string
  title: string
  type: string
}
```

- [ ] **Step 2: Replace the `return` block (everything from `return (` at the end of `SetupFlow` through the closing `)` before the function's final `}`)**

```tsx
  return (
    <main className="mx-auto grid max-w-4xl flex-1 grid-cols-1 gap-8 px-4 py-10 sm:grid-cols-2 sm:items-start">
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[.3em] text-brass">{t('kickerLabel')}</p>
        <h1 className="font-display text-4xl text-ticket sm:text-5xl">{t('title')}</h1>
        <SetupStepTracker step={step} />
      </div>

      <div className="flex flex-col gap-5">
        {step === 'token' && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('boxOffice')}</p>
            <p className="mb-4 text-sm text-ticket/70">{t('tokenExplainer')}</p>
            <label className="mb-4 flex flex-col gap-1.5">
              <span className="font-mono text-xs uppercase tracking-wide text-brass/80">{t('tokenLabel')}</span>
              <input
                type="password"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                placeholder={t('tokenPlaceholder')}
                autoComplete="off"
                className="h-12 border-0 border-b-2 border-brass/40 bg-transparent font-mono text-ticket outline-none focus:border-exit-red"
              />
            </label>
            <button
              type="button"
              disabled={adminToken.length === 0 || busy}
              onClick={() => {
                setStep('pin')
                void requestPin()
              }}
              className="h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20 disabled:text-ticket/40"
            >
              {t('startButton')}
            </button>
          </div>
        )}

        {(step === 'pin' || step === 'polling') && pin && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('linkPlexTitle')}</p>
            <PlexPinReveal code={pin.code} />
            <a
              href={`https://app.plex.tv/auth#?clientID=${encodeURIComponent(pin.clientIdentifier)}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=PopcornPoll`}
              target="_blank"
              rel="noreferrer"
              className="mt-5 block"
            >
              <span className="block h-[52px] w-full bg-marquee text-center font-display text-lg leading-[52px] text-ink hover:bg-marquee/90">
                {t('openPlexButton')}
              </span>
            </a>
            {step === 'polling' && (
              <p
                className="mt-4 text-center font-mono text-xs uppercase tracking-widest text-brass"
                style={{ animation: 'flicker 2.4s ease-in-out infinite' }}
              >
                {t('waitingForApproval')}
              </p>
            )}
            {step === 'polling' && (
              <button
                type="button"
                onClick={cancelPolling}
                className="mt-2 w-full font-mono text-xs uppercase tracking-widest text-exit-red hover:underline"
              >
                {t('cancelButton')}
              </button>
            )}
            {step === 'pin' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void requestPin()}
                className="mt-2 w-full border border-brass/50 py-3 font-mono text-xs uppercase tracking-widest text-ticket hover:border-marquee hover:text-marquee"
              >
                {t('newCodeButton')}
              </button>
            )}
          </div>
        )}

        {step === 'servers' && (
          <div className="border border-brass/40 p-5">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('chooseServerTitle')}</p>
            {busy && <div className="h-10 w-full animate-pulse bg-brass/10" />}
            {!busy && resources.length === 0 && <p className="text-sm text-ticket/60">{t('noServersFound')}</p>}
            <div className="flex flex-col gap-2">
              {resources.flatMap((resource) =>
                resource.connections.map((connection) => (
                  <button
                    key={connection.uri}
                    type="button"
                    disabled={busy}
                    onClick={() => pickServer(connection.uri)}
                    className="flex items-center justify-between border border-brass/40 px-4 py-3 text-left text-ticket hover:border-marquee"
                  >
                    <span>{resource.name}</span>
                    <span className="font-mono text-xs text-ticket/50">{connection.uri}</span>
                  </button>
                )),
              )}
            </div>
          </div>
        )}

        {step === 'sections' && (
          <div className="border border-brass/40 p-5">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-brass">{t('chooseLibrariesTitle')}</p>
            {sections.length === 0 && <p className="text-sm text-ticket/60">{t('noMovieLibraries')}</p>}
            <div className="flex flex-col gap-3">
              {sections.map((section) => (
                <label key={section.id} className="flex items-center gap-2.5 text-ticket">
                  <input
                    type="checkbox"
                    checked={selectedSectionIds.includes(section.id)}
                    onChange={() => toggleSection(section.id)}
                    className="h-4 w-4 accent-marquee"
                  />
                  {section.title}
                </label>
              ))}
            </div>
            <div className="my-4 h-px bg-brass/30" />
            <button
              type="button"
              disabled={selectedSectionIds.length === 0 || busy}
              onClick={submitLink}
              className="h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20 disabled:text-ticket/40"
            >
              {t('finishButton')}
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="border-2 border-brass/60 bg-gradient-to-b from-velvet/80 to-ink/90 p-6 sm:p-8">
            <p className="mb-4 font-display text-2xl text-marquee">{t('successTitle')}</p>
            <p className="mb-5 text-sm text-ticket/80">{t('successMessage')}</p>
            <button
              type="button"
              disabled={syncing}
              onClick={syncNow}
              className="h-[52px] w-full bg-marquee font-display text-lg text-ink hover:bg-marquee/90 disabled:cursor-not-allowed disabled:bg-brass/20"
            >
              {syncing ? t('syncingButton') : t('syncNowButton')}
            </button>
          </div>
        )}
      </div>
    </main>
  )
```

- [ ] **Step 3: Typecheck and manually verify**

Run: `npm run typecheck`, then set `ADMIN_SETUP_TOKEN` in the environment, run `npm run dev`, navigate to `/setup?token=<that value>`. Confirm: the step tracker shows "Admin token" as current with the other 3 rows outlined/upcoming; submitting the token advances to the "Link Plex account" panel with the tracker updating (token row now filled/done, link row now current) and the Plex PIN rendering through the glitch/decrypt reveal. If you don't have real Plex credentials to complete the full flow, at minimum confirm the token and pin/polling panels render correctly and the tracker updates between them — note in your report which steps you could and couldn't reach live.

- [ ] **Step 4: Commit**

```bash
git add app/setup/page.tsx
git commit -m "feat: restyle Setup screen with step tracker and Plex PIN reveal"
```

---

## Final Verification

Run `npm run verify` (typecheck + build + vitest) — must be green. Run `npm run test:e2e` — must stay at whatever count it was before this plan (this plan adds no new e2e coverage; `e2e/chrome.spec.ts`'s setup-screen chapter-indicator test must still pass unmodified).
