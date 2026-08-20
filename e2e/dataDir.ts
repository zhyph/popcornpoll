// e2e/dataDir.ts
import { fileURLToPath } from 'node:url'

// Where the e2e server keeps its SQLite file. Shared by playwright.config.ts
// (which passes it to the server as DATA_DIR, and wipes it before each run)
// and by the specs that reach into that database directly — they must open
// the *same* file the server is using, and must never fall back to
// server/config.ts's './data' default, which is the developer's own instance.
//
// Absolute, resolved from this file rather than from a relative path: the
// webServer's cwd is the config's directory, while test workers inherit the
// cwd of whatever shell launched `playwright test`. A relative path would
// resolve differently in the two — and better-sqlite3 silently *creates* a
// database at a missing path, so the mismatch would surface as a baffling
// "no such table: movies" rather than as a missing file.
export const E2E_DATA_DIR = fileURLToPath(new URL('../test-results/e2e-data', import.meta.url))
