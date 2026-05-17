/**
 * Repro for: Reconciler throws InvalidNodeTypeError on Range#setEndAfter
 * when a parent each() re-keys a row while a nested each() inside that
 * row has a pending reconcile.
 *
 * User's pattern:
 *   - Parent each() with key derived from a mutable field (re-keys when
 *     the field changes)
 *   - Nested each() inside the row's render whose items accessor reads
 *     sibling state (panelData/panelOpenForId)
 *   - Reducer mutates BOTH the parent's key field AND the nested each's
 *     observed state in the same tick
 *   - First click works; second click after a fetch resolves crashes
 *
 * Expected: no crash regardless of click count or reconcile ordering.
 */
import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { each } from '../src/primitives/each'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import type { ComponentDef } from '../src/types'

type Row = { id: string; bumpedField: number }
type PanelData = { value: string }
type State = {
  rows: Row[]
  panelOpenForId: string | null
  panelData: PanelData | null
}
type Msg =
  | { type: 'open-panel'; id: string }
  | { type: 'panel-data-loaded'; data: PanelData }
  | { type: 'row-action'; id: string; value: number }

describe('nested each() with parent re-key + sibling-state inner items', () => {
  function makeDef(): ComponentDef<State, Msg, never> {
    return {
      name: 'Nested',
      init: () => [
        {
          rows: [
            { id: 'a', bumpedField: 0 },
            { id: 'b', bumpedField: 0 },
          ],
          panelOpenForId: null,
          panelData: null,
        },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'open-panel':
            return [{ ...state, panelOpenForId: msg.id }, []]
          case 'panel-data-loaded':
            return [{ ...state, panelData: msg.data }, []]
          case 'row-action':
            return [
              {
                ...state,
                rows: state.rows.map((r) =>
                  r.id === msg.id ? { ...r, bumpedField: msg.value } : r,
                ),
                // Multi-field tick: parent's key changes AND the inner
                // each's observed state flips to null at the same time.
                panelData: null,
              },
              [],
            ]
        }
      },
      view: () =>
        each<State, Row>({
          items: (s) => s.rows,
          // Re-keys whenever bumpedField changes
          key: (r) => `${r.id}|${r.bumpedField}`,
          render: ({ item }) => {
            const it = item((w) => w)()
            return [
              div({ 'data-row': it.id }, [text(() => `row-${it.id}-${it.bumpedField}`)]),
              ...each<State, { key: string; data: PanelData }>({
                items: (s) => {
                  if (s.panelOpenForId !== it.id) return []
                  if (!s.panelData) return []
                  return [{ key: `${it.id}-${s.panelData.value}`, data: s.panelData }]
                },
                key: (slot) => slot.key,
                render: ({ item: slot }) => [
                  div({ 'data-panel': it.id }, [text(slot((s) => s.data.value))]),
                ],
              }),
            ]
          },
        }),
      __prefixes: [(s) => s.rows, (s) => s.panelOpenForId, (s) => s.panelData],
    }
  }

  it("user's Range#setEndAfter crash: panel open at mount, replaced after fetch, then row-action re-keys", () => {
    type State4 = { rows: Row[]; panelOpenForId: string | null; panelData: PanelData | null }
    type Msg4 =
      | { type: 'panel-data-loaded'; data: PanelData }
      | { type: 'row-action'; id: string; value: number }
    const def: ComponentDef<State4, Msg4, never> = {
      name: 'PanelOpenAtMount',
      init: () => [
        // Panel is open AND already shows a placeholder entry at initial
        // render, so the inner each's entry node is captured in the
        // outer row's entry.nodes snapshot. The user's bug fires when
        // that node gets replaced (fetch resolves) before the outer
        // re-keys (next click). lastEntry.nodes[last] then references a
        // detached node.
        {
          rows: [{ id: 'a', bumpedField: 0 }],
          panelOpenForId: 'a',
          panelData: null,
        },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'panel-data-loaded':
            return [{ ...state, panelData: msg.data }, []]
          case 'row-action':
            return [
              {
                ...state,
                rows: state.rows.map((r) =>
                  r.id === msg.id ? { ...r, bumpedField: msg.value } : r,
                ),
                panelData: null,
              },
              [],
            ]
        }
      },
      view: () =>
        each<State4, Row>({
          items: (s) => s.rows,
          key: (r) => `${r.id}|${r.bumpedField}`,
          render: ({ item }) => {
            const it = item((w) => w)()
            return [
              div({ 'data-row': it.id }, [text(() => `row-${it.id}-${it.bumpedField}`)]),
              ...each<State4, { key: string; data: PanelData | null }>({
                items: (s) => {
                  if (s.panelOpenForId !== it.id) return []
                  return [
                    {
                      key: s.panelData ? `loaded-${s.panelData.value}` : 'pending',
                      data: s.panelData,
                    },
                  ]
                },
                key: (slot) => slot.key,
                render: ({ item: slot }) => [
                  div({ 'data-panel': it.id }, [
                    text(slot((s) => (s.data ? s.data.value : 'pending'))),
                  ]),
                ],
              }),
            ]
          },
        }),
      __prefixes: [(s) => s.rows, (s) => s.panelOpenForId, (s) => s.panelData],
    }
    let sendFn!: (msg: Msg4) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    // Panel pending node is captured in row.entry.nodes (rendered at mount).
    // Fetch resolves: inner each replaces 'pending' with 'loaded-v1'.
    // The pending node is now detached; row.entry.nodes still holds it as
    // the last captured node.
    sendFn({ type: 'panel-data-loaded', data: { value: 'v1' } })
    handle.flush()

    // Row action: re-keys outer. With one row, outer takes Fast path 5
    // (full replace, no shared keys). lastEntry = row, lastNode =
    // detached pending node. range.setEndAfter(detachedNode) throws
    // InvalidNodeTypeError.
    sendFn({ type: 'row-action', id: 'a', value: 1 })
    handle.flush()

    const errors = errorSpy.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(errors, `errors observed: ${JSON.stringify(errors)}`).toHaveLength(0)
  })

  it("user's exact crash: single-row outer triggers Fast path 5 → Range#setEndAfter on stale node", () => {
    type State3 = { rows: Row[]; panelOpenForId: string | null; panelData: PanelData | null }
    type Msg3 =
      | { type: 'open-panel'; id: string }
      | { type: 'panel-data-loaded'; data: PanelData }
      | { type: 'row-action'; id: string; value: number }
    const def: ComponentDef<State3, Msg3, never> = {
      name: 'Single',
      init: () => [
        { rows: [{ id: 'a', bumpedField: 0 }], panelOpenForId: null, panelData: null },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'open-panel':
            return [{ ...state, panelOpenForId: msg.id }, []]
          case 'panel-data-loaded':
            return [{ ...state, panelData: msg.data }, []]
          case 'row-action':
            return [
              {
                ...state,
                rows: state.rows.map((r) =>
                  r.id === msg.id ? { ...r, bumpedField: msg.value } : r,
                ),
                panelData: null,
              },
              [],
            ]
        }
      },
      view: () =>
        each<State3, Row>({
          items: (s) => s.rows,
          key: (r) => `${r.id}|${r.bumpedField}`,
          render: ({ item }) => {
            const it = item((w) => w)()
            return [
              div({ 'data-row': it.id }, [text(() => `row-${it.id}-${it.bumpedField}`)]),
              ...each<State3, { key: string; data: PanelData | null }>({
                items: (s) => {
                  if (s.panelOpenForId !== it.id) return []
                  return [
                    {
                      key: s.panelData ? `loaded-${s.panelData.value}` : 'pending',
                      data: s.panelData,
                    },
                  ]
                },
                key: (slot) => slot.key,
                render: ({ item: slot }) => [
                  div({ 'data-panel': it.id }, [
                    text(slot((s) => (s.data ? s.data.value : 'pending'))),
                  ]),
                ],
              }),
            ]
          },
        }),
      __prefixes: [(s) => s.rows, (s) => s.panelOpenForId, (s) => s.panelData],
    }
    let sendFn!: (msg: Msg3) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    sendFn({ type: 'open-panel', id: 'a' })
    handle.flush()
    sendFn({ type: 'panel-data-loaded', data: { value: 'v1' } })
    handle.flush()

    // Click — bumps key + flips panelData null. Single-row outer enters
    // Fast path 5 (full replace, no shared keys). lastEntry is oldA;
    // oldA.entry.nodes[last] is the pending-entry node that was already
    // replaced by inner each when panel-data-loaded fired. setEndAfter
    // on that detached node throws InvalidNodeTypeError.
    sendFn({ type: 'row-action', id: 'a', value: 1 })
    handle.flush()

    const errors = errorSpy.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(errors, `errors observed: ${JSON.stringify(errors)}`).toHaveLength(0)
  })

  it('first click — bumps parent key while inner reads same-tick state', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    // Open panel for row 'a' and load data
    sendFn({ type: 'open-panel', id: 'a' })
    handle.flush()
    sendFn({ type: 'panel-data-loaded', data: { value: 'v1' } })
    handle.flush()

    expect(container.querySelector('[data-panel="a"]')).toBeTruthy()

    // First action click — bumps parent's key, flips panelData null
    sendFn({ type: 'row-action', id: 'a', value: 1 })
    handle.flush()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(container.querySelector('[data-row="a"]')).toBeTruthy()
  })

  it("second click — user's exact pattern: inner each returns 1 entry whose key derives from panelData (no null-guard)", () => {
    type State2 = { rows: Row[]; panelOpenForId: string | null; panelData: PanelData | null }
    type Msg2 =
      | { type: 'open-panel'; id: string }
      | { type: 'panel-data-loaded'; data: PanelData }
      | { type: 'row-action'; id: string; value: number }
    const def: ComponentDef<State2, Msg2, never> = {
      name: 'Nested2',
      init: () => [
        {
          rows: [
            { id: 'a', bumpedField: 0 },
            { id: 'b', bumpedField: 0 },
          ],
          panelOpenForId: null,
          panelData: null,
        },
        [],
      ],
      update: (state, msg) => {
        switch (msg.type) {
          case 'open-panel':
            return [{ ...state, panelOpenForId: msg.id }, []]
          case 'panel-data-loaded':
            return [{ ...state, panelData: msg.data }, []]
          case 'row-action':
            return [
              {
                ...state,
                rows: state.rows.map((r) =>
                  r.id === msg.id ? { ...r, bumpedField: msg.value } : r,
                ),
                panelData: null,
              },
              [],
            ]
        }
      },
      view: () =>
        each<State2, Row>({
          items: (s) => s.rows,
          key: (r) => `${r.id}|${r.bumpedField}`,
          render: ({ item }) => {
            const it = item((w) => w)()
            return [
              div({ 'data-row': it.id }, [text(() => `row-${it.id}-${it.bumpedField}`)]),
              ...each<State2, { key: string; data: PanelData | null }>({
                items: (s) => {
                  if (s.panelOpenForId !== it.id) return []
                  // No null-guard — return 1 entry whose key changes
                  // from "null" to the data identity, matching the user's
                  // exact pattern.
                  return [
                    {
                      key: s.panelData ? `loaded-${s.panelData.value}` : 'pending',
                      data: s.panelData,
                    },
                  ]
                },
                key: (slot) => slot.key,
                render: ({ item: slot }) => [
                  div({ 'data-panel': it.id }, [
                    text(slot((s) => (s.data ? s.data.value : 'pending'))),
                  ]),
                ],
              }),
            ]
          },
        }),
      __prefixes: [(s) => s.rows, (s) => s.panelOpenForId, (s) => s.panelData],
    }
    let sendFn!: (msg: Msg2) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    sendFn({ type: 'open-panel', id: 'a' })
    handle.flush()
    sendFn({ type: 'panel-data-loaded', data: { value: 'v1' } })
    handle.flush()
    expect(container.querySelector('[data-panel="a"]')).toBeTruthy()

    sendFn({ type: 'row-action', id: 'a', value: 1 })
    handle.flush()
    sendFn({ type: 'panel-data-loaded', data: { value: 'v2' } })
    handle.flush()

    sendFn({ type: 'row-action', id: 'a', value: 2 })
    handle.flush()

    const errors = errorSpy.mock.calls.map((c) => (c[0] as { message: string }).message)
    expect(errors, `errors observed: ${JSON.stringify(errors)}`).toHaveLength(0)
  })

  it('second click — same flow after the inner each has a mounted entry from a resolved fetch', () => {
    const def = makeDef()
    let sendFn!: (msg: Msg) => void
    const origView = def.view
    def.view = (h) => {
      sendFn = h.send
      return origView(h)
    }
    const errorSpy = vi.fn()
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    handle.setOnBindingError(errorSpy)

    sendFn({ type: 'open-panel', id: 'a' })
    handle.flush()
    sendFn({ type: 'panel-data-loaded', data: { value: 'v1' } })
    handle.flush()
    expect(container.querySelector('[data-panel="a"]')).toBeTruthy()

    // First click: bumps parent key, flips panelData null. Inner each
    // for the row should remount cleanly.
    sendFn({ type: 'row-action', id: 'a', value: 1 })
    handle.flush()
    expect(container.querySelector('[data-row="a"]')).toBeTruthy()

    // Simulated fetch lands later — repopulates panelData on the new row.
    sendFn({ type: 'panel-data-loaded', data: { value: 'v2' } })
    handle.flush()
    expect(container.querySelector('[data-panel="a"]')).toBeTruthy()

    // Second click: same shape. Crashes per the bug report.
    sendFn({ type: 'row-action', id: 'a', value: 2 })
    handle.flush()

    expect(
      errorSpy.mock.calls,
      'second click should not surface a reconcile error: ' +
        JSON.stringify(errorSpy.mock.calls.map((c) => (c[0] as { message: string }).message)),
    ).toHaveLength(0)
    expect(container.querySelector('[data-row="a"]')).toBeTruthy()
  })
})
