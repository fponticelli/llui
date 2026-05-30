# Getting Started with LLui

## Setup

```bash
mkdir my-app && cd my-app
npm init -y
npm install @llui/dom
npm install -D @llui/vite-plugin vite typescript
```

**vite.config.ts:**

```typescript
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui()],
})
```

**index.html:**

```html
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

## Your First Component

**src/main.ts:**

```typescript
import { component, mountApp, div, button, text } from '@llui/dom'

// 1. Define your state shape
type State = { count: number }

// 2. Define your messages (user intents)
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

// 3. Create the component
const Counter = component<State, Msg>({
  name: 'Counter',

  // Initial state + effects
  init: () => [{ count: 0 }, []],

  // Pure state transitions
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: state.count - 1 }, []]
      case 'reset':
        return [{ count: 0 }, []]
    }
  },

  // View — runs once, creates DOM with reactive bindings.
  // The bag is `{ state, send }`: `state` is a Signal<State>.
  // Element helpers (div, button, text, …) are imported from @llui/dom.
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
      button({ onClick: () => send({ type: 'reset' }) }, [text('Reset')]),
    ]),
  ],
})

// 4. Mount it
mountApp(document.getElementById('app')!, Counter)
```

Run with `npx vite`.

## Core Concepts

### State is Plain Data

State is a plain TypeScript object. No classes, no observables, no proxies.

```typescript
type State = {
  todos: Array<{ id: number; text: string; done: boolean }>
  filter: 'all' | 'active' | 'completed'
}
```

### Messages are Discriminated Unions

Every user action is a message with a `type` field:

```typescript
type Msg =
  | { type: 'addTodo'; text: string }
  | { type: 'toggleTodo'; id: number }
  | { type: 'setFilter'; filter: 'all' | 'active' | 'completed' }
```

### update() is Pure

`update()` returns `[newState, effects]`. No mutations, no side effects.

```typescript
update: (state, msg) => {
  switch (msg.type) {
    case 'addTodo':
      return [
        {
          ...state,
          todos: [...state.todos, { id: Date.now(), text: msg.text, done: false }],
        },
        [],
      ]
    case 'toggleTodo':
      return [
        {
          ...state,
          todos: state.todos.map((t) => (t.id === msg.id ? { ...t, done: !t.done } : t)),
        },
        [],
      ]
  }
}
```

### view() Runs Once

`view()` builds the DOM at mount time. It receives one bag, `{ state, send }`. `state` is a `Signal<State>` — slice into it with `.at('field')`, derive with `.map(fn)`, and read a one-shot value with `.peek()` (for event handlers and effects only).

For values that change, pass a **signal**; for static values, pass plain values:

```typescript
// Static text (never changes):
text('Hello')

// Reactive text (updates when count changes):
text(state.at('count').map((n) => `Count: ${n}`))

// Reactive attribute on an element helper:
div({ class: state.at('active').map((a) => (a ? 'on' : 'off')) }, [...])

// Reactive props:
input({ value: state.at('query'), disabled: state.at('loading') })
```

A reactive slot is a signal; an event handler is a plain function. Never operate on a
signal as if it were a value (`state.at('n') + 1`) — derive with `.map`. Never use
`.peek()` in a slot — it reads once and never updates.

### Conditional Rendering

Use `branch()` for multi-way and `show()` for boolean:

```typescript
// Multi-way conditional — keyed on a string/number signal's value
branch(state.at('page'), {
  home: () => [text('Home page')],
  about: () => [text('About page')],
})

// Boolean conditional — the truthy arm receives the narrowed signal
show(state.at('isVisible'), () => [div([text('I am visible')])])
```

### Lists

Use `each()` with a key function. The `render` callback receives per-row `item` and
`index` **signals**:

```typescript
each(state.at('todos'), {
  key: (t) => t.id,
  render: (item) => [
    div({ class: 'todo' }, [
      input({
        type: 'checkbox',
        checked: item.at('done'),
        onChange: () => send({ type: 'toggle', id: item.at('id').peek() }),
      }),
      text(item.at('text')),
    ]),
  ],
})
```

`item.at('text')` is a reactive per-row slot — it updates in place when the row's data
changes. `key` receives the **raw** item value (a plain function). Inside an event
handler, read the current value with `item.at('id').peek()`.

## Effects

Effects are plain data objects returned from `update()`:

```typescript
import { http } from '@llui/effects'

update: (state, msg) => {
  switch (msg.type) {
    case 'fetchUsers':
      return [
        { ...state, loading: true },
        [
          http({
            url: '/api/users',
            // onSuccess/onError are CALLBACKS that return a Msg:
            onSuccess: (data) => ({ type: 'usersLoaded' as const, payload: data }),
            onError: (err) => ({ type: 'fetchError' as const, error: err }),
          }),
        ],
      ]
    case 'usersLoaded':
      return [{ ...state, users: msg.payload, loading: false }, []]
  }
}
```

Handle effects with `handleEffects()`. It consumes the built-in effects (`http`,
`cancel`, `debounce`, …); `.else()` receives one `{ effect, send, signal }` context for
the remaining custom variants:

```typescript
import { handleEffects } from '@llui/effects'

onEffect: handleEffects<Effect, Msg>().else(({ effect, send }) => {
  // custom effect handling — `effect` is narrowed to your non-built-in variants
}),
```

## Routing

```typescript
import { createRouter, route, param } from '@llui/router'
import { connectRouter } from '@llui/router/connect'

const router = createRouter<Route>(
  [
    route([], () => ({ page: 'home' })),
    route(['about'], () => ({ page: 'about' })),
    route(['user', param('id')], ({ id }) => ({ page: 'user', id })),
  ],
  { mode: 'history' },
)

const routing = connectRouter(router)
```

In the view:

```typescript
view: ({ state, send }) => [
  routing.link(send, { page: 'home' }, {}, [text('Home')]),
  ...routing.listener(send),
  branch(state.at('route').at('page'), {
    home: () => homePage(state, send),
    user: () => userPage(state, send),
  }),
]
```

## Dev Tools

When running through the Vite plugin in dev mode, LLui automatically installs
`window.__lluiDebug` on every mounted component. Open the browser console:

```js
__lluiDebug.getState() // current state
__lluiDebug.send({ type: 'inc' }) // dispatch a message
__lluiDebug.getMessageHistory() // last 1000 state transitions
__lluiDebug.exportTrace() // save + replay via @llui/test
```

The devtools code is tree-shaken out of production builds — zero cost in prod.

## Next Steps

- [Cookbook](cookbook.md) — forms, async patterns, composition, SSR
- [API Reference](designs/09%20API%20Reference.md) — complete type signatures
- [Architecture](designs/01%20Architecture.md) — how it works under the hood
- [GitHub Explorer](../examples/github-explorer) — full example app
