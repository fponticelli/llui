import { createRingBuffer, type RingBuffer } from './each-diff.js'

/**
 * Dev-only disposer log entry, emitted once per `disposeScope` call
 * when the owning component instance has an `_disposerLog` ring buffer
 * installed by `installDevTools`.
 *
 * `cause` is set by the structural primitive (each / branch / child)
 * immediately before calling `disposeScope`. When no cause was
 * explicitly set, `disposeScope` falls back to `'component-unmount'`.
 * `'app-unmount'` is reserved for the top-level `mountApp` teardown.
 *
 * Used by the `llui_disposer_log` MCP tool to diagnose leaks on
 * structural transitions (e.g., branch swap that fails to release a
 * subscription registered in the old arm).
 */
export interface DisposerEvent {
  scopeId: string
  cause:
    | 'branch-swap'
    | 'each-remove'
    | 'show-hide'
    | 'child-unmount'
    | 'app-unmount'
    | 'component-unmount'
  timestamp: number
}

export { createRingBuffer, type RingBuffer }
