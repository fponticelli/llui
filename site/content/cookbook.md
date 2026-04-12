---
title: Cookbook
description: 'Recipes for common patterns: forms, async, composition, routing, SSR, testing.'
---

# Cookbook

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
  render: ({ item }) => [li({ class: 'error' }, [text(item)])],
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
        render: ({ item }) => [text(item.name)],
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
Raw values captured at mount are frozen -- a silent reactivity bug.

```typescript
import type { Props, Send } from '@llui/dom'

type ToolbarData = {
  tools: Tool[]
  theme: 'light' | 'dark'
  activeId: string | null
}

// Generic over S -- parent supplies its own state type:
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

// Caller -- each field is an accessor. TypeScript errors if you pass a raw value:
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

`Props<T, S>` maps `{ tools: Tool[] }` to `{ tools: (s: S) => Tool[] }` -- making the
reactive-accessor contract explicit and type-enforced.

### Minimal Intent Pattern

Event handlers inside `each()` send minimal data -- `update()` resolves the rest from state:

```typescript
// In each() render -- only sends the item id
onClick: () => send({ type: 'selectItem', id: item.id() })

// In update() -- has full state access
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

### Type-level composition with `ChildState` / `ChildMsg`

When composing many child components, the State and Msg union declarations
become repetitive. `ChildState` and `ChildMsg` derive the child portions
from a map of component modules, and `childHandlers` creates the merged
handler at runtime:

```typescript
import { mergeHandlers, childHandlers } from '@llui/dom'
import type { ChildState, ChildMsg } from '@llui/dom'
import { dialog } from '@llui/components/dialog'
import { tabs } from '@llui/components/tabs'
import { sortable } from '@llui/components/sortable'

const children = { dialog, tabs, sort: sortable } as const

// ChildState derives { dialog: DialogState; tabs: TabsState; sort: SortableState }
// ChildMsg  derives { type: 'dialog'; msg: DialogMsg } | { type: 'tabs'; msg: TabsMsg } | ...
type State = ChildState<typeof children> & { items: string[] }
type Msg = ChildMsg<typeof children> | { type: 'addItem'; text: string }

const update = mergeHandlers<State, Msg, never>(childHandlers(children), (state, msg) => {
  if (msg.type === 'addItem') {
    return [{ ...state, items: [...state.items, msg.text] }, []]
  }
  return null
})
```

Each child module's `update` is wired via the key convention automatically.
The parent only writes its own State fields and Msg variants — child wiring
is zero boilerplate.

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

// Consume anywhere in the subtree -- returns a `(s) => T` accessor:
export function card(): Node[] {
  const theme = useContext(ThemeContext)
  return [div({ class: (s) => `card theme-${theme(s)}` }, [...])]
}
```

Nested providers shadow outer ones within their subtree; the outer value
is restored for sibling subtrees automatically. Context works across
`show`/`branch`/`each` boundaries, including re-mounts.

**When to use context:** theme, route, user session, feature flags, design
tokens. **When NOT to use it:** data that's specific to a subtree -- pass
via `Props<T, S>` instead.

### `sliceHandler` shorthand

When your state key matches the message's `type` field and the parent wraps
the child message in a `msg` property, the shorthand derives get/set/narrow
automatically:

```typescript
// Instead of:
sliceHandler({
  get: (s) => s.confirm,
  set: (s, v) => ({ ...s, confirm: v }),
  narrow: (m) => (m.type === 'confirm' ? m.msg : null),
  sub: dialog.update,
})

// Write:
sliceHandler('confirm', dialog.update)
```

Both forms are equivalent. Use the full form when the state key doesn't match
the message type, or when the parent message shape differs from `{ type; msg }`.

### Sub-state slicing with `slice()`

`slice()` narrows a parent's `View<Root, M>` to a `View<Sub, M>` that only
sees a sub-slice of the state. View functions that operate on a sub-shape
don't need the full parent state type:

```typescript
import { slice, div, text } from '@llui/dom'
import type { View } from '@llui/dom'

type AppState = { user: { name: string; email: string }; settings: Settings }

