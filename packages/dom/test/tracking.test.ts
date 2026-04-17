import { describe, it, expect, afterEach } from 'vitest'
import { createRingBuffer } from '../src/tracking/each-diff'
import type { EachDiff } from '../src/tracking/each-diff'
import type { DisposerEvent } from '../src/tracking/disposer-log'
import { createRingBuffer as createRB2 } from '../src/tracking/disposer-log'
import { createCoverageTracker } from '../src/tracking/coverage'
import type { EffectTimelineEntry } from '../src/tracking/effect-timeline'
import {
  createRingBuffer as createRB3,
  createMockRegistry,
  createPendingEffectsList,
} from '../src/tracking/effect-timeline'
import { mountApp, _setDevToolsInstall } from '../src/mount'
import { installDevTools } from '../src/devtools'
import { each } from '../src/primitives/each'
import { branch } from '../src/primitives/branch'
import { child } from '../src/primitives/child'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import { component } from '../src/component'
import type { ComponentDef } from '../src/types'
import type { ComponentInstance } from '../src/update-loop'

describe('each-diff ring buffer', () => {
  it('records entries and caps at maxSize', () => {
    const buf = createRingBuffer<EachDiff>(3)
    buf.push({
      updateIndex: 0,
      eachSiteId: 's1',
      added: ['a'],
      removed: [],
      moved: [],
      reused: [],
    })
    buf.push({
      updateIndex: 1,
      eachSiteId: 's1',
      added: ['b'],
      removed: [],
      moved: [],
      reused: ['a'],
    })
    buf.push({
      updateIndex: 2,
      eachSiteId: 's1',
      added: [],
      removed: ['a'],
      moved: [],
      reused: ['b'],
    })
    buf.push({
      updateIndex: 3,
      eachSiteId: 's1',
      added: ['c'],
      removed: [],
      moved: [],
      reused: ['b'],
    })

    const all = buf.toArray()
    expect(all).toHaveLength(3)
    expect(all[0]!.updateIndex).toBe(1) // oldest was dropped
    expect(all[2]!.updateIndex).toBe(3)
  })

  it('returns entries since a given updateIndex', () => {
    const buf = createRingBuffer<EachDiff>(10)
    for (let i = 0; i < 5; i++) {
      buf.push({
        updateIndex: i,
        eachSiteId: 's1',
        added: [],
        removed: [],
        moved: [],
        reused: [],
      })
    }
    const since = buf.toArray().filter((e) => e.updateIndex >= 3)
    expect(since.map((e) => e.updateIndex)).toEqual([3, 4])
  })
})

// ── Integration: each() emits diffs when devtools is installed ────────

type Item = { id: string; label: string }
type EachState = { items: Item[] }
type EachMsg =
  | { type: 'append'; item: Item }
  | { type: 'remove'; id: string }
  | { type: 'swap'; i: number; j: number }

function eachListDef(): ComponentDef<EachState, EachMsg, never> {
  return {
    name: 'EachList',
    init: () => [
      {
        items: [
          { id: '1', label: 'one' },
          { id: '2', label: 'two' },
          { id: '3', label: 'three' },
        ],
      },
      [],
    ],
    update: (state, msg) => {
      switch (msg.type) {
        case 'append':
          return [{ items: [...state.items, msg.item] }, []]
        case 'remove':
          return [{ items: state.items.filter((i) => i.id !== msg.id) }, []]
        case 'swap': {
          const items = [...state.items]
          const tmp = items[msg.i]!
          items[msg.i] = items[msg.j]!
          items[msg.j] = tmp
          return [{ items }, []]
        }
      }
    },
    view: () =>
      each<EachState, Item>({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [div({ 'data-id': item((t) => t.id) }, [text(item((t) => t.label))])],
      }),
    __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
  }
}

