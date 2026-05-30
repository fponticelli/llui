import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, type AgentAttentionState } from '../../src/client/agentAttention.js'
import type { LogEntry } from '../../src/protocol.js'
import type { StateDiff } from '../../src/state-diff.js'
import { rootSignal, read } from './_signal.js'

const makeEntry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  id: 'e1',
  at: 1_000,
  kind: 'dispatched',
  variant: 'SetItem',
  intent: 'Set item',
  ...overrides,
})

const diff = (...ops: StateDiff): StateDiff => ops

describe('agentAttention: init', () => {
  it('returns empty spotlight + default flash duration of 600ms', () => {
    const [s, e] = init()
    expect(s.latestDispatch).toBeNull()
    expect(s.flashDurationMs).toBe(600)
    expect(e).toHaveLength(0)
  })

  it('honours opts.flashDurationMs', () => {
    const [s] = init({ flashDurationMs: 1200 })
    expect(s.flashDurationMs).toBe(1200)
  })
})

describe('agentAttention: Append', () => {
  it('sets latestDispatch with top-level paths from a dispatched entry with stateDiff', () => {
    const [s0] = init()
    const entry = makeEntry({
      id: 'e1',
      stateDiff: diff(
        { op: 'replace', path: '/items/3/name', value: 'X' },
        { op: 'add', path: '/cart/items/-', value: { id: 'a' } },
      ),
    })
    const [s1, effects] = update(s0, { type: 'Append', entry })
    expect(s1.latestDispatch).not.toBeNull()
    expect(s1.latestDispatch!.entryId).toBe('e1')
    // Order-insensitive — Set semantics
    expect(s1.latestDispatch!.paths.sort()).toEqual(['cart', 'items'])
    expect(s1.latestDispatch!.variant).toBe('SetItem')
    expect(s1.latestDispatch!.intent).toBe('Set item')
    expect(s1.latestDispatch!.at).toBe(1_000)
    // Auto-clear effect emitted with matching entryId + state's flash duration
    expect(effects).toEqual([{ type: 'AgentAttentionFlashTimeout', entryId: 'e1', delayMs: 600 }])
  })

  it("collapses a root-replace patch ('/' or '') to wildcard '*'", () => {
    const [s0] = init()
    const entry = makeEntry({
      stateDiff: diff({ op: 'replace', path: '/', value: { everything: 'new' } }),
    })
    const [s1] = update(s0, { type: 'Append', entry })
    expect(s1.latestDispatch!.paths).toEqual(['*'])
  })

  it('deduplicates multiple ops on the same top-level path', () => {
    const [s0] = init()
    const entry = makeEntry({
      stateDiff: diff(
        { op: 'replace', path: '/items/0', value: 'a' },
        { op: 'add', path: '/items/-', value: 'b' },
        { op: 'remove', path: '/items/3' },
      ),
    })
    const [s1] = update(s0, { type: 'Append', entry })
    expect(s1.latestDispatch!.paths).toEqual(['items'])
  })

  it('ignores non-dispatched kinds (read, proposed, blocked, error, user-input)', () => {
    const [s0] = init()
    const kinds: LogEntry['kind'][] = ['read', 'proposed', 'blocked', 'error', 'confirmed']
    for (const kind of kinds) {
      const entry = makeEntry({
        kind,
        stateDiff: diff({ op: 'replace', path: '/x', value: 1 }),
      })
      const [s1, effects] = update(s0, { type: 'Append', entry })
      expect(s1).toBe(s0) // no change
      expect(effects).toEqual([])
    }
  })

  it('skips silent dispatches (dispatched entry with no stateDiff or empty diff)', () => {
    const [s0] = init()
    const noDiff = makeEntry({ stateDiff: undefined })
    const empty = makeEntry({ id: 'e2', stateDiff: [] })
    const [s1] = update(s0, { type: 'Append', entry: noDiff })
    const [s2] = update(s0, { type: 'Append', entry: empty })
    expect(s1).toBe(s0)
    expect(s2).toBe(s0)
  })

  it('a fresh dispatch replaces a previous spotlight', () => {
    const [s0] = init()
    const e1 = makeEntry({
      id: 'e1',
      stateDiff: diff({ op: 'replace', path: '/a/b', value: 1 }),
    })
    const e2 = makeEntry({
      id: 'e2',
      stateDiff: diff({ op: 'replace', path: '/c', value: 2 }),
    })
    const [s1] = update(s0, { type: 'Append', entry: e1 })
    expect(s1.latestDispatch!.paths).toEqual(['a'])
    const [s2, effects] = update(s1, { type: 'Append', entry: e2 })
    expect(s2.latestDispatch!.entryId).toBe('e2')
    expect(s2.latestDispatch!.paths).toEqual(['c'])
    // Each Append emits its own timer; the previous one's timer eventually
    // fires and is no-op'd by the conditional Clear guard (tested below).
    expect(effects).toEqual([{ type: 'AgentAttentionFlashTimeout', entryId: 'e2', delayMs: 600 }])
  })
})

