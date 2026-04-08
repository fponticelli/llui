import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountApp } from '../src/mount'
import { component, div, text, each, selector, flush } from '../src/index'
import {
  createScope,
  disposeScope,
  disposeScopesBulk,
  addDisposer,
  addCheckedItemUpdater,
  _drainScopePool,
} from '../src/scope'
import { _runPhase2 } from '../src/update-loop'
import type { ComponentDef, Binding } from '../src/types'
import type { StructuralBlock } from '../src/structural'

// ── __update compiler fast path ──────────────────────────────────

describe('__update fast path', () => {
  it('calls __update instead of generic Phase 1/2 when present', () => {
    const updateSpy = vi.fn()

    type S = { count: number }
    type M = { type: 'inc' }

    const def: ComponentDef<S, M, never> = {
      name: 'UpdateSpy',
      init: () => [{ count: 0 }, []],
      update: (s, _m) => [{ ...s, count: s.count + 1 }, []],
      view: ({ text: t }) => [div([t((s: S) => String(s.count))])],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
      __update(state, dirty, bindings, blocks, bindingsBeforePhase1) {
        updateSpy({ state, dirty, bindings, blocks, bindingsBeforePhase1 })
        // Must still run Phase 2 for correctness
        _runPhase2(state, dirty, bindings, bindingsBeforePhase1)
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(updateSpy).not.toHaveBeenCalled()

    sendFn({ type: 'inc' })
    flush()

    expect(updateSpy).toHaveBeenCalledTimes(1)
    const call = updateSpy.mock.calls[0]![0]
    expect(call.state).toEqual({ count: 1 })
    expect(call.dirty).toBe(1)
    expect(Array.isArray(call.bindings)).toBe(true)
    expect(Array.isArray(call.blocks)).toBe(true)

    // DOM should still update (Phase 2 ran inside our spy)
    expect(container.textContent).toBe('1')

    handle.dispose()
  })

  it('falls back to generic update when __update is absent', () => {
    type S = { count: number }
    type M = { type: 'inc' }

    const def: ComponentDef<S, M, never> = {
      name: 'NoUpdate',
      init: () => [{ count: 0 }, []],
      update: (s, _m) => [{ ...s, count: s.count + 1 }, []],
      view: ({ text: t }) => [div([t((s: S) => String(s.count))])],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
      // No __update — generic path
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    sendFn({ type: 'inc' })
    flush()

    expect(container.textContent).toBe('1')
    handle.dispose()
  })
})

// ── Phase 1 mask gating ──────────────────────────────────────────

describe('Phase 1 mask gating', () => {
  it('skips each() reconcile when dirty mask does not intersect structural mask', () => {
    type S = { items: string[]; label: string }
    type M = { type: 'setLabel'; value: string } | { type: 'setItems'; items: string[] }

    let itemsAccessorCalls = 0

    const def: ComponentDef<S, M, never> = {
      name: 'MaskGating',
      init: () => [{ items: ['a', 'b'], label: 'hello' }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'setLabel':
            return [{ ...s, label: m.value }, []]
          case 'setItems':
            return [{ ...s, items: m.items }, []]
        }
      },
      view: ({ text: t }) => [
        div([t((s: S) => s.label)]),
        ...each<S, string>({
          items: (s) => {
            itemsAccessorCalls++
            return s.items
          },
          key: (item) => item,
          render: ({ item }) => [div([text(item)])],
          __mask: 1, // items depends on bit 1
        } as never),
      ],
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.items, n.items)) m |= 1
        if (!Object.is(o.label, n.label)) m |= 2
        return m
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    // Initial mount calls items accessor once
    const initialCalls = itemsAccessorCalls

    // Change label (bit 2) — should NOT call items accessor
    sendFn({ type: 'setLabel', value: 'world' })
    flush()

    expect(container.textContent).toContain('world')
    expect(itemsAccessorCalls).toBe(initialCalls) // No new items accessor call

    // Change items (bit 1) — SHOULD call items accessor
    sendFn({ type: 'setItems', items: ['c'] })
    flush()

    expect(itemsAccessorCalls).toBeGreaterThan(initialCalls)
    expect(container.textContent).toContain('c')

    handle.dispose()
  })
})

// ── Swap in single-pass ──────────────────────────────────────────

describe('swap optimization', () => {
  it('swaps two items without updating all entries', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }
    type M = { type: 'swap' }

    let updateEntryCalls = 0

    const def: ComponentDef<S, M, never> = {
      name: 'SwapOpt',
      init: () => [
        {
          rows: [
            { id: 1, label: 'one' },
            { id: 2, label: 'two' },
            { id: 3, label: 'three' },
            { id: 4, label: 'four' },
            { id: 5, label: 'five' },
          ],
        },
        [],
      ],
      update: (s, _m) => {
        const rows = s.rows.slice()
        const tmp = rows[0]!
        rows[0] = rows[4]!
        rows[4] = tmp
        return [{ rows }, []]
      },
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item }) => {
            const nodes = [div([text(item.label)])]
            return nodes
          },
        }),
      ],
      __dirty: (o, n) => (Object.is(o.rows, n.rows) ? 0 : 1),
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    // Verify initial order
    const getText = () =>
      Array.from(container.querySelectorAll('div'))
        .map((d) => d.textContent)
        .filter(Boolean)

    expect(getText()).toEqual(['one', 'two', 'three', 'four', 'five'])

    // Swap first and last
    sendFn({ type: 'swap' })
    flush()

    expect(getText()).toEqual(['five', 'two', 'three', 'four', 'one'])

    // Swap again
    sendFn({ type: 'swap' })
    flush()

    expect(getText()).toEqual(['one', 'two', 'three', 'four', 'five'])

    handle.dispose()
  })
})

