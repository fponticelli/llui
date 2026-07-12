import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text } from '../../src/signals/authoring'
import { derived, pathHandle } from '../../src/signals/handle'

// A `.map()` / `derived()` handle wraps a pure fn over its resolved inputs. The
// runtime evaluates a handle's `produce(state)` once PER DOWNSTREAM BINDING per
// update (N bindings reading the same `.map` = N calls), and the reconciler
// relies on OUTPUT-equality (`Object.is`) to gate commits. Re-running `fn` when
// the resolved inputs are reference-identical is pure waste. `derivedHandle`
// carries a single-slot memo keyed on INPUT identity: it recomputes only when a
// resolved input differs by reference (the same reference-equality-per-path
// contract the mask gate already uses), so it never changes observable output.

// Reach the internal `produce(state)` — the accessor the runtime binding calls.
const produceOf = <T>(h: unknown): ((s: unknown) => T) =>
  (h as { produce: (s: unknown) => T }).produce

describe('derivedHandle input-identity memo — .map', () => {
  it('runs fn ONCE when produce is called repeatedly with the same state ref', () => {
    const state = { a: 1, b: 2 }
    let calls = 0
    const a = pathHandle<number>(() => state, 'a')
    const mapped = a.map((x) => {
      calls++
      return x * 2
    })
    const produce = produceOf<number>(mapped)
    expect(produce(state)).toBe(2)
    expect(produce(state)).toBe(2)
    expect(produce(state)).toBe(2)
    expect(calls).toBe(1)
  })

  it('memo hits across DIFFERENT state refs when the resolved input is ref-identical', () => {
    // The value at path `a` is the SAME object across s1/s2 (only `b` changed).
    // Under the mask contract the input didn't change, so fn must not re-run.
    const sharedA = { n: 5 }
    const s1 = { a: sharedA, b: 1 }
    const s2 = { a: sharedA, b: 2 }
    let calls = 0
    const a = pathHandle<{ n: number }>(() => s1, 'a')
    const mapped = a.map((x) => {
      calls++
      return x.n * 10
    })
    const produce = produceOf<number>(mapped)
    expect(produce(s1)).toBe(50)
    expect(produce(s2)).toBe(50)
    expect(calls).toBe(1)
  })

  it('re-runs fn when the resolved input reference changes', () => {
    let calls = 0
    const a = pathHandle<number>(() => ({ a: 0 }), 'a')
    const mapped = a.map((x) => {
      calls++
      return x + 1
    })
    const produce = produceOf<number>(mapped)
    expect(produce({ a: 1 })).toBe(2)
    expect(produce({ a: 2 })).toBe(3)
    expect(produce({ a: 2, b: 9 })).toBe(3) // a unchanged -> memo hit
    expect(calls).toBe(2)
  })

  it('memoizes each level of a derived-of-derived chain independently', () => {
    const state = { a: 3, b: 0 }
    let f = 0
    let g = 0
    const a = pathHandle<number>(() => state, 'a')
    const m1 = a.map((x) => {
      f++
      return x + 1
    })
    const m2 = m1.map((x) => {
      g++
      return x * 10
    })
    const produce = produceOf<number>(m2)
    expect(produce(state)).toBe(40)
    expect(produce(state)).toBe(40)
    // b changed but a (m1's only input) did not: inner fn stays cached, so the
    // outer fn's input is ref-identical too -> neither re-runs.
    expect(produce({ a: 3, b: 1 })).toBe(40)
    expect(f).toBe(1)
    expect(g).toBe(1)
  })
})

