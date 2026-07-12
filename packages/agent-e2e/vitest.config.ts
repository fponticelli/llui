import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // Setup/teardown launch a real headless Chromium and bootstrap the app; under
    // full-repo parallel `turbo test` load that can be slow but correct, so give
    // hooks generous headroom (the flake was a starved browser launch, not a hang).
    hookTimeout: 60_000,
    fileParallelism: false, // serve from one browser to keep things simple
    // Every test here drives a real browser + agent server + WS round-trips.
    // These are correct but timing-sensitive under full-repo parallel load, where
    // the OS/event loop can be starved enough that a single attempt occasionally
    // misses a deadline. Retry the transient starvation — a genuinely broken test
    // still fails all attempts.
    retry: 2,
  },
})
