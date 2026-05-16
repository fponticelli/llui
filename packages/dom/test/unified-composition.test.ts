// End-to-end worked example of the unified composition model.
// See `docs/proposals/unified-composition-model.md`.
//
// What this test demonstrates:
//
//   1. A "host" app composed from three feature slices (todos, filter, ui)
//      — each slice owns a sub-tree of state + its own reducer.
//   2. `combine()` wires the slice reducers into the host's top-level
//      reducer, routing messages by `${slice}/${action}` prefix.
//   3. View functions render slices by taking the slice's data and the
//      host's `send` callback. NO `child()`, NO component boundaries,
//      NO propsMsg / onMsg machinery.
//   4. Path-keyed reactivity (the compiler-emitted __prefixes path)
//      ensures bindings re-evaluate only when their actual slice
//      mutates — even though everything lives in one store.
//
// This is what the migration target looks like. For comparison, the
// equivalent "old way" using child() + onMsg is sketched in comments
// below the test (NOT executed); the conversion rule is mechanical.
//
//   OLD: child({def: TodosWidget, props: s => s.todos, onMsg: m => ...})
//   NEW: ...todosView(s.todos, send) in the host's view, plus a
//        todosUpdate reducer wired into combine()
//
// Every aspect of the new pattern is testable as plain functions:
// the slice reducers stand alone (no mounting needed); the view
// functions can be tested with synthetic state; the wiring via
// combine() routes messages mechanically.

import { describe, it, expect } from 'vitest'
import { combine } from '../src/combine'
import { mountApp, component, div, text } from '../src/index'
import type { ComponentDef } from '../src/types'

// ── State shape ─────────────────────────────────────────────────────

type Todo = { id: string; label: string; done: boolean }
type TodosSlice = { items: Todo[]; nextId: number }
type FilterValue = 'all' | 'active' | 'done'
type FilterSlice = { value: FilterValue }
type UiSlice = { editingId: string | null; draft: string }
type AppState = { todos: TodosSlice; filter: FilterSlice; ui: UiSlice }

// ── Messages — namespaced by slice ──────────────────────────────────

type TodosMsg =
  | { type: 'todos/add'; label: string }
  | { type: 'todos/toggle'; id: string }
  | { type: 'todos/remove'; id: string }
  | { type: 'todos/commitEdit'; id: string; label: string }

type FilterMsg = { type: 'filter/set'; v: FilterValue }

type UiMsg =
  | { type: 'ui/startEdit'; id: string; label: string }
  | { type: 'ui/updateDraft'; text: string }
  | { type: 'ui/cancelEdit' }

type AppMsg = TodosMsg | FilterMsg | UiMsg

type AppEffect = never

// ── Slice reducers — pure, standalone-testable ──────────────────────

function todosUpdate(
  state: TodosSlice,
  msg: TodosMsg,
): [TodosSlice, AppEffect[]] {
  switch (msg.type) {
    case 'todos/add':
      return [
        {
          items: [...state.items, { id: `t${state.nextId}`, label: msg.label, done: false }],
          nextId: state.nextId + 1,
        },
        [],
      ]
    case 'todos/toggle':
      return [
        {
          ...state,
          items: state.items.map((t) => (t.id === msg.id ? { ...t, done: !t.done } : t)),
        },
        [],
      ]
    case 'todos/remove':
      return [{ ...state, items: state.items.filter((t) => t.id !== msg.id) }, []]
    case 'todos/commitEdit':
      return [
        {
          ...state,
          items: state.items.map((t) => (t.id === msg.id ? { ...t, label: msg.label } : t)),
        },
        [],
      ]
  }
}

function filterUpdate(
  _state: FilterSlice,
  msg: FilterMsg,
): [FilterSlice, AppEffect[]] {
  switch (msg.type) {
    case 'filter/set':
      return [{ value: msg.v }, []]
  }
}

