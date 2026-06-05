import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, span, text } from '../../src/signals/authoring'
import { derived, pathHandle, isSignalHandle } from '../../src/signals/handle'

// `derived([a, b, …], fn)` combines N independent signals into one. The compiler
// lowers it inside a DIRECT view; in a view-HELPER (the form-validation `field()`
// shape) it runs at runtime and must behave identically: produce/peek combine the
// sources, deps are the UNION (so the binding fires when any source changes), and
// the result chains with `.map()`. This was a type-surface-only stub that threw
// "not implemented yet" — the runtime path was never built or tested.

interface S {
  values: { email: string; age: number }
  touched: Record<string, boolean>
}

describe('derived (runtime handle)', () => {
  it('produces fn over the sources and unions their deps', () => {
    // raw handles rooted at the same state, as the runtime builds them
    const state = { a: 2, b: 3 }
    const a = pathHandle<number>(() => state, 'a')
    const b = pathHandle<number>(() => state, 'b')
    const sum = derived([a, b], (x, y) => x + y)

    expect(isSignalHandle(sum)).toBe(true)
    expect(sum.peek()).toBe(5)
    expect((sum as unknown as { produce: (s: unknown) => number }).produce({ a: 10, b: 1 })).toBe(
      11,
    )
    expect([...(sum as unknown as { deps: readonly string[] }).deps].sort()).toEqual(['a', 'b'])
  })

  it('variadic form derived(a, b, fn) matches the array form', () => {
    const state = { a: 2, b: 3 }
    const a = pathHandle<number>(() => state, 'a')
    const b = pathHandle<number>(() => state, 'b')
    const sum = derived(a, b, (x, y) => x + y)

    expect(isSignalHandle(sum)).toBe(true)
    expect(sum.peek()).toBe(5)
    expect((sum as unknown as { produce: (s: unknown) => number }).produce({ a: 10, b: 1 })).toBe(
      11,
    )
    expect([...(sum as unknown as { deps: readonly string[] }).deps].sort()).toEqual(['a', 'b'])
  })

  it('variadic form derived(a, b, c, fn) combines three sources', () => {
    const state = { a: 1, b: 2, c: 4 }
    const a = pathHandle<number>(() => state, 'a')
    const b = pathHandle<number>(() => state, 'b')
    const c = pathHandle<number>(() => state, 'c')
    const sum = derived(a, b, c, (x, y, z) => x + y + z)
    expect(sum.peek()).toBe(7)
    expect([...(sum as unknown as { deps: readonly string[] }).deps].sort()).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('dedups overlapping deps and chains with .map()', () => {
    const state = { a: 4 }
    const a = pathHandle<number>(() => state, 'a')
    const doubled = a.map((x) => x * 2) // deps ['a']
    const combined = derived([a, doubled], (x, y) => x + y) // deps union -> ['a']
    expect([...(combined as unknown as { deps: readonly string[] }).deps]).toEqual(['a'])

    const labeled = combined.map((n) => `=${n}`)
    expect(labeled.peek()).toBe('=12') // 4 + 8
  })

  it('rejects a non-signal input', () => {
    const a = pathHandle<number>(() => ({ a: 1 }), 'a')
    const notASignal = 5 as unknown as typeof a
    expect(() => derived([a, notASignal], (x, y) => x + y)).toThrow(/signal/i)
  })

  it('throws on .at() of a combined signal (slice before combining)', () => {
    const a = pathHandle<{ x: number }>(() => ({ a: { x: 1 } }), 'a')
    const b = pathHandle<{ x: number }>(() => ({ b: { x: 2 } }), 'b')
    const combined = derived([a, b], (p: { x: number }, q: { x: number }) => ({ x: p.x + q.x }))
    // `.at()` on a mapped/combined signal is a COMPILE error now (MappedSignal.at
    // is `never`) — bypass the type to assert the runtime safety net still throws
    // for any code that reaches here uncompiled.
    const escaped = combined as unknown as { at: (path: string) => unknown }
    expect(() => escaped.at('x')).toThrow()
  })

  it('renders + reacts in a component view (the form-validation field() shape)', () => {
    const container = document.createElement('div')
    // mountSignalComponent runs the authoring path (uncompiled) — exactly what a
    // view-helper calling derived() hits in a real build.
    const h = mountSignalComponent<
      S,
      { type: 'setAge'; age: number } | { type: 'touch'; field: string }
    >(container, {
      init: () => ({ values: { email: 'a@b.c', age: 10 }, touched: {} }),
      update: (s, m) =>
        m.type === 'setAge'
          ? { ...s, values: { ...s.values, age: m.age } }
          : { ...s, touched: { ...s.touched, [m.field]: true } },
      view: ({ state }) => {
        const values = state.at('values')
        const ageTouched = state.at('touched').at('age').map(Boolean)
        // combine a path handle (values) with a mapped handle (ageTouched)
        const error = derived([values, ageTouched], (vals, touched) =>
          touched && vals.age < 13 ? 'must be 13+' : '',
        )
        return [
          div({ class: error.map((msg) => (msg ? 'field has-error' : 'field')) }, [
            span({ class: 'err' }, [text(error)]),
          ]),
        ]
      },
    })

    const field = () => container.querySelector('div')!
    const err = () => container.querySelector('.err')!.textContent

    // untouched -> no error even though age < 13
    expect(err()).toBe('')
    expect(field().getAttribute('class')).toBe('field')

    // touch the field -> error appears (touched source changed)
    h.send({ type: 'touch', field: 'age' })
    expect(err()).toBe('must be 13+')
    expect(field().getAttribute('class')).toBe('field has-error')

    // bump age >= 13 -> error clears (values source changed)
    h.send({ type: 'setAge', age: 20 })
    expect(err()).toBe('')
    expect(field().getAttribute('class')).toBe('field')

    h.dispose()
  })
})
