import { describe, it, expect } from 'vitest'
import { component, mountApp, input } from '../src/index'

// Runtime contract for the whole-state sentinel that the compiler
// appends to `__prefixes` when any reactive accessor in a file flows
// state opaquely (function-arg invocation, spread, dynamic key, etc.).
//
// The compile-time emission is covered in
// `@llui/compiler` test/transform.test.ts; this test verifies the
// SHAPE the compiler emits actually does the work it's supposed to:
//
//   1. With the sentinel present, a FULL_MASK (both words) binding
//      re-evaluates even when the only changed field has no
//      precise-prefix entry — that's the bug the sentinel exists to
//      fix.
//   2. Without the sentinel, the same binding silently never
//      re-evaluates — proving the sentinel is necessary, not
//      gratuitous.

describe('opaque-flow whole-state sentinel — runtime', () => {
  type State = { zoom: number; hidden: { a: number } }
  type Msg = { type: 'set-hidden'; v: number } | { type: 'set-zoom'; v: number }

  // The accessor reads `hidden.a` indirectly through a closure the
  // compiler would treat as opaque. The compiler's FULL_MASK fix sets
  // both `mask` and `maskHi` to -1; here we hand-roll the same shape.
  const opaqueAccessor = (s: State): string => {
    const indirect = (x: State) => x.hidden.a
    return String(indirect(s) * s.zoom)
  }

  const baseInit = (): [State, never[]] => [{ zoom: 1, hidden: { a: 7 } }, []]
  const reduce = (s: State, m: Msg): [State, never[]] => {
    if (m.type === 'set-hidden') return [{ ...s, hidden: { a: m.v } }, []]
    return [{ ...s, zoom: m.v }, []]
  }

  it('with sentinel: opaque binding re-fires on any state change', () => {
    const App = component<State, Msg, never>({
      name: 'OpaqueWithSentinel',
      init: baseInit,
      update: reduce,
      view: () => [
        input({
          // The binding's mask is FULL_MASK in BOTH words — the
          // signature the compiler emits for opaque-flow accessors.
          // Without the sentinel below this would still skip changes
          // to `hidden` because `dirty === 0` (no prefix matches).
          value: opaqueAccessor,
        }),
      ],
      __compilerVersion: '__test__',
      // `s => s.zoom` covers zoom changes. `s => s` is the sentinel —
      // its bit dirties on every update, driving the FULL_MASK
      // binding even when only `hidden` was touched.
      __prefixes: [(s) => s.zoom, (s) => s],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, App)
    const el = container.querySelector('input') as HTMLInputElement
    expect(el.value).toBe('7') // 7 * 1

    handle.send({ type: 'set-hidden', v: 99 })
    handle.flush()
    expect(el.value).toBe('99') // 99 * 1 — the bug repro: this would
    // be '7' (stale) without the sentinel.

    handle.send({ type: 'set-zoom', v: 2 })
    handle.flush()
    expect(el.value).toBe('198') // 99 * 2
  })

  it('without sentinel: opaque binding silently misses opaque-only field changes (regression marker)', () => {
    // Same component but `__prefixes` is missing the `(s) => s`
    // sentinel — i.e. what the compiler emitted BEFORE the fix. The
    // binding's FULL_MASK doesn't help: `dirty === 0` when only
    // `hidden` changes (no prefix matches it), so `(-1) & 0 === 0`
    // and the binding never re-evaluates.
    const App = component<State, Msg, never>({
      name: 'OpaqueNoSentinel',
      init: baseInit,
      update: reduce,
      view: () => [input({ value: opaqueAccessor })],
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.zoom], // no sentinel
    })

    const container = document.createElement('div')
    const handle = mountApp(container, App)
    const el = container.querySelector('input') as HTMLInputElement
    expect(el.value).toBe('7')

    handle.send({ type: 'set-hidden', v: 99 })
    handle.flush()
    // The bug: input stays at '7' even though state.hidden.a is 99.
    expect(el.value).toBe('7')

    // Zoom updates DO fire — that prefix IS in the array, dirty has
    // its bit, FULL_MASK catches it. This isolates the failure to
    // exactly the opaque-only-field case.
    handle.send({ type: 'set-zoom', v: 2 })
    handle.flush()
    expect(el.value).toBe('198') // 99 * 2
  })
})
