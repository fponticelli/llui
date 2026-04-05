# LLui Cookbook

Common patterns and recipes.

## Forms

### Text Input with Reactive Binding

```typescript
type State = { name: string }
type Msg = { type: 'setName'; value: string }

view: (send) => [
  input({
    type: 'text',
    value: (s: State) => s.name,
    onInput: (e: Event) =>
      send({
        type: 'setName',
        value: (e.target as HTMLInputElement).value,
      }),
  }),
]
```

### Form Submission

```typescript
form({
  onSubmit: (e: Event) => {
    e.preventDefault()
    send({ type: 'submitForm' })
  },
}, [
  input({ value: (s: State) => s.email, onInput: ... }),
  button({ type: 'submit', disabled: (s: State) => s.loading }, [text('Submit')]),
])
```

### Error Display

```typescript
each<State, string, Msg>({
  items: (s) => s.errors,
  key: (e) => e,
  render: ({ item }) => [li({ class: 'error' }, [text(item((e) => e))])],
})
```

## Async Patterns

### Loading State with `Async<T, E>`

```typescript
import type { Async, ApiError } from '@llui/effects'

type State = { users: Async<User[], ApiError> }

// In view:
branch<State, Msg>({
  on: (s) => s.users.type,
  cases: {
    idle: () => [text('Click to load')],
    loading: () => [text('Loading...')],
    success: () => [
      each<State, User, Msg>({
        items: (s) => (s.users.type === 'success' ? s.users.data : []),
        key: (u) => u.id,
        render: ({ item }) => [text(item((u) => u.name))],
      }),
    ],
    failure: () => [text((s: State) => (s.users.type === 'failure' ? s.users.error.kind : ''))],
  },
})
```

### Debounced Search

```typescript
import { http, cancel, debounce } from '@llui/effects'

case 'setQuery': {
  const q = msg.value
  if (!q.trim()) return [{ ...state, query: q }, [cancel('search')]]
  return [
    { ...state, query: q },
    [debounce('search', 300, http({
      url: `/api/search?q=${encodeURIComponent(q)}`,
      onSuccess: 'searchOk',
      onError: 'searchError',
    }))],
  ]
}
```

### Cancel Previous Request

```typescript
case 'loadUser':
  return [state, [
    cancel('user-load', http({
      url: `/api/users/${msg.id}`,
      onSuccess: 'userLoaded',
      onError: 'loadError',
    })),
  ]]
```

## Composition

### Level 1: View Functions (default)

Split views into separate modules. Parent owns state, child operates on a slice.

```typescript
// views/header.ts
export function header(send: Send<Msg>): Node[] {
  return [
    nav({}, [
      text((s: State) => s.user?.name ?? 'Guest'),
      button({ onClick: () => send({ type: 'logout' }) }, [text('Logout')]),
    ]),
  ]
}

// main component view:
view: (send) => [header(send), mainContent(send)]
```

### View functions with typed props: `Props<T, S>`

When a view function needs data from state, make **every field an accessor**.
Raw values captured at mount are frozen — a silent reactivity bug.

```typescript
import type { Props, Send } from '@llui/dom'

type ToolbarData = {
  tools: Tool[]
  theme: 'light' | 'dark'
  activeId: string | null
}

// Generic over S — parent supplies its own state type:
export function toolbar<S>(props: Props<ToolbarData, S>, send: Send<ToolbarMsg>): Node[] {
  return [
    div({ class: (s) => `toolbar theme-${props.theme(s)}` }, [
      each({
        items: props.tools,
        key: (t) => t.id,
        render: ({ item, send }) => [
          div(
            {
              class: (s) => (props.activeId(s) === item.id() ? 'tool active' : 'tool'),
              onClick: () => send({ type: 'pick', id: item.id() }),
            },
            [text(item.label)],
          ),
        ],
      }),
    ]),
  ]
}

// Caller — each field is an accessor. TypeScript errors if you pass a raw value:
view: (send) =>
  toolbar<State>(
    {
      tools: (s) => s.tools,
      theme: (s) => s.settings.theme,
      activeId: (s) => s.selectedId,
    },
    (msg) => send({ type: 'toolbar', msg }),
  )
```

`Props<T, S>` maps `{ tools: Tool[] }` to `{ tools: (s: S) => Tool[] }` — making the
reactive-accessor contract explicit and type-enforced.

### Minimal Intent Pattern

Event handlers inside `each()` send minimal data — `update()` resolves the rest from state:

```typescript
// In each() render — only sends the item id
onClick: () => send({ type: 'selectItem', id: item.id() })

// In update() — has full state access
case 'selectItem':
  const fullItem = state.items.find(i => i.id === msg.id)
  return [{ ...state, selected: fullItem }, []]
```

### Composable Update with `mergeHandlers`

```typescript
import { mergeHandlers } from '@llui/dom'

const update = mergeHandlers<State, Msg, Effect>(
  routerHandler,     // handles 'navigate' messages
  authHandler,       // handles 'login', 'logout'
  (state, msg) => {  // everything else
    switch (msg.type) { ... }
  },
)
```

### Embedding a sub-component with `sliceHandler`

`sliceHandler` lifts a sub-component's reducer into one that operates on the
parent's full state + message type. The sub-component's state lives at a slice
of the parent state, and the parent wraps sub-messages in its own discriminant.
Pair with `mergeHandlers` to compose:

