import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
  bench: {
    include: ['test/**/*.bench.ts'],
    environment: 'jsdom',
  },
})
