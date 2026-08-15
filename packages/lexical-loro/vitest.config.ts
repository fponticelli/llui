import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'node',
      // This package's convergence/fuzz suites replay hundreds of operations
      // across three peers with full Loro doc exchanges — legitimately heavy,
      // ~2s locally and longer under full-workspace parallel load. The timeout
      // that absorbs that now lives in `vitest.shared.ts` for every package at
      // once (#147); restating it here would shadow the shared budget.
    },
  }),
)
