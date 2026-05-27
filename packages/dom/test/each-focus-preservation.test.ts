// Verifies that focus on an <input> survives `each()` list mutations
// when the row's key is stable. The audit flagged this as a potential
// doc gap; this test confirms or refutes whether the framework already
// does the right thing.
//
// Three mutation shapes:
//   1. Insert at head — focused row's key is unchanged, DOM node should
//      stay mounted, focus survives.
//   2. Sort/reorder — focused row's key unchanged, DOM node moves
//      (parent re-inserts), focus should survive the move.
//   3. Remove sibling — focused row's key unchanged, only sibling
//      DOM nodes change, focus survives.
//
// If all three pass, the framework already preserves focus correctly
// when keys are stable — no doc gap, just stable-key discipline.
// If any fails, that's either a framework bug or a recipe to document.

import { describe, it, expect } from 'vitest'
import { component, mountApp, createView, input, div } from '../src/index'
import type { View } from '../src/index'

type Row = { id: string; label: string }
type State = { rows: Row[] }
type Msg = { type: 'insertHead'; row: Row } | { type: 'reverse' } | { type: 'remove'; id: string }

function makeApp() {
  return component<State, Msg, never>({
    name: 'FocusTest',
    init: () => [
      {
        rows: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
      },
      [],
    ],
    update: (s, msg) => {
      switch (msg.type) {
        case 'insertHead':
          return [{ rows: [msg.row, ...s.rows] }, []]
        case 'reverse':
          return [{ rows: [...s.rows].reverse() }, []]
        case 'remove':
          return [{ rows: s.rows.filter((r) => r.id !== msg.id) }, []]
      }
    },
    view: (h: View<State, Msg>) => [
      div(
        { class: 'list' },
        h.each<Row>({
          items: (s) => s.rows,
          key: (row) => row.id,
          render: ({ item }) => [
            input({
              class: () => `row row-${item.id()}`,
              'data-id': () => item.id(),
              value: () => item.label(),
            }),
          ],
        }),
      ),
    ],
    __compilerVersion: '__test__',
    __view: ($send) => createView<State, Msg>($send),
    __prefixes: [(s: State) => s.rows],
  })
}

describe('each() — focus preservation across list mutations (stable keys)', () => {
  it('insert-at-head: focused row keeps focus', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    await new Promise<void>(queueMicrotask)

    const inputB = root.querySelector('.row-b') as HTMLInputElement
    expect(inputB).not.toBeNull()
    inputB.focus()
    expect(document.activeElement).toBe(inputB)

    handle.send({ type: 'insertHead', row: { id: 'x', label: 'X' } })
    handle.flush()

    // Same DOM node should still be in the tree and still focused —
    // each() identified row 'b' by stable key and didn't recreate it.
    const inputBAfter = root.querySelector('.row-b') as HTMLInputElement
    expect(inputBAfter).toBe(inputB) // identity check
    expect(document.activeElement).toBe(inputB)

    handle.dispose()
    root.remove()
  })

  it('reverse: focused row keeps focus across DOM reorder', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    await new Promise<void>(queueMicrotask)

    const inputB = root.querySelector('.row-b') as HTMLInputElement
    inputB.focus()
    expect(document.activeElement).toBe(inputB)

    handle.send({ type: 'reverse' })
    handle.flush()

    // Reverse re-inserts the DOM nodes in a new order, but row 'b' is
    // moved (not recreated) — its key is stable. Focus should survive
    // the parent re-insertion.
    const inputBAfter = root.querySelector('.row-b') as HTMLInputElement
    expect(inputBAfter).toBe(inputB)
    expect(document.activeElement).toBe(inputB)

    handle.dispose()
    root.remove()
  })

  it('remove sibling: focused row keeps focus', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    await new Promise<void>(queueMicrotask)

    const inputB = root.querySelector('.row-b') as HTMLInputElement
    inputB.focus()
    expect(document.activeElement).toBe(inputB)

    handle.send({ type: 'remove', id: 'a' })
    handle.flush()

    const inputBAfter = root.querySelector('.row-b') as HTMLInputElement
    expect(inputBAfter).toBe(inputB)
    expect(document.activeElement).toBe(inputB)

    handle.dispose()
    root.remove()
  })

  it('UNSTABLE keys: focus is lost on reorder (sanity counter-test for the discipline)', async () => {
    // Demonstrates WHY stable keys matter. When the key function
    // returns a derived value that changes per commit (e.g. the row
    // label, when labels can change), each() treats reordered or
    // renamed rows as "removed + new" — destroying the focused DOM
    // node. The cookbook's `key: (row) => row.id` discipline exists
    // precisely to avoid this.
    type Row = { id: string; label: string }
    type S = { rows: Row[] }
    type M = { type: 'shuffle' }
    const App = component<S, M, never>({
      name: 'UnstableKeys',
      init: () => [
        {
          rows: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ],
        },
        [],
      ],
      // Mutate: each row gets a new label suffix, AND the order reverses.
      // With label-based keys, every row's key changes — each() sees
      // "all old rows gone, three new rows appeared."
      update: (s) => [
        {
          rows: [...s.rows].reverse().map((r) => ({ id: r.id, label: r.label + "'" })),
        },
        [],
      ],
      view: (h: View<S, M>) => [
        div(
          { class: 'list' },
          h.each<Row>({
            items: (state) => state.rows,
            // BUG SHAPE: key by mutable field (label), not by stable id.
            key: (row) => row.label,
            render: ({ item }) => [
              input({ class: () => `row row-${item.id()}`, value: () => item.label() }),
            ],
          }),
        ),
      ],
      __compilerVersion: '__test__',
      __view: ($send) => createView<S, M>($send),
      __prefixes: [(s: S) => s.rows],
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, App)
    await new Promise<void>(queueMicrotask)

    const inputB = root.querySelector('.row-b') as HTMLInputElement
    inputB.focus()
    expect(document.activeElement).toBe(inputB)

    handle.send({ type: 'shuffle' })
    handle.flush()

    // Label-based key. Every row's key changed ('A' → "A'", 'B' → "B'",
    // etc.). each() removed all three old rows and inserted three new
    // ones. The DOM node we focused was destroyed. Focus is lost.
    const inputBAfter = root.querySelector('.row-b') as HTMLInputElement
    expect(inputBAfter).not.toBe(inputB) // different DOM node
    expect(document.activeElement).not.toBe(inputBAfter)

    handle.dispose()
    root.remove()
  })

  it('remove focused row: focus does not silently jump to a sibling', async () => {
    // Sanity counter-test. Removing the focused row itself should
    // result in focus leaving the document (or going to body). If
    // focus jumps to a sibling silently, that's a separate UX problem
    // worth knowing about.
    const root = document.createElement('div')
    document.body.appendChild(root)
    const handle = mountApp(root, makeApp())
    await new Promise<void>(queueMicrotask)

    const inputB = root.querySelector('.row-b') as HTMLInputElement
    inputB.focus()
    expect(document.activeElement).toBe(inputB)

    handle.send({ type: 'remove', id: 'b' })
    handle.flush()

    // Row B is gone. Focus should not be on a sibling input.
    expect(root.querySelector('.row-b')).toBeNull()
    const after = document.activeElement
    // Either null/body (jsdom convention) or the document itself, but
    // definitely NOT one of the other rows.
    if (after && after !== document.body) {
      expect((after as Element).classList.contains('row-a')).toBe(false)
      expect((after as Element).classList.contains('row-c')).toBe(false)
    }

    handle.dispose()
    root.remove()
  })
})
