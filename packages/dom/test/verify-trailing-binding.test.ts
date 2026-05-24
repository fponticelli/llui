/**
 * Hypothesis: `buildCtx` and `buildBag` in each.ts are module-level
 * singletons. When an inner each() runs inside the parent each's
 * render, the inner each's buildEntry mutates `buildCtx.rootLifetime`
 * to the inner entry's scope. After the inner each() returns, outer
 * render continues — and any element helper called AFTER the inner
 * each() in outer's render reads `currentContext.rootLifetime` and
 * attaches its disposer/binding to the INNER scope instead of the
 * OUTER scope. When the inner each later reconciles and disposes
 * the old inner scope, the OUTER-scoped bindings get killed too.
 *
 * Symptom would be: bindings created AFTER inner each() in outer
 * render go dead on the FIRST inner-each reconcile.
 */
import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type Row = { id: string }
type Param = { name: string; value: number; key: string }
type State = {
  rows: Row[]
  paramOverridesById: Record<string, Record<string, number>>
  banner: string
}
type Msg =
  | { type: 'set-override'; id: string; key: string; value: number }
  | { type: 'set-banner'; v: string }

describe('outer-render bindings after inner each() reconcile', () => {
  it('bindings created AFTER inner each() in outer render survive inner reconcile', () => {
    const def: ComponentDef<State, Msg, never> = {
      name: 'Repro',
      init: () => [
        {
          rows: [{ id: 'a' }],
          paramOverridesById: {},
          banner: 'init',
        },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'set-override':
            return [
              {
                ...state,
                paramOverridesById: {
                  ...state.paramOverridesById,
                  [msg.id]: { ...(state.paramOverridesById[msg.id] ?? {}), [msg.key]: msg.value },
                },
              },
              [],
            ]
          case 'set-banner':
            return [{ ...state, banner: msg.v }, []]
        }
      },
      view: () =>
        each<State, Row>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: ({ item }) => {
            const row = item((r) => r)()
            const entryId = row.id
            const PARAMS = ['p']
            const innerNodes = each<State, Param>({
              items: (s) => {
                const ov = s.paramOverridesById[entryId] ?? {}
                return PARAMS.map((p) => ({
                  name: p,
                  value: ov[p] ?? 0,
                  key: `${p}:${ov[p] ?? 0}`,
                }))
              },
              key: (p) => p.key,
              render: ({ item: pr }) => [
                div({ 'data-inner-param': pr((p) => p.name) }, [text(pr((p) => String(p.value)))]),
              ],
            })
            // CRITICAL: this div is created AFTER inner each() returns
            // but still inside outer render. Its reactive binding reads
            // s.banner (NOT paramOverridesById). If the hypothesis is
            // right, this binding gets attached to the inner each's
            // entry scope and dies on the first inner reconcile.
            return [
              div({ 'data-row': entryId }, [
                ...innerNodes,
                div({ 'data-trailing-banner': 'yes' }, [text((s: State) => s.banner)]),
              ]),
            ]
          },
        }),
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.rows, (s) => s.paramOverridesById, (s) => s.banner],
    }

    let sendFn!: (m: Msg) => void
    const orig = def.view
    def.view = (h) => {
      sendFn = h.send
      return orig(h)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)

    const trailing = container.querySelector('[data-trailing-banner]')!
    expect(trailing).not.toBeNull()
    expect(trailing.textContent).toBe('init')

    // Verify the trailing-banner binding works BEFORE any inner-each reconcile
    sendFn({ type: 'set-banner', v: 'before' })
    handle.flush()
    expect(trailing.textContent, 'banner before inner reconcile').toBe('before')

    // Trigger inner each reconcile (changes param override → inner each
    // rebuilds its single entry due to key including currentValue-equiv).
    sendFn({ type: 'set-override', id: 'a', key: 'p', value: 4 })
    handle.flush()
    expect(
      container.querySelector('[data-inner-param="p"]')!.textContent,
      'inner each updated',
    ).toBe('4')

    // Now try the banner update AGAIN. If the trailing binding was
    // mistakenly attached to the inner entry's scope, it died with the
    // inner reconcile and this update will not propagate.
    sendFn({ type: 'set-banner', v: 'after' })
    handle.flush()
    const stillThere = container.querySelector('[data-trailing-banner]')!
    expect(
      stillThere.textContent,
      'trailing-banner binding should still be live after inner-each reconcile',
    ).toBe('after')

    handle.dispose?.()
  })
})
