import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    include: [resolve(import.meta.dirname, '*.test.ts')],
    environment: 'jsdom',
  },
})
