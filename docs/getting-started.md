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
import { component, mountApp, div, button, flush } from '@llui/dom'

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
  // Destructure helpers from the View bag — `text` infers State automatically.
  view: ({ send, text }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
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

`view()` builds the DOM at mount time. It's called with `(send, h)` where `h` is a bundle of state-bound helpers. Destructure the ones you need — that pins `State` across every callback, so you never write per-call generics.

```typescript
view: ({ send, show, each, branch, text, memo }) => [
  ...show({ when: (s) => s.visible, render: () => [...] }),
]
```

For values that change, use **accessor functions**:

```typescript
// Static text (never changes):
text('Hello')

// Reactive text (updates when state changes — destructured `text` infers s: State):
text((s) => `Count: ${s.count}`)

// Reactive attribute on an element helper (annotate s here — element
// helpers are imported directly and not bound to the component's State):
div({ class: (s: State) => s.active ? 'on' : 'off' }, [...])

// Reactive prop:
input({ value: (s: State) => s.query, disabled: (s: State) => s.loading })
```

### Conditional Rendering

Use `branch()` for multi-way and `show()` for boolean:

```typescript
// Multi-way conditional (destructure `branch` from the view helpers)
branch({
  on: (s) => s.page,
  cases: {
    home: () => [text('Home page')],
    about: () => [text('About page')],
  },
})

// Boolean conditional
show({
  when: (s) => s.isVisible,
  render: () => [div([text('I am visible')])],
})
```

### Lists

Use `each()` with a key function and the options bag pattern:

```typescript
each({
  items: (s) => s.todos,
  key: (t) => t.id,
  render: ({ send, item, index }) => [
    div({ class: 'todo' }, [
      input({
        type: 'checkbox',
        checked: item.done,
        onChange: () => send({ type: 'toggle', id: item.id() }),
      }),
      text(item.text),
    ]),
  ],
})
```

`item.text` returns a **per-item accessor** — a zero-arg function that reads the current item's field. It updates automatically when the item changes. Use `item(t => t.expr)` for computed expressions.

Invoke the accessor (`item.id()`) to read the current value imperatively — e.g. inside event handlers.

## Effects

Effects are plain data objects returned from `update()`:

```typescript
import { http } from '@llui/effects'

update: (state, msg) => {
  case 'fetchUsers':
    return [
      { ...state, loading: true },
      [http({
        url: '/api/users',
        onSuccess: (data) => ({ type: 'usersLoaded' as const, payload: data }),
        onError: (err) => ({ type: 'fetchError' as const, error: err }),
      })],
    ]
  case 'usersLoaded':
    return [{ ...state, users: msg.payload, loading: false }, []]
}
```

Handle effects with `handleEffects()`:

```typescript
import { handleEffects } from '@llui/effects'

onEffect: handleEffects<Effect, Msg>()
  .use(routingPlugin)              // plugins handle specific effect types
  .else(({ effect, send }) => {    // catch-all for app-specific effects
    // custom effect handling
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
view: ({ send, branch }) => [
  routing.link(send, { page: 'home' }, {}, [text('Home')]),
  ...routing.listener(send),
  ...branch({
    on: (s) => s.route.page,
    cases: {
      home: () => homePage(send),
      user: () => userPage(send),
    },
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
