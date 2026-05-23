import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagsFor(source: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  return result?.diagnostics.filter((d) => d.id === 'llui/opaque-state-flow') ?? []
}

describe('opaque-state-flow lint rule', () => {
  // Each "leak" shape — the runtime stays correct (FULL_MASK + sentinel),
  // but the binding re-evaluates on every state change, so we surface
  // the leak as a compile-time error pointing at the offending node.

  it('errors on opaque function-arg invocation in a binding accessor', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number; hidden: { a: number } }
      function paramRow(
        getParamState: (s: State) => { overrides: Record<string, number> },
      ) {
        return input({
          value: (s: State) => String(getParamState(s).overrides['mod'] ?? 0),
        })
      }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, hidden: { a: 0 } }, []],
        update: (s) => [s, []],
        view: () => paramRow((s) => ({ overrides: {} })),
      })
    `)
    // The lint fires on the binding inside paramRow — the value accessor
    // \`(s) => String(getParamState(s)...)\` and on the lift arrow's
    // standalone-return shape. We only require at least one error from
    // this rule; exact shape lives in the per-shape tests below.
    expect(diags.length).toBeGreaterThanOrEqual(1)
    for (const d of diags) {
      expect(d.severity).toBe('error')
      expect(d.category).toBe('perf')
      expect(d.message).toMatch(/opaquely/i)
    }
  })

  it('errors on NewExpression with state arg', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      class Wrapper { constructor(_s: { hidden: { a: number } }) {} value = 0 }
      type State = { zoom: number; hidden: { a: number } }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, hidden: { a: 0 } }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(new Wrapper(s).value * s.zoom) })],
      })
    `)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/constructor/i)
  })

  it('errors on object spread of state', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      function helper(_o: { zoom: number }) { return { x: 0 } }
      type State = { zoom: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(helper({ ...s }).x) })],
      })
    `)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/spread/i)
  })

  it('errors on dynamic element access on state', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      const key: 'zoom' = 'zoom'
      type State = { zoom: number }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(s[key]) })],
      })
    `)
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/dynamic/i)
  })

  it('errors on conditional with state branch', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number; flag: boolean }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, flag: false }, []],
        update: (s) => [s, []],
        view: () => [
          input({ value: (s: State) => String(((s.flag ? s : s) as State).zoom) }),
        ],
      })
    `)
    expect(diags.length).toBeGreaterThanOrEqual(1)
    // The lift expression in the conditional fires; the message names
    // the conditional or the type assertion shape.
    expect(diags[0]!.message).toMatch(/conditional|assertion/i)
  })

  it('does NOT error on precise property-access accessors', () => {
    const diags = diagsFor(`
      import { component, input, text } from '@llui/dom'
      type State = { zoom: number; hidden: { a: number } }
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1, hidden: { a: 0 } }, []],
        update: (s) => [s, []],
        view: () => [
          text((s: State) => String(s.hidden.a)),
          input({ value: (s: State) => \`x=\${s.zoom}\` }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error on resolvable same-module helper delegation', () => {
    const diags = diagsFor(`
      import { component, input } from '@llui/dom'
      type State = { zoom: number }
      const slice = (s: State) => s.zoom * 2
      export const C = component<State, never, never>({
        name: 'C',
        init: () => [{ zoom: 1 }, []],
        update: (s) => [s, []],
        view: () => [input({ value: (s: State) => String(slice(s)) })],
      })
    `)
    expect(diags).toEqual([])
  })

  it('does NOT error on non-reactive arrows (event handlers, onEffect)', () => {
    const diags = diagsFor(`
      import { component, button } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          button({
            // Event handlers are not reactive accessors — even though
            // they reference state-like names inside, they're not
            // visited by the classifier.
            onClick: (_e) => send({ type: 'inc' }),
          }),
        ],
      })
    `)
    expect(diags).toEqual([])
  })
})