describe('derivedHandle input-identity memo — derived([...], fn)', () => {
  it('runs the combiner ONCE for repeated same-state produce calls', () => {
    const state = { a: 2, b: 3 }
    let calls = 0
    const a = pathHandle<number>(() => state, 'a')
    const b = pathHandle<number>(() => state, 'b')
    const sum = derived([a, b], (x, y) => {
      calls++
      return x + y
    })
    const produce = produceOf<number>(sum)
    expect(produce(state)).toBe(5)
    expect(produce(state)).toBe(5)
    expect(calls).toBe(1)
  })

  it('re-runs when ANY one input reference changes, holds when all inputs are stable', () => {
    let calls = 0
    const a = pathHandle<number>(() => ({}), 'a')
    const b = pathHandle<number>(() => ({}), 'b')
    const sum = derived([a, b], (x, y) => {
      calls++
      return x + y
    })
    const produce = produceOf<number>(sum)
    expect(produce({ a: 1, b: 1 })).toBe(2) // miss
    expect(produce({ a: 1, b: 1 })).toBe(2) // both stable -> hit
    expect(produce({ a: 2, b: 1 })).toBe(3) // a changed -> miss
    expect(produce({ a: 2, b: 2 })).toBe(4) // b changed -> miss
    expect(calls).toBe(3)
  })
})

describe('component-level: N bindings reading one .map compute fn once per update', () => {
  it('runs the mapped fn once even though three bindings read it, and stays reactive', () => {
    const container = document.createElement('div')
    let calls = 0
    const h = mountSignalComponent<
      { n: number; other: number },
      { type: 'inc' } | { type: 'noise' }
    >(container, {
      init: () => ({ n: 1, other: 0 }),
      update: (s, m) => (m.type === 'inc' ? { ...s, n: s.n + 1 } : { ...s, other: s.other + 1 }),
      view: ({ state }) => {
        const doubled = state.at('n').map((n) => {
          calls++
          return String(n * 2)
        })
        // three independent bindings, all reading the same mapped handle
        return [
          div({}, [text(doubled)]),
          span({ class: 'a' }, [text(doubled)]),
          span({ class: 'b' }, [text(doubled)]),
        ]
      },
    })
    const texts = () => [...container.querySelectorAll('div, span')].map((e) => e.textContent)

    // mount: one evaluation for all three bindings
    expect(texts()).toEqual(['2', '2', '2'])
    expect(calls).toBe(1)

    calls = 0
    h.send({ type: 'inc' }) // n changed -> exactly one recompute for all three
    expect(texts()).toEqual(['4', '4', '4'])
    expect(calls).toBe(1)

    calls = 0
    h.send({ type: 'noise' }) // n unchanged -> bindings gated out, fn not called
    expect(texts()).toEqual(['4', '4', '4'])
    expect(calls).toBe(0)

    h.dispose()
  })
})

describe('property: memoized produce equals a pure oracle across random update sequences', () => {
  it('never diverges from fn-of-resolved-inputs over 400 random states', () => {
    // Deterministic LCG so failures are reproducible.
    let seed = 0x9e3779b9
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff
    }
    const pick = (n: number) => Math.floor(rnd() * n)

    // A pool of shared sub-objects so consecutive states frequently share a ref
    // at a given path (exercising the cross-ref memo-hit path).
    const aPool = [{ v: 0 }, { v: 1 }, { v: 2 }]
    const bPool = [10, 20, 30]

    type St = { a: { v: number }; b: number }
    let live: St = { a: aPool[0]!, b: bPool[0]! }
    const a = pathHandle<{ v: number }>(() => live, 'a')
    const b = pathHandle<number>(() => live, 'b')
    const mapped = a.map((x) => ({ tag: x.v * 3 })) // object-returning -> ref churn
    const combined = derived([a, b], (x: { v: number }, y: number) => x.v + y)
    const chained = mapped.map((o) => `t${o.tag}`)

    const mProduce = produceOf<{ tag: number }>(mapped)
    const cProduce = produceOf<number>(combined)
    const chProduce = produceOf<string>(chained)

    for (let i = 0; i < 400; i++) {
      const st: St = { a: aPool[pick(aPool.length)]!, b: bPool[pick(bPool.length)]! }
      live = st
      // Oracle: apply the pure fns directly to the freshly-resolved inputs.
      expect(mProduce(st)).toEqual({ tag: st.a.v * 3 })
      expect(cProduce(st)).toBe(st.a.v + st.b)
      expect(chProduce(st)).toBe(`t${st.a.v * 3}`)
    }
  })
})
