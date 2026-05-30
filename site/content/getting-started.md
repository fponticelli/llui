---
title: Getting Started
description: Set up your first LLui project, create a component, and learn the core concepts.
---

## Installation

```bash
mkdir my-app && cd my-app
npm init -y
npm install @llui/dom @llui/effects
npm install -D @llui/vite-plugin vite typescript
```

## Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({ plugins: [llui()] })
```

## HTML Entry Point

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

## Your First Component

Every LLui component has five parts:

1. **State** — a plain, JSON-serializable object
2. **Msg** — a discriminated union of all possible events
3. **`init`** — returns `[initialState, initialEffects]`
4. **`update`** — receives current state and a message, returns `[newState, effects]`
5. **`view`** — runs **once** at mount time, returns DOM nodes with reactive bindings

```typescript
// src/main.ts
import { component, mountApp, div, button, input, text, each } from '@llui/dom'

type Item = { id: number; label: string }

type State = {
  text: string
  items: Item[]
  nextId: number
}

type Msg = { type: 'setText'; value: string } | { type: 'add' } | { type: 'remove'; id: number }

const TodoApp = component<State, Msg, never>({
  name: 'TodoApp',
  init: () => [{ text: '', items: [], nextId: 1 }, []],

  update: (state, msg) => {
    switch (msg.type) {
      case 'setText':
        return [{ ...state, text: msg.value }, []]
      case 'add':
        if (!state.text.trim()) return [state, []]
        return [
          {
            ...state,
            text: '',
            items: [...state.items, { id: state.nextId, label: state.text }],
            nextId: state.nextId + 1,
          },
          [],
        ]
      case 'remove':
        return [{ ...state, items: state.items.filter((it) => it.id !== msg.id) }, []]
    }
  },

  // The bag is `{ state, send }`. Element/structural helpers are imports.
  view: ({ state, send }) => [
    div({ class: 'app' }, [
      div({ class: 'input-row' }, [
        input({
          type: 'text',
          value: state.at('text'),
          onInput: (e) => send({ type: 'setText', value: (e.target as HTMLInputElement).value }),
          onKeyDown: (e) => {
            if ((e as KeyboardEvent).key === 'Enter') send({ type: 'add' })
          },
          placeholder: 'Add item...',
        }),
        button({ onClick: () => send({ type: 'add' }) }, [text('Add')]),
      ]),
      each(state.at('items'), {
        key: (it) => it.id,
        render: (item) => [
          div({ class: 'item' }, [
            text(item.at('label')),
            button({ onClick: () => send({ type: 'remove', id: item.at('id').peek() }) }, [
              text('x'),
            ]),
          ]),
        ],
      }),
    ]),
  ],
})

mountApp(document.getElementById('app')!, TodoApp)
```

## Core Concepts

### Reactive Bindings

The view bag carries `state`, a `Signal<State>`. A **reactive slot is a signal** — slice
with `.at('field')`, derive with `.map(fn)`. A static value is plain. An event handler is a
plain function. Read a one-shot value with `.peek()` (handlers and effects only).

```typescript
// Static (evaluated once):
div({ class: 'container' }, [...])

// Reactive (updates when state changes):
div({ class: state.at('isActive').map((a) => (a ? 'active' : 'inactive')) }, [...])
text(state.at('count').map((n) => `Count: ${n}`))
```

### Structural Primitives

LLui provides structural primitives for conditional and list rendering. They are module
imports from `@llui/dom`:

- **`show`** — render/remove nodes based on a truthy condition
- **`branch`** — switch between named views based on a state value
- **`each`** — render a list of items with keyed reconciliation

```typescript
import { show, branch, each, div, button, text } from '@llui/dom'

view: ({ state, send }) => [
  // show: truthy toggle — the truthy arm gets the narrowed signal
  show(state.at('isVisible'), () => [div([text('Visible!')])]),

  // branch: keyed on a string/number signal's value
  branch(state.at('page'), {
    home: () => [text('Home page')],
    about: () => [text('About page')],
    contact: () => [text('Contact page')],
  }),

  // each: keyed list — render gets a per-row `item` signal
  each(state.at('todos'), {
    key: (todo) => todo.id,
    render: (item) => [
      div([
        text(item.at('label')),
        button({ onClick: () => send({ type: 'remove', id: item.at('id').peek() }) }, [text('x')]),
      ]),
    ],
  }),
]
```

### Effects

Side effects are data — plain objects returned from `update()`. The runtime dispatches them:

```typescript
import { http, cancel, debounce, handleEffects } from '@llui/effects'

type Effect = ReturnType<typeof http> | ReturnType<typeof cancel> | ReturnType<typeof debounce>

const App = component<State, Msg, Effect>({
  // ...
  update: (state, msg) => {
    switch (msg.type) {
      case 'search':
        return [
          { ...state, query: msg.value },
          [
            cancel(
              'search',
              debounce(
                'search',
                300,
                http({
                  url: `/api/search?q=${encodeURIComponent(msg.value)}`,
                  onSuccess: (data) => ({ type: 'results' as const, data }),
                  onError: (err) => ({ type: 'error' as const, err }),
                }),
              ),
            ),
          ],
        ]
      // ...
    }
  },
  onEffect: handleEffects<Effect, Msg>().else(({ effect }) => {
    console.warn('Unhandled effect:', effect)
  }),
})
```

### Composition

The default composition model is **view functions**: a module exports a function that
takes a **signal handle** for its slice plus the parent's `send`. The parent owns all
state; the child renders a slice.

```typescript
import { div, text, button } from '@llui/dom'
import type { Signal, Send } from '@llui/dom'

// A reusable row — takes a per-row signal, not an accessor callback.
function todoItem(item: Signal<Todo>, send: Send<Msg>): Node[] {
  return [
    div({ class: 'todo' }, [
      text(item.at('label')),
      button({ onClick: () => send({ type: 'toggle', id: item.at('id').peek() }) }, [text('done')]),
    ]),
  ]
}
```

Library components from `@llui/components` use a state-machine + `connect` convention: the
parent owns the slice, delegates to the component's pure `update`, and routes its messages
through the parent's own `Msg` union (`send({ type: 'dialog', msg })`). See the
[Composition patterns guide](/cookbook#library-components-connect--delegated-update).

For embedding a genuinely independent app (third-party bundled widget, an independent
effect lifecycle), the escape hatch is a full `child()` boundary (or `lazy()` to load one
asynchronously). Don't reach for it to "isolate a complex component" — the chunked-mask
reactivity gates each binding precisely regardless of nesting depth.

### SSR

LLui supports server-side rendering via `@llui/vike`. The runtime's
`view()` runs identically on the server (producing HTML strings) and
on the client (hydrating existing DOM). See the [SSR cookbook recipes](/cookbook#ssr)
and [`@llui/vike` API reference](/api/vike) for setup details.

## Dev Server

```bash
npx vite
```

Open `http://localhost:5173`. Changes hot-reload via HMR.
