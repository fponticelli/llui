import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Vitest doesn't go through `@llui/vite-plugin`'s `define` step, so
  // the build-time `__LLUI_AGENT__` flag would be `undefined` at
  // runtime — runtime guards treat that as "agent off". Force-substitute
  // it to `true` here so binding-descriptors tests can exercise the
  // agent-active path. Production bundles via vite-plugin substitute
  // the flag based on the consumer's `agent: …` option.
  define: {
    __LLUI_AGENT__: 'true',
    __LLUI_TRANSITIONS__: 'true',
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types.ts', 'src/structural.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
  bench: {
    include: ['test/**/*.bench.ts'],
    environment: 'jsdom',
  },
})
