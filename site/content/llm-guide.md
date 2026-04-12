---
title: LLM Guide
description: 'System prompt and idiomatic patterns for LLMs generating LLui code.'
---

# LLui Component

You are writing a TypeScript component using the LLui framework.

## Pattern

LLui uses The Elm Architecture: `init` returns initial state and effects;
`update(state, msg)` returns `[newState, effects]`; `view({ send, text, ... })`
returns DOM nodes once at mount and binds state to the DOM through accessor
functions. State is immutable. Effects are plain data objects returned from
`update()`. Destructure view helpers from the single `View<S, M>` parameter.

## Key Types

```typescript
interface ComponentDef<S, M, E = never, D = void> {
  name: string
  // `data` is typed by D. Top-level components use D = void (default);
  // lazy()-loaded children receive D-typed init data from the parent.
  init: (data: D) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (h: View<S, M>) => Node[]
  onEffect?: (ctx: { effect: E; send: (msg: M) => void; signal: AbortSignal }) => void
}

// component() wrapper preserves all four type params.
function component<S, M, E = never, D = void>(
  def: ComponentDef<S, M, E, D>,
): ComponentDef<S, M, E, D>

// View<S, M> is a bundle of state-bound helpers + send. Destructure in
// `view` to drop per-call generics — every accessor infers `s: S` from
// the component.
interface View<S, M> {
  send: (msg: M) => void
  show(opts: { when: (s: S) => boolean; render: (h: View<S, M>) => Node[] }): Node[]
  branch(opts: {
    on: (s: S) => string | number
    cases: Record<string, (h: View<S, M>) => Node[]>
  }): Node[]
  each<T>(opts: {
    items: (s: S) => T[]
    key: (item: T) => string | number
    render: (bag: { item; index: () => number; send }) => Node[]
  }): Node[]
  text(accessor: ((s: S) => string) | string): Text
  memo<T>(accessor: (s: S) => T): (s: S) => T
  ctx<T>(c: Context<T>): (s: S) => T
}
// slice(h, selector) — standalone function for sub-slice view composition
function slice<Root, Sub, M>(h: View<Root, M>, sel: (s: Root) => Sub): View<Sub, M>

function onMount(callback: (el: Element) => (() => void) | void): void
// item accessor: item.field (shorthand) or item(t => t.expr) (computed) — both return () => V
```

## Effects

Effects use **typed message constructors** — callbacks, not strings:

```typescript
import { http, cancel, debounce, handleEffects } from '@llui/effects'
import type { ApiError } from '@llui/effects'

// HTTP with typed callbacks + flexible body:
http({
  url: '/api/users',
  method: 'POST',
  body: { name: 'Franco' },             // auto JSON.stringify + Content-Type
  // body: formData,                     // FormData/Blob/URLSearchParams pass through
  timeout: 5000,                         // optional request timeout (ms)
  onSuccess: (data, headers) => ({ type: 'usersLoaded' as const, payload: data }),
  onError: (err: ApiError) => ({ type: 'fetchFailed' as const, error: err }),
})

// Compose: cancel previous + debounce + http
cancel('search', debounce('search', 300, http({
  url: `/api/search?q=${q}`,
  onSuccess: (data) => ({ type: 'results' as const, payload: data }),
  onError: (err) => ({ type: 'searchError' as const, error: err }),
})))

// WebSocket:
import { websocket, wsSend } from '@llui/effects'
websocket({
  url: 'wss://api.example.com/ws',
  key: 'feed',
  onMessage: (data) => ({ type: 'wsMessage' as const, payload: data }),
  onClose: (code, reason) => ({ type: 'wsDisconnected' as const }),
})
wsSend('feed', { action: 'subscribe', channel: 'updates' })

// Retry with exponential backoff:
import { retry } from '@llui/effects'
retry(http({ url: '/api/data', onSuccess: ..., onError: ... }), {
  maxAttempts: 3,
  delayMs: 1000,  // 1s, 2s, 4s
})

// Handle effects:
onEffect: handleEffects<Effect, Msg>()
  .else(({ effect, send, signal }) => { /* custom effects */ })
```

