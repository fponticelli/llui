import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      // Cross-file / cross-package tests spin up real TypeScript programs
      // (Compiler API) and resolve manifests — genuinely CPU-heavy work that
      // runs 5–6s on a fast machine and longer on a CPU-starved parallel CI
      // runner, where the default 5s timeout flaked them. Give heavy compiler
      // tests headroom; fast tests are unaffected.
      testTimeout: 30000,
    },
  }),
)
