/**
 * Regression: bindings created AFTER an inner each() in the outer
 * render must remain alive across inner-each reconciles.
 *
 * `buildCtx` in each.ts is a module-level singleton reused across
 * every buildEntry call to avoid per-row context allocation. When an
 * outer each's buildEntry calls render, and render constructs an
 * inner each() whose own buildEntry recurses through the same path,
 * `ctx === buildCtx`. The inner mutates `buildCtx.rootLifetime` to
 * the inner entry's scope. Without an explicit save/restore around
 * the inner call, that mutation leaks back into outer's render
 * frame: any element helper called AFTER the inner each() in outer
 * reads `currentContext.rootLifetime` and attaches its disposer /
 * binding to the INNER scope. On the inner each's next reconcile
 * (key change → dispose old entry), those outer-scoped bindings get
 * silently killed.
 *
 * Surface symptom in apps: a `text((s) => s.banner)` (or any other
 * reactive cell) declared past an inner each() goes dead on the
 * first state change that re-keys the inner each. The fix lives in
 * `buildEntry` — see the rootLifetime/state snapshot/restore pair.
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

  // Lazy bag.item access AFTER a nested each() must read the OUTER's
  // per-item proxy, not the inner's. The `get item()` getter calls
  // `buildBag._getItemProxy`, which is a module-level singleton mutated
  // by every buildEntry. Pre-fix, an inner each() left `_getItemProxy`
  // pointing at the inner's last entry; outer render code that read
  // `bag.item` AFTER the inner each() returned would project the inner
  // entry's data even though the structural position was outer.
  it("outer bag.item read AFTER inner each() returns the outer's item", () => {
    type OuterItem = { id: string; label: string }
    type InnerItem = { name: string; value: number }
    type S = { rows: OuterItem[]; tick: number }
    type M = { type: 'noop' }

    let lazyValueAtRender: string | undefined

    const def: ComponentDef<S, M, never> = {
      name: 'BagItemLazy',
      init: () => [{ rows: [{ id: 'a', label: 'OUTER-A' }], tick: 0 }, []],
      update: (s) => [s, []],
      view: () =>
        each<S, OuterItem>({
          items: (s) => s.rows,
          key: (r) => r.id,
          render: (bag) => {
            // Nested each — populated, so its buildEntry runs and
            // mutates buildBag._getItemProxy to the inner entry's.
            const innerNodes = each<S, InnerItem>({
              items: () => [{ name: 'x', value: 1 }],
              key: (i) => i.name,
              render: ({ item: innerItem }) => [
                div({ 'data-inner': innerItem((i) => i.name) }, []),
              ],
            })
            // LAZY access via `bag.item` AFTER the nested each() returned.
            // If the singleton leaked, `bag.item` invokes the inner's
            // _getItemProxy and reads from the inner entry instead of
            // the outer entry. Capture the projected label here so the
            // test asserts on a deterministic snapshot.
            lazyValueAtRender = (bag.item as unknown as { label: () => string }).label()
            return [div({ 'data-row': 'wrap' }, [...innerNodes]) as Node]
          },
        }),
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.rows, (s) => s.tick],
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    expect(
      lazyValueAtRender,
      "outer bag.item.label() after a nested each() should project the OUTER row's label",
    ).toBe('OUTER-A')
    handle.dispose?.()
  })
})
