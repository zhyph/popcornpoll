# PopcornPoll "Reimagined" Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor the 14 React Bits components the "Reimagined" redesign needs and build the shared cross-screen chrome (ambient background, curtain overlay, marquee header with a read-only progress indicator, footer), wired into `app/layout.tsx` so every route picks it up immediately.

**Architecture:** Pure frontend addition on top of the existing Next.js App Router app. React Bits components are pulled via the shadcn CLI's `@react-bits` registry (already configured in `components.json`) into a new `components/ui/reactbits/` folder, exactly the way `components/ui/Aurora.tsx` was already vendored. Hand-authored chrome components live in a new `components/chrome/` folder and replace `components/SpotlightBackground.tsx` in `app/layout.tsx`. No backend, no per-screen restyle — those are follow-on plans that build on this one.

**Tech Stack:** Next.js App Router, React 18, TypeScript strict, Tailwind, `framer-motion` (existing), `gsap`/`@gsap/react` (new), `ogl` (existing), Playwright.

**Amendment (mid-execution, Task 2):** the spec's Dither entry was originally planned as a vendored React Bits component via `@react-three/fiber`/`@react-three/postprocessing`/`postprocessing`/`three`. That dependency chain turned out to hard-require React 19 (`@react-three/postprocessing@^3.0.4`'s own peer dependency is `react: "^19.0"`) — this app is pinned to React 18.3.1 on Next.js 14.2, which does not support React 19. Task 2 vendored it, confirmed the incompatibility, and was reverted (commit `fedf5b4`). Dither is dropped from this plan; Task 7's grain layer is hand-authored CSS instead (matching the original mockup's own grain technique, which is CSS, not React Bits, at its core). No React Three Fiber dependency is added anywhere in this plan.

**Spec:** `docs/superpowers/specs/2026-08-18-popcornpoll-reimagined-design.md` — this plan implements that spec's "Shared chrome" and "React Bits components" sections. Executors should have both open. Follow-on plans (not yet written) will cover the spec's per-screen restyles and backend additions.

## Global Constraints

- Vendored React Bits files go in `components/ui/reactbits/`, one file per component, named after the component (`Dither.tsx`, not `Dither-TS-TW.tsx`) — kept separate from the 10 existing shadcn-style wrappers directly in `components/ui/` and from `components/ui/Aurora.tsx`, which stays where it is.
- Every React Bits pull uses the shadcn CLI's `-TS-TW` (TypeScript + Tailwind) variant, matching the precedent `npx shadcn@latest add @react-bits/Aurora-TS-TW` already used for Aurora.
- The CLI writes each fetched file to `components/<Name>.tsx` (the `registry:component` type resolves against the `components` alias, not the `ui` alias — this is why Aurora needed a manual move too). Every vendoring task moves the file to `components/ui/reactbits/<Name>.tsx` right after pulling it.
- Components whose vendored source imports from `motion/react` get that import rewritten to `framer-motion` (already a project dependency, API-compatible for the subset these components use) instead of adding a second, duplicate animation library. If `npm run typecheck` fails specifically on a missing export from `framer-motion` after this rewrite, install `motion` as an additional dependency and revert that one file's import to `motion/react` instead of continuing to fight the substitution.
- This codebase has no component-level unit test infrastructure (`vitest.config.ts` is `environment: 'node'`, `include: ['**/*.test.ts']` — no `.tsx`, no jsdom, no `@testing-library/react`) and the prior UI work (`docs/superpowers/plans/2026-08-17-popcornpoll-implementation.md` Task 22) established the pattern this plan follows: vendored/visual components are verified by `npm run typecheck` + `npm run build`, with Playwright covering actual rendered behavior. Do not introduce jsdom/testing-library as part of this plan.
- Every new full-viewport looping animation (grain, light-beam sway, curtain transition) must check a shared `usePrefersReducedMotion()` hook (built in Task 7) and fall back to a static frame — this is a non-negotiable default, not a per-component judgment call.
- `app/layout.tsx` is an async Server Component; it already renders client components (`SpotlightBackground`, `LocaleSwitcher`) directly as children — the same pattern applies to every new chrome component here, all of which are `'use client'`.

---

## Task 1: Vendor SplitText + CardSwap (adds `gsap`, `@gsap/react`)

