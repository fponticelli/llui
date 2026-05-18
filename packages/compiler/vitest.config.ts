import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Engine tests land in v2c module-mapping work; for v2a, the engine is
    // proven by the existing vite-plugin/eslint-plugin test suites.
    passWithNoTests: true,
  },
})
