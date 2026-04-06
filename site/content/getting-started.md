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

Every LLui component has four parts:

1. **State** — a plain, JSON-serializable object
2. **Msg** — a discriminated union of all possible events
3. **`init`** — returns `[initialState, initialEffects]`
4. **`update`** — receives current state and a message, returns `[newState, effects]`
5. **`view`** — runs **once** at mount time, returns DOM nodes with reactive bindings

```typescript
// src/main.ts
import { component, mountApp, div, button, input } from '@llui/dom'

type State = {
  text: string
  items: string[]
}

type Msg =
  | { type: 'setText'; value: string }
  | { type: 'add' }
  | { type: 'remove'; index: number }

const TodoApp = component<State, Msg, never>({
  name: 'TodoApp',
  init: () => [{ text: '', items: [] }, []],

  update: (state, msg) => {
    switch (msg.type) {
      case 'setText':
        return [{ ...state, text: msg.value }, []]
      case 'add':
        if (!state.text.trim()) return [state, []]
        return [{ ...state, text: '', items: [...state.items, state.text] }, []]
      case 'remove':
        return [{ ...state, items: state.items.filter((_, i) => i !== msg.index) }, []]
    }
  },

  view: ({ send, text, each }) => [
    div({ class: 'app' }, [
      div({ class: 'input-row' }, [
        input({
          type: 'text',
          value: (s) => s.text,
          onInput: (e) => send({ type: 'setText', value: (e.target as HTMLInputElement).value }),
          onKeydown: (e) => { if (e.key === 'Enter') send({ type: 'add' }) },
          placeholder: 'Add item...',
        }),
        button({ onClick: () => send({ type: 'add' }) }, [text('Add')]),
      ]),
      ...each({
        items: (s) => s.items,
        key: (_item, i) => i,
        render: ({ item, index, send }) => [
          div({ class: 'item' }, [
            text(() => item()),
            button({
              onClick: () => send({ type: 'remove', index: index() }),
            }, [text('x')]),
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

In `view()`, arrow functions create **reactive bindings** — they re-evaluate whenever the relevant state changes:

```typescript
// Static (evaluated once):
div({ class: 'container' }, [...])

// Reactive (updates when state changes):
div({ class: (s) => s.isActive ? 'active' : 'inactive' }, [...])
text((s) => `Count: ${s.count}`)
```

### Structural Primitives

LLui provides three structural primitives for conditional and list rendering:

- **`show`** — render/remove nodes based on a boolean condition
- **`branch`** — switch between named views based on a state value
- **`each`** — render a list of items with keyed reconciliation

```typescript
view: ({ send, text, show, branch, each }) => [
  // show: boolean toggle
  ...show({
    when: (s) => s.isVisible,
    render: () => [div({}, [text('Visible!')])],
  }),

  // branch: multi-case switch
  ...branch({
    on: (s) => s.page,
    cases: {
      home: () => [text('Home page')],
      about: () => [text('About page')],
      contact: () => [text('Contact page')],
    },
  }),

  // each: keyed list
  ...each({
    items: (s) => s.todos,
    key: (todo) => todo.id,
    render: ({ item, send }) => [
      div({}, [
        text(() => item.label()),
        button({ onClick: () => send({ type: 'remove', id: item.id() }) }, [text('x')]),
      ]),
    ],
  }),
]
```

### Effects

Side effects are data — plain objects returned from `update()`. The runtime dispatches them:

```typescript
import { http, cancel, debounce, handleEffects } from '@llui/effects'

type Effect =
  | ReturnType<typeof http>
  | ReturnType<typeof cancel>
  | ReturnType<typeof debounce>

const App = component<State, Msg, Effect>({
  // ...
  update: (state, msg) => {
    switch (msg.type) {
      case 'search':
        return [
          { ...state, query: msg.value },
          [cancel('search', debounce('search', 300, http({
            url: `/api/search?q=${encodeURIComponent(msg.value)}`,
            onSuccess: (data) => ({ type: 'results' as const, data }),
            onError: (err) => ({ type: 'error' as const, err }),
          })))],
        ]
      // ...
    }
  },
  onEffect: handleEffects<Effect, Msg>()
    .else(({ effect }) => { console.warn('Unhandled effect:', effect) }),
})
```

### Composition

LLui supports two levels of composition:

**Level 1 — View functions** (default): A module exports `update()` and `view()` functions. The parent owns state; the child operates on a slice.

**Level 2 — `child()`** (opt-in): Full component boundary with own bitmask, update cycle, and scope tree. Use for library components or 30+ state paths.

```typescript
// Level 1: view function
function todoItem(item: Accessor<Todo>, send: (msg: Msg) => void): Node[] {
  return [
    div({ class: 'todo' }, [
      text(() => item.label()),
      button({ onClick: () => send({ type: 'toggle', id: item.id() }) }, [text('done')]),
    ]),
  ]
}
```

## Dev Server

```bash
npx vite
```

Open `http://localhost:5173`. Changes hot-reload via HMR.
