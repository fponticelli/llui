import { defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// Do not use mergeConfig here: it concatenates `test.include`, which would make
// this command run the whole normal suite before the stress file. Preserve the
// shared defines/reporters/hooks explicitly, then replace discovery and the
// per-test budget only for this dedicated runner.
export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    environment: 'node',
    // Deep accumulated histories intentionally exercise upstream Loro import
    // costs that cannot fit the normal workspace's 30-second PR budget. Keep
    // the larger suite policy here: the default package config still inherits
    // the shared budget unchanged, and individual stress tests cannot override
    // this contract locally.
    include: ['test/stress/**/*.stress.ts'],
    testTimeout: 180_000,
  },
})
