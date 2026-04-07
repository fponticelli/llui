# LLui Cookbook

Common patterns and recipes.

## Forms

### Text Input with Reactive Binding

```typescript
type State = { name: string }
type Msg = { type: 'setName'; value: string }

view: ({ send }) => [
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
      onSuccess: (data) => ({ type: 'searchOk' as const, payload: data }),
      onError: (err) => ({ type: 'searchError' as const, error: err }),
    }))],
  ]
}
```

### Polling with `interval`

```typescript
import { interval, cancel } from '@llui/effects'

case 'startPolling':
  return [{ ...state, polling: true }, [interval('poll', 5000, { type: 'tick' })]]
case 'stopPolling':
  return [{ ...state, polling: false }, [cancel('poll')]]
case 'tick':
  return [state, [http({
    url: '/api/status',
    onSuccess: (data) => ({ type: 'statusLoaded' as const, payload: data }),
    onError: (err) => ({ type: 'statusErr' as const, error: err }),
  })]]
```

### Delayed Messages with `timeout`

```typescript
import { timeout } from '@llui/effects'

case 'showToast':
  return [
    { ...state, toast: msg.text },
    [timeout(3000, { type: 'dismissToast' })],
  ]
case 'dismissToast':
  return [{ ...state, toast: null }, []]
```

### Persistence with localStorage

```typescript
import { storageLoad, storageSet, storageWatch } from '@llui/effects'

// Seed state at init time:
init: () => {
  const saved = storageLoad<{ theme: string }>('prefs')
  return [{ theme: saved?.theme ?? 'light' }, [
    // Optionally subscribe to cross-tab changes:
    storageWatch('prefs', 'prefsChanged'),
  ]]
}

// Write on every change:
case 'setTheme':
  return [
    { ...state, theme: msg.value },
    [storageSet('prefs', { theme: msg.value })],
  ]

// Cross-tab sync handler:
case 'prefsChanged':
  return msg.value ? [{ ...state, theme: (msg.value as { theme: string }).theme }, []] : [state, []]
```

### Cancel Previous Request

```typescript
case 'loadUser':
  return [state, [
    cancel('user-load', http({
      url: `/api/users/${msg.id}`,
      onSuccess: (data) => ({ type: 'userLoaded' as const, payload: data }),
      onError: (err) => ({ type: 'loadError' as const, error: err }),
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
    nav([
      text((s: State) => s.user?.name ?? 'Guest'),
      button({ onClick: () => send({ type: 'logout' }) }, [text('Logout')]),
    ]),
  ]
}

// main component view:
view: ({ send }) => [header(send), mainContent(send)]
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
view: ({ send }) =>
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

### Context: avoiding prop drilling

For ambient data that many components need (theme, user session, i18n) without
threading through every view function:

```typescript
import { createContext, provide, useContext } from '@llui/dom'

// Declare a typed context. Pass a default to make unprovided consumers resolve;
// omit to make `useContext` throw at mount.
const ThemeContext = createContext<'light' | 'dark'>('light')

// Provide a reactive accessor to every descendant rendered inside children():
view: ({ send }) =>
  provide(ThemeContext, (s: State) => s.theme, () => [
    header(send),
    main(send),
  ])

// Consume anywhere in the subtree — returns a `(s) => T` accessor:
export function card(): Node[] {
  const theme = useContext(ThemeContext)
  return [div({ class: (s) => `card theme-${theme(s)}` }, [...])]
}
```

Nested providers shadow outer ones within their subtree; the outer value
is restored for sibling subtrees automatically. Context works across
`show`/`branch`/`each` boundaries, including re-mounts.

**When to use context:** theme, route, user session, feature flags, design
tokens. **When NOT to use it:** data that's specific to a subtree — pass
via `Props<T, S>` instead.

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
view: ({ send, branch }) => [
  ...routing.listener(send), // listens for popstate/hashchange
  ...branch({
    on: (s) => s.route.page,
    cases: {
      home: () => homePage(send),
      search: () => searchPage(send),
      repo: () => repoPage(send),
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

// Unit test update() — zero DOM, runs in Node
const harness = testComponent(MyComponent)
harness.send({ type: 'inc' })
expect(harness.state.count).toBe(1)
expect(harness.allEffects).toEqual([])

// Chain messages:
harness.sendAll([{ type: 'inc' }, { type: 'inc' }, { type: 'reset' }])
expect(harness.state.count).toBe(0)

// Interactive view test — mount, simulate events, assert DOM:
const view = testView(MyComponent, { count: 5 })
expect(view.text('.count')).toBe('5')

view.click('.increment') // dispatches onClick + flushes
view.input('.name', 'alice') // sets value + fires input event + flushes
view.send({ type: 'reset' }) // dispatch a message + flush
expect(view.text('.count')).toBe('0')

view.unmount()

// Property test (random message sequences):
propertyTest(MyComponent, {
  messages: [{ type: 'inc' }, { type: 'dec' }, { type: 'reset' }],
  invariant: (state) => state.count >= 0,
})
```

**When to use which:**

- `testComponent` — validating `update()` logic. Pure, fast, no DOM.
- `testView` — validating bindings + event wiring. Uses jsdom, supports
  `click`, `input`, `fire`, `send`, `text`, `attr`, `query`, `queryAll`.
- `propertyTest` — catching edge cases via random message sequences.