**Files:**
- Create: `components/ui/reactbits/SplitText.tsx`, `components/ui/reactbits/CardSwap.tsx`
- Modify: `package.json` (add `gsap`, `@gsap/react`)

**Interfaces:**
- Produces: default-exported `SplitText` and `CardSwap` components at `components/ui/reactbits/SplitText.tsx` / `CardSwap.tsx`. Neither is consumed by this plan — a later per-screen plan reads the vendored file's own prop types before using it.

- [ ] **Step 1: Pull both components**

```bash
npx shadcn@latest add @react-bits/SplitText-TS-TW @react-bits/CardSwap-TS-TW
```

This installs `gsap` and `@gsap/react` into `package.json`/`package-lock.json` as a side effect (both components import from `gsap`) and writes `components/SplitText.tsx` and `components/CardSwap.tsx`.

- [ ] **Step 2: Move the fetched files into `components/ui/reactbits/`**

```bash
mkdir -p components/ui/reactbits
mv components/SplitText.tsx components/ui/reactbits/SplitText.tsx
mv components/CardSwap.tsx components/ui/reactbits/CardSwap.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors from either new file or from the `gsap`/`@gsap/react` imports.

- [ ] **Step 4: Commit**

```bash
git add components/ui/reactbits/SplitText.tsx components/ui/reactbits/CardSwap.tsx package.json package-lock.json
git commit -m "feat: vendor React Bits SplitText and CardSwap"
```

---

## Task 2: Dropped — Dither is not React-19-compatible with this app

**Status: SKIPPED.** Originally "Vendor Dither (adds `@react-three/fiber`, `@react-three/postprocessing`, `postprocessing`, `three`)". Attempted, reverted (commit `fedf5b4`) once `npm install` only succeeded via `legacy-peer-deps=true` and independent verification confirmed `@react-three/postprocessing@^3.0.4` (the version Dither's vendored source actually imports) declares a hard peer dependency on `react: "^19.0"` — this app is pinned to `react@^18.3.1`/`react-dom@^18.3.1` on Next.js 14.2, which does not support React 19. `legacy-peer-deps=true` would have suppressed npm's warning without fixing the actual runtime incompatibility (React Three Fiber v9's reconciler targets React 19's concurrent APIs), and an app-wide React 19 upgrade is far outside this plan's scope and blast radius to force through as a side effect of one ambient background layer.

No file is created by this task. `components/ui/reactbits/Dither.tsx` does not exist and is not referenced by any later task — Task 7's `AtmosphereLayer` (below) uses a hand-authored CSS grain layer instead, matching the original mockup's own grain technique (a `repeating-radial-gradient` composite under a `steps()` keyframe shift), which is what the mockup actually built for this element regardless of its footer's React Bits credit line.

---

## Task 3: Vendor LightRays + MetaBalls (reuses existing `ogl` dependency)

**Files:**
- Create: `components/ui/reactbits/LightRays.tsx`, `components/ui/reactbits/MetaBalls.tsx`

**Interfaces:**
- Produces: `const LightRays: React.FC<LightRaysProps>` (default export) at `components/ui/reactbits/LightRays.tsx`, where
  ```ts
  interface LightRaysProps {
    raysOrigin?: RaysOrigin   // default 'top-center'
    raysColor?: string        // default a light color constant in the vendored file
    raysSpeed?: number        // default 1
    lightSpread?: number      // default 1
    rayLength?: number        // default 2
    pulsating?: boolean       // default false
    fadeDistance?: number     // default 1.0
    saturation?: number       // default 1.0
    followMouse?: boolean     // default true
    mouseInfluence?: number   // default 0.1
    noiseAmount?: number      // default 0.0
    distortion?: number       // default 0.0
    className?: string        // default ''
  }
  ```
  Consumed by Task 7 (`AtmosphereLayer`). `MetaBalls`'s default export is not consumed by this plan — a later per-screen plan (the swipe-vote "popcorn kernel" burst) reads its own prop types before use.

- [ ] **Step 1: Pull both components**

```bash
npx shadcn@latest add @react-bits/LightRays-TS-TW @react-bits/MetaBalls-TS-TW
```

- [ ] **Step 2: Move the fetched files**

```bash
mv components/LightRays.tsx components/ui/reactbits/LightRays.tsx
mv components/MetaBalls.tsx components/ui/reactbits/MetaBalls.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/reactbits/LightRays.tsx components/ui/reactbits/MetaBalls.tsx package.json package-lock.json
git commit -m "feat: vendor React Bits LightRays and MetaBalls"
```

---

## Task 4: Vendor DecryptedText + Stack + TiltedCard (`motion/react` → `framer-motion`)

**Files:**
- Create: `components/ui/reactbits/DecryptedText.tsx`, `components/ui/reactbits/Stack.tsx`, `components/ui/reactbits/TiltedCard.tsx`

**Interfaces:**
- Produces: default exports `DecryptedText`, `Stack`, `TiltedCard` at their respective files. None consumed by this plan.

None of these three add a new dependency — their vendored source imports from `motion/react`, which this task rewrites to the already-installed `framer-motion` instead of installing the `motion` package as a second copy of the same library.

- [ ] **Step 1: Pull all three components**

```bash
npx shadcn@latest add @react-bits/DecryptedText-TS-TW @react-bits/Stack-TS-TW @react-bits/TiltedCard-TS-TW
```

- [ ] **Step 2: Move the fetched files**

```bash
mv components/DecryptedText.tsx components/ui/reactbits/DecryptedText.tsx
mv components/Stack.tsx components/ui/reactbits/Stack.tsx
mv components/TiltedCard.tsx components/ui/reactbits/TiltedCard.tsx
```

- [ ] **Step 3: Rewrite each file's `motion/react` import to `framer-motion`**

In `components/ui/reactbits/DecryptedText.tsx`, change:
```ts
import { motion } from 'motion/react';
import type { HTMLMotionProps } from 'motion/react';
```
to:
```ts
import { motion } from 'framer-motion';
import type { HTMLMotionProps } from 'framer-motion';
```

In `components/ui/reactbits/Stack.tsx`, change:
```ts
import { motion, useMotionValue, useTransform, type PanInfo } from 'motion/react';
```
to:
```ts
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
```

In `components/ui/reactbits/TiltedCard.tsx`, change:
```ts
import type { SpringOptions } from 'motion/react';
import { motion, useMotionValue, useSpring } from 'motion/react';
```
to:
```ts
import type { SpringOptions } from 'framer-motion';
import { motion, useMotionValue, useSpring } from 'framer-motion';
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If it fails on a specific named export missing from `framer-motion` (not a general type error elsewhere), that export doesn't exist under the old package name in the installed version — install `motion` (`npm install motion`) and revert only the affected file's import back to `motion/react`, leaving the other files on `framer-motion`.