describe('each() → EachDiff emission', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any
    delete g.__lluiDebug
    delete g.__lluiComponents
    _setDevToolsInstall(null)
  })

  it('emits diffs for append / remove / swap when devtools is installed', () => {
    // Install devtools auto-installer and capture the inst as it's
    // created — the devtools API intentionally doesn't expose the
    // ComponentInstance, so we stash it from the install hook.
    const captured: ComponentInstance<EachState, EachMsg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<EachState, EachMsg, never>)
    })

    const def = eachListDef()
    let sendFn!: (msg: EachMsg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const inst = captured[0]!
    expect(inst._eachDiffLog).toBeDefined()
    const log = inst._eachDiffLog!

    // Initial mount doesn't emit — the each block only diffs on
    // reconcile, not on first render.
    expect(log.size()).toBe(0)

    // Append: 1/2/3 → 1/2/3/4
    sendFn({ type: 'append', item: { id: '4', label: 'four' } })
    handle.flush()
    {
      const entries = log.toArray()
      expect(entries).toHaveLength(1)
      const d = entries[0]!
      expect(d.added).toEqual(['4'])
      expect(d.removed).toEqual([])
      expect(d.moved).toEqual([])
      expect(d.reused).toEqual(['1', '2', '3'])
      expect(d.eachSiteId).toMatch(/^each#\d+$/)
    }

    // Remove: 1/2/3/4 → 1/3/4. After removing '2' at oldIndex 1, keys
    // '3' and '4' shift left (oldIndex 2→1 and 3→2). The diff reports
    // those as moved relative to their new positions; '1' stays at 0.
    sendFn({ type: 'remove', id: '2' })
    handle.flush()
    {
      const entries = log.toArray()
      expect(entries).toHaveLength(2)
      const d = entries[1]!
      expect(d.added).toEqual([])
      expect(d.removed).toEqual(['2'])
      expect(d.moved).toEqual([
        { key: '3', from: 2, to: 1 },
        { key: '4', from: 3, to: 2 },
      ])
      expect(d.reused).toEqual(['1'])
    }

    // Swap indices 0 and 2: [1,3,4] → [4,3,1]
    sendFn({ type: 'swap', i: 0, j: 2 })
    handle.flush()
    {
      const entries = log.toArray()
      expect(entries).toHaveLength(3)
      const d = entries[2]!
      expect(d.added).toEqual([])
      expect(d.removed).toEqual([])
      // 1 moved from 0→2, 4 moved from 2→0, 3 reused at index 1
      expect(d.moved.map((m) => m.key).sort()).toEqual(['1', '4'])
      expect(d.reused).toEqual(['3'])
    }

    // updateIndex is monotonic and matches devtools message indices.
    const entries = log.toArray()
    expect(entries[0]!.updateIndex).toBe(0)
    expect(entries[1]!.updateIndex).toBe(1)
    expect(entries[2]!.updateIndex).toBe(2)

    handle.dispose()
  })

  it('emits diffs for nested each() inside an outer row template', () => {
    // Regression test for Issue 1: the reusable buildCtx inside each.ts's
    // buildEntry used to drop `instance` when cloning the outer ctx onto
    // the per-row render context. A nested each() registered inside a row
    // therefore saw `ctx.instance === undefined` and skipped diff tracking.
    type Inner = { id: string }
    type Outer = { id: string; children: Inner[] }
    type S = { groups: Outer[] }
    type Msg =
      | { type: 'appendOuter'; group: Outer }
      | { type: 'appendInner'; groupId: string; child: Inner }

    const captured: ComponentInstance<S, Msg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<S, Msg, never>)
    })

    const def: ComponentDef<S, Msg, never> = {
      name: 'NestedEach',
      init: () => [
        {
          groups: [
            { id: 'g1', children: [{ id: 'g1c1' }] },
            { id: 'g2', children: [{ id: 'g2c1' }] },
          ],
        },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'appendOuter':
            return [{ groups: [...state.groups, msg.group] }, []]
          case 'appendInner': {
            const groups = state.groups.map((g) =>
              g.id === msg.groupId ? { ...g, children: [...g.children, msg.child] } : g,
            )
            return [{ groups }, []]
          }
        }
      },
      view: () =>
        each<S, Outer>({
          items: (s) => s.groups,
          key: (g) => g.id,
          render: ({ item, acc }) => [
            div({ 'data-group': item((g) => g.id) }, [
              ...each<S, Inner>({
                // Inner each reads the current outer row's children via acc.
                items: () => acc((g) => g.children)(),
                key: (c) => c.id,
                render: ({ item: innerItem }) => [
                  div({ 'data-child': innerItem((c) => c.id) }, []),
                ],
              }),
            ]),
          ],
        }),
      // Top-level change always forces full reconcile for this test.
      __dirty: (o, n) => (Object.is(o.groups, n.groups) ? 0 : 1),
    }

    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const inst = captured[0]!
    expect(inst._eachDiffLog).toBeDefined()
    const log = inst._eachDiffLog!

    // Initial mount does not emit.
    expect(log.size()).toBe(0)

    // Append a new inner child to g1. The outer each's items array is
    // rebuilt (new reference) but keys are preserved, so outer reconcile
    // runs and updates the surviving outer row. The inner each inside
    // that row sees a new children array and should emit a diff.
    sendFn({ type: 'appendInner', groupId: 'g1', child: { id: 'g1c2' } })
    handle.flush()

    const entries = log.toArray()
    // Outer each emits (its items() closure returns a new array reference
    // even though keys are the same — reconcileEntries runs). The inner
    // each for g1 emits an 'added' for the new child. The inner each for
    // g2 may also run reconcile with the same array reference — fast-path
    // no-ops it, so no diff is emitted there.
    const innerAdds = entries.filter((e) => e.added.includes('g1c2'))
    expect(innerAdds.length).toBeGreaterThanOrEqual(1)
    expect(innerAdds[0]!.added).toEqual(['g1c2'])
    expect(innerAdds[0]!.reused).toEqual(['g1c1'])
    // The site id should be distinct from the outer each's site id —
    // inner blocks register after the outer, so their N is larger.
    expect(innerAdds[0]!.eachSiteId).toMatch(/^each#\d+$/)

    handle.dispose()
  })

  it('does not emit when devtools is NOT installed (zero-cost in prod)', () => {
    // No _setDevToolsInstall hook — inst._eachDiffLog stays undefined
    const def = eachListDef()
    let sendFn!: (msg: EachMsg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    sendFn({ type: 'append', item: { id: '4', label: 'four' } })
    handle.flush()
    // No crash, no side effects. (Nothing to assert — the fact that
    // this runs without error proves the guards are in place.)
    expect(container.querySelectorAll('[data-id]')).toHaveLength(4)
    handle.dispose()
  })
})