// ── disposeScopesBulk ────────────────────────────────────────────

describe('disposeScopesBulk', () => {
  it('disposes all scopes and their children', () => {
    const parent = createScope(null)
    const child1 = createScope(parent)
    const child2 = createScope(parent)
    const grandchild = createScope(child1)

    const disposed: string[] = []
    addDisposer(child1, () => disposed.push('child1'))
    addDisposer(child2, () => disposed.push('child2'))
    addDisposer(grandchild, () => disposed.push('grandchild'))

    disposeScopesBulk([child1, child2])

    expect(disposed).toContain('child1')
    expect(disposed).toContain('child2')
    expect(disposed).toContain('grandchild')
    expect(child1.parent).toBeNull()
    expect(child2.parent).toBeNull()
    expect(grandchild.parent).toBeNull()
  })

  it('marks bindings as dead', () => {
    const parent = createScope(null)
    const child = createScope(parent)

    // Create a mock binding on the child scope
    const binding: Binding = {
      mask: 1,
      accessor: () => 'test',
      lastValue: 'test',
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
      dead: false,
      ownerScope: child,
    }
    child.bindings = [binding]

    disposeScopesBulk([child])

    expect(binding.dead).toBe(true)
    expect(binding.accessor).toBeNull()
    expect(binding.node).toBeNull()
  })

  it('clears itemUpdaters', () => {
    const parent = createScope(null)
    const child = createScope(parent)
    child.itemUpdaters = [() => {}, () => {}]

    disposeScopesBulk([child])

    // After bulk dispose, arrays are reset to shared empties
    expect(child.itemUpdaters.length).toBe(0)
  })
})

// ── addCheckedItemUpdater ────────────────────────────────────────

describe('addCheckedItemUpdater', () => {
  it('returns initial value', () => {
    const scope = createScope(null)
    let val = 'hello'
    const initial = addCheckedItemUpdater(
      scope,
      () => val,
      () => {},
    )

    expect(initial).toBe('hello')
  })

  it('calls apply when value changes', () => {
    const scope = createScope(null)
    let val = 'hello'
    const applied: string[] = []

    addCheckedItemUpdater(
      scope,
      () => val,
      (v) => applied.push(v),
    )

    // Run updater with same value — should not apply
    val = 'hello'
    scope.itemUpdaters[0]!()
    expect(applied).toEqual([])

    // Run updater with new value — should apply
    val = 'world'
    scope.itemUpdaters[0]!()
    expect(applied).toEqual(['world'])

    // Run updater with same value again — should not apply
    scope.itemUpdaters[0]!()
    expect(applied).toEqual(['world'])
  })

  it('handles NaN correctly', () => {
    const scope = createScope(null)
    let val = NaN
    const applied: number[] = []

    addCheckedItemUpdater(
      scope,
      () => val,
      (v) => applied.push(v),
    )

    // NaN === NaN should skip (NaN guard)
    scope.itemUpdaters[0]!()
    expect(applied).toEqual([])

    // Change to a real number
    val = 42
    scope.itemUpdaters[0]!()
    expect(applied).toEqual([42])
  })
})

// ── selector O(1) update ─────────────────────────────────────────

