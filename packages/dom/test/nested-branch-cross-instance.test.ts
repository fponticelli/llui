/**
 * Regression: branch() nested inside another each's render must
 * reconcile against the OWNING component's render context — its arm
 * builder receives the right `instance` / `allBindings` / `dom` etc.
 * — even when an intervening sub-app's buildEntry has poisoned the
 * shared `buildCtx` singleton in the meantime.
 *
 * Pre-fix branch.ts captured `ctx` (live singleton) at construction.
 * On reconcile it spreads `setRenderContext({...ctx, rootLifetime,
 * state})` and passes `getOwnerBag(ctx, send)` into the new arm's
 * builder. With `ctx` IS buildCtx, those reads return whatever the
 * singleton's fields were last mutated to. The arm's bindings end up
 * registered against the wrong instance's allBindings (or its View
 * bag is sourced from the wrong instance).
 *
 * Test exercises: row each → branch (gated on `arm` state field)
 * inside row's render. Sibling subApp dispatch poisons buildCtx
 * between branch's construction and the arm-swap dispatch. Branch
 * arm swap must build new arm bindings into the parent's
 * allBindings, and those bindings must remain reactive under the
 * parent's subsequent dispatches.
 */
import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { branch } from '../src/primitives/branch'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import { subApp } from '../src/escape-hatch'
import type { ComponentDef } from '../src/types'

type SubState = { rows: number[] }
type SubMsg = { type: 'rebuild'; rows: number[] }

const SubAppDef: ComponentDef<SubState, SubMsg, never> = {
  name: 'SubAppRows',
  init: () => [{ rows: [1, 2, 3] }, []],
  update: (s, m) => (m.type === 'rebuild' ? [{ rows: m.rows }, []] : [s, []]),
  view: () => [
    div({}, [
      ...each<SubState, number>({
        items: (s) => s.rows,
        key: (n) => n,
        render: ({ item }) => [div({ 'data-sub-row': item((n) => String(n)) }, [])],
      }),
    ]),
  ],
  __compilerVersion: '__test__',
  __prefixes: [(s) => s.rows],
}

type State = { rows: string[]; arm: 'a' | 'b'; label: string }
type Msg = { type: 'flip-arm' } | { type: 'set-label'; v: string }

describe('nested branch across sub-app boundary stays attached to owning instance', () => {
  it('branch arm swap after sub-app dispatch still renders in parent', () => {
    let subHandle: { send: (m: SubMsg) => void; flush: () => void } | undefined

    const def: ComponentDef<State, Msg, never> = {
      name: 'Parent',
      init: () => [{ rows: ['row'], arm: 'a', label: 'init' }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'flip-arm':
            return [{ ...s, arm: s.arm === 'a' ? 'b' : 'a' }, []]
          case 'set-label':
            return [{ ...s, label: m.v }, []]
        }
      },
      view: () => [
        div({}, [
          ...each<State, string>({
            items: (s) => s.rows,
            key: (r) => r,
            render: () => [
              div({ 'data-row': 'yes' }, [
                // NESTED branch — captured ctx IS buildCtx pre-fix.
                ...branch<State, Msg, 'a' | 'b'>({
                  on: (s) => s.arm,
                  cases: {
                    a: () => [div({ 'data-arm-a': 'yes' }, [text((s: State) => `A:${s.label}`)])],
                    b: () => [div({ 'data-arm-b': 'yes' }, [text((s: State) => `B:${s.label}`)])],
                  },
                }),
              ]),
            ],
          }),
          ...subApp<SubState, SubMsg, never, void>({
            reason: 'cross-instance branch buildCtx leak repro',
            def: SubAppDef,
            onHandle: (h): void => {
              subHandle = h as unknown as { send: (m: SubMsg) => void; flush: () => void }
            },
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.rows, (s) => s.arm, (s) => s.label],
    }

    let sendFn!: (m: Msg) => void
    const orig = def.view
    def.view = (h) => {
      sendFn = h.send
      return orig(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Initial arm A.
    expect(container.querySelector('[data-arm-a]')?.textContent).toBe('A:init')

    // 1. Sub-app dispatch — pre-fix, poisons buildCtx fields.
    expect(subHandle, 'subApp onHandle should have fired').toBeTruthy()
    subHandle!.send({ type: 'rebuild', rows: [10, 20] })
    subHandle!.flush()

    // 2. Flip the branch arm. Pre-fix, branch.reconcile spreads
    //    the poisoned ctx into the new arm's render context, and
    //    the new arm's bindings register against the sub-app's
    //    allBindings instead of the parent's.
    sendFn({ type: 'flip-arm' })
    handle.flush()
    expect(
      container.querySelector('[data-arm-b]')?.textContent,
      'branch arm-b should render with parent state',
    ).toBe('B:init')

    // 3. Update parent state — the new arm's text binding must be
    //    in the parent's allBindings to fire here.
    sendFn({ type: 'set-label', v: 'after' })
    handle.flush()
    expect(
      container.querySelector('[data-arm-b]')?.textContent,
      'arm-b text binding must reconcile under parent dispatch',
    ).toBe('B:after')

    handle.dispose?.()
  })
})
