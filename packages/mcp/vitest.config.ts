import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      // E2E test mounts a real component via mountApp which needs DOM globals.
      // Other tests don't depend on DOM but jsdom is harmless for them.
      environment: 'jsdom',
      // Point the MCP handshake state (marker + HTTP token) at a private
      // per-worker directory instead of the workspace-rooted default, so two
      // concurrent runs of this suite on one machine cannot stomp each
      // other's `active.json` (issue #85).
      setupFiles: ['./test/support/state-dir.ts'],
      // Test files still share a worker (and therefore a state directory)
      // when run sequentially, and several spawn a real browser or Vite
      // server — keep them serialized so the marker handoff each one
      // asserts on is not interleaved with another file's.
      fileParallelism: false,
    },
  }),
)
