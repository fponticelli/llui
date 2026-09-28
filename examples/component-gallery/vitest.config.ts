import { mergeConfig, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import shared from '../../vitest.shared'

const BROWSER_SUITES = 'test/**/*.browser.test.ts'
const aliases = {
  '@/lib': resolve(import.meta.dirname, '../../registry/llui/lib'),
  '@/ui': resolve(import.meta.dirname, '../../registry/llui/ui'),
}

// Two projects, ONE vitest run (so one duration report per package, #193):
//
//   unit     the shell's pure model and the path-document glue, in jsdom;
//   browser  real Chromium over the gallery, including the #268 gates. Its
//            `globalSetup` builds the three documents ONCE and serves them to
//            every browser suite (it runs only when a browser suite is
//            selected), instead of each suite paying for its own build.
//
// The registry scenario renderers compile against the `@/` alias a consumer
// project has (see tsconfig.json); tests resolve it to registry SOURCE, the
// builds to the registry-demo copies.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      // Files run one at a time: `build-graph` builds the gallery and
      // `dev-server` boots it, and either one contending with a browser suite
      // for the CPU stretches the other's waits. Throughput inside the gate
      // suites comes from `describe.concurrent` instead (bounded by
      // `maxConcurrency`), which shares one browser and one build.
      fileParallelism: false,
      maxConcurrency: 4,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'jsdom',
            exclude: [BROWSER_SUITES],
          },
        },
        {
          // NOT `extends: true`: extending MERGES, and `mergeConfig`
          // concatenates `test.include`, so the shared `test/**/*.test.ts`
          // would pull every unit file into this project too. Spread the
          // shared config instead (docs/agents/test-durations.md).
          ...shared,
          resolve: { alias: aliases },
          test: {
            ...shared.test,
            name: 'browser',
            environment: 'node',
            include: [BROWSER_SUITES],
            fileParallelism: false,
            maxConcurrency: 4,
            globalSetup: ['test/gates/global-setup.ts'],
          },
        },
      ],
    },
    resolve: { alias: aliases },
  }),
)
