import type { AgentEffect } from './effects.js'
import type { LogEntry, LogKind } from '../protocol.js'

export type AgentLogFilter = { kinds?: LogKind[]; since?: number }

export type AgentLogState = {
  entries: LogEntry[]
  filter: AgentLogFilter
}

export type AgentLogInitOpts = { maxEntries?: number } // default 100

export type AgentLogMsg =
  | { type: 'Append'; entry: LogEntry }
  | { type: 'Clear' }
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

export function connect<S>(
  get: (s: S) => AgentLogState,
  send: Send<AgentLogMsg>,
): ConnectBag<S> {
  const visible = (state: S): LogEntry[] => {
    const s = get(state)
    return s.entries.filter((e) => {
      if (s.filter.kinds && !s.filter.kinds.includes(e.kind)) return false
      if (s.filter.since !== undefined && e.at < s.filter.since) return false
      return true
    })
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
