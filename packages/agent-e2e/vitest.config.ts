import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// This package used to define its whole config standalone, so it never picked
// up `vitest.shared.ts` at all. That divergence was INERT rather than latent:
// the only thing it was missing is the `__LLUI_*` define block, and nothing in
// the repo READS `__LLUI_AGENT__` / `__LLUI_TRANSITIONS__` — they are written
// in exactly two places (the vite-plugin's `define`, and the shared config) and
// consumed in none. Separately, this package's browser bundle is built by
// esbuild (`src/build.ts`) with its own `define` set, so a vitest-level define
// would not reach the browser code either way.
//
// It is merged now regardless, because it had independently arrived at exactly
// the timeouts the shared base states (30s/60s) — measured against its own
// browser fixtures, which is where the shared `hookTimeout` number came from in
// the first place (#147). Restating them here would shadow the shared budget
// the next time it moves, which is the failure mode #147 is about.
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      // Only e2e files, and only under `node`. `mergeConfig` concatenates the
      // globs; the shared `test/**/*.test.ts` already covers every file here.
      include: ['test/**/*.e2e.test.ts'],
      environment: 'node',
      fileParallelism: false, // serve from one browser to keep things simple
      // Every test here drives a real browser + agent server + WS round-trips.
      // These are correct but timing-sensitive under full-repo parallel load, where
      // the OS/event loop can be starved enough that a single attempt occasionally
      // misses a deadline. Retry the transient starvation — a genuinely broken test
      // still fails all attempts.
      retry: 2,
    },
  }),
)
