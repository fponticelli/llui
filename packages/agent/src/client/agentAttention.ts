import type { AgentEffect } from './effects.js'
import type { LogEntry } from '../protocol.js'
import type { StateDiff } from '../state-diff.js'

/**
 * Visual attention layer. Companion to `agentLog` — same `Append { entry }`
 * input shape, different output. While `agentLog` ring-buffers the full
 * activity history, `agentAttention` tracks only the most recent
 * dispatched entry's effective metadata so the host's view can flash
 * highlight classes onto DOM regions whose state paths just changed.
 *
 * Why a separate slice: the activity log is a passive timeline (read-only,
 * no time-bounded expiry, no per-region accessors). The attention layer
 * is a transient projection — the "current dispatch's spotlight" — that
 * has to clear itself after a configurable window, decay across renders,
 * and drive per-path accessors (one per highlightable region in the
 * host's layout). Mixing these into one slice would conflate "I want
 * to read past actions" with "I want to point at the current one."
 *
 * Composition contract: the host appends the SAME `LogEntry` payload
 * to both slices on every `log-append` from the ws-client (typically
 * via a single `agent/log/Append` Msg routed by `sliceHandler`). The
 * attention reducer ignores entries whose `kind` isn't `'dispatched'`
 * — proposed, blocked, error, and read entries don't update the
 * attention focus, since they don't represent a state mutation.
 *
 * Auto-clear: the reducer fires an `AgentAttentionFlashTimeout` effect
 * keyed by `entryId`. After `flashDurationMs`, the effect handler
 * dispatches a `Clear { entryId }` Msg back into the slice. The
 * conditional clear (only-if-current) means a fast follow-up dispatch
 * cleanly replaces the spotlight without the timer racing to wipe the
 * new one. Hosts that don't wire `wrapAttentionMsg` in the factory
 * still see the spotlight set; it just won't auto-clear (the next
 * dispatch overwrites it instead).
 */
export type AgentAttentionState = {
  /**
   * The current dispatch's spotlight, or null when no dispatch has
   * landed yet (or the auto-clear timer fired and `latestDispatch.entryId`
   * matched).
   */
  latestDispatch: {
    entryId: string
    /**
     * Top-level state paths the dispatch touched, derived from the
     * entry's JSON-Patch `stateDiff`. A whole-state replace (path
     * `/`) collapses to the wildcard `'*'` so callers can match every
     * region without enumerating their own state keys.
     */
    paths: string[]
    variant?: string
    intent?: string
    at: number
  } | null
  /** Configurable: how long the spotlight persists before auto-clear. */
  flashDurationMs: number
}

export type AgentAttentionInitOpts = {
  /** Default 600ms — long enough to read, short enough not to obscure. */
  flashDurationMs?: number
}

export type AgentAttentionMsg =
  | {
      /**
       * Same shape as `agentLog`'s `Append` so the host can route a
       * single incoming Msg to both slices via `sliceHandler` without
       * a translation layer.
       */
      type: 'Append'
      entry: LogEntry
    }
  | {
      /**
       * Fired by the auto-clear timer effect. Guarded by `entryId` —
       * the reducer only clears when `latestDispatch.entryId` matches,
       * so a fast follow-up dispatch isn't wiped by the previous
       * dispatch's pending timer.
       */
      type: 'Clear'
      entryId: string
    }
  | {
      /**
       * Adjust the flash duration at runtime. Persists in state so
       * subsequent timeouts use the new value. Existing in-flight
       * timers are not cancelled — they'll fire at their original
       * delay, and the conditional clear handles the race.
       */
      type: 'SetFlashDuration'
      ms: number
    }

const DEFAULT_FLASH_MS = 600

export function init(opts: AgentAttentionInitOpts = {}): [AgentAttentionState, AgentEffect[]] {
  return [
    {
      latestDispatch: null,
      flashDurationMs: opts.flashDurationMs ?? DEFAULT_FLASH_MS,
    },
    [],
  ]
}

export function update(
  state: AgentAttentionState,
  msg: AgentAttentionMsg,
): [AgentAttentionState, AgentEffect[]] {
  switch (msg.type) {
    case 'Append': {
      const entry = msg.entry
      // Only dispatched entries update the spotlight. Read / proposed /
      // blocked / error / user-input entries don't represent a state
      // mutation, so the visual cue is meaningless for them.
      if (entry.kind !== 'dispatched') return [state, []]
      const paths = topLevelPaths(entry.stateDiff)
      // No diff (or empty diff) means the dispatch landed but nothing
      // changed — silent success. Skip the spotlight rather than
      // flashing nothing in particular.
      if (paths.length === 0) return [state, []]
      const next: AgentAttentionState = {
        ...state,
        latestDispatch: {
          entryId: entry.id,
          paths,
          variant: entry.variant,
          intent: entry.intent,
          at: entry.at,
        },
      }
      return [
        next,
        [{ type: 'AgentAttentionFlashTimeout', entryId: entry.id, delayMs: state.flashDurationMs }],
      ]
    }
    case 'Clear': {
      // Conditional clear: only wipe if the timer's entryId still
      // matches the current spotlight. If a newer dispatch landed in
      // the meantime, the older timer is a no-op.
      if (state.latestDispatch?.entryId !== msg.entryId) return [state, []]
      return [{ ...state, latestDispatch: null }, []]
    }
    case 'SetFlashDuration': {
      return [{ ...state, flashDurationMs: Math.max(0, msg.ms) }, []]
    }
  }
}