function userCard(h: View<AppState, Msg>): Node[] {
  // Narrow to just the user slice:
  const { text: t } = slice(h, (s) => s.user)
  return [
    div({ class: 'card' }, [
      t((u) => u.name), // u is { name, email }, not AppState
      t((u) => u.email),
    ]),
  ]
}
```

**When to use it:** view functions that read a focused sub-tree of state.
Keeps the view function's type signature tight and decoupled from the
parent's full state shape.

### Derived values with `selector`

`selector` caches a derived value and only recomputes when its dependencies
change. Use it when a computation is expensive or shared across bindings:

```typescript
view: ({ selector, text, each }) => {
  // Computed once per update cycle, memoized:
  const sorted = selector((s) => [...s.items].sort((a, b) => a.name.localeCompare(b.name)))

  return [
    text((s) => `${sorted(s).length} items`),
    ...each({
      items: (s) => sorted(s),
      key: (item) => item.id,
      render: ({ item }) => [div([text(item.name)])],
    }),
  ]
}
```

**`selector` vs `memo`:** `memo` caches and returns an accessor function
`(s) => T` that you pass to bindings. `selector` returns a function you call
inside other accessors to share derived state. Use `memo` for simple
projections, `selector` when the derived value feeds into multiple bindings
or structural primitives.

## Code Splitting

### Lazy-loaded components with `lazy()`

`lazy()` loads a component asynchronously via dynamic `import()`. The
fallback renders immediately; the loaded component swaps in when the
Promise resolves:

```typescript
import { lazy, div, p } from '@llui/dom'

view: ({ show, send, text }) => [
  ...show({
    when: (s) => s.showChart,
    render: () => [
      ...lazy({
        loader: () => import('./chart').then((m) => m.default),
        fallback: ({ text }) => [p([text('Loading chart...')])],
        error: (err, { text }) => [p([text(`Failed: ${err.message}`)])],
        data: (s) => ({ points: s.chartData }),
      }),
    ],
  }),
]
```

The loaded component's S, M, E types are internal -- `lazy()` only needs
the `D` (init data) type to match. `LazyDef<D>` erases the child's types
at the module boundary, so the loader requires no casts:

```typescript
// chart.ts — the loaded module
const Chart = component<ChartState, ChartMsg, never, { points: Point[] }>({
  name: 'Chart',
  init: (data) => [{ points: data.points, zoom: 1 }, []],
  // ... own state/msg/view — invisible to the parent
})
export default Chart
```

### Virtualized lists with `virtualEach()`

For large lists (1k+ items), `virtualEach` renders only the visible rows.
It requires a fixed row height and a known container height:

```typescript
import { virtualEach, div, span, text } from '@llui/dom'

view: ({ text }) => [
  ...virtualEach({
    items: (s) => s.logs,
    key: (log) => log.id,
    itemHeight: 32,
    containerHeight: 600,
    overscan: 3,
    class: 'log-list',
    render: ({ item }) => [
      div({ class: 'row' }, [span([text(item.timestamp)]), span([text(item.message)])]),
    ],
  }),
]
```

Scrolling reconciles rows in place without touching component state.
The `overscan` option (default 3) renders extra rows above and below
the viewport for smooth scrolling.

## Drag and Drop

### Sortable lists

The `sortable` state machine from `@llui/components` handles single-
and cross-container drag-to-reorder with pointer and keyboard support:

```typescript
import { sortable, type SortableState, type SortableMsg } from '@llui/components/sortable'

type State = { items: string[]; sort: SortableState }
type Msg = { type: 'sort'; msg: SortableMsg }

// In update:
case 'sort': {
  const [s, fx] = sortable.update(state.sort, msg.msg)
  if (msg.msg.type === 'drop' && state.sort.dragging) {
    const { startIndex, currentIndex } = state.sort.dragging
    return [{ ...state, items: sortable.reorder(state.items, startIndex, currentIndex), sort: s }, fx]
  }
  return [{ ...state, sort: s }, fx]
}

// In view:
const parts = sortable.connect<State>((s) => s.sort, (m) => send({ type: 'sort', msg: m }), { id: 'list' })