```typescript
import { mergeHandlers, sliceHandler } from '@llui/dom'
import * as dialog from './components/dialog'

// Parent state owns a slice for the dialog:
type State = { confirm: dialog.State; todos: Todo[] }
type Msg = { type: 'confirm'; msg: dialog.Msg } | { type: 'addTodo'; text: string }

const update = mergeHandlers<State, Msg, Effect>(
  sliceHandler({
    get: (s) => s.confirm,
    set: (s, v) => ({ ...s, confirm: v }),
    narrow: (m) => (m.type === 'confirm' ? m.msg : null),
    sub: dialog.update,
  }),
  (state, msg) => {
    // Only sees messages the slice handler didn't claim:
    switch (msg.type) {
      case 'addTodo':
        return [{ ...state, todos: [...state.todos, { text: msg.text }] }, []]
    }
  },
)
```

**When to reach for this:** embedding a reusable component (dialog, combobox,
date-picker) that ships its own `State`, `Msg`, and `update`. The parent stays
type-safe: each sub-component gets a branded message variant (`{ type: 'confirm',
msg: dialog.Msg }`) so the parent's `Msg` union is exhaustive and routing is
explicit.

**When NOT to use it:** for view-function composition (Level 1), where the
parent owns the state directly and passes accessors down via `Props<T, S>`.
`sliceHandler` is for genuine sub-components with their own update logic.

## Routing

### Structured Route Definitions

```typescript
import { createRouter, route, param, rest } from '@llui/router'

const router = createRouter<Route>([
  route([], () => ({ page: 'home' })),
  route(['search'], { query: ['q', 'p'] }, ({ q, p }) => ({
    page: 'search',
    q: q ?? '',
    p: p ? parseInt(p) : 1,
  })),
  route([param('owner'), param('name')], ({ owner, name }) => ({ page: 'repo', owner, name })),
  route([param('owner'), param('name'), 'tree', rest('path')], ({ owner, name, path }) => ({
    page: 'tree',
    owner,
    name,
    path,
  })),
])
```

Routes are bidirectional — `router.match('/search?q=foo')` parses, `router.href({ page: 'search', q: 'foo', p: 1 })` formats.

### Navigation Links

```typescript
import { connectRouter } from '@llui/router/connect'
const routing = connectRouter(router)

// In views:
routing.link(send, { page: 'home' }, { class: 'nav-link' }, [text('Home')])
```

`routing.link` renders `<a>` with correct href and handles click (`preventDefault` + send navigate message + pushState).

### Page Switching

```typescript
view: (send) => [
  ...routing.listener(send), // listens for popstate/hashchange
  ...branch<State, Msg>({
    on: (s) => s.route.page,
    cases: {
      home: (send) => homePage(send),
      search: (send) => searchPage(send),
      repo: (send) => repoPage(send),
    },
  }),
]
```

## SSR

### Server-Side Data Loading

```typescript
import { initSsrDom } from '@llui/dom/ssr'
import { renderToString } from '@llui/dom'
import { resolveEffects } from '@llui/effects'

await initSsrDom()

export async function render(url: string) {
  const state = initialState(url)
  const [routeState, effects] = update(state, { type: 'navigate', route: state.route })

  // Execute HTTP effects server-side
  const loaded = await resolveEffects(routeState, effects, update)
  const html = renderToString(appDef, loaded)

  return { html, state: JSON.stringify(loaded) }
}
```

### Client Hydration

```typescript
import { mountApp, hydrateApp } from '@llui/dom'

const serverState = document.getElementById('__state')
if (serverState && container.children.length > 0) {
  hydrateApp(container, App, JSON.parse(serverState.textContent!))
} else {
  mountApp(container, App)
}
```

## Foreign Libraries

### Shadow DOM for Style Isolation

```typescript
foreign<State, { html: string }, { root: ShadowRoot }>({
  mount: (container) => {
    const root = container.attachShadow({ mode: 'open' })
    root.innerHTML = '<style>h1 { color: blue }</style><div class="content"></div>'
    return { root }
  },
  props: (s) => ({ html: s.readmeHtml }),
  sync: (instance, { html }) => {
    instance.root.querySelector('.content')!.innerHTML = html
  },
  destroy: () => {},
})
```

### Imperative DOM (Line-Numbered Code)

```typescript
foreign<State, { content: string }, { el: HTMLElement }>({
  mount: (container) => ({ el: container }),
  props: (s) => ({ content: s.fileContent }),
  sync: ({ el }, { content }) => {
    el.innerHTML = ''
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const row = document.createElement('div')
      row.textContent = `${i + 1}: ${lines[i]}`
      el.appendChild(row)
    }
  },
  destroy: () => {},
})
```

## Testing

```typescript
import { testComponent, testView, propertyTest } from '@llui/test'

// Unit test update()
const harness = testComponent(MyComponent)
harness.send({ type: 'inc' })
expect(harness.state().count).toBe(1)

// View test
const view = testView(MyComponent, { count: 5 })
expect(view.query('.counter')?.textContent).toContain('5')

// Property test (random message sequences)
propertyTest(MyComponent, {
  messages: [{ type: 'inc' }, { type: 'dec' }, { type: 'reset' }],
  invariant: (state) => state.count >= 0,
})
```
