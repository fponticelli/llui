import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
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
  }),
)
