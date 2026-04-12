import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // E2E test mounts a real component via mountApp which needs DOM globals.
    // Other tests don't depend on DOM but jsdom is harmless for them.
    environment: 'jsdom',
  },
})
