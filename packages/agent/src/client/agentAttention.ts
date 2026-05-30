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

import { type Send, type Signal } from '@llui/dom'

type RegionAction = {
  entryId: string
  variant?: string
  intent?: string
  at: number
} | null

export type ConnectBag = {
  root: { 'data-scope': 'agent-attention' }
  /**
   * Reactive boolean signal: true while the spotlight covers `path`.
   * Use as the predicate for a conditional class binding in the host's
   * own element bag. Cached by `path` so each `flashing(path)` call
   * returns the same handle across renders, keeping the underlying
   * binding's short-circuit valid.
   */
  flashing: (path: string) => Signal<boolean>
  /**
   * Convenience signal: resolves to `className` (default `'agent-flash'`)
   * while flashing, otherwise `undefined`. Spread into element bags
   * via `class: bag.flashClass('items')`. Cached per `(path, className)`
   * pair.
   */
  flashClass: (path: string, className?: string) => Signal<string | undefined>
  /**
   * Metadata about the action that touched this path, or null when
   * the spotlight isn't on this path. Useful for tooltips or aria-live
   * narration: "agent → SelectAlternative just changed alternatives."
   * Cached per `path`.
   */
  regionAction: (path: string) => Signal<RegionAction>
  /**
   * Direct signal on the latest dispatch envelope. Useful for a
   * single panel-level "now flashing: X" indicator outside the
   * per-region instrumentation.
   */
  latestDispatch: Signal<AgentAttentionState['latestDispatch']>
}

export function connect(
  state: Signal<AgentAttentionState>,
  _send: Send<AgentAttentionMsg>,
): ConnectBag {
  // Per-call-shape derived-signal caches. Caching by `(path, className)`
  // keeps the handle reference stable so the underlying LLui binding
  // short-circuits — without it, `bag.flashing('items')` would allocate
  // a fresh handle each call. Hosts also iterate these in tight inner
  // loops, where per-render allocation costs would compound.
  const flashingCache = new Map<string, Signal<boolean>>()
  const flashClassCache = new Map<string, Signal<string | undefined>>()
  const regionActionCache = new Map<string, Signal<RegionAction>>()

  const matches = (s: AgentAttentionState, path: string): boolean => {
    const d = s.latestDispatch
    if (!d) return false
    return d.paths.includes('*') || d.paths.includes(path)
  }

  return {
    root: { 'data-scope': 'agent-attention' },
    flashing: (path) => {
      const cached = flashingCache.get(path)
      if (cached) return cached
      const handle = state.map((s) => matches(s, path))
      flashingCache.set(path, handle)
      return handle
    },
    flashClass: (path, className = 'agent-flash') => {
      const key = `${path}\0${className}`
      const cached = flashClassCache.get(key)
      if (cached) return cached
      const handle = state.map((s) => (matches(s, path) ? className : undefined))
      flashClassCache.set(key, handle)
      return handle
    },
    regionAction: (path) => {
      const cached = regionActionCache.get(path)
      if (cached) return cached
      const handle = state.map((s): RegionAction => {
        const d = s.latestDispatch
        if (!d) return null
        if (!d.paths.includes('*') && !d.paths.includes(path)) return null
        return { entryId: d.entryId, variant: d.variant, intent: d.intent, at: d.at }
      })
      regionActionCache.set(path, handle)
      return handle
    },
    latestDispatch: state.map((s) => s.latestDispatch),
  }
}
