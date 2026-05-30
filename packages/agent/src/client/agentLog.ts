import type { AgentEffect } from './effects.js'
import type { LogEntry, LogKind } from '../protocol.js'
import type { StateDiff } from '../state-diff.js'

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
import { tagSend, type Send, type Signal } from '@llui/dom'

/**
 * Static prop bag with reactive (Signal-handle) values. See
 * agentConnect.ts for the rationale.
 *
 * `visibleEntries` is exposed as a Signal handle of the filtered entry
 * list — pass it to `each` directly:
 *   each(bag.visibleEntries, { key, render })
 */
export type ConnectBag = {
  root: { 'data-scope': 'agent-log' }
  list: { 'data-part': 'list'; 'data-count': Signal<number> }
  entryItem: (id: string) => {
    'data-part': 'entry'
    'data-id': string
    'data-kind': Signal<LogKind | 'missing'>
  }
  filterControls: {
    clearButton: { onClick: () => void; disabled: Signal<boolean> }
    setFilter: (filter: AgentLogFilter) => void
  }
  /** Filtered view of entries — respects state.filter. */
  visibleEntries: Signal<readonly LogEntry[]>
  /**
   * Reactive (Signal) value for an entry's structural diff (JSON-Patch).
   * Resolves to the entry's `stateDiff` when present, `null` otherwise —
   * `null` covers three distinct cases: the entry exists but its kind
   * (read / proposed / etc.) doesn't carry a diff; the entry was filtered
   * out; the entry was evicted by the ring-buffer or never appended.
   * Hosts that render a per-entry "what changed" sidecar wire this to
   * a structural primitive (`branch`, `each`) so the sidecar disposes
   * cleanly when the entry leaves.
   *
   * Lookup is over `state.entries` directly (NOT through the filter)
   * — a hidden-by-filter entry still has its diff available, which is
   * what consumers expect when reading from a sidecar that may outlive
   * the visibility filter.
   */
  entryDiff: (id: string) => Signal<StateDiff | null>
}

function filterEntries(s: AgentLogState): readonly LogEntry[] {
  return s.entries.filter((e) => {
    if (s.filter.kinds && !s.filter.kinds.includes(e.kind)) return false
    if (s.filter.since !== undefined && e.at < s.filter.since) return false
    return true
  })
}

export function connect(state: Signal<AgentLogState>, send: Send<AgentLogMsg>): ConnectBag {
  // A single derived handle for the filtered list; reused by the
  // per-item lookups below so the filter logic lives in one place.
  const visible = state.map(filterEntries)

  // Per-id derived-signal cache. The `each(bag.visibleEntries)` pattern
  // calls `bag.entryDiff(entry.id)` once per row at view-construction —
  // caching keeps each row's handle stable across re-renders, so the
  // underlying binding short-circuits when state hasn't changed.
  const diffSignalCache = new Map<string, Signal<StateDiff | null>>()
  const kindSignalCache = new Map<string, Signal<LogKind | 'missing'>>()

  return {
    root: { 'data-scope': 'agent-log' },
    list: {
      'data-part': 'list',
      'data-count': visible.map((entries) => entries.length),
    },
    entryItem: (id) => ({
      'data-part': 'entry',
      'data-id': id,
      'data-kind': (() => {
        const cached = kindSignalCache.get(id)
        if (cached) return cached
        const handle = state.map(
          (s): LogKind | 'missing' => filterEntries(s).find((x) => x.id === id)?.kind ?? 'missing',
        )
        kindSignalCache.set(id, handle)
        return handle
      })(),
    }),
    filterControls: {
      clearButton: {
        onClick: tagSend(send, ['Clear'], () => send({ type: 'Clear' })),
        disabled: state.map((s) => s.entries.length === 0),
      },
      setFilter: (filter) => send({ type: 'SetFilter', filter }),
    },
    visibleEntries: visible,
    entryDiff: (id) => {
      const cached = diffSignalCache.get(id)
      if (cached) return cached
      const handle = state.map(
        (s): StateDiff | null => s.entries.find((x) => x.id === id)?.stateDiff ?? null,
      )
      diffSignalCache.set(id, handle)
      return handle
    },
  }
}
