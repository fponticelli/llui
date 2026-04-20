import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/client/agentLog.js'
import type { AgentLogState } from '../../src/client/agentLog.js'
import type { LogEntry } from '../../src/protocol.js'

// Inline fixtures
const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 'entry-1',
  at: 1_000_000,
  kind: 'dispatched',
  variant: 'SomeMsg',
  intent: 'Do something',
  ...overrides,
})

describe('agentLog: init', () => {
  it('returns empty entries, empty filter, and no effects', () => {
    const [state, effects] = init()
    expect(state).toEqual({ entries: [], filter: {} })
    expect(effects).toHaveLength(0)
  })
})

describe('agentLog: Append', () => {
  it('adds entry to entries list', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1, effects] = update(s0, { type: 'Append', entry })
    expect(s1.entries).toHaveLength(1)
    expect(s1.entries[0]).toEqual(entry)
    expect(effects).toHaveLength(0)
  })

  it('appends multiple entries preserving order', () => {
    const [s0] = init()
    const e1 = makeEntry({ id: 'a', at: 1_000 })
    const e2 = makeEntry({ id: 'b', at: 2_000 })
    const [s1] = update(s0, { type: 'Append', entry: e1 })
    const [s2] = update(s1, { type: 'Append', entry: e2 })
    expect(s2.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('ring-buffer cap: drops oldest entry when over maxEntries', () => {
    const [s0] = init({ maxEntries: 3 })
    const e1 = makeEntry({ id: 'e1', at: 1_000 })
    const e2 = makeEntry({ id: 'e2', at: 2_000 })
    const e3 = makeEntry({ id: 'e3', at: 3_000 })
    const e4 = makeEntry({ id: 'e4', at: 4_000 })
    const [s1] = update(s0, { type: 'Append', entry: e1 }, { maxEntries: 3 })
    const [s2] = update(s1, { type: 'Append', entry: e2 }, { maxEntries: 3 })
    const [s3] = update(s2, { type: 'Append', entry: e3 }, { maxEntries: 3 })
    const [s4] = update(s3, { type: 'Append', entry: e4 }, { maxEntries: 3 })
    // e1 should be dropped; e2, e3, e4 remain
    expect(s4.entries.map((e) => e.id)).toEqual(['e2', 'e3', 'e4'])
  })

  it('ring-buffer cap: default 100 entries retained', () => {
    let state = init()[0]
    for (let i = 0; i < 100; i++) {
      ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: `e${i}`, at: i }) })
    }
    expect(state.entries).toHaveLength(100)
    // Adding one more drops the first
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'e100', at: 100 }) })
    expect(state.entries).toHaveLength(100)
    expect(state.entries[0]?.id).toBe('e1')
  })
})

describe('agentLog: Clear', () => {
  it('empties entries list and emits no effects', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'Append', entry: makeEntry({ id: 'e1' }) })
    const [s2, effects] = update(s1, { type: 'Clear' })
    expect(s2.entries).toHaveLength(0)
    expect(effects).toHaveLength(0)
  })
})

describe('agentLog: SetFilter', () => {
  it('updates filter and emits no effects', () => {
    const [s0] = init()
    const [s1, effects] = update(s0, { type: 'SetFilter', filter: { kinds: ['dispatched'] } })
    expect(s1.filter).toEqual({ kinds: ['dispatched'] })
    expect(effects).toHaveLength(0)
  })
})

describe('agentLog: filtering via visibleEntries (connect)', () => {
  const buildBag = (state: AgentLogState, send = vi.fn()) => {
    const connector = connect<AgentLogState>((s) => s, send)
    return { bag: connector(state), send }
  }

  it('SetFilter by kinds — other kinds excluded from visibleEntries', () => {
    let state = init()[0]
    ;[state] = update(state, {
      type: 'Append',
      entry: makeEntry({ id: 'e1', kind: 'dispatched' }),
    })
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'e2', kind: 'proposed' }) })
    ;[state] = update(state, { type: 'SetFilter', filter: { kinds: ['dispatched'] } })
    const { bag } = buildBag(state)
    expect(bag.visibleEntries.map((e) => e.id)).toEqual(['e1'])
  })

  it('SetFilter by since — entries before ts excluded from visibleEntries', () => {
    let state = init()[0]
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'old', at: 999 }) })
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'new', at: 2_000 }) })
    ;[state] = update(state, { type: 'SetFilter', filter: { since: 1_000 } })
    const { bag } = buildBag(state)
    expect(bag.visibleEntries.map((e) => e.id)).toEqual(['new'])
  })

  it('list.data-count reflects visible count not raw count', () => {
    let state = init()[0]
    ;[state] = update(state, {
      type: 'Append',
      entry: makeEntry({ id: 'e1', kind: 'dispatched' }),
    })
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'e2', kind: 'proposed' }) })
    ;[state] = update(state, { type: 'SetFilter', filter: { kinds: ['dispatched'] } })
    const { bag } = buildBag(state)
    expect(bag.list['data-count']).toBe(1)
  })

  it('entryItem(id) returns null for id not in visible', () => {
    let state = init()[0]
    ;[state] = update(state, {
      type: 'Append',
      entry: makeEntry({ id: 'e1', kind: 'dispatched' }),
    })
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'e2', kind: 'proposed' }) })
    ;[state] = update(state, { type: 'SetFilter', filter: { kinds: ['dispatched'] } })
    const { bag } = buildBag(state)
    // e2 is filtered out → not in visible
    expect(bag.entryItem('e2')).toBeNull()
  })

  it('entryItem(id) returns entry bag for visible entry', () => {
    let state = init()[0]
    ;[state] = update(state, {
      type: 'Append',
      entry: makeEntry({ id: 'e1', kind: 'dispatched' }),
    })
    const { bag } = buildBag(state)
    const item = bag.entryItem('e1')
    expect(item).not.toBeNull()
    expect(item!['data-id']).toBe('e1')
    expect(item!['data-kind']).toBe('dispatched')
  })

  it('filterControls.clearButton.disabled when entries is empty', () => {
    const [s0] = init()
    const { bag } = buildBag(s0)
    expect(bag.filterControls.clearButton.disabled).toBe(true)
  })

  it('filterControls.clearButton.disabled is false when entries exist', () => {
    let state = init()[0]
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'e1' }) })
    const { bag } = buildBag(state)
    expect(bag.filterControls.clearButton.disabled).toBe(false)
  })

  it('filterControls.clearButton.onClick dispatches Clear', () => {
    let state = init()[0]
    ;[state] = update(state, { type: 'Append', entry: makeEntry({ id: 'e1' }) })
    const { bag, send } = buildBag(state)
    bag.filterControls.clearButton.onClick()
    expect(send).toHaveBeenCalledWith({ type: 'Clear' })
  })

  it('filterControls.setFilter dispatches SetFilter', () => {
    const [s0] = init()
    const { bag, send } = buildBag(s0)
    bag.filterControls.setFilter({ kinds: ['error'] })
    expect(send).toHaveBeenCalledWith({ type: 'SetFilter', filter: { kinds: ['error'] } })
  })
})
