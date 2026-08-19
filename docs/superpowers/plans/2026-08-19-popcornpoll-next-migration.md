# Next.js 15/16 + React 19 + Tailwind 4 + TypeScript 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PopcornPoll off Next.js 14 / React 18 / Tailwind 3 / TypeScript 5.5 onto Next.js 16 / React 19 / Tailwind 4 / TypeScript 7, closing GitHub issue #1, without breaking the custom Node HTTP server, the raw WebSocket layer, or any client-visible behavior.

**Architecture:** Four sequential stages, each gated on a fully green `npm run verify` (`tsc --noEmit && next build && vitest run`) before moving to the next: TypeScript 7 first (smallest blast radius, unblocks accurate typechecking for the rest), then Tailwind 4 (CSS/config-only, no app-code coupling), then Next 16 + React 19 together (they move in lockstep — Next 15+ requires React 19 as a peer minimum), then a final verification pass. This mirrors the order specified in the issue.

**Tech Stack:** Next.js 16.3.1 (App Router, custom server), React 19.2.8, Tailwind CSS 4.3.3 (`@tailwindcss/postcss`), TypeScript 7.0.2, Vitest 4, Playwright.

**Spec:** GitHub issue #1 ("Migrate to Next.js 15 + React 19 (and follow-on major bumps)"), `docs/superpowers/plans/2026-08-17-popcornpoll-implementation.md` (existing app architecture: custom server, WS layer).

## Global Constraints

- Gate every task on `npm run verify` passing before commit — no task is done with a red gate.
- After Task 3 (Next+React bump), do a manual dev-server click-through: create room → join → start → swipe → match. `next build` passing does not prove the custom WS server or client hydration still work.
- Target exact versions (verified on npm as of 2026-08-19, matching the issue's targets): `typescript@7.0.2`, `tailwindcss@4.3.3` + `@tailwindcss/postcss@4.3.3`, `next@16.3.1`, `react@19.2.8`, `react-dom@19.2.8`, `@types/react@19.2.18` (already pinned), `@types/react-dom@19.2.4` (currently missing from devDependencies — must be added).
- Do not add `output: 'standalone'` to `next.config.js` at any point — it is documented as mutually exclusive with the custom server this app runs (`server/index.ts`), and would silently break the WS/HTTP integration.
- All dependency peer ranges were checked against npm's published `peerDependencies` for their current `@latest` versions and confirmed to already accept React 19 / Next 16 / Tailwind 4 where relevant: `framer-motion@13.1.0`, every `@radix-ui/react-*` package in use, `react-hook-form@7.85.0`, `@hookform/resolvers@5.9.1` (zod 4 support), `next-themes@0.4.6`, `sonner@2.0.8`, `next-intl@4.13.7`, `tailwindcss-animate@1.0.7`, `@gsap/react@2.1.2`, `lucide-react@1.33.0`. No dependency blocks this migration — none need bumping beyond what's already in `package.json`.
- The App Router fetch-caching default change (Next 15+: `fetch()` no longer cached-by-default in Server Components) does **not** apply to this app — every `fetch()` call in the codebase (`app/page.tsx`, `app/setup/page.tsx`) is client-side, inside `'use client'` components, calling same-origin `/api/*` routes. No server-component data fetching exists to be affected. No action needed for this item; it is confirmed not-applicable, not an open risk.
- No `middleware.ts`, `route.ts`, `default.tsx`, or `generateMetadata` exports exist anywhere in the repo — confirmed by repo-wide search. The async `params`/`searchParams` migration only touches the two files listed in Task 3.

---

### Task 1: TypeScript 5.5 → 7.0.2

**Files:**
- Modify: `package.json` (devDependencies.typescript)
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: nothing from other tasks (first task).
- Produces: a tsconfig that Task 2 and Task 3 build on unchanged — no further tsconfig edits are expected in later tasks.

- [ ] **Step 1: Bump the `typescript` devDependency**

Edit `package.json`:

```diff
-    "typescript": "^5.5.4",
+    "typescript": "^7.0.2",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates, no install errors.

- [ ] **Step 3: Remove `baseUrl` from tsconfig.json**

TypeScript 7 removes the `baseUrl` option entirely (`TS5102: Option 'baseUrl' has been removed`). The `paths` mapping resolves relative to the tsconfig file's own location once `baseUrl` is gone, so `"@/*": ["./*"]` continues to resolve identically — no change to the `paths` values themselves.

Edit `tsconfig.json`:

```diff
     "resolveJsonModule": true,
     "jsx": "preserve",
     "incremental": true,
-    "baseUrl": ".",
     "paths": {
       "@/*": [
         "./*"
       ]
     },
```

Leave every other compilerOption unchanged (`target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `allowJs`, `plugins: [{name:"next"}]` all remain valid under TS7 — verified against TS7/tsgo docs). Note: the Next.js language-service plugin entry (`plugins: [{name: "next"}]`) is accepted by the config schema but has no effect under the native tsgo editor/LSP (no plugin-loading support yet) — this only affects editor intellisense, not `tsc --noEmit` or the build, so no action needed here.