## Example

```typescript
import { component, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

export const Counter = component<State, Msg, never>({
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
  view: ({ send, text }) =>
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
- Destructure view helpers from the `view` argument: `view: ({ send, show, each, branch, text, memo }) => [...]`. This pins `s: S` across all state-bound calls -- no per-call generics. Import element helpers (`div`, `button`, `span`...) normally.
- **Never import `text`, `each`, `show`, `branch`, `memo` from `@llui/dom`** -- always use the view bag's versions. The bag versions are typed to the component's `State`; the import versions are weakly typed.
- When extracting view helpers (functions called from `view`), pass the needed primitives as arguments: `function myHelper(text: View<S,M>['text'], send: Send<M>): Node[]`.
- Never use `.map()` on state arrays in `view()`. Always use `each()` for reactive lists.
- Never spread arrays into element children: `div([...arr.map(...)])` prevents template-clone optimization. Use `each()` instead, even for static arrays.
- In `each()`, `render` receives `item` (a scoped accessor proxy) and `index` (a getter).
  Read item properties via property access: `item.text` (returns a reactive accessor).
  Use `item(t => t.expr)` for computed expressions.
  Invoke the accessor to read imperatively: `item.id()` (e.g. inside event handlers).
- Wrap derived values used in multiple places in `memo()`.
- Use `show` for boolean conditions. Use `branch` for named states (3+ cases or non-boolean).
- Use `lazy({ loader, fallback, error?, data? })` for code-split components: `loader: () => import('./Heavy').then(m => m.default)`. Renders `fallback` until loaded; the `error` handler fires on rejection. Cancels cleanly if the parent scope is disposed mid-load.
- Use `virtualEach({ items, key, itemHeight, containerHeight, render })` from `@llui/dom` for large lists (1k+ rows) with fixed row height. Renders only visible rows; scrolling reconciles in place without touching component state.
- For composition, use view functions (Level 1) with `(props, send)` convention.
  Only use `child()` for library components with encapsulated internals or 30+ state paths.
- For forms with many fields, use a single `setField` message:
  `{ type: 'setField'; field: keyof Fields; value: string }` instead of one message per field.
  Use `applyField(state, msg.field, msg.value)` from `@llui/dom` to apply updates.
- Effects use typed message constructors: `onSuccess: (data) => ({ type: 'loaded', payload: data })`.
  Never use string-based effect callbacks.
- For `http`, `cancel`, `debounce`, `websocket`, `retry`: import from `@llui/effects`.
  Wire into onEffect with `handleEffects<Effect, Msg>().else(handler)`.
- `send()` batches via microtask. Use `flush()` only when reading DOM state immediately.
- `@llui/components` ships 58 headless state machines. Each exports `init`, `update`, `connect` and a `Parts` type. Wire them into your app reducer via `sliceHandler` or a single `msg.type === 'compName'` case. Pointer + keyboard accessibility is built in.
- For forms, use the `form` state machine (`FormState` tracks submit status + touched fields) with `validateSchema(schema, values)` against any Standard Schema library (Zod, Valibot, ArkType). Values live in parent state; `form` is a coordinator.
- For drag-to-reorder, use the `sortable` state machine. Call `reorder(arr, from, to)` in the `drop` case. Multiple sortable containers share state and track `fromContainer`/`toContainer` for cross-container drag.
- For theme toggling, use the `themeSwitch` state machine plus `applyTheme(resolveTheme(state.theme))` to set `data-theme` on `<html>`. CSS selectors use `[data-theme='dark']`.
- For scroll-triggered behavior, use the `inView` state machine with `inView.createObserver(el, send, { once: true })` inside `onMount`.
- For component label translations, components read from `LocaleContext` (exported from `@llui/components`, defaulting to English) — English apps need zero setup. Non-English apps call `provide(LocaleContext, (s) => s.locale, () => [...])` at the root.
- For number/date/list/plural formatting, use `formatNumber`, `formatDate`, `formatRelativeTime`, `formatList`, `formatPlural`, `formatFileSize` from `@llui/components` — all wrap `Intl.*` with caching and accept an optional `locale` option.
