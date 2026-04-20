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

type ConnectBag = {
  root: { 'data-scope': string }
  list: { 'data-part': string; 'data-count': number }
  entryItem: (id: string) => { 'data-part': string; 'data-id': string; 'data-kind': string } | null
  filterControls: {
    clearButton: { onClick: () => void; disabled: boolean }
    setFilter: (filter: AgentLogFilter) => void
  }
  /** Filtered view of entries — respects state.filter. */
  visibleEntries: LogEntry[]
}

export function connect<S>(
  get: (s: S) => AgentLogState,
  send: Send<AgentLogMsg>,
): (state: S) => ConnectBag {
  return (state) => {
    const s = get(state)
    const visible = s.entries.filter((e) => {
      if (s.filter.kinds && !s.filter.kinds.includes(e.kind)) return false
      if (s.filter.since !== undefined && e.at < s.filter.since) return false
      return true
    })
    return {
      root: { 'data-scope': 'agent-log' },
      list: { 'data-part': 'list', 'data-count': visible.length },
      entryItem: (id) => {
        const e = visible.find((x) => x.id === id)
        if (!e) return null
        return { 'data-part': 'entry', 'data-id': e.id, 'data-kind': e.kind }
      },
      filterControls: {
        clearButton: {
          onClick: () => send({ type: 'Clear' }),
          disabled: s.entries.length === 0,
        },
        setFilter: (filter) => send({ type: 'SetFilter', filter }),
      },
      visibleEntries: visible,
    }
  }
}
