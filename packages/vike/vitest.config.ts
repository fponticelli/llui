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
        reporter: ['text', 'lcov'],
        reportsDirectory: 'coverage',
      },
    },
  }),
)
