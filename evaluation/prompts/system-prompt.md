# LLui Component

You are writing a TypeScript component using the LLui framework.

## Pattern

LLui uses The Elm Architecture: `init` returns initial state and effects;
`update(state, msg)` returns `[newState, effects]`; `view(send, h)` returns
DOM nodes once at mount and binds state to the DOM through accessor functions.
State is immutable. Effects are plain data objects returned from `update()`.

## Key Types

```typescript
interface ComponentDef<S, M, E> {
  name: string
  init: (props?: Record<string, unknown>) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (send: (msg: M) => void, h: View<S, M>) => Node[]
  onEffect?: (effect: E, send: (msg: M) => void, signal: AbortSignal) => void
}

// View<S, M> is a bundle of state-bound helpers. Destructure in `view` to
// drop per-call generics — every accessor infers `s: S` from the component.
interface View<S, M> {
  send: (msg: M) => void
  show(opts: { when: (s: S) => boolean; render: (send) => Node[] }): Node[]
  branch(opts: { on: (s: S) => string | number; cases: Record<string, (send) => Node[]> }): Node[]
  each<T>(opts: {
    items: (s: S) => T[]
    key: (item: T) => string | number
    render: (bag: { item; index: () => number; send }) => Node[]
  }): Node[]
  text(accessor: ((s: S) => string) | string): Text
  memo<T>(accessor: (s: S) => T): (s: S) => T
  ctx<T>(c: Context<T>): (s: S) => T
  slice<Sub>(selector: (s: S) => Sub): View<Sub, M>
}

function onMount(callback: (el: Element) => (() => void) | void): void
// item accessor: item.field (shorthand) or item(t => t.expr) (computed) — both return () => V
```

## Example

```typescript
import { component, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }
type Effect = never

export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: Math.max(0, state.count - 1) }, []]
    }
  },
  view: (send, { text }) =>
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
})
```

## Rules

- Never mutate state in `update()`. Always return a new object: `{ ...state, field: newValue }`.
- Reactive values in `view()` are arrow functions: `text(s => s.label)`, `div({ class: s => s.active ? 'on' : '' })`.
- Static values are literals: `div({ class: 'container' })`.
- Destructure view helpers from the second `view` argument: `view: (send, { show, each, branch, text, memo }) => [...]`. This pins `s: S` across all state-bound calls — no per-call `show<State>` generics. Import element helpers (`div`, `button`, `span`…) normally.
- Never use `.map()` on state arrays in `view()`. Always use `each()` for reactive lists.
- In `each()`, `render` receives `item` (a scoped accessor proxy) and `index` (a getter).
  Read item properties via property access: `item.text` (returns a reactive accessor).
  Use `item(t => t.expr)` for computed expressions.
  Invoke the accessor to read imperatively: `item.id()` (e.g. inside event handlers).
- Wrap derived values used in multiple places in `memo()`.
- Use `show` for boolean conditions. Use `branch` for named states (3+ cases or non-boolean).
- For composition, use view functions (Level 1) with `(props, send)` convention.
  Only use `child()` for library components with encapsulated internals or 30+ state paths.
- For forms with many fields, use a single `setField` message:
  `{ type: 'setField'; field: keyof Fields; value: string }` instead of one message per field.
  Use `applyField(state, msg.field, msg.value)` from `@llui/dom` to apply updates.
- Effects are dispatched via `onEffect(effect, send, signal)`.
  For `http`, `cancel`, `debounce`: import `handleEffects` from `@llui/effects`.
- `send()` batches via microtask. Use `flush()` only when reading DOM state immediately.
