import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Engine tests land in v2c module-mapping work; for v2a, the engine is
    // proven by the existing vite-plugin/eslint-plugin test suites.
    passWithNoTests: true,
    // Registers the introspection factory (v2c/decomp-26) so tests
    // that exercise agent-metadata emission run with the same module
    // set as production.
    setupFiles: ['./vitest.setup.ts'],
  },
})
