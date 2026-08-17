# LLui Component

You are writing TypeScript with LLui, a compile-time-optimized web framework built on
The Elm Architecture. LLui has no virtual DOM: `view()` runs once at mount and builds
real DOM nodes with reactive signal bindings.

## Component shape

```typescript
component<State, Msg, Effect>({
  name,
  init: () => State | [State, Effect[]],
  update: (state, msg) => State | [State, Effect[]],
  view: ({ state, send, batch }) => Renderable,
  onEffect: (effect, api) => void | (() => void),
})
```

- `State` is plain JSON-serializable data. Do not store `Map`, `Set`, `Date`, class
  instances, functions, `NaN`, or infinities.
- `Msg` and `Effect` are discriminated unions with a `type` field.
- `update` is pure. Never mutate state; return a new object for changed paths.
- Effects are data returned by `update`, then handled by `onEffect`.
- The view bag contains exactly `state`, `send`, and `batch`. Element and structural
  helpers are imports from `@llui/dom`.

## Signal authoring

`state` is a `Signal<State>` with three operations:

- `state.at('field')` narrows to a precise reactive path and is chainable.
- `state.map(fn)` derives a reactive value from the whole signal.
- `state.peek()` performs a one-shot read. Use it only inside event handlers, effects,
  and `onMount`; never use it as a reactive slot value.

Combine signals with the imported `derived(...)` helper. There is no `.select()`, and a
mapped signal cannot be narrowed with `.at()` afterward.

```typescript
import { component, mountApp, div, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => ({ count: 0 }),
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return { ...state, count: state.count + 1 }
      case 'dec':
        return { ...state, count: state.count - 1 }
    }
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

An element with no props uses the children-only form, such as `div([text('Hi')])`.
Do not write `div({}, [...])`. Author with `text`, `each`, `show`, and `branch`; names
such as `signalText` and `signalEach` are compiler targets, not authoring APIs.

## Structural primitives

Import all structural primitives from `@llui/dom`.

```typescript
show(
  state.at('user'),
  (user) => [text(user.at('name'))],
  () => [text('Signed out')],
)

branch(
  state.at('page').map((page) => page.type),
  {
    search: () => [searchView(state, send)],
    repo: () => [repoView(state, send)],
  },
)

each(state.at('todos'), {
  key: (todo) => todo.id,
  render: (item) => [
    div({ class: item.at('done').map((done) => (done ? 'done' : '')) }, [text(item.at('label'))]),
  ],
})
```

- `each` keys must be stable value identities, never array indexes.
- The `item` and `index` passed to a row renderer are signals. Rows are reused on
  reorder, so read them reactively; call `.peek()` only at event time.
- A keyed row needs a stable element root, not a bare structural primitive.
- `show`, `branch`, `each`, `lazy`, `portal`, `foreign`, and `onMount` return lazy
  `Mountable` recipes. They do nothing unless placed in the returned view tree.
- `onMount` may return a cleanup function. Its returned `Mountable` must be in the view.

Factor sub-views as plain functions that accept sliced signals:

```typescript
function header(state: Signal<HeaderState>, send: (msg: Msg) => void): Renderable {
  return [h1([text(state.at('title'))])]
}

view: ({ state, send }) => [header(state.at('header'), send)]
```

There is no `child()` composition API. Use `mapSend` to route a child state machine's
messages into the parent's union.

## Effects

```typescript
import { http, debounce, handleEffects, asOnEffect } from '@llui/effects'

const chain = handleEffects<Effect, Msg>().else(({ effect }) =>
  console.warn('unhandled effect', effect),
)

const App = component<State, Msg, Effect>({
  // init, update, view...
  onEffect: asOnEffect(chain),
})

const search = (query: string) =>
  debounce(
    'search',
    300,
    http<Msg>({
      url: `/api/search?q=${encodeURIComponent(query)}`,
      onSuccess: (data) => ({ type: 'searchLoaded', data }),
      onError: (error) => ({ type: 'searchFailed', error }),
    }),
  )
```

Do not perform I/O in `init`, `update`, or the synchronous body of `view`. Every emitted
effect needs a handler. Use stable cancellation keys for debounce, interval, retry, and
superseded requests.

## Headless components

`@llui/components` ships 66 headless state machines. Pass a sliced signal handle to
`connect`, never an accessor or the whole root signal:

```typescript
import { dialog } from '@llui/components/dialog'
import { mapSend } from '@llui/dom'

const parts = dialog.connect(
  state.at('dialog'),
  mapSend(send, (msg) => ({ type: 'dialog', msg })),
  { id: 'edit-profile' },
)
```

Spread the returned part bags onto elements. Place overlay helpers in the view tree.
Use `@llui/interactions` for custom focus, dismissal, floating, modal, or roving behavior.

## Rules

- `view()` runs once. Build a static graph of reactive bindings; it does not re-render.
- Prefer precise `.at()` paths. Root `.map()` reads coarsen dependency gating.
- Never use `peek()` where a signal should remain reactive.
- Never mutate state or store non-JSON values.
- `send()` is synchronous. Use `batch(fn)` to coalesce several sends into one DOM commit;
  use the optional `raf` scheduler for frame-coalesced rendering.
- Place every lifecycle or structural `Mountable` you create.
- Keep `init()` deterministic for SSR. Browser-only work belongs in effects or `onMount`.
- Use `unsafeHtml` only with trusted or sanitized HTML.
- Reach for `@llui/components`, `@llui/interactions`, and `@llui/effects` before
  reimplementing their behavior.
