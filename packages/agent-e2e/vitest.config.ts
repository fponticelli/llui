import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,  // serve from one browser to keep things simple
  },
})
