import { mergeConfig, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import shared from '../../vitest.shared'

// Unit tests run the shell's pure model and the path-document glue in jsdom.
// The registry scenario renderers compile against the `@/` alias a consumer
// project has (see tsconfig.json); tests resolve it to registry SOURCE, the
// builds to the registry-demo copies.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'jsdom',
      // Two files BUILD the gallery and one boots its dev server; run in
      // parallel they contend for the same CPU and the dev server's first
      // compile of a document can outlast its wait. The unit files are fast,
      // so serial costs little and keeps the browser suites honest.
      fileParallelism: false,
    },
    resolve: {
      alias: {
        '@/lib': resolve(import.meta.dirname, '../../registry/llui/lib'),
        '@/ui': resolve(import.meta.dirname, '../../registry/llui/ui'),
      },
    },
  }),
)