// ── Disposer log ────────────────────────────────────────────────────

describe('disposer log', () => {
  it('caps at 500 and records events with scope id + cause', () => {
    const buf = createRB2<DisposerEvent>(500)
    buf.push({ scopeId: 'root/each/0', cause: 'each-remove', timestamp: Date.now() })
    buf.push({ scopeId: 'root/show', cause: 'show-hide', timestamp: Date.now() })
    expect(buf.toArray()).toHaveLength(2)
    expect(buf.toArray()[0]!.cause).toBe('each-remove')
  })
})

// ── Integration: disposer log captures structural causes ──────────────

type BranchState = { which: 'a' | 'b' }
type BranchMsg = { type: 'toggle' }

function branchDef(): ComponentDef<BranchState, BranchMsg, never> {
  return {
    name: 'BranchApp',
    init: () => [{ which: 'a' }, []],
    update: (state, _msg) => [{ which: state.which === 'a' ? 'b' : 'a' }, []],
    view: () =>
      branch<BranchState, BranchMsg>({
        on: (s) => s.which,
        cases: {
          a: () => [div({}, [text(() => 'A')])],
          b: () => [div({}, [text(() => 'B')])],
        },
      }),
    __dirty: (o, n) => (Object.is(o.which, n.which) ? 0 : 1),
  }
}