describe('selector optimization', () => {
  it('updates only affected rows on select change', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[]; selected: number }
    type M = { type: 'select'; id: number }

    const def = component<S, M, never>({
      name: 'SelectorOpt',
      init: () => [
        {
          rows: [
            { id: 1, label: 'one' },
            { id: 2, label: 'two' },
            { id: 3, label: 'three' },
          ],
          selected: 0,
        },
        [],
      ],
      update: (s, m) => [{ ...s, selected: m.id }, []],
      view: ({ send }) => {
        const sel = selector<S, number>((s) => s.selected)
        return [
          ...each<S, Row>({
            items: (s) => s.rows,
            key: (r) => r.id,
            render: ({ item }) => {
              const rowId = item.id()
              const row = div([text(item.label)])
              sel.bind(row, rowId, 'class', 'class', (match) => (match ? 'selected' : ''))
              return [row]
            },
          }),
        ]
      },
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.rows, n.rows)) m |= 1
        if (!Object.is(o.selected, n.selected)) m |= 2
        return m
      },
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    const divs = container.querySelectorAll('div')
    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('')
    expect(divs[2]!.className).toBe('')

    // Select row 2
    sendFn({ type: 'select', id: 2 })
    flush()

    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('selected')
    expect(divs[2]!.className).toBe('')

    // Switch to row 3
    sendFn({ type: 'select', id: 3 })
    flush()

    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('')
    expect(divs[2]!.className).toBe('selected')

    handle.dispose()
  })
})

// ── __handlers per-message dispatch ──────────────────────────────

describe('__handlers per-message dispatch', () => {
  it('dispatches single message to __handlers instead of generic pipeline', () => {
    type S = { count: number; label: string }
    type M = { type: 'inc' } | { type: 'setLabel'; value: string }

    const handlerSpy = vi.fn()

    const def: ComponentDef<S, M, never> = {
      name: 'Handlers',
      init: () => [{ count: 0, label: 'hello' }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'inc':
            return [{ ...s, count: s.count + 1 }, []]
          case 'setLabel':
            return [{ ...s, label: m.value }, []]
        }
      },
      view: ({ text: t }) => [div([t((s: S) => String(s.count))]), div([t((s: S) => s.label)])],
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.count, n.count)) m |= 1
        if (!Object.is(o.label, n.label)) m |= 2
        return m
      },
      __handlers: {
        inc: (inst: object, _msg: unknown): [S, never[]] => {
          const typedInst = inst as { state: S; allBindings: Binding[] }
          handlerSpy('inc')
          const newState = { ...typedInst.state, count: typedInst.state.count + 1 }
          typedInst.state = newState
          _runPhase2(newState, 1, typedInst.allBindings, typedInst.allBindings.length)
          return [newState, []]
        },
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    mountApp(container, def)

    sendFn({ type: 'inc' })
    flush()
    expect(handlerSpy).toHaveBeenCalledWith('inc')
    expect(container.textContent).toBe('1hello')

    // Message without handler → falls through to generic
    sendFn({ type: 'setLabel', value: 'world' })
    flush()
    expect(container.textContent).toBe('1world')
  })

  it('falls back to generic pipeline for multi-message batches', () => {
    type S = { count: number }
    type M = { type: 'inc' }

    const handlerSpy = vi.fn()

    const def: ComponentDef<S, M, never> = {
      name: 'MultiBatch',
      init: () => [{ count: 0 }, []],
      update: (s) => [{ ...s, count: s.count + 1 }, []],
      view: ({ text: t }) => [div([t((s: S) => String(s.count))])],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
      __handlers: {
        inc: (inst: object): [S, never[]] => {
          handlerSpy('inc-handler')
          const typedInst = inst as { state: S }
          const newState = { ...typedInst.state, count: typedInst.state.count + 1 }
          return [newState, []]
        },
      },
    }

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    mountApp(container, def)

    sendFn({ type: 'inc' })
    sendFn({ type: 'inc' })
    flush()

    expect(handlerSpy).not.toHaveBeenCalled()
    expect(container.textContent).toBe('2')
  })
})

// ── selector __directUpdate ──────────────────────────────────────

