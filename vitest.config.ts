import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // '.claude/**' matters beyond the obvious: EnterWorktree checks worktrees
    // out under .claude/worktrees/, each with its own node_modules — without
    // this, a worktree left on disk during a `vitest run` gets its dependency
    // tree's own bundled test suites (e.g. zod's) picked up and run too.
    exclude: ['node_modules', 'dist', '.next', 'e2e/**', '.claude/**'],
  },
})
