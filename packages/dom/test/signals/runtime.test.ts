import { describe, it, expect } from 'vitest'
import {
  buildPathTable,
  bindingMask,
  type SparseMask,
  type PathTable,
} from '../../src/signals/mask'
import { createSignalScope, type SignalBinding } from '../../src/signals/runtime'

interface State {
  count: number
  user: { name: string }
  items: number[]
}

// A test binding that records produce/commit calls, so we can assert exactly
// which bindings ran (gate) and which actually wrote (output-equality).
function spyBinding(
  table: PathTable,
  deps: string[],
  produce: (s: State) => unknown,
  log: string[],
  id: string,
): SignalBinding & { produced: number; committed: number } {
  const mask: SparseMask = bindingMask(deps, table)
  const b = {
    mask,
    produced: 0,
    committed: 0,
    produce(state: unknown): unknown {
      b.produced++
      return produce(state as State)
    },
    commit(value: unknown): void {
      b.committed++
      log.push(`${id}=${String(value)}`)
    },
  }
  return b
}

const PATHS = ['count', 'user.name', 'items']

function setup() {
  const table = buildPathTable(PATHS)
  const log: string[] = []
  const bCount = spyBinding(table, ['count'], (s) => s.count, log, 'count')
  const bName = spyBinding(table, ['user.name'], (s) => s.user.name, log, 'name')
  const bNameLen = spyBinding(table, ['user.name'], (s) => s.user.name.length, log, 'len')
  const scope = createSignalScope(table, [bCount, bName, bNameLen])
  return { table, log, bCount, bName, bNameLen, scope }
}

describe('createSignalScope', () => {
  it('mount runs every binding once', () => {
    const { scope, log, bCount, bName, bNameLen } = setup()
    scope.mount({ count: 1, user: { name: 'ab' }, items: [1] })
    expect(log).toEqual(['count=1', 'name=ab', 'len=2'])
    expect([bCount.produced, bName.produced, bNameLen.produced]).toEqual([1, 1, 1])
  })

  it('update gates out bindings whose deps did not change (produce not even called)', () => {
    const { scope, log, bCount, bName, bNameLen } = setup()
    const s0: State = { count: 1, user: { name: 'ab' }, items: [1] }
    scope.mount(s0)
    log.length = 0
    bCount.produced = bName.produced = bNameLen.produced = 0

    // change only count
    const s1: State = { ...s0, count: 2 }
    scope.update(s0, s1)

    expect(log).toEqual(['count=2'])
    expect(bCount.produced).toBe(1)
    expect(bName.produced).toBe(0) // gated out — never produced
    expect(bNameLen.produced).toBe(0)
  })

  it('update commits all bindings whose dep changed', () => {
    const { scope, log } = setup()
    const s0: State = { count: 1, user: { name: 'ab' }, items: [1] }
    scope.mount(s0)
    log.length = 0

    const s1: State = { ...s0, user: { name: 'abc' } }
    scope.update(s0, s1)

    // both name bindings depend on user.name
    expect(log).toEqual(['name=abc', 'len=3'])
  })

  it('output-equality: a gated-in binding whose value is unchanged does NOT commit', () => {
    const { scope, log, bName, bNameLen } = setup()
    const s0: State = { count: 1, user: { name: 'ab' }, items: [1] }
    scope.mount(s0)
    log.length = 0
    bName.committed = bNameLen.committed = 0
    bName.produced = bNameLen.produced = 0

    // user.name changes 'ab' -> 'cd': same LENGTH (2). Both bindings gate in
    // (user.name is dirty) and both produce, but len's value is unchanged.
    const s1: State = { ...s0, user: { name: 'cd' } }
    scope.update(s0, s1)

    expect(bName.produced).toBe(1)
    expect(bNameLen.produced).toBe(1) // gated in, produced...
    expect(bName.committed).toBe(1) // name changed 'ab'->'cd' -> commit
    expect(bNameLen.committed).toBe(0) // length 2->2 unchanged -> suppressed
    expect(log).toEqual(['name=cd'])
  })

  it('identical state reference does nothing', () => {
    const { scope, log } = setup()
    const s0: State = { count: 1, user: { name: 'ab' }, items: [1] }
    scope.mount(s0)
    log.length = 0
    scope.update(s0, s0)
    expect(log).toEqual([])
  })

  it('a new state object with all-equal field values commits nothing (output-equality)', () => {
    const { scope, log } = setup()
    const s0: State = { count: 1, user: { name: 'ab' }, items: [1] }
    scope.mount(s0)
    log.length = 0
    // fresh object, but count and user.name resolve to equal values
    const s1: State = { count: 1, user: { name: 'ab' }, items: [2] }
    scope.update(s0, s1)
    // count unchanged (1===1), user.name unchanged ('ab'==='ab') -> nothing.
    // (items changed but no binding depends on it.)
    expect(log).toEqual([])
  })
})