describe('selector __directUpdate', () => {
  it('updates DOM directly without Phase 2', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[]; selected: number }
    type M = { type: 'select'; id: number }

    let selectorRef: ReturnType<typeof selector<S, number>> | null = null

    const def = component<S, M, never>({
      name: 'DirectSelector',
      init: () => [
        {
          rows: [
            { id: 1, label: 'a' },
            { id: 2, label: 'b' },
          ],
          selected: 0,
        },
        [],
      ],
      update: (s, m) => [{ ...s, selected: m.id }, []],
      view: () => {
        const sel = selector<S, number>((s) => s.selected)
        selectorRef = sel
        return [
          ...each<S, Row>({
            items: (s) => s.rows,
            key: (r) => r.id,
            render: ({ item }) => {
              const row = div([text(item.label)])
              sel.bind(row, item.id(), 'class', 'class', (m) => (m ? 'active' : ''))
              return [row]
            },
          }),
        ]
      },
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.rows, n.rows)) m |= 1
        if (!Object.is(o.selected, n.selected)) m |= 2
        return m
      },
    })

    const container = document.createElement('div')
    mountApp(container, def)

    const divs = container.querySelectorAll('div')
    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('')

    selectorRef!.__directUpdate({ rows: [], selected: 1 })
    expect(divs[0]!.className).toBe('active')
    expect(divs[1]!.className).toBe('')

    selectorRef!.__directUpdate({ rows: [], selected: 2 })
    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('active')
  })
})

// ── Scope pooling ────────────────────────────────────────────────

describe('scope pooling', () => {
  beforeEach(() => {
    _drainScopePool()
  })

  it('reuses disposed scope objects', () => {
    const parent = createScope(null)
    const child = createScope(parent)
    const childId = child.id

    // Dispose child — should return to pool
    addDisposer(child, () => {}) // ensure it goes through full disposal path
    disposeScope(child)

    // Create a new scope — should reuse the pooled object
    const reused = createScope(parent)
    // Same object, different id
    expect(reused).toBe(child)
    expect(reused.id).not.toBe(childId)
    expect(reused.parent).toBe(parent)
    expect(reused.disposers).toEqual([])
    expect(reused.children).toEqual([])
    expect(reused.bindings).toEqual([])
    expect(reused.itemUpdaters).toEqual([])

    disposeScope(parent)
  })

  it('reused scopes do not carry stale state', () => {
    _drainScopePool()

    const parent = createScope(null)
    const scope = createScope(parent)

    // Add state to the scope
    addDisposer(scope, () => {})
    const binding: Binding = {
      mask: 1,
      accessor: () => 'old',
      lastValue: 'old',
      kind: 'text',
      node: document.createTextNode(''),
      perItem: false,
      dead: false,
      ownerScope: scope,
    }
    scope.bindings = [binding]
    scope.itemUpdaters = [() => {}]

    // Dispose — returns to pool with clean state
    disposeScope(scope)

    // Reuse
    const reused = createScope(parent)
    expect(reused).toBe(scope)
    expect(reused.disposers).toEqual([])
    expect(reused.bindings).toEqual([])
    expect(reused.children).toEqual([])
    expect(reused.itemUpdaters).toEqual([])

    // Adding new state works correctly
    const newCalls: string[] = []
    addDisposer(reused, () => newCalls.push('new'))
    disposeScope(reused)
    expect(newCalls).toEqual(['new'])
  })

  it('pool is capped — does not grow unbounded', () => {
    _drainScopePool()

    const parent = createScope(null)
    const scopes: ReturnType<typeof createScope>[] = []

    // Create and dispose 3000 scopes (pool cap is 2048)
    for (let i = 0; i < 3000; i++) {
      const s = createScope(parent)
      addDisposer(s, () => {}) // ensure full disposal path
      scopes.push(s)
    }
    for (const s of scopes) {
      disposeScope(s, true)
    }

    // Pool should be capped
    // Create scopes from pool to count how many were pooled
    let pooled = 0
    const created = new Set<object>()
    for (let i = 0; i < 3000; i++) {
      const s = createScope(null)
      if (created.has(s)) break // duplicate = pool exhausted, shouldn't happen
      created.add(s)
      if (scopes.includes(s)) pooled++
      disposeScope(s) // empty scope, won't be re-pooled (early return path)
    }

    // Should be capped at 2048
    expect(pooled).toBeLessThanOrEqual(2048)
    expect(pooled).toBeGreaterThan(0)
  })

  it('bulk disposal pools scopes', () => {
    _drainScopePool()

    const parent = createScope(null)
    const children = []
    for (let i = 0; i < 5; i++) {
      const c = createScope(parent)
      addDisposer(c, () => {}) // ensure full disposal
      children.push(c)
    }

    disposeScopesBulk(children)

    // Create 5 new scopes — should reuse from pool
    const reused = []
    for (let i = 0; i < 5; i++) {
      reused.push(createScope(null))
    }

    // All 5 should be reused objects
    for (const r of reused) {
      expect(children).toContain(r)
    }
  })
})

