import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'node',
      // This package's convergence/fuzz suites replay hundreds of operations
      // across three peers with full Loro doc exchanges — legitimately heavy.
      // The whole suite runs in ~2s locally, but under CI's parallel load (all
      // workspace packages testing at once on a shared runner) a single burst
      // test can exceed vitest's 5s default and time out. A generous ceiling
      // absorbs that starvation without weakening any test; a genuinely hung
      // test still fails.
      testTimeout: 30000,
    },
  }),
)
