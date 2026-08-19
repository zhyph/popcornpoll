# Contributing

## Setup

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
```

## Before opening a PR

```bash
npm run typecheck
npm run build
npm test
npm run test:e2e
```

`npm run verify` runs typecheck + build + unit tests in one shot (not e2e —
that needs Playwright's browsers, installed separately via
`npx playwright install --with-deps chromium`). CI runs all of the above on
every PR; a green run locally is the fast way to avoid red CI.

## Conventions

- TypeScript, strict mode. No `any` without a comment explaining why it's
  unavoidable.
- New UI copy goes into **both** `messages/en-us.json` and
  `messages/pt-br.json` in the same PR — `messages/messages.test.ts` fails
  the whole suite if the two files' key sets diverge.
- Tailwind classes are literal strings, never template-interpolated
  (`` `border-${accent}` ``) — the JIT scanner can't see through
  interpolation and will silently drop the class. Use a lookup object of
  literal classes instead (see `components/EdgeState.tsx` for the pattern).
- Prefer small, focused PRs. If a review turns up adjacent, in-scope
  follow-up work, it's fine to fold it into the same PR with a note in the
  description rather than opening a new issue for it.

## Reporting bugs / requesting features

Use the issue templates — they ask for the environment details (Docker vs.
`npm run dev`, image tag/commit, browser) needed to reproduce anything
UI- or WebSocket-related.
