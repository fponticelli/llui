import type { AgentEffect } from './effects.js'
import type { LogEntry, LogKind } from '../protocol.js'

export type AgentLogFilter = { kinds?: LogKind[]; since?: number }

export type AgentLogState = {
  entries: LogEntry[]
  filter: AgentLogFilter
}

export type AgentLogInitOpts = { maxEntries?: number } // default 100

export type AgentLogMsg =
  /**
   * @humanOnly — internal: WS frame router dispatches this on every
   * `log-append` frame from the runtime. Agents observe the log via
   * the LAP read surface, not by emitting Append themselves.
   */
  | { type: 'Append'; entry: LogEntry }
  /** @intent("Clear the agent activity log") */
  | { type: 'Clear' }
  /** @intent("Set the visibility filter for the agent log") */
  | { type: 'SetFilter'; filter: AgentLogFilter }

const DEFAULT_MAX = 100

export function init(_opts: AgentLogInitOpts = {}): [AgentLogState, AgentEffect[]] {
  return [{ entries: [], filter: {} }, []]
}

export function update(
  state: AgentLogState,
  msg: AgentLogMsg,
  opts: AgentLogInitOpts = {},
): [AgentLogState, AgentEffect[]] {
  const max = opts.maxEntries ?? DEFAULT_MAX
  switch (msg.type) {
    case 'Append': {
      const next = [...state.entries, msg.entry]
      // Ring-buffer cap
      if (next.length > max) next.splice(0, next.length - max)
      return [{ ...state, entries: next }, []]
    }
    case 'Clear':
      return [{ ...state, entries: [] }, []]
    case 'SetFilter':
      return [{ ...state, filter: msg.filter }, []]
  }
}

// Connect bag:
import { type Send } from '@llui/dom'

// Sentinel for the memoization slot — distinguishable from any
// possible parent state value (including null/undefined).
const UNSET: unique symbol = Symbol('agent-log-visible-unset')

/**
 * Static prop bag with reactive accessors. See agentConnect.ts for
 * the rationale.
 *
 * `visibleEntries` is exposed as a reactive accessor returning the
 * filtered entry list — pass it to `each` directly:
 *   each(bag.visibleEntries, (e) => …)
 */
export type ConnectBag<S> = {
  root: { 'data-scope': 'agent-log' }
  list: { 'data-part': 'list'; 'data-count': (s: S) => number }
  entryItem: (id: string) => {
    'data-part': 'entry'
    'data-id': string
    'data-kind': (s: S) => LogKind | 'missing'
  }
  filterControls: {
    clearButton: { onClick: () => void; disabled: (s: S) => boolean }
    setFilter: (filter: AgentLogFilter) => void
  }
  /** Filtered view of entries — respects state.filter. */
  visibleEntries: (s: S) => LogEntry[]
}

export function connect<S>(get: (s: S) => AgentLogState, send: Send<AgentLogMsg>): ConnectBag<S> {
  // Memoize the filter result by parent-state reference. Each render
  // pass typically calls `visibleEntries`, `list['data-count']`, and
  // every `entryItem(id)['data-kind']` — without this, an `each` loop
  // over visibleEntries triggers O(n) filter recomputes per item.
  // Parent state is immutable (TEA), so reference equality is enough.
  // Using a single-slot cache rather than a WeakMap because consumers
  // call from a hot path and a single recent state covers >99% of hits.
  let lastState: S | typeof UNSET = UNSET
  let lastResult: LogEntry[] = []
  const visible = (state: S): LogEntry[] => {
    if (state === lastState) return lastResult
    const s = get(state)
    lastResult = s.entries.filter((e) => {
      if (s.filter.kinds && !s.filter.kinds.includes(e.kind)) return false
      if (s.filter.since !== undefined && e.at < s.filter.since) return false
      return true
    })
    lastState = state
    return lastResult
  }
  const findVisible = (state: S, id: string): LogEntry | undefined =>
    visible(state).find((x) => x.id === id)

  return {
    root: { 'data-scope': 'agent-log' },
    list: {
      'data-part': 'list',
      'data-count': (s) => visible(s).length,
    },
    entryItem: (id) => ({
      'data-part': 'entry',
      'data-id': id,
      'data-kind': (s) => findVisible(s, id)?.kind ?? 'missing',
    }),
    filterControls: {
      clearButton: {
        onClick: () => send({ type: 'Clear' }),
        disabled: (s) => get(s).entries.length === 0,
      },
      setFilter: (filter) => send({ type: 'SetFilter', filter }),
    },
    visibleEntries: visible,
  }
}
