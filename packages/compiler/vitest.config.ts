import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Cross-file / cross-package tests spin up real TypeScript programs
    // (Compiler API) and resolve manifests — genuinely CPU-heavy work that
    // runs 5–6s on a fast machine and longer on a CPU-starved parallel CI
    // runner, where the default 5s timeout flaked them. Give heavy compiler
    // tests headroom; fast tests are unaffected.
    testTimeout: 30000,
    // Engine tests land in v2c module-mapping work; for v2a, the engine is
    // proven by the existing vite-plugin/eslint-plugin test suites.
    passWithNoTests: true,
    // Registers the introspection factory (v2c/decomp-26) so tests
    // that exercise agent-metadata emission run with the same module
    // set as production.
    setupFiles: ['./vitest.setup.ts'],
  },
})
