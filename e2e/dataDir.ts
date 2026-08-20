// e2e/dataDir.ts
//
// Where the e2e server keeps its SQLite file. Shared by playwright.config.ts
// (which passes it to the server as DATA_DIR, and wipes it before each run)
// and by the specs that reach into that database directly — they must open
// the *same* file the server is using, and must never fall back to
// server/config.ts's './data' default, which is the developer's own instance.
export const E2E_DATA_DIR = 'test-results/e2e-data'
