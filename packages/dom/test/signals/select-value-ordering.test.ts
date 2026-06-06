import { describe, it, expect, afterEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el, react, type PropValue } from '../../src/signals/dom'
import { select, option, each, show, text } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'

// Regression: a reactive `value` binding on a <select> whose <option>s come from
// `each()` must resolve to the BOUND value on first mount — not to whichever
// option `each` happens to insert first into the (initially empty) <select>.
//
// Root cause (pre-fix): `populate` pushed the element's prop bindings (the
// select's `value`) BEFORE materializing children. The `each` rows are built
// when the each's structural binding commits, which (sharing the same scope)
// ran AFTER the value commit — so `select.value = 'b'` was assigned while the
// <select> had zero <option>s, the browser dropped it, and the first option
// `each` inserted (it inserts right-to-left) ended up selected. The bug was
// masked only when the bound value happened to be the LAST option.
//
// Fix: `populate` materializes children first, so the each's options exist by
// the time the select's `value` binding commits.

interface S {
  open: boolean
  value: string
  opts: { id: string; name: string }[]
}

const seed = (value: string, ids: string[], open = true): S => ({
  open,
  value,
  opts: ids.map((id) => ({ id, name: id.toUpperCase() })),
})

function mountDirect(state: S) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, { type: 'noop' }>(container, {
    init: () => state,
    update: (s) => s,
    view: ({ state }) => [
      select({ 'data-probe': '', value: (state as Signal<S>).at('value') }, [
        each((state as Signal<S>).at('opts'), {
          key: (o) => o.id,
          render: (item) => [option({ value: item.at('id') }, [text(item.at('name'))])],
        }),
      ]),
    ],
  })
  return { container, h, sel: () => container.querySelector('select') as HTMLSelectElement }
}

function mountBehindShow(state: S) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, { type: 'noop' }>(container, {
    init: () => state,
    update: (s) => s,
    view: ({ state }) => [
      show((state as Signal<S>).at('open'), () => [
        select({ 'data-probe': '', value: (state as Signal<S>).at('value') }, [
          each((state as Signal<S>).at('opts'), {
            key: (o) => o.id,
            render: (item) => [option({ value: item.at('id') }, [text(item.at('name'))])],
          }),
        ]),
      ]),
    ],
  })
  return { container, h, sel: () => container.querySelector('select') as HTMLSelectElement }
}

// (value, options) cases — covers first / middle / last selected positions, the
// last being the case that coincidentally passed before the fix.
const CASES: ReadonlyArray<readonly [string, string[]]> = [
  ['a', ['a', 'b']], // first
  ['b', ['a', 'b']], // last
  ['a', ['a', 'b', 'c']], // first
  ['b', ['a', 'b', 'c']], // middle
  ['c', ['a', 'b', 'c']], // last
]

describe('<select> reactive value with each()-produced options', () => {
  for (const [value, ids] of CASES) {
    it(`direct: selects bound value '${value}' from [${ids.join(',')}] on first mount`, () => {
      const { sel } = mountDirect(seed(value, ids))
      expect(sel().value).toBe(value)
      expect(sel().selectedIndex).toBe(ids.indexOf(value))
    })

    it(`behind show(): selects bound value '${value}' from [${ids.join(',')}] on first mount`, () => {
      const { sel } = mountBehindShow(seed(value, ids))
      expect(sel().value).toBe(value)
      expect(sel().selectedIndex).toBe(ids.indexOf(value))
    })
  }

  it('behind show(): re-mounting the arm (toggle off→on) re-selects the bound value', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'toggle' }>(container, {
      init: () => seed('b', ['a', 'b', 'c'], true),
      update: (s, m) => (m.type === 'toggle' ? { ...s, open: !s.open } : s),
      view: ({ state }) => [
        show((state as Signal<S>).at('open'), () => [
          select({ value: (state as Signal<S>).at('value') }, [
            each((state as Signal<S>).at('opts'), {
              key: (o) => o.id,
              render: (item) => [option({ value: item.at('id') }, [text(item.at('name'))])],
            }),
          ]),
        ]),
      ],
    })
    const sel = () => container.querySelector('select') as HTMLSelectElement | null
    expect(sel()!.value).toBe('b')
    h.send({ type: 'toggle' }) // off — arm + scope torn down
    expect(sel()).toBeNull()
    h.send({ type: 'toggle' }) // on — arm rebuilt FRESH; value must re-resolve
    expect(sel()!.value).toBe('b')
    expect(sel()!.selectedIndex).toBe(1)
  })

  it('still updates correctly after a state-driven value change', () => {
    const { h, sel } = mountDirect(seed('b', ['a', 'b', 'c']))
    expect(sel().value).toBe('b')
    // Output-equality: the value binding only re-commits when its produced value
    // changes. The first-mount commit must already be correct, otherwise a later
    // change that lands on the wrong-but-equal value would never re-resolve.
    h.send({ type: 'noop' })
    expect(sel().value).toBe('b')
  })
})

