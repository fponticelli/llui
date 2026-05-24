/**
 * Regression: a nested each() inside an outer each's render must
 * register its structural block in the OWNING component's
 * `inst.structuralBlocks`, not whatever array the shared `buildCtx`
 * singleton happens to point at when the block.reconcile fires.
 *
 * Failure mode (pre-fix): when a second component instance (subApp)
 * runs its own buildEntry between the outer each's construction and a
 * later reconcile, `buildCtx.structuralBlocks` gets reassigned to the
 * sub-app's array. The outer each's captured `ctx` IS the live
 * buildCtx, so when its reconcile triggers an entry rebuild whose
 * render constructs a nested each, the nested each.push lands in the
 * SUB-APP's structuralBlocks instead of the parent's. The parent's
 * own dispatches never iterate the misplaced block — bindings inside
 * the nested rows silently freeze.
 *
 * Repro mirrors the dicerun2 /my-rolls shape: outer each → parent
 * render constructs an inner each, then a sibling subApp gets a
 * dispatch (rebuilding its own each entries, polluting buildCtx),
 * then the outer each reconciles (rebuilds row by key change) and
 * the nested each must end up in the PARENT's structuralBlocks.
 */
import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
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

type Row = { id: string; rev: number }
type Param = { name: string; value: number; key: string }
type State = {
  rows: Row[]
  paramOverridesById: Record<string, Record<string, number>>
}
type Msg =
  | { type: 'bump-row'; id: string }
  | { type: 'set-override'; id: string; name: string; value: number }

describe('nested each() under intervening sub-app must stay in parent structuralBlocks', () => {
  it('parent dispatch reconciles the nested each even after sub-app activity', () => {
    let subHandle: { send: (m: SubMsg) => void; flush: () => void } | undefined

    const def: ComponentDef<State, Msg, never> = {
      name: 'Parent',
      init: () => [
        {
          rows: [{ id: 'a', rev: 0 }],
          paramOverridesById: {},
        },
        [],
      ],
      update: (s, m) => {
        switch (m.type) {
          case 'bump-row':
            return [
              {
                ...s,
                rows: s.rows.map((r) => (r.id === m.id ? { ...r, rev: r.rev + 1 } : r)),
              },
              [],
            ]
          case 'set-override':
            return [
              {
                ...s,
                paramOverridesById: {
                  ...s.paramOverridesById,
                  [m.id]: { ...(s.paramOverridesById[m.id] ?? {}), [m.name]: m.value },
                },
              },
              [],
            ]
        }
      },
      view: () => [
        div({}, [
          ...each<State, Row>({
            items: (s) => s.rows,
            // Re-key so an unrelated `bump-row` later rebuilds the row
            // entry — that rebuild is what mirrors dicerun2's
            // library/rolls/loaded → slot re-key path.
            key: (r) => `${r.id}|${r.rev}`,
            render: ({ item }) => {
              const row = item((r) => r)()
              const entryId = row.id
              return [
                div({ 'data-row': entryId }, [
                  ...each<State, Param>({
                    items: (s) => {
                      const ov = s.paramOverridesById[entryId] ?? {}
                      return [{ name: 'p', value: ov['p'] ?? 0, key: `p:${ov['p'] ?? 0}` }]
                    },
                    key: (p) => p.key,
                    render: ({ item: pr }) => [
                      div({ 'data-param': pr((p) => p.name) }, [text(pr((p) => String(p.value)))]),
                    ],
                  }),
                ]),
              ]
            },
          }),
          // Sub-app sibling whose own buildEntries will run on
          // unrelated dispatches and (pre-fix) repoint the shared
          // buildCtx.structuralBlocks at its own array.
          ...subApp<SubState, SubMsg, never, void>({
            reason: 'regression repro — exercises shared buildCtx pollution across instances',
            def: SubAppDef,
            onHandle: (h): void => {
              subHandle = h as unknown as { send: (m: SubMsg) => void; flush: () => void }
            },
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.rows, (s) => s.paramOverridesById],
    }

    let sendFn!: (m: Msg) => void
    const orig = def.view
    def.view = (h) => {
      sendFn = h.send
      return orig(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // Initial: param-row reads override=0.
    expect(container.querySelector('[data-param="p"]')?.textContent).toBe('0')

    // 1. Sub-app dispatch — rebuilds its each entries, polluting the
    //    shared buildCtx singleton in the pre-fix world.
    expect(subHandle, 'subApp onHandle should have fired').toBeTruthy()
    subHandle!.send({ type: 'rebuild', rows: [10, 20] })
    subHandle!.flush()

    // 2. Parent dispatch that re-keys the outer row entry — its
    //    render reconstructs the inner each, which (pre-fix) lands in
    //    the SUB-APP's structuralBlocks instead of the parent's.
    sendFn({ type: 'bump-row', id: 'a' })
    handle.flush()

    // 3. Parent dispatch that should drive the inner each to reconcile.
    sendFn({ type: 'set-override', id: 'a', name: 'p', value: 7 })
    handle.flush()

    expect(
      container.querySelector('[data-param="p"]')?.textContent,
      'inner each must reconcile under parent dispatch even after sub-app activity',
    ).toBe('7')

    handle.dispose?.()
  })
})