/**
 * Extract top-level state paths from a JSON-Patch StateDiff.
 *
 * - `op.path === '/'` (root replace) → wildcard `'*'`. The host's
 *   accessors match every region against `'*'`, so a whole-state
 *   swap (rare in TEA but possible via dev hot-reload, time-travel
 *   restore) flashes everything.
 * - `op.path === '/items/3/name'` → `'items'`. Multi-segment paths
 *   collapse to their top-level field; per-region matching is at
 *   field granularity, not deep-path granularity, because the host's
 *   layout typically maps regions to top-level state slices, not to
 *   deep cells.
 * - Empty / undefined diff → empty array. No spotlight.
 */
function topLevelPaths(diff: StateDiff | undefined): string[] {
  if (!diff || diff.length === 0) return []
  const seen = new Set<string>()
  for (const op of diff) {
    const path = op.path
    if (path === '' || path === '/') {
      seen.add('*')
      continue
    }
    // JSON-Pointer: leading '/' splits into ['', '<top>', '<rest>...'].
    const parts = path.split('/')
    if (parts.length >= 2 && parts[1]) seen.add(parts[1])
  }
  return Array.from(seen)
}

import type { Send } from '@llui/dom/signals'

const UNSET: unique symbol = Symbol('agent-attention-unset')

export type ConnectBag<S> = {
  root: { 'data-scope': 'agent-attention' }
  /**
   * Reactive boolean accessor: true while the spotlight covers `path`.
   * Use as the predicate for a conditional class binding in the host's
   * own element bag. Memoized by `path` so each `flashing(path)` call
   * returns the same accessor across renders, keeping the underlying
   * binding's `lastValue` short-circuit valid.
   */
  flashing: (path: string) => (s: S) => boolean
  /**
   * Convenience accessor: returns `className` (default `'agent-flash'`)
   * while flashing, otherwise `undefined`. Spread into element bags
   * via `class: bag.flashClass('items')`. Memoized per `(path, className)`
   * pair.
   */
  flashClass: (path: string, className?: string) => (s: S) => string | undefined
  /**
   * Metadata about the action that touched this path, or null when
   * the spotlight isn't on this path. Useful for tooltips or aria-live
   * narration: "agent → SelectAlternative just changed alternatives."
   * Memoized per `path`.
   */
  regionAction: (path: string) => (s: S) => {
    entryId: string
    variant?: string
    intent?: string
    at: number
  } | null
  /**
   * Direct accessor on the latest dispatch envelope. Useful for a
   * single panel-level "now flashing: X" indicator outside the
   * per-region instrumentation.
   */
  latestDispatch: (s: S) => AgentAttentionState['latestDispatch']
}

export function connect<S>(
  get: (s: S) => AgentAttentionState,
  _send: Send<AgentAttentionMsg>,
): ConnectBag<S> {
  // Per-call-shape accessor caches. Two reasons for memoizing:
  // 1. Stable reference per `(path, className)` lets the underlying
  //    LLui binding short-circuit on `Object.is(lastValue, newValue)`
  //    — without it, `bag.flashing('items')` would allocate a fresh
  //    closure each call and the binding would re-fire even when the
  //    state hasn't changed.
  // 2. Hosts iterate `each(visibleEntries, ...)` calling these in tight
  //    inner loops; per-render allocation costs would compound.
  const flashingCache = new Map<string, (s: S) => boolean>()
  const flashClassCache = new Map<string, (s: S) => string | undefined>()
  const regionActionCache = new Map<
    string,
    (s: S) => {
      entryId: string
      variant?: string
      intent?: string
      at: number
    } | null
  >()

  // Single-slot memo on the parent state ref for `flashing(path)`'s
  // path → boolean lookup. Hot path: each frame's view evaluates
  // every region's `flashing(path)` once; on a state where 30 regions
  // are wired and one is highlighted, the inclusion check is trivial,
  // but the parent-state-ref invariant still saves the `get(s)` and
  // `Array.includes` work for the other 29.
  let lastFlashState: S | typeof UNSET = UNSET
  let lastDispatch: AgentAttentionState['latestDispatch'] = null
  const refreshDispatch = (state: S): AgentAttentionState['latestDispatch'] => {
    if (state === lastFlashState) return lastDispatch
    lastDispatch = get(state).latestDispatch
    lastFlashState = state
    return lastDispatch
  }

  const matches = (state: S, path: string): boolean => {
    const d = refreshDispatch(state)
    if (!d) return false
    return d.paths.includes('*') || d.paths.includes(path)
  }

  return {
    root: { 'data-scope': 'agent-attention' },
    flashing: (path) => {
      const cached = flashingCache.get(path)
      if (cached) return cached
      const accessor = (s: S): boolean => matches(s, path)
      flashingCache.set(path, accessor)
      return accessor
    },
    flashClass: (path, className = 'agent-flash') => {
      const key = `${path}\0${className}`
      const cached = flashClassCache.get(key)
      if (cached) return cached
      const accessor = (s: S): string | undefined => (matches(s, path) ? className : undefined)
      flashClassCache.set(key, accessor)
      return accessor
    },
    regionAction: (path) => {
      const cached = regionActionCache.get(path)
      if (cached) return cached
      const accessor = (
        s: S,
      ): { entryId: string; variant?: string; intent?: string; at: number } | null => {
        const d = refreshDispatch(s)
        if (!d) return null
        if (!d.paths.includes('*') && !d.paths.includes(path)) return null
        return { entryId: d.entryId, variant: d.variant, intent: d.intent, at: d.at }
      }
      regionActionCache.set(path, accessor)
      return accessor
    },
    latestDispatch: (s) => get(s).latestDispatch,
  }
}
