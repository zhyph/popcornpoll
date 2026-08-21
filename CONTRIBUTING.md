# Contributing

## Setup

```bash
npm install
cp .env.example .env   # fill in the values
npm run dev
```

### Throwaway instance

`npm run dev` uses `DATA_DIR` from your environment, which normally means the
`./data` you keep a real Plex link and a synced library in. For anything you
would rather not do to that database — poking at a half-finished migration,
resyncing against a different Plex server, filling up match history while
testing a flow — run against a scratch directory instead:

```bash
npm run dev:sandbox     # same as dev, against ./data-sandbox
npm run start:sandbox   # next build, then production mode, against ./data-sandbox
npm run sandbox:reset   # delete it and start clean
```

`start:sandbox` runs `next build` first on purpose: with `NODE_ENV=production`
the server calls `next({dev: false})`, which throws "Could not find a
production build" if `.next` holds nothing but dev output.

Both set `DATA_DIR` inline, so they override an exported one rather than
losing to it. `./data-sandbox` is gitignored. The first run starts from an
empty database, so you will need to link Plex again inside it.

The Playwright suite already has its own isolation and needs none of this: see
`playwright.config.ts`, which points `DATA_DIR` at `test-results/e2e-data`,
wipes it before every run, and serves on port 3100.

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