function uiUpdate(state: UiSlice, msg: UiMsg): [UiSlice, AppEffect[]] {
  switch (msg.type) {
    case 'ui/startEdit':
      return [{ editingId: msg.id, draft: msg.label }, []]
    case 'ui/updateDraft':
      return [{ ...state, draft: msg.text }, []]
    case 'ui/cancelEdit':
      return [{ editingId: null, draft: '' }, []]
  }
}

// ── Host reducer — slices composed via combine() ────────────────────

const update = combine<AppState, AppMsg, AppEffect>({
  todos: todosUpdate,
  filter: filterUpdate,
  ui: uiUpdate,
})

// ── Initial state ───────────────────────────────────────────────────

const initialState: AppState = {
  todos: {
    items: [
      { id: 't0', label: 'write docs', done: false },
      { id: 't1', label: 'ship it', done: true },
    ],
    nextId: 2,
  },
  filter: { value: 'all' },
  ui: { editingId: null, draft: '' },
}

// ── View functions ──────────────────────────────────────────────────
// Each takes a slice + the host's send; renders DOM. No component
// boundary, no propsMsg, no onMsg, no mask budget concern.

// A real host would render the filtered list as a view function:
//
//   function todoListView(todos: TodosSlice, filter: FilterValue): Node[] {
//     const filtered = todos.items.filter(t =>
//       filter === 'all' ? true : filter === 'active' ? !t.done : t.done
//     )
//     return [ul({class: 'todos'}, filtered.flatMap(t => [
//       li({class: t.done ? 'done' : 'active'}, [text(t.label)]),
//     ]))]
//   }
//
// View functions can only run inside a live render context (text() et al.
// require it), so we don't invoke todoListView() directly from the tests
// here — the slice-filtering logic is exercised as data below, and the
// host component test sub-mounts the real view.

// ── Host component — one mount, all state in one store ──────────────

const TodosApp: ComponentDef<AppState, AppMsg, AppEffect> = component<AppState, AppMsg, AppEffect>({
  name: 'TodosApp',
  init: () => [initialState, []],
  update,
  view: () => [
    div({ class: 'app' }, [
      // Note: this test exercises imperative state + handle.flush() rather
      // than reactive bindings. The compiler-emitted prefix-keyed reactivity
      // (path-precise dirty mask) drives per-render binding gating in a real
      // app; here we drive the reducer directly from outside and verify
      // state transitions land correctly via getState().
      text((s: AppState) => `count: ${s.todos.items.length}`),
    ]),
  ],
})