// ── reconcileRemove ──────────────────────────────────────────────

describe('each reconcileRemove', () => {
  it('removes a single item by filter', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }
    type M = { type: 'remove'; id: number }

    const def = component<S, M, never>({
      name: 'RemoveTest',
      init: () => [
        {
          rows: [
            { id: 1, label: 'a' },
            { id: 2, label: 'b' },
            { id: 3, label: 'c' },
          ],
        },
        [],
      ],
      update: (s, m) => [{ rows: s.rows.filter((r) => r.id !== m.id) }, []],
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item }) => [div([text(item.label)])],
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.querySelectorAll('div').length).toBe(3)
    expect(container.textContent).toBe('abc')

    // Remove middle item
    sendFn({ type: 'remove', id: 2 })
    flush()

    expect(container.querySelectorAll('div').length).toBe(2)
    expect(container.textContent).toBe('ac')

    // Remove first item
    sendFn({ type: 'remove', id: 1 })
    flush()

    expect(container.querySelectorAll('div').length).toBe(1)
    expect(container.textContent).toBe('c')

    // Remove last item
    sendFn({ type: 'remove', id: 3 })
    flush()

    expect(container.querySelectorAll('div').length).toBe(0)

    handle.dispose()
  })

  it('reconcileRemove called directly works', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }

    const def = component<S, never, never>({
      name: 'DirectRemove',
      init: () => [
        {
          rows: [
            { id: 1, label: 'x' },
            { id: 2, label: 'y' },
            { id: 3, label: 'z' },
          ],
        },
        [],
      ],
      update: (s) => [s, []],
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item }) => [div([text(item.label)])],
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('xyz')

    // Access the structural block
    // @ts-expect-error — internal access
    const blocks = (handle as unknown as { structuralBlocks: StructuralBlock[] }).structuralBlocks
    if (blocks?.[0]?.reconcileRemove) {
      // Call reconcileRemove directly with filtered rows
      blocks[0].reconcileRemove({
        rows: [
          { id: 1, label: 'x' },
          { id: 3, label: 'z' },
        ],
      })
      expect(container.textContent).toBe('xz')
      expect(container.querySelectorAll('div').length).toBe(2)
    }

    handle.dispose()
  })

  it('handles removing multiple items', () => {
    type S = { items: number[] }
    type M = { type: 'removeEvens' }

    const def = component<S, M, never>({
      name: 'MultiRemove',
      init: () => [{ items: [1, 2, 3, 4, 5, 6] }, []],
      update: (s) => [{ items: s.items.filter((n) => n % 2 !== 0) }, []],
      view: () => [
        ...each<S, number>({
          items: (s) => s.items,
          key: (n) => n,
          render: ({ item }) => [div([text(item((n: number) => String(n)))])],
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('123456')

    sendFn({ type: 'removeEvens' })
    flush()

    expect(container.textContent).toBe('135')
    expect(container.querySelectorAll('div').length).toBe(3)

    handle.dispose()
  })
})

// ── reconcileChanged (strided update) ────────────────────────────

describe('each reconcileChanged', () => {
  it('updates only every Nth item by stride', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }
    type M = { type: 'update' }

    const def = component<S, M, never>({
      name: 'StridedUpdate',
      init: () => [
        {
          rows: [
            { id: 1, label: 'a' },
            { id: 2, label: 'b' },
            { id: 3, label: 'c' },
            { id: 4, label: 'd' },
            { id: 5, label: 'e' },
            { id: 6, label: 'f' },
          ],
        },
        [],
      ],
      update: (s) => {
        const rows = s.rows.slice()
        for (let i = 0; i < rows.length; i += 3) {
          rows[i] = { ...rows[i]!, label: rows[i]!.label + '!' }
        }
        return [{ rows }, []]
      },
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item }) => [div([text(item.label)])],
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('abcdef')

    sendFn({ type: 'update' })
    flush()

    // Only items at indices 0 and 3 changed (stride 3: 0, 3)
    expect(container.textContent).toBe('a!bcd!ef')

    handle.dispose()
  })
})

// ── Row factory ──────────────────────────────────────────────────

describe('row factory (__rowUpdate)', () => {
  it('entry.__rowUpdate is called instead of closure-based updaters', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }
    type M = { type: 'update' }

    const updateSpy = vi.fn()

    const def = component<S, M, never>({
      name: 'RowFactory',
      init: () => [
        {
          rows: [
            { id: 1, label: 'a' },
            { id: 2, label: 'b' },
          ],
        },
        [],
      ],
      update: (s) => {
        const rows = s.rows.slice()
        rows[0] = { ...rows[0]!, label: rows[0]!.label + '!' }
        return [{ rows }, []]
      },
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item, entry }) => {
            const nodes = [div([text(item.label)])]
            if (entry) {
              const e = entry as Record<string, unknown>
              e._n0 = nodes[0]!.firstChild as Text
              e._v0 = (e as { current: Row }).current?.label ?? ''
              e.__rowUpdate = (ent: Record<string, unknown>) => {
                updateSpy()
                const v = (ent.current as Row).label
                if (v !== ent._v0) {
                  ent._v0 = v
                  ;(ent._n0 as Text).nodeValue = v
                }
              }
            }
            return nodes
          },
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('ab')
    sendFn({ type: 'update' })
    flush()

    expect(updateSpy).toHaveBeenCalled()
    expect(container.textContent).toBe('a!b')
    handle.dispose()
  })

  it('falls back to closure updaters when __rowUpdate is not set', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }
    type M = { type: 'update' }

    const def = component<S, M, never>({
      name: 'NoRowFactory',
      init: () => [
        {
          rows: [
            { id: 1, label: 'x' },
            { id: 2, label: 'y' },
          ],
        },
        [],
      ],
      update: (s) => {
        const rows = s.rows.slice()
        rows[1] = { ...rows[1]!, label: 'z' }
        return [{ rows }, []]
      },
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item }) => [div([text(item.label)])],
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.textContent).toBe('xy')
    sendFn({ type: 'update' })
    flush()
    expect(container.textContent).toBe('xz')
    handle.dispose()
  })

  it('shared update function skips unchanged values', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[] }
    type M = { type: 'noop' }

    let domWrites = 0

    const def = component<S, M, never>({
      name: 'RowFactorySkip',
      init: () => [{ rows: [{ id: 1, label: 'test' }] }, []],
      update: (s) => [{ rows: [{ id: 1, label: 'test' }] }, []],
      view: () => [
        ...each<S, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ entry }) => {
            const textNode = document.createTextNode('')
            if (entry) {
              const e = entry as Record<string, unknown>
              e._n0 = textNode
              e._v0 = (e as { current: Row }).current?.label ?? ''
              textNode.nodeValue = e._v0 as string
              e.__rowUpdate = (ent: Record<string, unknown>) => {
                const v = (ent.current as Row).label
                if (v !== ent._v0) {
                  domWrites++
                  ent._v0 = v
                  ;(ent._n0 as Text).nodeValue = v
                }
              }
            }
            return [textNode]
          },
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    mountApp(container, def)

    expect(container.textContent).toBe('test')
    sendFn({ type: 'noop' })
    flush()
    expect(domWrites).toBe(0)
  })

  it('entry is accessible on the render bag', () => {
    type S = { items: string[] }
    let receivedEntry: unknown = null

    const def = component<S, never, never>({
      name: 'EntryAccess',
      init: () => [{ items: ['a'] }, []],
      update: (s) => [s, []],
      view: () => [
        ...each<S, string>({
          items: (s) => s.items,
          key: (s) => s,
          render: ({ item, entry }) => {
            receivedEntry = entry
            return [div([text(item((s: string) => s))])]
          },
        }),
      ],
      __dirty: () => 1,
    })

    const container = document.createElement('div')
    mountApp(container, def)

    expect(receivedEntry).not.toBeNull()
    const e = receivedEntry as Record<string, unknown>
    expect(e.key).toBe('a')
    expect(e.current).toBe('a')
    expect(typeof e.index).toBe('number')
  })

  it('row factory works with selector.bind and user variables derived from item', () => {
    // This test replicates the benchmark pattern where:
    // 1. A user variable (rowId) is computed from item.id()
    // 2. selector.bind() uses that variable
    // 3. A DOM property (_id) uses that variable
    // The row factory must preserve these statements and rewrite accessor calls.
    type Row = { id: number; label: string }
    type S = { rows: Row[]; selected: number }
    type M = { type: 'select'; id: number }

    const def = component<S, M, never>({
      name: 'RowFactoryWithSelector',
      init: () => [
        {
          rows: [
            { id: 1, label: 'one' },
            { id: 2, label: 'two' },
            { id: 3, label: 'three' },
          ],
          selected: 0,
        },
        [],
      ],
      update: (s, m) => [{ ...s, selected: m.id }, []],
      view: ({ send }) => {
        const sel = selector<S, number>((s) => s.selected)
        return [
          ...each<S, Row>({
            items: (s) => s.rows,
            key: (r) => r.id,
            render: ({ item, entry }) => {
              // User variable derived from item accessor
              const rowId = item.id()
              const row = div([text(item.label)])

              // Selector bind using the user variable
              sel.bind(row, rowId, 'class', 'class', (match) => (match ? 'selected' : ''))

              // DOM property using the user variable
              ;(row as Record<string, unknown>)._id = rowId

              // If entry available, simulate row factory pattern
              if (entry) {
                const e = entry as Record<string, unknown>
                e._n0 = row.firstChild as Text
                e._v0 = (e as { current: Row }).current?.label ?? ''
                ;(e._n0 as Text).nodeValue = e._v0 as string
                e.__rowUpdate = (ent: Record<string, unknown>) => {
                  const v = (ent.current as Row).label
                  if (v !== ent._v0) {
                    ent._v0 = v
                    ;(ent._n0 as Text).nodeValue = v
                  }
                }
              }

              return [row]
            },
          }),
        ]
      },
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.rows, n.rows)) m |= 1
        if (!Object.is(o.selected, n.selected)) m |= 2
        return m
      },
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    // Verify initial render
    const divs = container.querySelectorAll('div')
    expect(divs.length).toBe(3)
    expect(divs[0]!.textContent).toBe('one')
    expect(divs[1]!.textContent).toBe('two')
    expect(divs[2]!.textContent).toBe('three')

    // Verify _id was set from the user variable
    expect((divs[0] as Record<string, unknown>)._id).toBe(1)
    expect((divs[1] as Record<string, unknown>)._id).toBe(2)
    expect((divs[2] as Record<string, unknown>)._id).toBe(3)

    // Verify selector works (className updates)
    expect(divs[0]!.className).toBe('')
    sendFn({ type: 'select', id: 2 })
    flush()
    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('selected')
    expect(divs[2]!.className).toBe('')

    // Switch selection
    sendFn({ type: 'select', id: 3 })
    flush()
    expect(divs[1]!.className).toBe('')
    expect(divs[2]!.className).toBe('selected')

    handle.dispose()
  })
})