describe('disposer log → structural causes', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any
    delete g.__lluiDebug
    delete g.__lluiComponents
    _setDevToolsInstall(null)
  })

  it("records 'branch-swap' when branch changes cases", () => {
    const captured: ComponentInstance<BranchState, BranchMsg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<BranchState, BranchMsg, never>)
    })

    const def = branchDef()
    let sendFn!: (msg: BranchMsg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const inst = captured[0]!
    expect(inst._disposerLog).toBeDefined()
    const log = inst._disposerLog!

    expect(log.size()).toBe(0)

    // Swap case a → b; the a-arm scope is disposed with cause 'branch-swap'.
    sendFn({ type: 'toggle' })
    handle.flush()

    const entries = log.toArray()
    const swapEntries = entries.filter((e) => e.cause === 'branch-swap')
    expect(swapEntries.length).toBeGreaterThanOrEqual(1)
    expect(swapEntries[0]!.scopeId).toMatch(/^\d+$/)
    expect(typeof swapEntries[0]!.timestamp).toBe('number')

    handle.dispose()
  })

  it("records 'each-remove' when an each() row is removed", () => {
    type Item = { id: string }
    type S = { items: Item[] }
    type Msg = { type: 'remove'; id: string }

    const captured: ComponentInstance<S, Msg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<S, Msg, never>)
    })

    const def: ComponentDef<S, Msg, never> = {
      name: 'EachRemove',
      init: () => [
        {
          items: [{ id: '1' }, { id: '2' }, { id: '3' }],
        },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'remove':
            return [{ items: state.items.filter((i) => i.id !== msg.id) }, []]
        }
      },
      view: () =>
        each<S, Item>({
          items: (s) => s.items,
          key: (item) => item.id,
          render: ({ item }) => [div({ 'data-id': item((t) => t.id) }, [])],
        }),
      __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
    }

    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const inst = captured[0]!
    const log = inst._disposerLog!
    expect(log.size()).toBe(0)

    sendFn({ type: 'remove', id: '2' })
    handle.flush()

    const entries = log.toArray()
    const eachRemoves = entries.filter((e) => e.cause === 'each-remove')
    expect(eachRemoves.length).toBeGreaterThanOrEqual(1)

    handle.dispose()
  })

  it("records 'app-unmount' on mountApp handle dispose", () => {
    const captured: ComponentInstance<BranchState, BranchMsg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<BranchState, BranchMsg, never>)
    })

    const def = branchDef()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const inst = captured[0]!
    const log = inst._disposerLog!

    handle.dispose()

    const entries = log.toArray()
    const appUnmounts = entries.filter((e) => e.cause === 'app-unmount')
    expect(appUnmounts.length).toBeGreaterThanOrEqual(1)
  })

  it("records 'child-unmount' when a mounted child() is torn down with the parent", () => {
    type CState = { value: number }
    type CMsg = { type: 'propsChanged'; props: { initial: number } }

    const ChildComp = component<CState, CMsg, never>({
      name: 'ChildComp',
      init: (data) => [{ value: (data as unknown as { initial: number }).initial }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'propsChanged':
            return [{ ...state, value: msg.props.initial }, []]
        }
      },
      propsMsg: (props) => ({
        type: 'propsChanged' as const,
        props: props as { initial: number },
      }),
      view: () => [div({ class: 'child' }, [text((s: CState) => String(s.value))])],
      __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
    })

    type PState = { base: number }
    type PMsg = { type: 'noop' }

    const captured: ComponentInstance<PState, PMsg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<PState, PMsg, never>)
    })

    const def: ComponentDef<PState, PMsg, never> = {
      name: 'ParentWithChild',
      init: () => [{ base: 10 }, []],
      update: (state, _msg) => [state, []],
      view: () => [
        div({ class: 'parent' }, [
          ...child<PState, CMsg>({
            def: ChildComp as unknown as ComponentDef<unknown, CMsg, unknown>,
            key: 'childUnmountCounter',
            props: (s) => ({ initial: s.base }),
          }),
        ]),
      ],
      __dirty: (o, n) => (Object.is(o.base, n.base) ? 0 : 1),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const inst = captured[0]!
    expect(inst._disposerLog).toBeDefined()
    const log = inst._disposerLog!

    // Sanity: child rendered
    expect(container.querySelector('.child')).not.toBeNull()

    handle.dispose()

    const entries = log.toArray()
    const childUnmounts = entries.filter((e) => e.cause === 'child-unmount')
    expect(childUnmounts.length).toBeGreaterThanOrEqual(1)
    expect(childUnmounts[0]!.scopeId).toMatch(/^\d+$/)
    expect(typeof childUnmounts[0]!.timestamp).toBe('number')
  })
})

// ── Coverage tracker ────────────────────────────────────────────────

describe('coverage tracker', () => {
  it('counts fired variants and tracks lastIndex', () => {
    const cov = createCoverageTracker()
    cov.record('Increment', 0)
    cov.record('Increment', 1)
    cov.record('Reset', 2)
    const snap = cov.snapshot()
    expect(snap.fired.Increment).toEqual({ count: 2, lastIndex: 1 })
    expect(snap.fired.Reset).toEqual({ count: 1, lastIndex: 2 })
  })

  it('computes neverFired from a known variants list', () => {
    const cov = createCoverageTracker()
    cov.record('A', 0)
    const snap = cov.snapshot(['A', 'B', 'C'])
    expect(snap.neverFired).toEqual(['B', 'C'])
  })

  it('clear resets all counters', () => {
    const cov = createCoverageTracker()
    cov.record('X', 0)
    cov.clear()
    const snap = cov.snapshot(['X'])
    expect(snap.fired).toEqual({})
    expect(snap.neverFired).toEqual(['X'])
  })
})

// ── Integration: coverage tracker records fired Msg variants ──────────

type CovState = { count: number }
type CovMsg = { type: 'Increment' } | { type: 'Reset' } | { type: 'Decrement' }

function covCounterDef(): ComponentDef<CovState, CovMsg, never> {
  return {
    name: 'CovCounter',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'Increment':
          return [{ count: state.count + 1 }, []]
        case 'Decrement':
          return [{ count: state.count - 1 }, []]
        case 'Reset':
          return [{ count: 0 }, []]
      }
    },
    view: () => [div({}, [text((s: CovState) => String(s.count))])],
    __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
  }
}

