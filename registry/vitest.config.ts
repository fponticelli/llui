import { mergeConfig, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import shared from '../vitest.shared'

// The registry ships SOURCE, so its own modules import through the `@/` alias a
// consumer project will have. `check:registry` already compiles it in that
// shape; this mirrors the same alias at RUNTIME so a test can import the module
// exactly as a consumer's bundler will resolve it, rather than a repo-only
// variant that proves nothing about what ships.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'jsdom',
    },
    resolve: {
      alias: {
        '@/lib': resolve(import.meta.dirname, 'llui/lib'),
        '@/ui': resolve(import.meta.dirname, 'llui/ui'),
      },
    },
  }),
)