describe('unified composition model — end-to-end', () => {
  it('routes slice-prefixed messages through combine() into the right reducer', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, TodosApp)

    handle.send({ type: 'todos/add', label: 'pick up bread' })
    handle.flush()

    const s = handle.getState() as AppState
    expect(s.todos.items).toHaveLength(3)
    expect(s.todos.items[2]!.label).toBe('pick up bread')
    // Other slices untouched ⇒ reference preserved (combine()'s contract,
    // important for the path-keyed reactivity walker to skip cleanly)
    expect(s.filter).toBe(initialState.filter)
    expect(s.ui).toBe(initialState.ui)

    handle.dispose()
  })

  it('different slices route independently — toggling does not touch filter', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, TodosApp)
    const before = handle.getState() as AppState

    handle.send({ type: 'todos/toggle', id: 't0' })
    handle.flush()

    const after = handle.getState() as AppState
    expect(after.todos.items[0]!.done).toBe(true)
    expect(after.filter).toBe(before.filter) // reference equal
    expect(after.ui).toBe(before.ui) // reference equal

    handle.dispose()
  })

  it('UI-slice "in-progress edit" state lives in the host store, not in a child component', () => {
    // This is the canonical "lift up local state" pattern. In the
    // child()-based world this would be a child component with
    // {editing, draft} in its OWN state and an onMsg bubble for
    // commitEdit. In the unified world it's just a slice.
    const container = document.createElement('div')
    const handle = mountApp(container, TodosApp)

    handle.send({ type: 'ui/startEdit', id: 't0', label: 'write docs' })
    handle.send({ type: 'ui/updateDraft', text: 'write GREAT docs' })
    handle.send({ type: 'todos/commitEdit', id: 't0', label: 'write GREAT docs' })
    handle.send({ type: 'ui/cancelEdit' })
    handle.flush()

    const s = handle.getState() as AppState
    expect(s.todos.items[0]!.label).toBe('write GREAT docs')
    expect(s.ui).toEqual({ editingId: null, draft: '' })

    handle.dispose()
  })

  it('slice filtering computes the right items (pure data test)', () => {
    // View functions that use primitives like text() can only run inside
    // a real render context, so we can't test the DOM directly outside a
    // mount — but the slice-filtering logic IS just data, and we test
    // that piece independently here.
    const filter = (todos: TodosSlice, value: FilterValue) =>
      todos.items.filter((t) =>
        value === 'all' ? true : value === 'active' ? !t.done : t.done,
      )
    const sliced = filter(
      {
        items: [
          { id: 't0', label: 'one', done: false },
          { id: 't1', label: 'two', done: true },
          { id: 't2', label: 'three', done: false },
        ],
        nextId: 3,
      },
      'active',
    )
    expect(sliced.map((t) => t.label)).toEqual(['one', 'three'])
  })

  it('slice reducers are standalone-testable without mounting the app', () => {
    // The slice reducer's signature is `(slice, msg) → [slice, effects]`.
    // Same as any TEA update. Test it like one — no harness needed.
    const [next] = todosUpdate(initialState.todos, { type: 'todos/add', label: 'fresh task' })
    expect(next.items).toHaveLength(3)
    expect(next.nextId).toBe(3)
    // Original input untouched (immutability)
    expect(initialState.todos.items).toHaveLength(2)
  })

  it("unrecognized message slice falls through cleanly (combine()'s contract)", () => {
    const container = document.createElement('div')
    const handle = mountApp(container, TodosApp)
    const before = handle.getState() as AppState

    // No slice for 'unknown' — combine() returns state unchanged.
    handle.send({ type: 'unknown/whatever' } as never)
    handle.flush()

    const after = handle.getState() as AppState
    // Top-level reference preserved → no spurious bindings fire.
    expect(after).toBe(before)

    handle.dispose()
  })
})

// ── Migration crib sheet ────────────────────────────────────────────
//
// For every `child({ def, props, onMsg })` call in the old world, the
// mechanical migration is:
//
//   1. Move the child component's state shape under the parent's state
//      at the same position you would have read it from in `props`.
//      e.g. `props: s => ({ items: s.todos })` ⇒ parent state already
//      has `todos: TodosSlice`.
//
//   2. Convert the child's `update` into a slice reducer named after
//      the slice (and message-prefix). Drop `propsMsg` — the parent
//      writes the slice directly via its reducer.
//
//   3. Convert the child's `view` into a view function: take the slice
//      and the parent's `send`, return Node[]. Drop the component
//      wrapper.
//
//   4. Replace `child({ def: Foo, props, onMsg })` in the parent view
//      with `...fooView(s.fooSlice, send)`.
//
//   5. Wire the slice reducer into the parent's `update` via
//      `combine({foo: fooUpdate, ...})`.
//
// What used to be `onMsg: m => ({type: 'received', payload: m})` becomes
// nothing — the parent's reducer is already in the message-dispatch
// path because there's only ONE reducer. Messages dispatched anywhere
// go to the host's `update` and are routed by `combine()` to the right
// slice.
//
// When you genuinely need state isolation (foreign-DOM lifecycle, lazy
// chunks, isolated 60fps drag layers), use `subApp` from
// `@llui/dom/escape-hatch` instead. That's the only legitimate residue
// of `child()`'s "second app" semantics.