describe('coverage integration', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any
    delete g.__lluiDebug
    delete g.__lluiComponents
    _setDevToolsInstall(null)
  })

  it('records Msg variants and their indices as messages fire', () => {
    const captured: ComponentInstance<CovState, CovMsg, never>[] = []
    _setDevToolsInstall((inst) => {
      installDevTools(inst)
      captured.push(inst as ComponentInstance<CovState, CovMsg, never>)
    })

    const def = covCounterDef()
    let sendFn!: (msg: CovMsg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const inst = captured[0]!
    expect(inst._coverage).toBeDefined()

    sendFn({ type: 'Increment' })
    handle.flush()
    sendFn({ type: 'Increment' })
    handle.flush()
    sendFn({ type: 'Reset' })
    handle.flush()

    const snap = inst._coverage!.snapshot(['Increment', 'Reset', 'Decrement'])
    expect(snap.fired.Increment).toEqual({ count: 2, lastIndex: 1 })
    expect(snap.fired.Reset).toEqual({ count: 1, lastIndex: 2 })
    expect(snap.neverFired).toEqual(['Decrement'])

    handle.dispose()
  })
})

// ── Effect timeline / mock registry / pending effects ─────────────────

describe('effect timeline buffer', () => {
  it('records phases in order', () => {
    const buf = createRB3<EffectTimelineEntry>(500)
    buf.push({ effectId: 'e1', type: 'http', phase: 'dispatched', timestamp: 1 })
    buf.push({ effectId: 'e1', type: 'http', phase: 'in-flight', timestamp: 2 })
    buf.push({ effectId: 'e1', type: 'http', phase: 'resolved', timestamp: 5, durationMs: 4 })
    const entries = buf.toArray()
    expect(entries.map((e) => e.phase)).toEqual(['dispatched', 'in-flight', 'resolved'])
    expect(entries[2]!.durationMs).toBe(4)
  })
})

describe('mock registry', () => {
  it('matches by type and returns the registered response', () => {
    const reg = createMockRegistry()
    const mockId = reg.add({ type: 'http' }, { data: 'ok' }, false)
    expect(mockId).toMatch(/^mock-\d+$/)
    const hit = reg.match({ type: 'http', url: '/x' })
    expect(hit).not.toBeNull()
    expect(hit!.response).toEqual({ data: 'ok' })
    // One-shot — second match should miss
    expect(reg.match({ type: 'http' })).toBeNull()
  })

  it('persists when persist=true', () => {
    const reg = createMockRegistry()
    reg.add({ type: 'log' }, null, true)
    expect(reg.match({ type: 'log' })).not.toBeNull()
    expect(reg.match({ type: 'log' })).not.toBeNull()
  })

  it('matches by payloadPath + payloadEquals', () => {
    const reg = createMockRegistry()
    reg.add({ type: 'http', payloadPath: 'url', payloadEquals: '/api/x' }, 'ok', false)
    expect(reg.match({ type: 'http', url: '/api/y' })).toBeNull()
    expect(reg.match({ type: 'http', url: '/api/x' })).not.toBeNull()
  })

  it('ignores effects that are not objects', () => {
    const reg = createMockRegistry()
    reg.add({ type: 'http' }, 'ok', true)
    expect(reg.match(null)).toBeNull()
    expect(reg.match(42)).toBeNull()
    expect(reg.match('http')).toBeNull()
  })

  it('clear() drops all mocks and resets id counter', () => {
    const reg = createMockRegistry()
    reg.add({ type: 'http' }, 'a', true)
    reg.add({ type: 'log' }, 'b', true)
    expect(reg.list()).toHaveLength(2)
    reg.clear()
    expect(reg.list()).toHaveLength(0)
    const newId = reg.add({ type: 'http' }, 'c', true)
    expect(newId).toBe('mock-1')
  })
})

describe('pending effects list', () => {
  it('supports push, findById, remove', () => {
    const list = createPendingEffectsList()
    list.push({ id: 'e1', type: 'http', dispatchedAt: 1, status: 'queued', payload: {} })
    list.push({ id: 'e2', type: 'log', dispatchedAt: 2, status: 'queued', payload: {} })
    expect(list.findById('e1')?.type).toBe('http')
    list.remove('e1')
    expect(list.findById('e1')).toBeUndefined()
    expect(list.list()).toHaveLength(1)
  })
})
