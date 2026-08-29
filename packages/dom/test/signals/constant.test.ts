import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, ul, li, text, each, noSend } from '../../src/signals/authoring'
import { constant, pathHandle, isSignalHandle, derived } from '../../src/signals/handle'
import type { Signal, MappedSignal } from '../../src/signals/types'

// `constant(v)` — a signal handle whose value never changes (#235's "Note on the
// state model"; NOT #231, whose widget's state changes — that is `island()`).
//
// The motivating shape: all 72 `connect(state, send, opts)` entry points in
// `@llui/components` demand `Signal<S>` + `Send<M>`, so a widget whose values are
// FIXED FOR THE LIFE OF THE NODE has no way to call one without hoisting a state
// slice per widget into an ancestor's `State`. `constant` + `noSend` is that
// missing input pair.
//
// It cannot be assembled from `pathHandle` in user land — see the first test
// below, which pins the SILENT failure that motivates a real primitive.

/** Read a handle's private carrier (the same escape the other handle tests use). */
function carrier<T>(sig: Signal<T> | MappedSignal<T>): {
  produce: (state: unknown) => T
  deps: readonly string[]
  rowLocal?: boolean
} {
  if (!isSignalHandle(sig)) throw new Error('expected a signal handle')
  return sig as unknown as {
    produce: (state: unknown) => T
    deps: readonly string[]
    rowLocal?: boolean
  }
}

interface S {
  count: number
}
type M = { type: 'inc' }

function mount(view: Parameters<typeof mountSignalComponent<S, M>>[1]['view']) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ count: 0 }),
    update: (s, m) => (m.type === 'inc' ? { count: s.count + 1 } : s),
    view,
  })
  return { container, h }
}

describe('constant — why it must be a primitive', () => {
  it('the user-land pathHandle hack resolves against the BINDING state, not the closed-over value', () => {
    // The obvious hack. `produce` walks the path 'v' against whatever state the
    // binding is evaluated with — the component state, which has no `v` — so the
    // captured value never appears. It fails SILENTLY (empty string, no throw),
    // which is exactly why `constant` exists.
    const hack = pathHandle<string>(() => ({ v: 'LAB-42' }), 'v')
    expect(hack.peek()).toBe('LAB-42') // peek reads the closure, so it LOOKS right
    expect(carrier(hack).produce({ count: 0 })).toBeUndefined() // the binding sees nothing

    const { container, h } = mount(() => [span([text(hack)])])
    expect(container.querySelector('span')!.textContent).toBe('') // rendered empty
    h.dispose()
  })
})

describe('constant — carrier', () => {
  it('is a signal handle', () => {
    expect(isSignalHandle(constant('x'))).toBe(true)
  })

  it('produce ignores the binding state entirely', () => {
    const c = constant('LAB-42')
    const { produce } = carrier(c)
    expect(produce({ count: 0 })).toBe('LAB-42')
    expect(produce({ anything: 'else' })).toBe('LAB-42')
    expect(produce(undefined)).toBe('LAB-42')
    expect(c.peek()).toBe('LAB-42')
  })

  it('declares no dependencies — the empty mask can never be dirty', () => {
    expect([...carrier(constant(1)).deps]).toEqual([])
    expect([...carrier(constant({ a: { b: 1 } }).at('a.b')).deps]).toEqual([])
    expect([...carrier(constant(2).map((n) => n * 2)).deps]).toEqual([])
  })

  it('carries a value of any shape by reference', () => {
    const obj = { a: 1 }
    expect(constant(obj).peek()).toBe(obj)
    expect(constant(null).peek()).toBeNull()
    expect(constant(undefined).peek()).toBeUndefined()
  })

  it('`.at()` SNAPSHOTS while `peek()` reads the LIVE object — the reference-carrying consequence', () => {
    // Carrying by reference is only half the story: `.at(path)` resolves the path
    // EAGERLY, at `.at()` time, so it freezes what it found, while `peek()` walks
    // through to whatever the object now holds. Neither is wrong, and the
    // divergence is only reachable by mutating a value you handed to `constant`
    // (which the JSDoc tells you not to do) — but it is the kind of asymmetry that
    // is discovered at 2am, so it is pinned rather than implied.
    const obj: { v: string } = { v: 'BEFORE' }
    const sig = constant(obj)
    const sliced = sig.at('v') // resolves NOW
    obj.v = 'AFTER'

    expect(sliced.peek()).toBe('BEFORE') // snapshot at .at() time
    expect(carrier(sliced).produce({})).toBe('BEFORE')
    expect(sig.peek().v).toBe('AFTER') // live read through the captured reference
    // A view built before the mutation therefore renders BEFORE forever — correct,
    // since a constant's binding runs once at mount and is never re-evaluated.
    const { container, h } = mount(() => [span([text(sliced)])])
    expect(container.querySelector('span')!.textContent).toBe('BEFORE')
    h.dispose()
  })
})

