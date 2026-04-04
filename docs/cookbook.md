# LLui Cookbook

Common patterns and recipes.

## Forms

### Text Input with Reactive Binding

```typescript
type State = { name: string }
type Msg = { type: 'setName'; value: string }

view: (_s, send) => [
  input({
    type: 'text',
    value: (s: State) => s.name,
    onInput: (e: Event) => send({
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
  render: ({ item }) => [
    li({ class: 'error' }, [text(item((e) => e))]),
  ],
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
    success: (s) => [
      each<State, User, Msg>({
        items: (s) => s.users.type === 'success' ? s.users.data : [],
        key: (u) => u.id,
        render: ({ item }) => [text(item((u) => u.name))],
      }),
    ],
    failure: () => [text((s: State) =>
      s.users.type === 'failure' ? s.users.error.kind : ''
    )],
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
export function header(s: State, send: Send<Msg>): Node[] {
  return [
    nav({}, [
      text((s: State) => s.user?.name ?? 'Guest'),
      button({ onClick: () => send({ type: 'logout' }) }, [text('Logout')]),
    ]),
  ]
}

// main component view:
view: (s, send) => [
  ...header(s, send),
  ...mainContent(s, send),
]
```

### Minimal Intent Pattern

Event handlers inside `each()` send minimal data — `update()` resolves the rest from state:

```typescript
// In each() render — only sends the item id
onClick: () => send({ type: 'selectItem', id: peek(item, (t) => t.id) })

// In update() — has full state access
case 'selectItem':
  const fullItem = state.items.find(i => i.id === msg.id)
  return [{ ...state, selected: fullItem }, []]
```

### Composable Update with `chainUpdate`

```typescript
import { chainUpdate } from '@llui/dom'

const update = chainUpdate<State, Msg, Effect>(
  routerHandler,     // handles 'navigate' messages
  authHandler,       // handles 'login', 'logout'
  (state, msg) => {  // everything else
    switch (msg.type) { ... }
  },
)
```

## Routing

### Structured Route Definitions

```typescript
import { createRouter, route, param, rest } from '@llui/router'

const router = createRouter<Route>([
  route([], () => ({ page: 'home' })),
  route(['search'], { query: ['q', 'p'] },
    ({ q, p }) => ({ page: 'search', q: q ?? '', p: p ? parseInt(p) : 1 })),
  route([param('owner'), param('name')],
    ({ owner, name }) => ({ page: 'repo', owner, name })),
  route([param('owner'), param('name'), 'tree', rest('path')],
    ({ owner, name, path }) => ({ page: 'tree', owner, name, path })),
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
view: (_s, send) => [
  ...routing.listener(send),  // listens for popstate/hashchange
  ...branch<State, Msg>({
    on: (s) => s.route.page,
    cases: {
      home: (s, send) => homePage(s, send),
      search: (s, send) => searchPage(s, send),
      repo: (s, send) => repoPage(s, send),
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