div({ ...parts.root }, [
  ...each({
    items: (s) => s.items,
    key: (item) => item,
    render: ({ item, index }) => [
      div({ ...parts.item(item(), index()) }, [
        span({ ...parts.handle(item(), index()) }, [text('⋮')]),
        text(item((i) => i)),
      ]),
    ],
  }),
])
```

`parts.item` provides `data-dragging`, `data-shift`, and `data-over`
attributes for CSS-driven visual feedback. `parts.handle` captures
pointer events and computes the live DOM index on each drag start.

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

Routes are bidirectional -- `router.match('/search?q=foo')` parses, `router.href({ page: 'search', q: 'foo', p: 1 })` formats.

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

// Unit test update() -- zero DOM, runs in Node
const harness = testComponent(MyComponent)
harness.send({ type: 'inc' })
expect(harness.state.count).toBe(1)
expect(harness.allEffects).toEqual([])

// Chain messages:
harness.sendAll([{ type: 'inc' }, { type: 'inc' }, { type: 'reset' }])
expect(harness.state.count).toBe(0)

// Interactive view test -- mount, simulate events, assert DOM:
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

- `testComponent` -- validating `update()` logic. Pure, fast, no DOM.
- `testView` -- validating bindings + event wiring. Uses jsdom, supports
  `click`, `input`, `fire`, `send`, `text`, `attr`, `query`, `queryAll`.
- `propertyTest` -- catching edge cases via random message sequences.

## DevTools / MCP Debugging

LLui ships a debug API that an LLM (or any tool) can use to inspect state,
send messages, replay traces, and decode bitmasks — all while the app is
running in the browser.

### How it works

In dev mode the Vite plugin injects two things and exposes one HTTP endpoint:

1. **`enableDevTools()`** — installs `window.__lluiDebug` on every mounted
   component. This is always active in dev builds and costs nothing if
   unused.
2. **`startRelay(port)`** — on page load, fetches `/__llui_mcp_status` from
   the dev server. If the MCP server is running, the response gives the
   actual port and the browser connects automatically — no console steps
   needed, no retry spam, no race conditions.
3. **`/__llui_mcp_status`** — Vite middleware that reads the marker file
   `node_modules/.cache/llui-mcp/active.json` (written by the MCP server
   on startup, removed on shutdown) and returns `{port}` or 404.

The MCP server can be started before or after Vite — both orderings
work. If MCP starts after the page loads, the Vite plugin's file watcher
sends an `llui:mcp-ready` HMR custom event, which the compiler-injected
listener forwards to `__lluiConnect`.

### Setup

```bash
# 1. Start the MCP server (separate terminal)
npx @llui/mcp

# 2. Start your dev server (Vite injects the relay automatically)
npx vite
```

The relay connects to `ws://127.0.0.1:5200` by default. Configure via the
Vite plugin option:

```typescript
// vite.config.ts
import llui from '@llui/vite-plugin'

export default {
  plugins: [llui({ mcpPort: 5201 })], // custom port
  // or: llui({ mcpPort: false })       // disable relay entirely
}
```

### Manual connection

The auto-connect via `/__llui_mcp_status` covers the common cases. If
you're running outside Vite (e.g. a static-built app for testing), or
the MCP server is on a non-default host, connect manually from the
browser console:

```javascript
__lluiConnect() // connect to the compile-time default port
__lluiConnect(5201) // connect to a custom port
```

### Available MCP tools

Once connected, the MCP server exposes these tools to any MCP client
(Claude Desktop, Claude Code, etc.):

| Tool                      | Description                                                     |
| ------------------------- | --------------------------------------------------------------- |
| `llui_get_state`          | Get the current component state                                 |
| `llui_send_message`       | Send a message and return new state + effects                   |
| `llui_eval_update`        | Dry-run a message without applying it                           |
| `llui_get_bindings`       | List all bindings with mask, kind, and last value               |
| `llui_why_did_update`     | Explain why a specific binding updated (mask match, value diff) |
| `llui_validate_message`   | Validate a message against the compiled schema                  |
| `llui_get_message_schema` | Get the discriminated union schema for Msg                      |
| `llui_decode_mask`        | Translate a dirty-mask number to field names                    |
| `llui_search_state`       | Dot-path lookup into state (e.g. `route.data.repos`)            |
| `llui_export_trace`       | Export message history as a replayable trace                    |
| `llui_snapshot_state`     | Checkpoint the current state                                    |
| `llui_restore_state`      | Restore a previously-captured snapshot                          |
| `llui_list_components`    | List all mounted components                                     |
| `llui_select_component`   | Switch the active debug target                                  |

### Browser console

Even without the MCP server, the debug API is available directly:

```javascript
__lluiDebug.getState()
__lluiDebug.send({ type: 'increment' })
__lluiDebug.getBindings()
__lluiDebug.decodeMask(5) // → ['route', 'query']
__lluiDebug.whyDidUpdate(3) // → { matched, changed, ... }
__lluiDebug.getMessageSchema() // → discriminant + variants
__lluiDebug.snapshotState() // → deep clone
__lluiDebug.restoreState(snapshot) // → overwrite + re-render

// Multi-component apps:
__lluiComponents // → { Counter: api, Dashboard: api }
__lluiDebug = __lluiComponents.Dashboard // switch target
```
