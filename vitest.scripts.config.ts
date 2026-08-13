import { defineConfig } from 'vitest/config'

// Tests for the repo's own tooling under `scripts/`. These live outside the
// workspace packages (the root is not a pnpm workspace member), so `turbo run
// test` cannot see them — the root `test:scripts` script runs this config, and
// `pnpm verify` calls it.
export default defineConfig({
  test: {
    include: ['scripts/test/**/*.test.ts'],
  },
})
