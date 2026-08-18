# Join/Ticket Screen (Reimagined UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `app/join/[code]/page.tsx` to match the approved "PopcornPoll Reimagined" mockup's Join/Ticket screen: the room code renders as staggered split-flap letter tiles, and the join form becomes a two-panel cream ticket card with a torn-stub side panel.

**Architecture:** A new presentational component (`components/CodeSlats.tsx`) renders the room code as grouped, staggered letter tiles, following the same "precompute an array of per-item inline styles" pattern as `components/BulbFrame.tsx`. The join page itself drops its shadcn `Card`/`Input`/`Label`/`Button` wrappers in favor of bespoke Tailwind-styled elements (mirroring how `app/page.tsx` already dropped shadcn for Box office), adds two new CSS keyframes, and updates its i18n copy. No backend changes.

**Tech Stack:** Next.js 14 App Router, React, Tailwind (existing `ink`/`velvet`/`marquee`/`ticket`/`brass`/`exit-red` color tokens), next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-popcornpoll-reimagined-design.md` (Join/Ticket screen entry). This plan also encodes design detail gathered by re-reading the actual mockup (`PopcornPoll Reimagined.dc.html`, Join section) beyond the spec's one-line mapping — see each task's Design Notes.

## Global Constraints

- Room codes are real `WORD-WORD-###` strings (e.g. `BLUE-WOLF-042`), not the mockup's unseparated demo code — hyphens become gaps between tile groups, not their own tile.
- Do not import the mockup's own JS `narrow`-prop branching for the stub panel's position; implement it as a Tailwind responsive class (dashed border on the left edge at `sm:` and up, on the top edge below).
- Use existing Tailwind color tokens (`ink`, `ticket`, `brass`, `exit-red`) rather than hardcoding the mockup's raw hex values — they already resolve close enough (confirmed via `app/globals.css`'s `--ink`/`--ticket`/`--exit-red` HSL definitions) and keep the page on the shared design system.
- CTA and label copy strings are stored uppercase verbatim in the i18n JSON (matching Box office's `"createButton": "PRINT THE TICKETS"` precedent), not lowercased-then-CSS-uppercased.
- `en-us.json` and `pt-br.json` must declare exactly the same key set — `messages/messages.test.ts` already enforces this; do not add a key to one file without the other.
- Preserve the existing `maxLength={24}` cap on the name input — the new character-count caption reports against this same 24, not a new value.

---

### Task 1: `CodeSlats` component + new CSS keyframes

**Files:**
- Create: `components/CodeSlats.tsx`
- Create: `components/CodeSlats.test.ts`
- Modify: `app/globals.css` (insert after the existing `@keyframes marqueeSlide` block, before the `prefers-reduced-motion` media query — that query already wildcards `*, *::before, *::after`, so no changes are needed there)

**Design notes (from the mockup):** each character of the room code is its own tile — dark gradient background, 1px brass border, inset shadow, Anton (`font-display`) text, staggered reveal via `slatFlip`, ~90ms stagger per letter across the *whole* code (not reset per hyphen-group). Tile sizing: `width: clamp(27px, 6.4vw, 68px); height: clamp(37px, 8.4vw, 90px); font-size: clamp(24px, 6vw, 64px)`. Screen readers should hear the code as one string, not letter-by-letter — the wrapping element carries `aria-label={code}` and each tile is `aria-hidden`.

**Interfaces:**
- Consumes: nothing new.
- Produces: `slatGroups(code: string): { letter: string; delay: string }[][]` (pure helper, exported for testing) and `CodeSlats({ code }: { code: string })` (default export used by Task 3's page).

- [ ] **Step 1: Write the failing test**

```ts
// components/CodeSlats.test.ts
import { describe, expect, it } from 'vitest'
import { slatGroups } from './CodeSlats'

describe('slatGroups', () => {
  it('splits a WORD-WORD-### code into per-hyphen groups of individual letters', () => {
    expect(slatGroups('BLUE-WOLF-042')).toEqual([
      [
        { letter: 'B', delay: '0.00' },
        { letter: 'L', delay: '0.09' },
        { letter: 'U', delay: '0.18' },
        { letter: 'E', delay: '0.27' },
      ],
      [
        { letter: 'W', delay: '0.36' },
        { letter: 'O', delay: '0.45' },
        { letter: 'L', delay: '0.54' },
        { letter: 'F', delay: '0.63' },
      ],
      [
        { letter: '0', delay: '0.72' },
        { letter: '4', delay: '0.81' },
        { letter: '2', delay: '0.90' },
      ],
    ])
  })

  it('staggers the delay across the whole code, not reset per group', () => {
    const groups = slatGroups('AB-CD')
    expect(groups[1][0].delay).toBe('0.18')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/CodeSlats.test.ts`
Expected: FAIL — `Cannot find module './CodeSlats'` (file doesn't exist yet)

- [ ] **Step 3: Implement `CodeSlats.tsx` and the keyframes**

```tsx
// components/CodeSlats.tsx
// Renders a room code as individually staggered "split-flap" letter tiles.
// Hyphens in the real WORD-WORD-### code format become gaps between tile
// groups rather than their own tile — the mockup's own demo code had no
// separators to model that case on, so this grouping is a deliberate call.
// Modeled on BulbFrame.tsx's pattern of precomputing an array of per-item
// inline styles.
export type Slat = { letter: string; delay: string }

export function slatGroups(code: string): Slat[][] {
  let i = 0
  return code.split('-').map((group) =>
    group.split('').map((letter) => {
      const delay = (i * 0.09).toFixed(2)
      i += 1
      return { letter, delay }
    }),
  )
}

export default function CodeSlats({ code }: { code: string }) {
  const groups = slatGroups(code)
  return (
    <div className="flex items-center gap-3 sm:gap-4" aria-label={code}>
      {groups.map((letters, gi) => (
        <div key={gi} className="flex gap-1 sm:gap-1.5">
          {letters.map(({ letter, delay }, li) => (
            <span
              key={li}
              aria-hidden
              className="flex items-center justify-center border border-brass/50 bg-gradient-to-b from-[#1A1512] to-[#0C0A08] font-display text-[clamp(24px,6vw,64px)] text-ticket shadow-[inset_0_-6px_12px_rgba(0,0,0,.6)]"
              style={{
                width: 'clamp(27px, 6.4vw, 68px)',
                height: 'clamp(37px, 8.4vw, 90px)',
                animation: `slatFlip .5s ease-out both ${delay}s`,
              }}
            >
              {letter}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}
```

Insert into `app/globals.css` right after the `@keyframes marqueeSlide { ... }` block (currently ending at line 87), before the `@media (prefers-reduced-motion: reduce)` block:

```css
@keyframes slatFlip {
  0% { transform: rotateX(-92deg); opacity: 0; }
  60% { transform: rotateX(8deg); opacity: 1; }
  100% { transform: rotateX(0); opacity: 1; }
}

@keyframes revealUp {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
}
```

(`revealUp` is added here because it's a small, self-contained keyframe like `slatFlip` — Task 3 is the task that actually uses it, on the ticket card's entrance.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/CodeSlats.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add components/CodeSlats.tsx components/CodeSlats.test.ts app/globals.css
git commit -m "feat: add CodeSlats split-flap room-code component"
```

---

### Task 2: i18n copy updates

**Files:**
- Modify: `messages/en-us.json:53-59` (`joinRoom` namespace)
- Modify: `messages/pt-br.json:53-59` (`joinRoom` namespace)
- Test: `messages/messages.test.ts` (existing — no changes needed, just must stay passing)

**Design notes:** `namePlaceholder` and `joinButton` change value (not key name). Four new keys are added: `nameCountCaption` (ICU-interpolated, matching the `{varName}` pattern already used elsewhere in this codebase, e.g. Box office's `plexLinkedStatus`), `noPasswordNote`, `admitOneLabel`, `seatLabel`. The now-unused `nameLabel` key is removed — the new design has no separate small "Name" label; `nameCardTitle` serves as the input's accessible name instead (wired via `aria-labelledby` in Task 3).

**Interfaces:**
- Consumes: nothing.
- Produces: the `joinRoom.nameCountCaption` key takes a `count` interpolation variable — Task 3's page calls `t('nameCountCaption', { count: displayName.length })`.

- [ ] **Step 1: Write the failing test**

No new test file — `messages/messages.test.ts` already asserts `pt-br.json` and `en-us.json` declare the same key set. Editing only one file first will fail it; that's the "failing test" for this task.

- [ ] **Step 2: Edit `messages/en-us.json`**

Replace lines 53-59:

```json
  "joinRoom": {
    "invitedTo": "You're invited to",
    "nameCardTitle": "Your name on the ticket",
    "namePlaceholder": "Type it here",
    "nameCountCaption": "{count}/24 characters · shown to everyone in the room",
    "joinButton": "TAKE MY SEAT",
    "noPasswordNote": "No password, no account. The room closes when the host says so.",
    "admitOneLabel": "ADMIT ONE",
    "seatLabel": "Row C · Seat 14"
  },
```

- [ ] **Step 3: Run the parity test, verify it fails**

Run: `npx vitest run messages/messages.test.ts`
Expected: FAIL — key sets differ (`pt-br.json` still has the old keys)

- [ ] **Step 4: Edit `messages/pt-br.json`**

Replace lines 53-59:

```json
  "joinRoom": {
    "invitedTo": "Você foi convidado para",
    "nameCardTitle": "Seu nome no ingresso",
    "namePlaceholder": "Digite aqui",
    "nameCountCaption": "{count}/24 caracteres · visível para todos na sala",
    "joinButton": "GARANTIR MEU LUGAR",
    "noPasswordNote": "Sem senha, sem conta. A sala fecha quando o anfitrião decidir.",
    "admitOneLabel": "ENTRADA ÚNICA",
    "seatLabel": "Fileira C · Assento 14"
  },
```

- [ ] **Step 5: Run the parity test, verify it passes**

Run: `npx vitest run messages/messages.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add messages/en-us.json messages/pt-br.json
git commit -m "feat: update join screen copy for ticket redesign"
```

---

### Task 3: Restyle `app/join/[code]/page.tsx`

**Files:**
- Modify: `app/join/[code]/page.tsx` (full rewrite, 51 lines → ~45 lines)

**Design notes:** Two-panel cream ticket card (`bg-gradient-to-br from-ticket to-ticket/80`, dark `text-ink` — inverts the app's usual dark theme, matching Box office's own `from-ticket to-ticket/80` ticket-panel precedent at `app/page.tsx:110`). Main panel: borderless underlined Anton name input (focus color `exit-red`), live `{n}/24` caption, full-width CTA that's `exit-red` when non-empty / muted ink-on-ink when empty and disabled. Side panel: dashed-border "torn stub" with vertical "ADMIT ONE" text on desktop (`sm:[writing-mode:vertical-rl] sm:rotate-180`), horizontal on mobile, plus a decorative non-functional "Row C · Seat 14" caption. Footer line below the card. Drops shadcn `Card`/`CardHeader`/`CardContent`/`Input`/`Label`/`Button`. New testids `join-name-input` / `join-submit` replace the old placeholder-text/button-text selectors (hardened in Task 4).

**Interfaces:**
- Consumes: `CodeSlats` from `../../../components/CodeSlats` (Task 1); `joinRoom.namePlaceholder`, `joinRoom.nameCountCaption`, `joinRoom.joinButton`, `joinRoom.noPasswordNote`, `joinRoom.admitOneLabel`, `joinRoom.seatLabel` (Task 2).
- Produces: `data-testid="join-name-input"` on the name `<input>`, `data-testid="join-submit"` on the submit `<button>` — Task 4's e2e updates depend on these exact names.

- [ ] **Step 1: Replace the page**

```tsx
// app/join/[code]/page.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import CodeSlats from '../../../components/CodeSlats'

export default function JoinRoomPage({ params }: { params: { code: string } }) {
  const t = useTranslations('joinRoom')
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')

  return (
    <main className="mx-auto flex max-w-[640px] flex-1 flex-col items-center justify-center gap-6 px-4">
      <p className="font-mono text-[11px] uppercase tracking-[.4em] text-brass">{t('invitedTo')}</p>
      <CodeSlats code={params.code} />
      <div
        className="flex w-full flex-wrap overflow-hidden border-2 border-brass/60 bg-gradient-to-br from-ticket to-ticket/80 text-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]"
        style={{ animation: 'revealUp .6s ease-out both' }}
      >
        <div className="flex flex-1 basis-[300px] flex-col gap-4 p-6 sm:p-8">
          <p id="joinNameLabel" className="font-mono text-xs uppercase tracking-widest text-ink/60">
            {t('nameCardTitle')}
          </p>
          <input
            aria-labelledby="joinNameLabel"
            data-testid="join-name-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={24}
            placeholder={t('namePlaceholder')}
            className="h-16 border-0 border-b-[3px] border-ink/40 bg-transparent font-display text-[clamp(28px,4vw,42px)] text-ink outline-none focus:border-exit-red"
          />
          <p className="font-mono text-xs text-ink/55">
            {t('nameCountCaption', { count: displayName.length })}
          </p>
          <button
            type="button"
            data-testid="join-submit"
            disabled={displayName.length === 0}
            onClick={() => {
              sessionStorage.setItem('pendingDisplayName', displayName)
              router.push(`/room/${params.code}`)
            }}
            className="h-[62px] font-display text-xl tracking-wide text-ticket disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-ink/45 enabled:cursor-pointer enabled:bg-exit-red"
          >
            {t('joinButton')}
          </button>
        </div>
        <div className="flex flex-1 basis-full flex-col items-center justify-between gap-3 border-t-[3px] border-dashed border-ink/40 bg-ink/[.04] p-4 text-center sm:basis-[168px] sm:border-l-[3px] sm:border-t-0 sm:py-6">
          <p className="font-display text-lg tracking-[.14em] text-ink/80 sm:rotate-180 sm:text-xl sm:[writing-mode:vertical-rl]">
            {t('admitOneLabel')}
          </p>
          <p className="font-mono text-[11px] text-ink/55">{t('seatLabel')}</p>
        </div>
      </div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-brass/85">{t('noPasswordNote')}</p>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors (confirms the dropped shadcn imports and new markup are well-typed)

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, navigate to `/join/BLUE-WOLF-042` in a browser. Verify: the room code renders as 11 staggered letter tiles grouped `BLUE` / `WOLF` / `042`; typing in the name field updates the `{n}/24` caption live; the submit button is disabled/muted until text is entered, then turns `exit-red`; the stub panel's "ADMIT ONE" reads vertically on desktop width and horizontally when the viewport is narrowed below `sm`.

- [ ] **Step 4: Commit**

```bash
git add app/join/[code]/page.tsx
git commit -m "feat: restyle join screen as split-flap ticket card"
```

---

### Task 4: Harden e2e locators for the join screen

**Files:**
- Modify: `e2e/authorization.spec.ts:19-20`
- Modify: `e2e/kicked.spec.ts:19-20,61-62`
- Modify: `e2e/match.spec.ts:22-23`
- Modify: `e2e/reconnect.spec.ts:20-21`
- Modify: `e2e/exhaustion.spec.ts:22-23`
- Modify: `e2e/exclusion.spec.ts:27-28,35-36`

**Design notes:** all 8 call sites currently do `page.fill('input[placeholder="Your name"]', <name>)` then `page.click('text=Join')`. Task 3 changed both the placeholder text and the button text, so every one of these breaks without this task — this mirrors Box office's own Task 9 locator-hardening precedent (testid-based selectors survive copy changes; placeholder/text selectors don't).

**Interfaces:**
- Consumes: `data-testid="join-name-input"` and `data-testid="join-submit"` from Task 3.
- Produces: nothing new — this is a pure selector swap, same runtime behavior.

- [ ] **Step 1: Replace all 8 call sites**

In each of the 6 files, replace this pattern (same two lines, only the page variable name and the fill value differ per call site):

```ts
await guestPage.fill('input[placeholder="Your name"]', 'Guest')
await guestPage.click('text=Join')
```

with:

```ts
await guestPage.getByTestId('join-name-input').fill('Guest')
await guestPage.getByTestId('join-submit').click()
```

Concretely:
- `e2e/authorization.spec.ts:19-20` — `guestPage`, `'Guest'`
- `e2e/kicked.spec.ts:19-20` — `guestPage`, `'Guest'`
- `e2e/kicked.spec.ts:61-62` — `guestPage`, `'Guest'`
- `e2e/match.spec.ts:22-23` — `guestPage`, `'Guest'`
- `e2e/reconnect.spec.ts:20-21` — `guestPage`, `'Guest'`
- `e2e/exhaustion.spec.ts:22-23` — `guestPage`, `'Guest'`
- `e2e/exclusion.spec.ts:27-28` — `stayingGuestPage`, `'Staying Guest'`
- `e2e/exclusion.spec.ts:35-36` — `guestPage`, `'Disconnecting Guest'`

(Keep each file's own page-variable name and fill value — only the two lines' selector strategy changes.)

- [ ] **Step 2: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: PASS — 28/28 (all tests that navigate through `/join/[code]` now use the hardened selectors against the Task 3 markup)

- [ ] **Step 3: Commit**

```bash
git add e2e/authorization.spec.ts e2e/kicked.spec.ts e2e/match.spec.ts e2e/reconnect.spec.ts e2e/exhaustion.spec.ts e2e/exclusion.spec.ts
git commit -m "test: harden join-screen e2e locators to data-testid"
```

---

## Final Verification

Run `npm run verify` (typecheck + build + vitest) followed by `npm run test:e2e` — both must be green before this plan is considered done.