- [ ] **Step 4: Run typecheck in isolation**

Run: `npm run typecheck`
Expected: PASS with no errors. If path-alias imports (`@/...`) fail to resolve, double check no other file (e.g. `vitest.config.ts`) hardcodes a `baseUrl`-relative assumption.

- [ ] **Step 5: Run full verify gate**

Run: `npm run verify`
Expected: `tsc --noEmit` passes, `next build` succeeds, all 266 existing vitest tests pass (same count as the pre-migration baseline — a changed count means something broke or a test was silently skipped).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: migrate to TypeScript 7.0.2"
```

---

### Task 2: Tailwind CSS 3.4 → 4.3

**Files:**
- Modify: `package.json` (devDependencies: bump `tailwindcss`, add `@tailwindcss/postcss`, remove `autoprefixer`)
- Modify: `postcss.config.js`
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts`

**Interfaces:**
- Consumes: green baseline from Task 1 (TS7-clean `tsc --noEmit`).
- Produces: a `tailwind.config.ts` kept alive via v4's `@config` compatibility directive (not rewritten to CSS-first `@theme`) — Task 3 and later work should keep adding new design tokens to this same file, not introduce a competing `@theme` block. This is a deliberate choice to minimize diff size/risk in an already-large migration; a full CSS-native rewrite is out of scope for this issue.

- [ ] **Step 1: Bump dependencies**

Edit `package.json`:

```diff
-    "autoprefixer": "^10.5.4",
+    "@tailwindcss/postcss": "^4.3.3",
     "postcss": "^8.5.26",
-    "tailwindcss": "^3.4.19",
+    "tailwindcss": "^4.3.3",
```

`autoprefixer` is removed — Tailwind v4's engine (Lightning CSS) handles vendor prefixing itself; keeping it as an unused PostCSS plugin would be dead weight.

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates, no install errors.

- [ ] **Step 3: Rewrite `postcss.config.js`**

```diff
 export default {
   plugins: {
-    tailwindcss: {},
-    autoprefixer: {},
+    '@tailwindcss/postcss': {},
   },
 }
```

- [ ] **Step 4: Rewrite the top of `app/globals.css`**

```diff
-@tailwind base;
-@tailwind components;
-@tailwind utilities;
+@import "tailwindcss";
+@config "../tailwind.config.ts";
+@plugin "tailwindcss-animate";
+@custom-variant dark (&:where(.dark, .dark *));

 :root {
```

- `@config` loads the existing `tailwind.config.ts` as a v4 "legacy" config (JS/TS config files are no longer auto-detected in v4) — this keeps `theme.extend.colors/borderRadius/keyframes/animation` working unchanged.
- `@plugin "tailwindcss-animate"` is the documented v4 compatibility path for loading a v3-era JS plugin from CSS.
- `@custom-variant dark (...)` replaces the removed `darkMode` config key (see Step 5) — this is the CSS-first equivalent of v3's `darkMode: ['class']`, matching on `.dark` on the element or an ancestor, same selector semantics as `next-themes`' `attribute="class"` usage already in this app.

- [ ] **Step 5: Remove the now-invalid `darkMode` key from `tailwind.config.ts`**