describe('agentAttention: Clear (auto-fire from timer)', () => {
  it('clears the spotlight when entryId matches', () => {
    const [s0] = init()
    const entry = makeEntry({
      id: 'e1',
      stateDiff: diff({ op: 'replace', path: '/x', value: 1 }),
    })
    const [s1] = update(s0, { type: 'Append', entry })
    expect(s1.latestDispatch).not.toBeNull()
    const [s2, effects] = update(s1, { type: 'Clear', entryId: 'e1' })
    expect(s2.latestDispatch).toBeNull()
    expect(effects).toEqual([])
  })

  it("no-ops when entryId doesn't match (stale timer from a replaced spotlight)", () => {
    // Simulates the race: e1 dispatched, e2 dispatched (replacing e1's
    // spotlight), then e1's older timer fires. The reducer must not
    // wipe e2's spotlight.
    const [s0] = init()
    const [s1] = update(s0, {
      type: 'Append',
      entry: makeEntry({
        id: 'e1',
        stateDiff: diff({ op: 'replace', path: '/x', value: 1 }),
      }),
    })
    const [s2] = update(s1, {
      type: 'Append',
      entry: makeEntry({
        id: 'e2',
        stateDiff: diff({ op: 'replace', path: '/y', value: 2 }),
      }),
    })
    const [s3] = update(s2, { type: 'Clear', entryId: 'e1' })
    expect(s3).toBe(s2) // identity preserved → no allocation
    expect(s3.latestDispatch!.entryId).toBe('e2')
  })

  it('no-ops when latestDispatch is already null', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'Clear', entryId: 'e1' })
    expect(s1).toBe(s0)
  })
})

describe('agentAttention: SetFlashDuration', () => {
  it('updates the duration and uses the new value on subsequent Appends', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetFlashDuration', ms: 1500 })
    expect(s1.flashDurationMs).toBe(1500)
    const [, effects] = update(s1, {
      type: 'Append',
      entry: makeEntry({ stateDiff: diff({ op: 'add', path: '/q', value: 1 }) }),
    })
    expect(effects[0]).toMatchObject({ type: 'AgentAttentionFlashTimeout', delayMs: 1500 })
  })

  it('clamps negative values to 0', () => {
    const [s0] = init()
    const [s1] = update(s0, { type: 'SetFlashDuration', ms: -1 })
    expect(s1.flashDurationMs).toBe(0)
  })
})

describe('agentAttention: connect()', () => {
  const buildBag = (_state: AgentAttentionState, send = vi.fn()) => {
    return connect(rootSignal<AgentAttentionState>(), send)
  }

  it('flashing(path) is true when the path is in latestDispatch.paths', () => {
    const [s0] = init()
    const [s1] = update(s0, {
      type: 'Append',
      entry: makeEntry({
        stateDiff: diff(
          { op: 'replace', path: '/items/0', value: 'x' },
          { op: 'replace', path: '/cart/total', value: 9 },
        ),
      }),
    })
    const bag = buildBag(s1)
    expect(read(bag.flashing('items'), s1)).toBe(true)
    expect(read(bag.flashing('cart'), s1)).toBe(true)
    expect(read(bag.flashing('other'), s1)).toBe(false)
  })

  it('flashing returns false when no spotlight is set', () => {
    const [s0] = init()
    const bag = buildBag(s0)
    expect(read(bag.flashing('items'), s0)).toBe(false)
  })

  it("matches every path against wildcard '*' (root replace)", () => {
    const [s0] = init()
    const [s1] = update(s0, {
      type: 'Append',
      entry: makeEntry({ stateDiff: diff({ op: 'replace', path: '/', value: {} }) }),
    })
    const bag = buildBag(s1)
    expect(read(bag.flashing('items'), s1)).toBe(true)
    expect(read(bag.flashing('cart'), s1)).toBe(true)
    expect(read(bag.flashing('anything'), s1)).toBe(true)
  })

  it('flashClass(path) returns the configured class while flashing', () => {
    const [s0] = init()
    const [s1] = update(s0, {
      type: 'Append',
      entry: makeEntry({
        stateDiff: diff({ op: 'replace', path: '/items/0', value: 1 }),
      }),
    })
    const bag = buildBag(s1)
    expect(read(bag.flashClass('items'), s1)).toBe('agent-flash')
    expect(read(bag.flashClass('items', 'pulse'), s1)).toBe('pulse')
    expect(read(bag.flashClass('other'), s1)).toBeUndefined()
  })

  it('regionAction(path) returns the action metadata when flashing', () => {
    const [s0] = init()
    const [s1] = update(s0, {
      type: 'Append',
      entry: makeEntry({
        id: 'e1',
        variant: 'SelectAlt',
        intent: 'Pick alternative',
        stateDiff: diff({ op: 'replace', path: '/alts/3/selected', value: true }),
      }),
    })
    const bag = buildBag(s1)
    expect(read(bag.regionAction('alts'), s1)).toEqual({
      entryId: 'e1',
      variant: 'SelectAlt',
      intent: 'Pick alternative',
      at: 1_000,
    })
    expect(read(bag.regionAction('other'), s1)).toBeNull()
  })

  it('per-path handles are cached (stable reference across calls)', () => {
    const [s0] = init()
    const bag = buildBag(s0)
    expect(bag.flashing('items')).toBe(bag.flashing('items'))
    expect(bag.flashClass('items')).toBe(bag.flashClass('items'))
    expect(bag.flashClass('items', 'pulse')).toBe(bag.flashClass('items', 'pulse'))
    expect(bag.flashClass('items', 'pulse')).not.toBe(bag.flashClass('items', 'other-class'))
    expect(bag.regionAction('items')).toBe(bag.regionAction('items'))
  })

  it('latestDispatch passes through the raw envelope (or null)', () => {
    const [s0] = init()
    const bag0 = buildBag(s0)
    expect(read(bag0.latestDispatch, s0)).toBeNull()
    const [s1] = update(s0, {
      type: 'Append',
      entry: makeEntry({
        stateDiff: diff({ op: 'replace', path: '/x', value: 1 }),
      }),
    })
    const bag1 = buildBag(s1)
    expect(read(bag1.latestDispatch, s1)?.entryId).toBe('e1')
  })
})