- [ ] **Step 5: Commit**

```bash
git add components/ui/reactbits/DecryptedText.tsx components/ui/reactbits/Stack.tsx components/ui/reactbits/TiltedCard.tsx package.json package-lock.json
git commit -m "feat: vendor React Bits DecryptedText, Stack, TiltedCard"
```

---

## Task 5: Vendor AnimatedList + BlurText + CountUp (`motion/react` → `framer-motion`)

**Files:**
- Create: `components/ui/reactbits/AnimatedList.tsx`, `components/ui/reactbits/BlurText.tsx`, `components/ui/reactbits/CountUp.tsx`

**Interfaces:**
- Produces: default exports `AnimatedList`, `BlurText`, `CountUp` at their respective files. None consumed by this plan.

- [ ] **Step 1: Pull all three components**

```bash
npx shadcn@latest add @react-bits/AnimatedList-TS-TW @react-bits/BlurText-TS-TW @react-bits/CountUp-TS-TW
```

- [ ] **Step 2: Move the fetched files**

```bash
mv components/AnimatedList.tsx components/ui/reactbits/AnimatedList.tsx
mv components/BlurText.tsx components/ui/reactbits/BlurText.tsx
mv components/CountUp.tsx components/ui/reactbits/CountUp.tsx
```

- [ ] **Step 3: Rewrite each file's `motion/react` import to `framer-motion`**

In `components/ui/reactbits/AnimatedList.tsx`, change:
```ts
import { motion, useInView } from 'motion/react';
```
to:
```ts
import { motion, useInView } from 'framer-motion';
```