This is the fix for the exact blocking error in the issue (`Type '["class"]' is not assignable to type 'DarkModeStrategy | undefined'` — v4's `Config` type no longer accepts a `darkMode` array; dark mode is CSS-variant-only in v4, configured in Step 4 above).

```diff
 const config: Config = {
-  darkMode: ['class'],
   content: ['./pages/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
```

- [ ] **Step 6: Run full verify gate**

Run: `npm run verify`
Expected: `tsc --noEmit` passes (the `darkMode` type error from the issue is gone), `next build` succeeds, all 266 tests pass.

- [ ] **Step 7: Manual visual check for dark-mode and animation regressions**

Run: `npm run dev`, open the app in a browser.
Check:
- Theme toggle (via `next-themes`) still switches `.dark` class on `<html>` and all `hsl(var(--foo))`-driven colors still apply in both themes.
- Radix `Dialog`/`Select`/`Tooltip` open/close transitions (these use `tailwindcss-animate` utility classes like `animate-in`/`fade-in`/`zoom-in`) still animate — this is the specific area flagged as having known v3→v4 friction for this plugin. If any animation is visibly broken (snaps instead of transitioning, or applies the wrong opacity), swap the `@plugin "tailwindcss-animate"` line for `@import "tw-animate-css";` (install `tw-animate-css` as a devDependency first) and re-check.
- `star-movement-bottom`/`star-movement-top` custom keyframe animations (defined in `tailwind.config.ts` `theme.extend.keyframes`) still render — these come through unchanged via the `@config` compatibility path, but confirm visually since they're easy to silently drop.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json postcss.config.js app/globals.css tailwind.config.ts
git commit -m "chore: migrate to Tailwind CSS 4.3.3"
```

---

### Task 3: Next.js 14.2 → 16.3 + React 18.3 → 19.2

**Files:**
- Modify: `package.json` (dependencies: `next`, `react`, `react-dom`; devDependencies: `@types/react-dom` — currently absent, must be added)
- Modify: `app/join/[code]/page.tsx`
- Modify: `app/room/[code]/page.tsx`

**Interfaces:**
- Consumes: green baseline from Task 2 (Tailwind4-clean build).
- Produces: no new shared types or functions for later tasks — Task 4 only re-verifies.

- [ ] **Step 1: Bump dependencies**

Edit `package.json`:

```diff
-    "next": "^14.2.5",
+    "next": "^16.3.1",
...
-    "react": "^18.3.1",
+    "react": "^19.2.8",
-    "react-dom": "^18.3.1",
+    "react-dom": "^19.2.8",
```

And in devDependencies, add the currently-missing `@types/react-dom` (this project has `@types/react` pinned but never had `@types/react-dom` as an explicit devDependency):

```diff
     "@types/qrcode": "^1.5.6",
     "@types/react": "^19.2.18",
+    "@types/react-dom": "^19.2.4",
     "@types/ws": "^8.18.1",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: lockfile updates, no install errors, no peer-dependency warnings for `next`/`react`/`react-dom` (every other dependency's peer range already accepts these versions — see Global Constraints).

- [ ] **Step 3: Convert `app/join/[code]/page.tsx` to async params**

Next.js 15+ wraps route `params` in a `Promise` for both server and client page components; client components unwrap it with React's `use()` hook instead of `await`.

Current (`app/join/[code]/page.tsx`):

```tsx
export default function JoinRoomPage({ params }: { params: { code: string } }) {
  const t = useTranslations('joinRoom')
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')

  return (
    <main ...>
      ...
      <CodeSlats code={params.code} />
      ...
              router.push(`/room/${params.code}`)
      ...
```

New:

```diff
 import { useTranslations } from 'next-intl'
 import { useRouter } from 'next/navigation'
-import { useState } from 'react'
+import { use, useState } from 'react'
 import CodeSlats from '../../../components/CodeSlats'

-export default function JoinRoomPage({ params }: { params: { code: string } }) {
+export default function JoinRoomPage({ params }: { params: Promise<{ code: string }> }) {
+  const { code } = use(params)
   const t = useTranslations('joinRoom')
   const router = useRouter()
   const [displayName, setDisplayName] = useState('')
```

Then replace both remaining usages: `<CodeSlats code={params.code} />` → `<CodeSlats code={code} />`, and `router.push(\`/room/${params.code}\`)` → `` router.push(`/room/${code}`) ``.

- [ ] **Step 4: Convert `app/room/[code]/page.tsx` to async params**

Same pattern. Current signature:

```tsx
export default function RoomPage({ params }: { params: { code: string } }) {
```

New:

```diff
-import { useEffect, useRef, useState } from 'react'
+import { use, useEffect, useRef, useState } from 'react'
 import { toast } from 'sonner'
 ...
-export default function RoomPage({ params }: { params: { code: string } }) {
+export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
+  const { code } = use(params)
   const router = useRouter()
```

Then replace every remaining `params.code` reference in this file (lines 80, 82, 127, 131, 136, 143, a `useEffect`/`useCallback` dependency array around line 168, and 231 as of the pre-migration file) with `code`. Search the file for the literal string `params.code` after the signature edit and replace each occurrence — do not leave any stale reference, since `params` after this change is a `Promise` and `params.code` would be a type error everywhere it's still used directly.

- [ ] **Step 5: Run full verify gate**

Run: `npm run verify`
Expected: `tsc --noEmit` passes, `next build` succeeds under Next 16 (watch for new build-time warnings, not just errors — Next 16 sometimes deprecation-warns on things that still build), all 266 tests pass.

- [ ] **Step 6: Manual dev-server click-through**

Run: `npm run dev` (this starts the custom server via `tsx server/index.ts`, exercising `next({dev}).getRequestHandler()` under Next 16 — confirmed still an officially supported pattern, not deprecated, but this is the first real run of it under the new major, so treat this as load-bearing, not a formality).

Walk through, in a real browser:
1. Create a room from `/` (exercises `POST /api/rooms`, the custom server's non-Next routing branch).
2. Open the join link (`/join/[code]`) in a second browser/incognito window — confirms the async `params`/`use()` conversion in Task 3 Step 3 actually resolves the code.
3. Join, then land on `/room/[code]` — confirms the async `params`/`use()` conversion in Task 3 Step 4.
4. Start the room as host, swipe through the deck (exercises the raw `ws` WebSocket connection attached to the same `httpServer` instance — this is the area most likely to have latent issues after three Next.js majors' worth of internal changes, per the migration research).
5. Get to a match reveal.
6. Switch the locale (next-intl, cookie-based) and confirm strings update without a full reload glitch.
7. Toggle dark/light theme and confirm no flash-of-unstyled-content or broken colors (cross-check against Task 2 Step 7 — this is the first time the Tailwind 4 dark-mode variant runs under React 19's rendering, not just Tailwind 3-vs-4 in isolation).

If any step fails, stop and debug before proceeding — do not commit a build that passes `next build` but breaks the actual room flow.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app/join/[code]/page.tsx app/room/[code]/page.tsx
git commit -m "chore: migrate to Next.js 16.3.1 and React 19.2.8"
```

---

### Task 4: Final verification and issue closeout

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: the fully migrated codebase from Tasks 1-3.
- Produces: nothing for further tasks — this is the terminal task.

- [ ] **Step 1: Re-run the full verify gate one more time from a clean install**

```bash
rm -rf node_modules .next
npm install
npm run verify
```

Expected: PASS, matching the pre-migration baseline test count (266 tests). A clean-install run catches anything that only worked because of stale `node_modules`/`.next` cache state left over from the incremental Task 1-3 installs.

- [ ] **Step 2: Confirm the CVEs the issue was raised for are actually gone**

Run: `osv-scanner --lockfile package-lock.json`

Compare against the issue's cited findings (`GHSA-c4j6-fc7j-m34r` at 8.6 CVSS, `GHSA-89xv-2m56-2m9x` at 8.3, `GHSA-m99w-x7hq-7vfj` at 8.2 — all tied to Next.js 14). Expected: none of these three IDs appear in the new scan output. Note any newly-introduced advisories from the bumped versions separately — do not silently fold a new finding into "done."

- [ ] **Step 3: Run the Playwright e2e suite, but do not block on pre-existing failures**

Run: `npm run test:e2e`

Issue #2 ("Fix 15/22 failing Playwright e2e specs") already tracks pre-existing, unrelated e2e failures — closed as pre-existing at the time issue #1 was filed. Compare the failing-spec list against that issue's baseline: specs that were already failing before this migration are not this task's responsibility, but any spec that passed before and fails now is a real regression from this migration and must be investigated before closing out.

- [ ] **Step 4: Update and close GitHub issue #1**

Post a summary comment on the issue (via `gh issue comment 1`) listing: final versions landed, confirmation the three cited CVEs are resolved, confirmation of the manual click-through pass, and a link to the PR/commits. Close the issue once the branch is merged, not before.