describe('constant — .at() / .map() composition', () => {
  it('.at() slices the captured value and stays constant', () => {
    const c = constant({ patient: { name: 'Ada', age: 36 } })
    const name = c.at('patient.name')
    expect(name.peek()).toBe('Ada')
    expect(carrier(name).produce({ patient: { name: 'WRONG' } })).toBe('Ada')
    expect([...carrier(name).deps]).toEqual([])
    // and it chains
    expect(c.at('patient').at('age').peek()).toBe(36)
  })

  it('.at() on an absent path yields undefined rather than throwing', () => {
    const c = constant<{ a?: { b: number } }>({})
    expect(c.at('a.b').peek()).toBeUndefined()
  })

  it('.map() derives and stays constant', () => {
    const c = constant(21)
    const doubled = c.map((n) => n * 2)
    expect(doubled.peek()).toBe(42)
    expect(carrier(doubled).produce({ count: 999 })).toBe(42)
    expect(doubled.map((n) => `=${n}`).peek()).toBe('=42')
  })

  it('.map() keeps the MappedSignal contract — .at() after .map() throws', () => {
    const mapped = constant({ a: 1 }).map((v) => v)
    // The public type is `at: never` (so `mapped.at('a')` is a COMPILE error, and
    // the `at-after-map` lint rule is the other half); the runtime carrier keeps
    // the throwing safety net every other derived handle has, for uncompiled JS
    // callers that get past both.
    const escape = mapped as unknown as { at: (p: string) => unknown }
    expect(() => escape.at('a')).toThrow(/\.at\(\) on a mapped/)
  })

  it('.at().map() is the supported order and works', () => {
    expect(
      constant({ patient: { name: 'Ada' } })
        .at('patient.name')
        .map((n) => n.toUpperCase())
        .peek(),
    ).toBe('ADA')
  })

  it('composes into derived() alongside a real state signal', () => {
    const state = { count: 7 }
    const live = pathHandle<number>(() => state, 'count')
    const scale = constant(3)
    const combined = derived([live, scale], (c, s) => (c as number) * (s as number))
    expect(carrier(combined).produce({ count: 5 })).toBe(15)
    // Only the live source contributes a dep — the constant adds none.
    expect([...carrier(combined).deps]).toEqual(['count'])
  })
})

describe('constant — in a live component', () => {
  it('renders, and survives host updates without going stale or blank', () => {
    const { container, h } = mount(({ state }) => [
      span({ 'data-id': constant('LAB-42') }, [text(constant('Sodium'))]),
      div([text(state.at('count').map(String))]),
    ])

    const s = container.querySelector('span')!
    expect(s.textContent).toBe('Sodium')
    expect(s.getAttribute('data-id')).toBe('LAB-42')
    expect(container.querySelector('div')!.textContent).toBe('0')

    // Ten host updates: the reactive sibling advances, the constant does not
    // blank, is not rewritten, and is not re-evaluated (its mask is empty).
    for (let i = 0; i < 10; i++) h.send({ type: 'inc' })
    expect(container.querySelector('div')!.textContent).toBe('10')
    const after = container.querySelector('span')!
    expect(after).toBe(s) // same node — never rebuilt
    expect(after.textContent).toBe('Sodium')
    expect(after.getAttribute('data-id')).toBe('LAB-42')
    h.dispose()
  })

  it('is evaluated exactly once — at mount, never on update', () => {
    let produced = 0
    // A real `constant` carrier (brand, deps, rowLocal, at, map) with an
    // INSTRUMENTED `produce`, because nothing observable distinguishes "produced
    // once" from "produced six times" on a value that never changes. If the
    // instrumentation broke the handle brand, `text()` would fall through to
    // `staticText(String(handle))` and `produced` would stay 0 — so the `toBe(1)`
    // below is also the proof that the handle path ran.
    const c = constant('once')
    const counted: Signal<string> = {
      ...(c as unknown as Record<string, unknown>),
      produce: () => {
        produced++
        return 'once'
      },
    } as unknown as Signal<string>

    const { container, h } = mount(() => [span([text(counted)])])
    expect(produced).toBe(1)
    for (let i = 0; i < 5; i++) h.send({ type: 'inc' })
    expect(produced).toBe(1) // empty mask -> gated out of every update
    expect(container.querySelector('span')!.textContent).toBe('once')
    h.dispose()
  })
})

