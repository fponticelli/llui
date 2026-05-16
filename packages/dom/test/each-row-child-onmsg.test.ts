import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { child } from '../src/primitives/child'
import { text } from '../src/primitives/text'
import { div, button } from '../src/elements'
import { component } from '../src/component'
import type { ComponentDef } from '../src/types'

/**
 * Regression — `child({ onMsg })` must bubble messages up to the parent
 * reducer when the child is mounted inside an `each()` row's render.
 *
 * The bug (surfaced 2026-05-16 against dicerun2's ParamControls in a
 * card list): each.ts's `buildEntry` overwrote a small fixed set of
 * fields on the reusable `buildCtx` and dropped `send`. `child()` reads
 * `parentCtx.send` to forward `onMsg` output to the parent reducer; with
 * `send === undefined`, the bubble silently no-opped. The child still
 * received its own messages but they never propagated up — controlled
 * input chains in particular ran into a render race because the parent's
 * reactive accessor reset the DOM on the next render.
 *
 * Test mirrors the proposal's minimal repro: parent renders each() of
 * three rows; each row mounts a `GreetChild` whose button dispatches
 * `{ type: 'hi' }`; the parent's `onMsg` translates that to
 * `{ type: 'child-said-hi' }`; clicking the first row's button must
 * land a `child-said-hi` in the parent reducer.
 */

type ChildMsg = { type: 'hi' }
type ChildState = Record<string, never>

const GreetChild = component<ChildState, ChildMsg, never>({
  name: 'GreetChild',
  init: () => [{}, []],
  update: (s) => [s, []],
  view: ({ send }) => [
    button({ class: 'greet-btn', onClick: () => send({ type: 'hi' }) }, [text('hi')]),
  ],
})

type Row = { id: string }
type ParentState = { rows: Row[]; hiCount: number }
type ParentMsg = { type: 'child-said-hi' }

describe('child({ onMsg }) inside each() row', () => {
  it('bubbles child messages up to the parent reducer', async () => {
    const Parent: ComponentDef<ParentState, ParentMsg, never> = {
      name: 'Parent',
      init: () => [
        {
          rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
          hiCount: 0,
        },
        [],
      ],
      update: (state, msg) => {
        if (msg.type === 'child-said-hi') return [{ ...state, hiCount: state.hiCount + 1 }, []]
        return [state, []]
      },
      view: ({ each: $each }) => [
        div({ class: 'parent' }, [
          text((s: ParentState) => `hi: ${s.hiCount}`),
          ...$each({
            items: (s: ParentState) => s.rows,
            key: (r: Row) => r.id,
            render: ({ item }) => {
              const id = item((t) => t.id)()
              return [
                div({ class: `row row-${id}` }, [
                  ...child<ParentState, ChildMsg>({
                    def: GreetChild as unknown as ComponentDef<unknown, ChildMsg, unknown>,
                    key: `greet-${id}`,
                    props: () => ({}),
                    onMsg: (m) =>
                      m.type === 'hi' ? ({ type: 'child-said-hi' } as ParentMsg) : null,
                  }),
                ]),
              ]
            },
          }),
        ]),
      ],
      __dirty: (o, n) =>
        (Object.is(o.rows, n.rows) ? 0 : 0b01) | (Object.is(o.hiCount, n.hiCount) ? 0 : 0b10),
    }

    const container = document.createElement('div')
    const handle = mountApp(container, Parent)

    // All three rows present, three buttons live
    const btns = container.querySelectorAll('.greet-btn')
    expect(btns).toHaveLength(3)
    expect(container.querySelector('.parent')!.textContent).toContain('hi: 0')

    // Click the first row's button. child().onMsg fires via microtask
    // after the child processes its own update.
    ;(btns[0] as HTMLElement).click()
    await Promise.resolve()
    handle.flush()

    expect((handle.getState() as ParentState).hiCount).toBe(1)
    expect(container.querySelector('.parent')!.textContent).toContain('hi: 1')

    // Different row triggers an independent bubble.
    ;(btns[2] as HTMLElement).click()
    await Promise.resolve()
    handle.flush()

    expect((handle.getState() as ParentState).hiCount).toBe(2)

    handle.dispose()
  })
})
