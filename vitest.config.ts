import { transformSync } from 'esbuild'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      name: 'jsx-loader',
      transform(code, id) {
        if (id.endsWith('.tsx')) {
          const result = transformSync(code, {
            loader: 'tsx',
            jsx: 'automatic',
            format: 'esm',
          })
          return { code: result.code }
        }
      },
    },
  ],
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