In `components/ui/reactbits/BlurText.tsx`, change:
```ts
import { motion, type Transition, type Easing } from 'motion/react';
```
to:
```ts
import { motion, type Transition, type Easing } from 'framer-motion';
```

In `components/ui/reactbits/CountUp.tsx`, change:
```ts
import { useInView, useMotionValue, useSpring } from 'motion/react';
```
to:
```ts
import { useInView, useMotionValue, useSpring } from 'framer-motion';
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. Same fallback as Task 4 Step 4 if a specific export is missing.

- [ ] **Step 5: Commit**

```bash
git add components/ui/reactbits/AnimatedList.tsx components/ui/reactbits/BlurText.tsx components/ui/reactbits/CountUp.tsx package.json package-lock.json
git commit -m "feat: vendor React Bits AnimatedList, BlurText, CountUp"
```

---

## Task 6: Vendor ClickSpark + StarBorder + LetterGlitch (no new dependencies)

**Files:**
- Create: `components/ui/reactbits/ClickSpark.tsx`, `components/ui/reactbits/StarBorder.tsx`, `components/ui/reactbits/LetterGlitch.tsx`

**Interfaces:**
- Produces: `const ClickSpark: React.FC<ClickSparkProps>` (default export) at `components/ui/reactbits/ClickSpark.tsx`, where
  ```ts
  interface ClickSparkProps {
    sparkColor?: string    // default '#fff'
    sparkSize?: number     // default 10
    sparkRadius?: number   // default 15
    sparkCount?: number    // default 8
    duration?: number      // default 400
    easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'  // default 'ease-out'
    extraScale?: number    // default 1.0
    children?: React.ReactNode
  }
  ```
  It is a **wrapper** component — it listens for clicks on whatever it wraps and spawns sparks at the click position; it does not attach a global document listener itself. Consumed by Task 11 (wraps `{children}` in `app/layout.tsx`).
  `StarBorder` and `LetterGlitch` default exports are not consumed by this plan.

- [ ] **Step 1: Pull all three components**

```bash
npx shadcn@latest add @react-bits/ClickSpark-TS-TW @react-bits/StarBorder-TS-TW @react-bits/LetterGlitch-TS-TW
```

- [ ] **Step 2: Move the fetched files**

```bash
mv components/ClickSpark.tsx components/ui/reactbits/ClickSpark.tsx
mv components/StarBorder.tsx components/ui/reactbits/StarBorder.tsx
mv components/LetterGlitch.tsx components/ui/reactbits/LetterGlitch.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/reactbits/ClickSpark.tsx components/ui/reactbits/StarBorder.tsx components/ui/reactbits/LetterGlitch.tsx
git commit -m "feat: vendor React Bits ClickSpark, StarBorder, LetterGlitch"
```

---

## Task 7: `usePrefersReducedMotion` hook + `AtmosphereLayer`

**Files:**
- Create: `lib/usePrefersReducedMotion.ts`
- Create: `components/chrome/AtmosphereLayer.tsx`
- Modify: `app/globals.css` (adds the `grainShift` keyframe)
- `app/layout.tsx` itself is not modified yet — wired in Task 11

**Interfaces:**
- Consumes: `LightRays` (Task 3, props above), `Aurora` (existing, `components/ui/Aurora.tsx`, props `{ colorStops?: string[], amplitude?: number, blend?: number, time?: number, speed?: number }`). Does **not** consume `Dither` — Task 2 was dropped (React 19 incompatibility, see its section above); the grain layer below is hand-authored CSS instead, values copied verbatim from the approved mockup (`PopcornPoll Reimagined.dc.html`'s `grainShift` keyframe and grain layer `<div>`), not reinvented.
- Produces:
  ```ts
  function usePrefersReducedMotion(): boolean
  function AtmosphereLayer(): JSX.Element
  ```
  `AtmosphereLayer` takes no props — it is a drop-in replacement for `SpotlightBackground` and reads `usePrefersReducedMotion()` itself.

- [ ] **Step 1: Write `lib/usePrefersReducedMotion.ts`**

```ts
// lib/usePrefersReducedMotion.ts
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
```

- [ ] **Step 2: Write `components/chrome/AtmosphereLayer.tsx`**

```tsx
// components/chrome/AtmosphereLayer.tsx
'use client'

