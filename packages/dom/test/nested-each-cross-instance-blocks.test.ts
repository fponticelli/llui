/**
 * Regression: a deeply-nested each() must register its structural
 * block in the OWNING component's `inst.structuralBlocks`, even when
 * an intervening sub-app dispatch poisons the shared `buildCtx`
 * singleton between the slot-each's initial construction and a later
 * slot-reconcile that re-keys the slot entry.
 *
 * Failure mode (pre-fix), three-level nesting required:
 *   row each (top-level — captured ctx = main page's mount ctx)
 *     buildEntry → render constructs
 *       slot each (NESTED — captured ctx IS the buildCtx singleton)
 *         buildEntry → render constructs
 *           inner each (param row, NESTED inside slot)
 *
 * 1. Initial mount: every block registers in the main page's
 *    structuralBlocks correctly.
 * 2. Sibling sub-app dispatch fires. The sub-app's each.buildEntry
 *    reassigns `buildCtx.structuralBlocks` to the sub-app's array.
 * 3. A main-page dispatch fires that re-keys the slot entry. The
 *    slot each's reconcile reads its captured `ctx.structuralBlocks`
 *    — that read now returns the sub-app's array (the singleton is
 *    sampled live, not at slot-each construction).
 * 4. slot.buildEntry stamps `buildCtx.structuralBlocks = ctx.structuralBlocks`
 *    (sub-app's array). The slot's render runs, the new inner each
 *    constructs, and its `blocks.push(block)` lands in the SUB-APP's
 *    structuralBlocks.
 * 5. The main page's `set-override` dispatch iterates main-page's
 *    structuralBlocks, never reaches the misplaced inner each, and
 *    the inner DOM stays frozen at its old value.
 *
 * Mirrors dicerun2 /my-rolls: row each → slot each (gated by
 * `expandedId`, re-keys on `rollsLoaded`) → inner ParamRow each.
 * Sibling subApp = packs sidebar.
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

type Slot = { key: string; rowId: string; payload: string }
type Param = { name: string; value: number; key: string }
type State = {
  rows: string[]
  expandedId: string | null
  rollsLoaded: boolean
  paramOverridesById: Record<string, Record<string, number>>
}
type Msg =
  | { type: 'expand'; id: string }
  | { type: 'rolls-loaded' }
  | { type: 'set-override'; id: string; name: string; value: number }

describe('nested each across sub-app boundary keeps blocks in the owning instance', () => {
  it('parent dispatch reconciles the deeply-nested each after intervening sub-app activity', () => {
    let subHandle: { send: (m: SubMsg) => void; flush: () => void } | undefined

    const def: ComponentDef<State, Msg, never> = {
      name: 'Parent',
      init: () => [
        {
          rows: ['a'],
          expandedId: null,
          rollsLoaded: false,
          paramOverridesById: {},
        },
        [],
      ],
      update: (s, m) => {
        switch (m.type) {
          case 'expand':
            return [{ ...s, expandedId: m.id }, []]
          case 'rolls-loaded':
            return [{ ...s, rollsLoaded: true }, []]
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
          // OUTER row each (top-level — captured ctx = main mount ctx).
          ...each<State, string>({
            items: (s) => s.rows,
            key: (rowId) => rowId,
            render: ({ item }) => {
              const rowId = item((id) => id)()
              return [
                div({ 'data-row': rowId }, [
                  // NESTED slot each — captured ctx IS buildCtx.
                  // Slot's items length is gated on `expandedId`;
                  // slot's KEY incorporates `rollsLoaded` so a
                  // `rolls-loaded` dispatch re-keys the entry.
                  ...each<State, Slot>({
                    items: (s) => {
                      if (s.expandedId !== rowId) return []
                      return [
                        {
                          key: `${rowId}|loaded:${s.rollsLoaded ? '1' : '0'}`,
                          rowId,
                          payload: s.rollsLoaded ? 'fresh' : 'pending',
                        },
                      ]
                    },
                    key: (slot) => slot.key,
                    render: ({ item: slotItem }) => {
                      const slot = slotItem((s) => s)()
                      const entryId = slot.rowId
                      return [
                        div({ 'data-slot': slot.payload }, [
                          // INNER ParamRow each — registers in
                          // whichever array buildCtx.structuralBlocks
                          // points to at construction time.
                          ...each<State, Param>({
                            items: (s) => {
                              const ov = s.paramOverridesById[entryId] ?? {}
                              return [{ name: 'p', value: ov['p'] ?? 0, key: `p:${ov['p'] ?? 0}` }]
                            },
                            key: (p) => p.key,
                            render: ({ item: pr }) => [
                              div({ 'data-param': pr((p) => p.name) }, [
                                text(pr((p) => String(p.value))),
                              ]),
                            ],
                          }),
                        ]),
                      ]
                    },
                  }),
                ]),
              ]
            },
          }),
          // Sibling sub-app whose every dispatch repoints the shared
          // buildCtx.structuralBlocks (pre-fix) at the sub-app's array.
          ...subApp<SubState, SubMsg, never, void>({
            reason: 'cross-instance buildCtx leak repro',
            def: SubAppDef,
            onHandle: (h): void => {
              subHandle = h as unknown as { send: (m: SubMsg) => void; flush: () => void }
            },
          }),
        ]),
      ],
      __compilerVersion: '__test__',
      __prefixes: [
        (s) => s.rows,
        (s) => s.expandedId,
        (s) => s.rollsLoaded,
        (s) => s.paramOverridesById,
      ],
    }

    let sendFn!: (m: Msg) => void
    const orig = def.view
    def.view = (h) => {
      sendFn = h.send
      return orig(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    // 1. Expand — slot each reconciles, builds the FIRST slot entry,
    //    its render constructs the inner each<ParamRow>.
    sendFn({ type: 'expand', id: 'a' })
    handle.flush()
    expect(container.querySelector('[data-param="p"]')?.textContent).toBe('0')

    // 2. Sub-app dispatch — pre-fix, poisons buildCtx.structuralBlocks.
    expect(subHandle, 'subApp onHandle should have fired').toBeTruthy()
    subHandle!.send({ type: 'rebuild', rows: [10, 20] })
    subHandle!.flush()

    // 3. rolls-loaded — re-keys the slot entry (key folds `rollsLoaded`).
    //    Pre-fix, the rebuild's render constructs the NEW inner each
    //    against the sub-app's poisoned structuralBlocks reference.
    sendFn({ type: 'rolls-loaded' })
    handle.flush()
    expect(
      container.querySelector('[data-slot]')?.getAttribute('data-slot'),
      'slot should have re-keyed to the loaded payload',
    ).toBe('fresh')

    // 4. set-override — the parent dispatch that should drive the
    //    nested inner each to reconcile. Pre-fix, the inner each
    //    block lives in the sub-app's structuralBlocks and the
    //    parent's iteration never hits it; DOM stays at "0".
    sendFn({ type: 'set-override', id: 'a', name: 'p', value: 7 })
    handle.flush()

    expect(
      container.querySelector('[data-param="p"]')?.textContent,
      'inner each must reconcile under parent dispatch after sub-app activity + slot re-key',
    ).toBe('7')

    handle.dispose?.()
  })
})