interface RowState {
  items: readonly string[]
  tick: number
}
type RowMsg = { type: 'tick' } | { type: 'drop' }

describe('constant — inside an each row', () => {
  it('resolves in a row build (deps [] needs no rebasing) and stays constant across updates', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<RowState, RowMsg>(container, {
      init: () => ({ items: ['a', 'b', 'c'], tick: 0 }),
      update: (s, m) =>
        m.type === 'tick' ? { ...s, tick: s.tick + 1 } : { ...s, items: s.items.slice(1) },
      view: ({ state }) => [
        ul([
          each(state.at('items'), {
            key: (it) => it,
            // A row that mounts on the combined `{ item, state, index }` ctx. A
            // component-rooted handle would be rebased to read `ctx.state`; the
            // constant has no deps to rebase and ignores the ctx outright, so it
            // must render identically in a row and at the top level.
            render: (item) => [
              li({ 'data-unit': constant('mmol/L') }, [text(item), text(constant(' · fixed'))]),
            ],
          }),
        ]),
      ],
    })

    const read = () =>
      [...container.querySelectorAll('li')].map((el) => [
        el.textContent,
        el.getAttribute('data-unit'),
      ])
    expect(read()).toEqual([
      ['a · fixed', 'mmol/L'],
      ['b · fixed', 'mmol/L'],
      ['c · fixed', 'mmol/L'],
    ])

    h.send({ type: 'tick' }) // unrelated component-state change sweeps the rows
    expect(read()).toEqual([
      ['a · fixed', 'mmol/L'],
      ['b · fixed', 'mmol/L'],
      ['c · fixed', 'mmol/L'],
    ])

    h.send({ type: 'drop' }) // structural change: rows reconcile
    expect(read()).toEqual([
      ['b · fixed', 'mmol/L'],
      ['c · fixed', 'mmol/L'],
    ])
    h.dispose()
  })

  it('serves an each items source, so a fixed list needs no state slice', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<RowState, RowMsg>(container, {
      init: () => ({ items: [], tick: 0 }),
      update: (s) => ({ ...s, tick: s.tick + 1 }),
      view: () => [
        ul([
          each(constant(['x', 'y']), {
            key: (it) => it,
            render: (item) => [li([text(item)])],
          }),
        ]),
      ],
    })
    expect([...container.querySelectorAll('li')].map((el) => el.textContent)).toEqual(['x', 'y'])
    h.send({ type: 'tick' })
    expect([...container.querySelectorAll('li')].map((el) => el.textContent)).toEqual(['x', 'y'])
    h.dispose()
  })
})

describe('noSend', () => {
  it('discards every message and returns undefined', () => {
    expect(noSend({ type: 'anything' })).toBeUndefined()
    expect(() => noSend(undefined)).not.toThrow()
  })

  it('satisfies a Send<M> parameter for an arbitrary M (compile-time; `pnpm check` is the assertion)', () => {
    type WidgetMsg = { type: 'a' } | { type: 'b'; n: number }
    const takesSend = (_send: (msg: WidgetMsg) => void): void => {}
    takesSend(noSend)
    // `Send<never>` would NOT compile here — a function type's parameter is
    // contravariant under strictFunctionTypes, so `WidgetMsg` would have to be
    // assignable to `never`. `Send<unknown>` is the type that fits every M.
  })
})