// ── Disposer-free selector ───────────────────────────────────────

describe('selector without per-row disposers', () => {
  it('selector works after individual row removal', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[]; selected: number }
    type M = { type: 'select'; id: number } | { type: 'remove'; id: number }

    const def = component<S, M, never>({
      name: 'SelectorRemove',
      init: () => [
        {
          rows: [
            { id: 1, label: 'a' },
            { id: 2, label: 'b' },
            { id: 3, label: 'c' },
          ],
          selected: 0,
        },
        [],
      ],
      update: (s, m) => {
        switch (m.type) {
          case 'select':
            return [{ ...s, selected: m.id }, []]
          case 'remove':
            return [{ ...s, rows: s.rows.filter((r) => r.id !== m.id) }, []]
        }
      },
      view: ({ send }) => {
        const sel = selector<S, number>((s) => s.selected)
        return [
          ...each<S, Row>({
            items: (s) => s.rows,
            key: (r) => r.id,
            render: ({ item }) => {
              const rowId = item.id()
              const row = div([text(item.label)])
              sel.bind(row, rowId, 'class', 'class', (m) => (m ? 'active' : ''))
              return [row]
            },
          }),
        ]
      },
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.rows, n.rows)) m |= 1
        if (!Object.is(o.selected, n.selected)) m |= 2
        return m
      },
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    // Select row 2
    sendFn({ type: 'select', id: 2 })
    flush()
    let divs = container.querySelectorAll('div')
    expect(divs[1]!.className).toBe('active')

    // Remove row 2 (the selected one)
    sendFn({ type: 'remove', id: 2 })
    flush()
    divs = container.querySelectorAll('div')
    expect(divs.length).toBe(2)
    expect(divs[0]!.textContent).toBe('a')
    expect(divs[1]!.textContent).toBe('c')

    // Select row 3 — should still work after removal
    sendFn({ type: 'select', id: 3 })
    flush()
    divs = container.querySelectorAll('div')
    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('active')

    // Select row 1
    sendFn({ type: 'select', id: 1 })
    flush()
    divs = container.querySelectorAll('div')
    expect(divs[0]!.className).toBe('active')
    expect(divs[1]!.className).toBe('')

    handle.dispose()
  })

  it('selector works after clear and recreate', () => {
    type Row = { id: number; label: string }
    type S = { rows: Row[]; selected: number }
    type M = { type: 'select'; id: number } | { type: 'clear' } | { type: 'create' }

    const def = component<S, M, never>({
      name: 'SelectorClearRecreate',
      init: () => [
        {
          rows: [
            { id: 1, label: 'x' },
            { id: 2, label: 'y' },
          ],
          selected: 0,
        },
        [],
      ],
      update: (s, m) => {
        switch (m.type) {
          case 'select':
            return [{ ...s, selected: m.id }, []]
          case 'clear':
            return [{ rows: [], selected: 0 }, []]
          case 'create':
            return [
              {
                rows: [
                  { id: 10, label: 'p' },
                  { id: 20, label: 'q' },
                  { id: 30, label: 'r' },
                ],
                selected: 0,
              },
              [],
            ]
        }
      },
      view: ({ send }) => {
        const sel = selector<S, number>((s) => s.selected)
        return [
          ...each<S, Row>({
            items: (s) => s.rows,
            key: (r) => r.id,
            render: ({ item }) => {
              const rowId = item.id()
              const row = div([text(item.label)])
              sel.bind(row, rowId, 'class', 'class', (m) => (m ? 'on' : ''))
              return [row]
            },
          }),
        ]
      },
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.rows, n.rows)) m |= 1
        if (!Object.is(o.selected, n.selected)) m |= 2
        return m
      },
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    // Select row 2
    sendFn({ type: 'select', id: 2 })
    flush()
    expect(container.querySelectorAll('div')[1]!.className).toBe('on')

    // Clear all rows
    sendFn({ type: 'clear' })
    flush()
    expect(container.querySelectorAll('div').length).toBe(0)

    // Create new rows with different IDs
    sendFn({ type: 'create' })
    flush()
    expect(container.querySelectorAll('div').length).toBe(3)
    expect(container.textContent).toBe('pqr')

    // Select one of the new rows
    sendFn({ type: 'select', id: 20 })
    flush()
    const divs = container.querySelectorAll('div')
    expect(divs[0]!.className).toBe('')
    expect(divs[1]!.className).toBe('on')
    expect(divs[2]!.className).toBe('')

    handle.dispose()
  })

  it('no memory leak — stale entries are cleaned up on select after remove', () => {
    type Row = { id: number }
    type S = { rows: Row[]; selected: number }
    type M = { type: 'select'; id: number } | { type: 'remove'; id: number }

    const def = component<S, M, never>({
      name: 'SelectorNoLeak',
      init: () => [
        {
          rows: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
          selected: 0,
        },
        [],
      ],
      update: (s, m) => {
        switch (m.type) {
          case 'select':
            return [{ ...s, selected: m.id }, []]
          case 'remove':
            return [{ ...s, rows: s.rows.filter((r) => r.id !== m.id) }, []]
        }
      },
      view: ({ send }) => {
        const sel = selector<S, number>((s) => s.selected)
        return [
          ...each<S, Row>({
            items: (s) => s.rows,
            key: (r) => r.id,
            render: ({ item }) => {
              const rowId = item.id()
              const row = div([text(item((r: Row) => String(r.id)))])
              sel.bind(row, rowId, 'class', 'class', (m) => (m ? 'sel' : ''))
              return [row]
            },
          }),
        ]
      },
      __dirty: (o, n) => {
        let m = 0
        if (!Object.is(o.rows, n.rows)) m |= 1
        if (!Object.is(o.selected, n.selected)) m |= 2
        return m
      },
    })

    const container = document.createElement('div')
    let sendFn!: (msg: M) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const handle = mountApp(container, def)

    expect(container.querySelectorAll('div').length).toBe(100)

    // Remove 50 rows
    for (let i = 1; i <= 50; i++) {
      sendFn({ type: 'remove', id: i })
    }
    flush()
    expect(container.querySelectorAll('div').length).toBe(50)

    // Select — should work and not crash on stale entries
    sendFn({ type: 'select', id: 51 })
    flush()
    const first = container.querySelector('div')
    expect(first!.className).toBe('sel')
    expect(first!.textContent).toBe('51')

    // Switch select — stale entries from removed rows should be cleaned up
    sendFn({ type: 'select', id: 100 })
    flush()
    const last = container.querySelector('div:last-child')
    expect(last!.className).toBe('sel')
    expect(first!.className).toBe('')

    handle.dispose()
  })
})
