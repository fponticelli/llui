import { describe, it, expect } from 'vitest'
import {
  buildPathTable,
  bindingMask,
  type SparseMask,
  type PathTable,
} from '../../src/signals/mask'
import { createSignalScope, withBindingErrors, type SignalBinding } from '../../src/signals/runtime'

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
): SignalBinding & { mask: SparseMask; produced: number; committed: number } {
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
  const bindings = [bCount, bName, bNameLen]
  const scope = createSignalScope(
    table,
    bindings,
    bindings.map((b) => b.mask),
  )
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

// A STRUCTURAL binding (show/branch/each/virtualEach) has an identity `produce`,
// so output-equality would compare the STATE BUFFER's identity rather than the
// binding's output. `each` recycles two ctx buffers per row and rotates them on
// every row update while `last[i]` advances only on commit, so one gated-out
// update desynchronises them and every later reconcile is suppressed (issue #52).
// Structural bindings are therefore exempt from the check.
describe('createSignalScope — structural bindings are exempt from output-equality', () => {
  interface Ctx {
    item: { mode: string }
    state: { tick: number }
  }

  // Mirrors the real row scope: a value binding on `item.mode` plus a structural
  // binding with the same dep and an identity produce, driven by two RECYCLED ctx
  // buffers that rotate exactly like `each`'s row ctx.
  function rowScope() {
    const table = buildPathTable(['item.mode', 'state.tick'])
    const seen: string[] = []
    const value: SignalBinding = {
      produce: (s) => (s as Ctx).item.mode,
      commit: (v) => seen.push(`text=${String(v)}`),
    }
    const structural: SignalBinding = {
      produce: (s) => s, // identity — the reconcile needs the whole state
      structural: true,
      commit: (s) => seen.push(`arm=${(s as Ctx).item.mode}`),
    }
    const bindings = [value, structural]
    const scope = createSignalScope(table, bindings, [
      bindingMask(['item.mode'], table),
      bindingMask(['item.mode'], table),
    ])
    const buffers: Ctx[] = [
      { item: { mode: 'a' }, state: { tick: 0 } },
      { item: { mode: 'a' }, state: { tick: 0 } },
    ]
    let cur = 0
    scope.mount(buffers[0]!)
    // Rotate buffers on every update, exactly as `each` does for a row.
    const send = (mode: string, tick: number): void => {
      const next = buffers[1 - cur]!
      next.item = { mode }
      next.state = { tick }
      scope.update(buffers[cur]!, next)
      cur = 1 - cur
    }
    return { seen, send }
  }

  it('reconciles after a gated-out update rotated the ctx buffers', () => {
    const { seen, send } = rowScope()
    seen.length = 0
    // `item.mode` is clean -> both bindings gate out, but the buffers still rotate.
    send('a', 1)
    expect(seen).toEqual([])
    // Now flip the discriminant: the structural binding must commit even though its
    // identity produce returns the buffer already sitting in `last`.
    send('b', 1)
    expect(seen).toEqual(['text=b', 'arm=b'])
  })

  it('reconciles at every parity of gated-out updates', () => {
    const { seen, send } = rowScope()
    for (let noops = 0; noops < 4; noops++) {
      const mode = noops % 2 === 0 ? 'b' : 'a'
      seen.length = 0
      for (let i = 0; i < noops; i++) send(mode === 'b' ? 'a' : 'b', i)
      seen.length = 0
      send(mode, 99)
      expect(seen).toEqual([`text=${mode}`, `arm=${mode}`])
    }
  })

  it('still gates a structural binding out when its deps are clean', () => {
    const { seen, send } = rowScope()
    seen.length = 0
    send('a', 7) // only state.tick moved; neither binding depends on it
    expect(seen).toEqual([])
  })

  // `update` has TWO loops — a try/catch-free fast path and the safe path taken
  // while a binding-error hook is installed. The exemption must hold in both.
  it('holds on the binding-error-hook path too', () => {
    const { seen, send } = rowScope()
    withBindingErrors(
      () => {
        throw new Error('no binding should throw here')
      },
      () => {
        seen.length = 0
        send('a', 1) // gated out; buffers rotate
        expect(seen).toEqual([])
        send('b', 1)
      },
    )
    expect(seen).toEqual(['text=b', 'arm=b'])
  })

  it('leaves value bindings in a mixed scope under output-equality', () => {
    const table = buildPathTable(['item.mode', 'item.label'])
    const seen: string[] = []
    const bindings: SignalBinding[] = [
      {
        produce: (s) => (s as { item: { label: string } }).item.label.length,
        commit: (v) => seen.push(`len=${String(v)}`),
      },
      { produce: (s) => s, structural: true, commit: () => seen.push('arm') },
    ]
    const scope = createSignalScope(table, bindings, [
      bindingMask(['item.label'], table),
      bindingMask(['item.mode'], table),
    ])
    const s0 = { item: { mode: 'a', label: 'ab' } }
    scope.mount(s0)
    seen.length = 0
    // label 'ab' -> 'cd': the value binding gates in and produces, but its OUTPUT
    // (the length) is unchanged, so the structural exemption must not leak to it.
    scope.update(s0, { item: { mode: 'a', label: 'cd' } })
    expect(seen).toEqual([])
  })

  it('leaves value bindings under output-equality on the binding-error-hook path', () => {
    const { scope, log, bName, bNameLen } = setup()
    const s0: State = { count: 1, user: { name: 'ab' }, items: [1] }
    scope.mount(s0)
    log.length = 0
    bName.committed = bNameLen.committed = 0

    withBindingErrors(
      () => {
        throw new Error('no binding should throw here')
      },
      () => scope.update(s0, { ...s0, user: { name: 'cd' } }),
    )

    expect(bName.committed).toBe(1)
    expect(bNameLen.committed).toBe(0)
    expect(log).toEqual(['name=cd'])
  })
})