// Regression: a per-<option> reactive `selected` binding inside `each()` must
// take effect on the right row. A single <select> coordinates selection across
// its options, so `option.selected = true` only "sticks" once the option is a
// CHILD of the select. Pre-fix, `each` committed each row's bindings (scope.mount)
// in phase 1 — while the option was still DETACHED — then inserted the option in
// phase 3; the detached `selected = true` was dropped and the first-inserted
// option ended up selected instead. Fix: `each` mounts a new row's scope in
// phase 3, AFTER its nodes are connected to the parent (the "insert FIRST, then
// mount" contract the rest of the runtime already honors).

interface SelS {
  opts: { id: string; sel: boolean }[]
}

const selSeed = (ids: string[], selected: string | string[]): SelS => {
  const set = new Set(Array.isArray(selected) ? selected : [selected])
  return { opts: ids.map((id) => ({ id, sel: set.has(id) })) }
}

function mountSelectedEach(state: SelS, multiple: boolean) {
  const container = document.createElement('div')
  const props = multiple ? { multiple: true } : {}
  const h = mountSignalComponent<SelS, { type: 'noop' }>(container, {
    init: () => state,
    update: (s) => s,
    view: ({ state }) => [
      select(props, [
        each((state as Signal<SelS>).at('opts'), {
          key: (o) => o.id,
          render: (item) => [
            option({ value: item.at('id'), selected: item.at('sel') }, [text(item.at('id'))]),
          ],
        }),
      ]),
    ],
  })
  const sel = () => container.querySelector('select') as HTMLSelectElement
  const selectedIds = () =>
    Array.from(sel().options)
      .filter((o) => o.selected)
      .map((o) => o.value)
  return { container, h, sel, selectedIds }
}

describe('per-<option> selected binding inside each()', () => {
  for (const target of ['a', 'b', 'c'] as const) {
    it(`single select: marks option '${target}' selected from [a,b,c]`, () => {
      const { sel, selectedIds } = mountSelectedEach(selSeed(['a', 'b', 'c'], target), false)
      expect(selectedIds()).toEqual([target])
      expect(sel().value).toBe(target)
    })
  }

  it('multiple select: marks every selected option', () => {
    const { selectedIds } = mountSelectedEach(selSeed(['a', 'b', 'c', 'd'], ['b', 'd']), true)
    expect(selectedIds()).toEqual(['b', 'd'])
  })

  it('multiple select: first + last both selected', () => {
    const { selectedIds } = mountSelectedEach(selSeed(['a', 'b', 'c'], ['a', 'c']), true)
    expect(selectedIds()).toEqual(['a', 'c'])
  })
})

// Invariant: form-control SELECTION props (value/checked/selected) commit AFTER
// every other prop, regardless of author key order. This is the order browsers
// require for `<input type=range>` (value is clamped to min/max set at assignment
// time) — jsdom doesn't clamp, so we assert the commit ORDER directly, which is
// the contract. Robust prop-order independence matters for LLM-emitted views.
describe('selection props commit after other props (prop-order independence)', () => {
  // Spy on min/max attribute writes and the .value setter to record commit order.
  let log: string[] = []
  let restore: (() => void) | null = null

  afterEach(() => {
    restore?.()
    restore = null
    log = []
  })

  function instrument(): void {
    const proto = Object.getPrototypeOf(document.createElement('input')) as HTMLInputElement
    const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value')!
    const origSetAttr = Element.prototype.setAttribute
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get() {
        return valueDesc.get!.call(this)
      },
      set(v) {
        log.push('value')
        valueDesc.set!.call(this, v)
      },
    })
    Element.prototype.setAttribute = function (this: Element, name: string, v: string) {
      if (name === 'min' || name === 'max') log.push(name)
      return origSetAttr.call(this, name, v)
    }
    restore = () => {
      Object.defineProperty(proto, 'value', valueDesc)
      Element.prototype.setAttribute = origSetAttr
    }
  }

  // All three are REACTIVE bindings (committed at scope.mount in registration
  // order) — so the ONLY thing that puts `value` after `min`/`max` is `populate`
  // pushing selection props last. With min/max also reactive, a value-first key
  // order would commit value before them WITHOUT the reorder, so this discriminates.
  interface RS {
    v: number
    lo: number
    hi: number
  }
  const rv: PropValue = react((s) => (s as RS).v, ['v'])
  const rlo: PropValue = react((s) => (s as RS).lo, ['lo'])
  const rhi: PropValue = react((s) => (s as RS).hi, ['hi'])

  function run(props: Record<string, PropValue>) {
    instrument()
    const container = document.createElement('div')
    mountSignalComponent<RS, { type: 'x' }>(container, {
      init: () => ({ v: 5, lo: 0, hi: 10 }),
      update: (s) => s,
      view: () => [el('input', props)],
    })
    return log.slice()
  }

  it('value AFTER min/max when value is declared first', () => {
    const seq = run({ type: 'range', value: rv, min: rlo, max: rhi })
    expect(seq.indexOf('value')).toBeGreaterThan(seq.indexOf('min'))
    expect(seq.indexOf('value')).toBeGreaterThan(seq.indexOf('max'))
  })

  it('value AFTER min/max when value is declared last', () => {
    const seq = run({ type: 'range', min: rlo, max: rhi, value: rv })
    expect(seq.indexOf('value')).toBeGreaterThan(seq.indexOf('min'))
    expect(seq.indexOf('value')).toBeGreaterThan(seq.indexOf('max'))
  })
})