import Aurora from '../ui/Aurora'
import LightRays from '../ui/reactbits/LightRays'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'

// Three stacked ambient layers behind every screen, replacing
// components/SpotlightBackground.tsx: Aurora (existing colour wash),
// LightRays (the mockup's beam-sway), and a hand-authored film-grain layer
// (the mockup's own grainShift keyframe/repeating-radial-gradient recipe —
// Dither was dropped, see Task 2). All freeze to a static frame under
// prefers-reduced-motion instead of animating — this is the one app-wide
// motion gate, not a per-screen or per-user toggle.
export function AtmosphereLayer() {
  const reducedMotion = usePrefersReducedMotion()

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <Aurora colorStops={['#2C1116', '#F5A623', '#17110E']} amplitude={0.6} speed={reducedMotion ? 0 : 0.3} />
      </div>
      {!reducedMotion && (
        <div className="absolute inset-0 opacity-40">
          <LightRays raysOrigin="top-center" raysColor="#F5A623" raysSpeed={0.6} lightSpread={1.4} rayLength={1.6} followMouse={false} />
        </div>
      )}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.22,
          mixBlendMode: 'overlay',
          animation: reducedMotion ? 'none' : 'grainShift 900ms steps(3) infinite',
          backgroundImage:
            'repeating-radial-gradient(circle at 17% 29%, rgba(243,233,210,.11) 0 1px, transparent 1px 3px), repeating-radial-gradient(circle at 71% 63%, rgba(16,12,9,.16) 0 1px, transparent 1px 4px), repeating-radial-gradient(circle at 43% 88%, rgba(243,233,210,.08) 0 1px, transparent 1px 5px)',
          backgroundSize: '37px 37px, 53px 53px, 71px 71px',
        }}
      />
    </div>
  )
}
```

`LightRays` has no `disableAnimation`/pause prop — under reduced motion it's skipped entirely rather than rendered inert, which is why it's behind an `if` while the grain layer (which just switches its own CSS `animation` to `none`) and Aurora (`speed={0}`) aren't.

- [ ] **Step 2b: Add the `grainShift` keyframe to `app/globals.css`**

Append to `app/globals.css` (verbatim from the mockup):

```css
@keyframes grainShift {
  0% { transform: translate(0, 0); }
  25% { transform: translate(-2%, 1%); }
  50% { transform: translate(1%, -2%); }
  75% { transform: translate(-1%, -1%); }
  100% { transform: translate(0, 0); }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/usePrefersReducedMotion.ts components/chrome/AtmosphereLayer.tsx app/globals.css
git commit -m "feat: add usePrefersReducedMotion hook and AtmosphereLayer"
```

---

## Task 8: `CurtainOverlay`

**Files:**
- Create: `components/chrome/CurtainOverlay.tsx`

**Interfaces:**
- Consumes: `usePrefersReducedMotion` (Task 7).
- Produces:
  ```ts
  interface CurtainOverlayProps {
    open: boolean           // true = curtains parted, stage visible (resting state)
    countdownNumber: number | null  // non-null shows the reel-countdown dial over the gap
  }
  function CurtainOverlay(props: CurtainOverlayProps): JSX.Element
  ```
  A later plan (the Lobby screen) drives `open`/`countdownNumber` from the real `'start'` WS round trip; this plan wires it into `app/layout.tsx` (Task 11) with `open={true} countdownNumber={null}` — curtains fully parted, nothing visible, a real but currently-inert render.

- [ ] **Step 1: Write `components/chrome/CurtainOverlay.tsx`**

```tsx
// components/chrome/CurtainOverlay.tsx
'use client'

import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'

export interface CurtainOverlayProps {
  open: boolean
  countdownNumber: number | null
}

// Values (colors, timing, dial layout) match the approved mockup
// (PopcornPoll Reimagined.dc.html) verbatim, not reinvented here.
export function CurtainOverlay({ open, countdownNumber }: CurtainOverlayProps) {
  const reducedMotion = usePrefersReducedMotion()
  const transition = reducedMotion ? 'none' : 'transform 1.5s cubic-bezier(.66,0,.2,1)'

  return (
    <div className="pointer-events-none fixed inset-0 z-[35]" data-testid="curtain-overlay">
      <div
        className="absolute inset-y-0 left-0 w-[52%]"
        style={{
          transform: `translateX(${open ? '-100%' : '0%'})`,
          transition,
          background:
            'repeating-linear-gradient(90deg, #3B1218 0 18px, #601D26 18px 34px, #2A0D12 34px 52px)',
          boxShadow: 'inset -40px 0 60px rgba(0,0,0,.65), 12px 0 40px rgba(0,0,0,.5)',
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-[52%]"
        style={{
          transform: `translateX(${open ? '100%' : '0%'})`,
          transition,
          background:
            'repeating-linear-gradient(90deg, #2A0D12 0 18px, #601D26 18px 34px, #3B1218 34px 52px)',
          boxShadow: 'inset 40px 0 60px rgba(0,0,0,.65), -12px 0 40px rgba(0,0,0,.5)',
        }}
      />
      {countdownNumber !== null && (
        <div
          className="fixed inset-0 z-[44] flex items-center justify-center"
          style={{ background: 'radial-gradient(circle at 50% 50%, rgba(28,20,14,.86), rgba(16,12,9,.97))' }}
        >
          <div
            className="relative flex items-center justify-center rounded-full border-2"
            style={{
              width: 'min(52vmin, 420px)',
              aspectRatio: '1',
              borderColor: 'rgba(243,233,210,.35)',
              background: 'radial-gradient(circle, rgba(243,233,210,.06), transparent 70%)',
            }}
          >
            <span
              className="font-display"
              style={{
                fontSize: 'clamp(90px, 22vmin, 200px)',
                lineHeight: 1,
                color: '#F3E9D2',
                textShadow: '0 0 40px rgba(245,166,35,.5)',
              }}
            >
              {countdownNumber}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/chrome/CurtainOverlay.tsx
git commit -m "feat: add CurtainOverlay chrome component"
```

---

## Task 9: `RoomStatusContext` + `PictureBoothHeader`

**Files:**
- Create: `components/chrome/RoomStatusContext.tsx`
- Create: `components/chrome/PictureBoothHeader.tsx`

**Interfaces:**
- Consumes: none from earlier tasks.
- Produces:
  ```ts
  type ChapterStep = 'entry' | 'lobby' | 'deck' | 'wrapup'
  function RoomStatusProvider(props: { children: React.ReactNode }): JSX.Element
  function useSetRoomStep(step: ChapterStep | null): void   // call with null to clear on unmount
  function PictureBoothHeader(): JSX.Element
  ```
  `useSetRoomStep` is how a future room page pushes its real WS-driven status into the header without the header needing route or WS knowledge itself. **Not called anywhere yet in this plan** — that wiring belongs to the follow-on screens plan (`RoomPage`'s Lobby/Now-showing/Wrap-up branches will call it once they exist). Until then, `PictureBoothHeader`'s indicator falls back to route-only inference, which is complete and correct for the routes this plan actually touches.

- [ ] **Step 1: Write `components/chrome/RoomStatusContext.tsx`**

```tsx
// components/chrome/RoomStatusContext.tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type ChapterStep = 'entry' | 'lobby' | 'deck' | 'wrapup'

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
```

- [ ] **Step 2: Write `components/chrome/PictureBoothHeader.tsx`**

```tsx
// components/chrome/PictureBoothHeader.tsx
'use client'

import { usePathname } from 'next/navigation'
import { useRoomStep, type ChapterStep } from './RoomStatusContext'

const HOST_LABELS: Record<ChapterStep, string> = {
  entry: 'Box office',
  lobby: 'Lobby',
  deck: 'Now showing',
  wrapup: 'Wrap-up',
}
const GUEST_LABELS: Record<ChapterStep, string> = {
  entry: 'Your ticket',
  lobby: 'Lobby',
  deck: 'Now showing',
  wrapup: 'Wrap-up',
}
const STEPS: ChapterStep[] = ['entry', 'lobby', 'deck', 'wrapup']

// Route-only inference for screens this plan doesn't wire real state into
// yet: '/' and '/join/[code]' are always 'entry' (nothing else they could
// be); '/room/[code]' defaults to 'lobby' unless a room page has pushed a
// more specific step via useSetRoomStep (Task 9's context, wired by a later
// plan); '/setup' isn't part of this flow, so no step highlights there.
function stepFromPath(pathname: string, pushedStep: ChapterStep | null): ChapterStep | null {
  if (pathname === '/') return 'entry'
  if (pathname.startsWith('/join/')) return 'entry'
  if (pathname.startsWith('/room/')) return pushedStep ?? 'lobby'
  return null
}

export function PictureBoothHeader() {
  const pathname = usePathname()
  const pushedStep = useRoomStep()
  // Recomputed every render from the reactive usePathname() value, not
  // captured once in state — otherwise a client-side navigation between
  // routes (e.g. '/' -> '/join/xyz' without a full reload) would leave this
  // stuck on whichever flow the header first mounted under.
  const isGuestFlow = pathname.startsWith('/join/')
  const currentStep = stepFromPath(pathname, pushedStep)
  const labels = isGuestFlow ? GUEST_LABELS : HOST_LABELS

  return (
    <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 border-b border-brass/35 bg-gradient-to-b from-velvet/90 to-ink/70 px-4 py-3.5 backdrop-blur-sm sm:px-10">
      <div className="flex items-center gap-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-marquee" />
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-marquee [animation-delay:140ms]" />
          <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-marquee [animation-delay:280ms]" />
        </span>
        <span className="font-display text-xl tracking-wide text-ticket">POPCORNPOLL</span>
        <span className="border border-brass/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-brass">
          est. 1952
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
        <span>Self-hosted</span>
      </div>
    </header>
  )
}
```

The usher-lamp cursor-spotlight toggle from the mockup's header is deliberately left out of this task — it needs a document-level pointermove listener and a flashlight overlay that only makes sense once wired app-wide in Task 11, not as header-internal state.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/chrome/RoomStatusContext.tsx components/chrome/PictureBoothHeader.tsx
git commit -m "feat: add RoomStatusContext and PictureBoothHeader"
```

---

## Task 10: `PictureBoothFooter`

**Files:**
- Create: `components/chrome/PictureBoothFooter.tsx`

**Interfaces:**
- Produces: `function PictureBoothFooter(): JSX.Element`, no props.

- [ ] **Step 1: Write `components/chrome/PictureBoothFooter.tsx`**

```tsx
// components/chrome/PictureBoothFooter.tsx
export function PictureBoothFooter() {
  return (
    <footer className="relative z-10 flex flex-wrap items-center justify-center gap-3.5 border-t border-brass/25 px-5 py-5 font-mono text-[9.5px] uppercase tracking-widest text-brass/75">
      <span>Self-hosted · your library, your rules</span>
      <span className="opacity-50">·</span>
      <span>This product uses the TMDB API but is not endorsed or certified by TMDB</span>
    </footer>
  )
}
```

This is a direct restyle of the attribution text already present verbatim in `app/page.tsx`'s current `tmdbAttribution` translation string — extracting it into shared chrome means `app/page.tsx` will drop its own copy in the follow-on screens plan (out of scope here since this task only adds the component, it doesn't yet touch `app/page.tsx`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/chrome/PictureBoothFooter.tsx
git commit -m "feat: add PictureBoothFooter chrome component"
```

---

## Task 11: Wire chrome into `app/layout.tsx`, add global click-spark, Playwright smoke test

**Files:**
- Modify: `app/layout.tsx`
- Delete: `components/SpotlightBackground.tsx` (superseded by `AtmosphereLayer`)
- Create: `e2e/chrome.spec.ts`

**Interfaces:**
- Consumes: `AtmosphereLayer` (Task 7), `CurtainOverlay` (Task 8), `RoomStatusProvider`/`PictureBoothHeader` (Task 9), `PictureBoothFooter` (Task 10), `ClickSpark` (Task 6, props `{ sparkColor?, sparkSize?, sparkRadius?, sparkCount?, duration?, easing?, extraScale?, children? }`).

- [ ] **Step 1: Write the failing Playwright smoke test**

```ts
// e2e/chrome.spec.ts
import { test, expect } from '@playwright/test'

test('shared chrome renders on the box office screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('POPCORNPOLL')).toBeVisible()
  await expect(page.getByTestId('chapter-indicator')).toBeVisible()
  await expect(page.getByTestId('curtain-overlay')).toBeAttached()
  await expect(page.getByText('self-hosted', { exact: false })).toBeVisible()
})

test('chapter indicator is hidden on the setup screen', async ({ page }) => {
  await page.goto('/setup')
  await expect(page.getByTestId('chapter-indicator')).not.toBeAttached()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test e2e/chrome.spec.ts`
Expected: FAIL — `app/layout.tsx` still renders the old `SpotlightBackground`/`LocaleSwitcher`-only chrome, so `chapter-indicator` and `curtain-overlay` don't exist yet.

- [ ] **Step 3: Rewrite `app/layout.tsx`**

```tsx
// app/layout.tsx
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { Anton, JetBrains_Mono, Work_Sans } from 'next/font/google'
import { AtmosphereLayer } from '../components/chrome/AtmosphereLayer'
import { CurtainOverlay } from '../components/chrome/CurtainOverlay'
import { PictureBoothFooter } from '../components/chrome/PictureBoothFooter'
import { PictureBoothHeader } from '../components/chrome/PictureBoothHeader'
import { RoomStatusProvider } from '../components/chrome/RoomStatusContext'
import { LocaleSwitcher } from '../components/LocaleSwitcher'
import ClickSpark from '../components/ui/reactbits/ClickSpark'
import { Toaster } from '../components/ui/sonner'
import './globals.css'

const display = Anton({ subsets: ['latin'], weight: '400', variable: '--font-display' })
const body = Work_Sans({ subsets: ['latin'], variable: '--font-body' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata = { title: 'PopcornPoll' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <NextIntlClientProvider>
          <RoomStatusProvider>
            <AtmosphereLayer />
            <CurtainOverlay open countdownNumber={null} />
            <ClickSpark sparkColor="#F5A623" sparkCount={8} duration={460} extraScale={1.0}>
              <div className="fixed right-2 top-2 z-50 sm:right-4 sm:top-4">
                <LocaleSwitcher />
              </div>
              <div className="flex min-h-screen flex-col">
                <PictureBoothHeader />
                <div className="flex-1">{children}</div>
                <PictureBoothFooter />
              </div>
            </ClickSpark>
          </RoomStatusProvider>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
```

`ClickSpark` wraps the header/content/footer, not the fixed-position `AtmosphereLayer`/`CurtainOverlay` (which sit behind everything and shouldn't intercept clicks meant for the page — both already have `pointer-events-none` at their root).

- [ ] **Step 4: Delete the superseded background component**

```bash
rm components/SpotlightBackground.tsx
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS. The `build` step matters here specifically because it's the first point at which `next build`'s route analysis touches every vendored WebGL component (`Aurora`, `LightRays`, `MetaBalls`) through the full layout tree — a client/server boundary mistake would surface here, not at `typecheck`.

- [ ] **Step 6: Run the Playwright smoke test again**

Run: `npx playwright test e2e/chrome.spec.ts`
Expected: PASS.

- [ ] **Step 7: Run the full existing Playwright suite**

Run: `npx playwright test`
Expected: PASS — every existing spec (`authorization`, `exclusion`, `exhaustion`, `kicked`, `match`, `rateLimit`, `reconnect`) still passes unmodified, since this task didn't touch any `data-testid` any of them depend on, only added new chrome around the existing pages.

- [ ] **Step 8: Commit**

```bash
git add app/layout.tsx e2e/chrome.spec.ts
git rm components/SpotlightBackground.tsx
git commit -m "feat: wire shared chrome (atmosphere, curtain, header, footer, click-spark) into layout"
```

---

## What this plan does not cover

Per the spec's build order, still to be planned separately once this lands:

- Per-screen restyles (Box office, Join, Lobby, Now showing, Match reveal, Runners-up, End of show, Setup) — each wires the vendored components from this plan into its actual content, and is where `useSetRoomStep` (Task 9) gets called for real from `app/room/[code]/page.tsx`.
- Backend additions: `match_history` migration + `GET /api/stats` + `GET /api/eligible-count`, and the `restart_reel` WS action.
- The usher-lamp cursor-spotlight toggle (needs a document-level pointer listener wired once a screen actually exposes the toggle button, per the spec's `PictureBoothHeader` description — deferred from Task 9 above).
