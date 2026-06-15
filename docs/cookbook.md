# LLui Cookbook

Common patterns and recipes.

## Forms

### Text Input with Reactive Binding

```typescript
type State = { name: string }
type Msg = { type: 'setName'; value: string }

view: ({ state, send }) => [
  input({
    type: 'text',
    value: state.at('name'),
    onInput: (e: Event) =>
      send({
        type: 'setName',
        value: (e.target as HTMLInputElement).value,
      }),
  }),
]
```

A controlled `value:` binding is a signal — the framework writes whatever it produces to
`el.value` on every commit where it differs. Keep state in sync via `onInput` as above.

### Form Submission

```typescript
form(
  {
    onSubmit: (e: Event) => {
      e.preventDefault()
      send({ type: 'submitForm' })
    },
  },
  [
    input({ value: state.at('email'), onInput: ... }),
    button({ type: 'submit', disabled: state.at('loading') }, [text('Submit')]),
  ],
)
```

### Error Display

```typescript
each(state.at('errors'), {
  key: (e) => e,
  render: (error) => [li({ class: 'error' }, [text(error)])],
})
```

## Async Patterns

### Loading State with `Async<T, E>`

```typescript
import type { Async, ApiError } from '@llui/effects'

type State = { users: Async<User[], ApiError> }

// In view — `branch` selects the discriminant and gives each arm the
// narrowed variant signal:
branch(state.at('users'), (u) => u.type, {
  idle: () => [text('Click to load')],
  loading: () => [text('Loading...')],
  success: (u) => [
    each(
      u.map((s) => s.data),
      {
        key: (user) => user.id,
        render: (user) => [text(user.at('name'))],
      },
    ),
  ],
  failure: (u) => [text(u.map((s) => s.error.kind))],
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

### Batching a burst of dispatches with `batch`

`send` is synchronous — each call reconciles the DOM immediately. When you dispatch
a _burst_ in one turn (draining a websocket frame, replaying a log), wrap it in
`batch` to coalesce the whole burst into **one** reconcile against the final state.
Every reducer still runs in order and effects still fire per message; only the DOM
commit is deferred to when `batch` returns. `batch` is in the view/`onEffect` bag
alongside `send`, and on the mount handle.

```typescript
// From a subscription / external driver (handle):
socket.onmessage = (frame) =>
  handle.batch(() => {
    for (const tick of frame.ticks) handle.send({ type: 'tick', tick })
  })

// From inside the component (bag):
view: ({ state, send, batch }) => [
  button(
    {
      onClick: () =>
        batch(() => {
          send({ type: 'a' })
          send({ type: 'b' })
        }),
    },
    [text('Do both')],
  ),
]
```

State is applied by the time `batch` returns (the synchronous contract holds at the
boundary). The compiler also auto-wraps a handler that does nothing but call
`send(...)` two or more times — so `() => { send(a); send(b) }` is coalesced for you
without writing `batch` by hand.

## Composition

### View functions (default)

Split views into separate modules. The parent owns all state; a child view function
takes a **signal handle** for its slice plus the parent's `send`.

```typescript
import { nav, button, text } from '@llui/dom'
import type { Signal, Send, Renderable } from '@llui/dom'

// views/header.ts
export function header(user: Signal<{ name: string } | null>, send: Send<Msg>): Renderable {
  return [
    nav([
      text(user.map((u) => u?.name ?? 'Guest')),
      button({ onClick: () => send({ type: 'logout' }) }, [text('Logout')]),
    ]),
  ]
}

// main component view — pass a sliced signal handle:
view: ({ state, send }) => [header(state.at('user'), send), mainContent(state, send)]
```

A child view function receives whatever signal granularity it needs — `state.at('user')`
for a narrow slice, or `state.map((s) => …)` for a derived view. Reactivity has no nesting
tax: `state.at('dashboard').at('toolbar').at('menuOpen')` gets its own dependency path.

### Toolbar example — sliced signals + per-row data

```typescript
import { div, text, each } from '@llui/dom'
import type { Signal, Send, Renderable } from '@llui/dom'

type Tool = { id: string; label: string }

export function toolbar(
  tools: Signal<Tool[]>,
  activeId: Signal<string | null>,
  send: Send<ToolbarMsg>,
): Renderable {
  return [
    div({ class: 'toolbar' }, [
      each(tools, {
        key: (t) => t.id,
        render: (tool) => [
          div(
            {
              // derive the row's class from both the per-row signal and activeId:
              class: derived([tool, activeId], (t, active) =>
                active === t.id ? 'tool active' : 'tool',
              ),
              onClick: () => send({ type: 'pick', id: tool.at('id').peek() }),
            },
            [text(tool.at('label'))],
          ),
        ],
      }),
    ]),
  ]
}

// Caller — pass sliced signals and route child messages through the parent's union:
view: ({ state, send }) =>
  toolbar(state.at('tools'), state.at('selectedId'), (msg) => send({ type: 'toolbar', msg }))
```

`derived([sigA, sigB], fn)` combines multiple signals into one derived signal. Import it
from `@llui/dom`.

### Minimal Intent Pattern

Event handlers inside `each()` send minimal data — `update()` resolves the rest from state:

```typescript
// In each() render — only sends the row id (read with .peek() in a handler)
onClick: () => send({ type: 'selectItem', id: item.at('id').peek() })

// In update() — has full state access
case 'selectItem': {
  const fullItem = state.items.find((i) => i.id === msg.id)
  return [{ ...state, selected: fullItem }, []]
}
```

### Library components: `connect()` + delegated `update`

`@llui/components` use a state-machine + `connect` convention. `init` / `update` are pure
functions over the slice; `connect(state: Signal<Slice>, send: Send<SliceMsg>, opts?)`
returns reactive props to spread onto elements. The parent owns the slice and routes the
child's messages through its own `Msg` union.

```typescript
import { dialog } from '@llui/components/dialog'
import { button, h2, div, text } from '@llui/dom'

// Parent state owns a slice for the dialog:
type State = { confirm: dialog.DialogState; todos: Todo[] }
type Msg = { type: 'dialog'; msg: dialog.DialogMsg } | { type: 'addTodo'; text: string }

// Parent update delegates to the dialog's pure update:
update: (state, msg) => {
  switch (msg.type) {
    case 'dialog':
      return [{ ...state, confirm: dialog.update(state.confirm, msg.msg)[0] }, []]
    case 'addTodo':
      return [{ ...state, todos: [...state.todos, { text: msg.text }] }, []]
  }
}

// View — connect() returns spreadable parts; overlay() renders the dialog tree:
view: ({ state, send }) => {
  const sendDialog = (m: dialog.DialogMsg) => send({ type: 'dialog', msg: m })
  const parts = dialog.connect(state.at('confirm'), sendDialog, { id: 'confirm' })
  return [
    button({ ...parts.trigger, class: 'btn' }, [text('Delete')]),
    dialog.overlay({
      state: state.at('confirm'),
      send: sendDialog,
      parts,
      content: () => [
        div({ ...parts.content, class: 'dialog' }, [
          h2({ ...parts.title }, [text('Are you sure?')]),
          button({ ...parts.closeTrigger, class: 'btn' }, [text('Cancel')]),
        ]),
      ],
    }),
  ]
}
```

A reviewer sees every state transition in one flat switch; an LLM generates it mechanically
from the types. For genuine isolation (an independent app, a library bundle with its own
effect lifecycle), reach for `child()`/`lazy()` — but reach for view functions first.

### Context: avoiding prop drilling

For ambient data that many components need (theme, user session, i18n) without
threading through every view function:

Context values are resolved **once, at view-construction time** — the idiomatic value is a
stable record (a dispatcher, a locale, a design-token set), not a per-keystroke value.

```typescript
import { createContext, provide, useContext, div, button, text } from '@llui/dom'
import type { Renderable } from '@llui/dom'

interface ToastDispatcher {
  show: (msg: string) => void
}

// Declare a typed context with a default value:
const ToastContext = createContext<ToastDispatcher>({ show: () => {} }, 'Toast')

// Provide a value to every descendant built inside the render callback:
view: ({ send }) => [
  provide(ToastContext, { show: (msg) => send({ type: 'toast', msg }) }, () => [
    header(send),
    main([]),
  ]),
]

// Consume anywhere in the subtree — returns the provided value:
export function saveButton(): Renderable {
  const toast = useContext(ToastContext)
  return [button({ onClick: () => toast.show('Saved') }, [text('Save')])]
}
```

`provide` sets a value for everything `render` builds, then restores it for siblings.
`useContext` reads the nearest provided value (or the context default). Provided values
flow into nested builds (each rows, show/branch arms). The value is read once at build —
for a value that must track parent state, read it from a sliced `state.at(...)` signal in
the view instead.

**When to use context:** theme tokens, user session, i18n locale, feature flags, layout
dispatchers. **When NOT to use it:** per-keystroke data specific to a subtree — pass a
sliced signal handle to the view function instead.

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
view: ({ state, send }) => [
  ...routing.listener(send), // listens for popstate/hashchange
  branch(state.at('route').at('page'), {
    home: () => homePage(state, send),
    search: () => searchPage(state, send),
    repo: () => repoPage(state, send),
  }),
]
```

## SSR

### Server-Side Data Loading

`renderToString(def, initialState, env)` builds the component against a server `DomEnv`
and serializes it to HTML. Effects are not dispatched on the server, so run any data
loading yourself and seed the state you pass in.

```typescript
import { renderToString } from '@llui/dom'
import { jsdomEnv } from '@llui/dom/ssr/jsdom'

export async function render(url: string) {
  const env = await jsdomEnv()
  const state = await loadInitialState(url) // your own data loading
  const html = renderToString(appDef, state, env)
  return { html, state: JSON.stringify(state) }
}
```

For composing multiple node trees (layout + page) before one serialization, use
`renderNodes(def, state, env, contexts?)` + `serializeNodes(nodes)`. On Cloudflare Workers,
use `linkedomEnv` from `@llui/dom/ssr/linkedom` instead of `jsdomEnv`.

`onMount` callbacks do **not** run on the server — the mount lifecycle is a client-DOM
concern. The server still emits the marker node (so the serialized tree is stable), but
the callback (and its cleanup) is deferred to the client mount/hydrate pass. So a
DOM-touching `onMount` body (`el.querySelector(...)`, `instanceof HTMLElement`, attaching
listeners) needs no `typeof window === 'undefined'` guard — it simply won't fire until the
browser owns the tree.

### Client Hydration

`hydrateSignalApp(container, def, serverState)` rebuilds the client tree against
`serverState` (matching the SSR render) and atomically swaps it in — server HTML stays
visible until the swap, so no flash.

```typescript
import { mountApp, hydrateSignalApp } from '@llui/dom'

const stateEl = document.getElementById('__state')
const container = document.getElementById('app')!
if (stateEl && container.children.length > 0) {
  hydrateSignalApp(container, App, JSON.parse(stateEl.textContent!))
} else {
  mountApp(container, App)
}
```

`init()`'s effects are skipped by default during hydration (the server already produced
the state); pass `{ runInitEffects: true }` for init()s that no-op on the server.

## Foreign Libraries

`foreign({ tag?, state?, mount, unmount? })` declares reactive inputs as a record of
signals. The runtime materializes each to a `LiveSignal` (`peek` + `bind`) and hands them
to `mount({ el, state })`, which builds the third-party instance. `bind` fires immediately
and on every change.

### Shadow DOM for Style Isolation

```typescript
import { foreign } from '@llui/dom'
import type { Signal } from '@llui/dom'

foreign<{ root: ShadowRoot }, { html: Signal<string> }>({
  state: { html: state.at('readmeHtml') },
  mount: ({ el, state: sig }) => {
    const root = el.attachShadow({ mode: 'open' })
    root.innerHTML = '<style>h1 { color: blue }</style><div class="content"></div>'
    sig.html.bind((html) => {
      root.querySelector('.content')!.innerHTML = html
    })
    return { root }
  },
  unmount: () => {},
})
```

### Imperative DOM (Line-Numbered Code)

```typescript
import { foreign } from '@llui/dom'
import type { Signal } from '@llui/dom'

foreign<{ el: HTMLElement }, { content: Signal<string> }>({
  state: { content: state.at('fileContent') },
  mount: ({ el, state: sig }) => {
    sig.content.bind((content) => {
      el.innerHTML = ''
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const row = document.createElement('div')
        row.textContent = `${i + 1}: ${lines[i]}`
        el.appendChild(row)
      }
    })
    return { el }
  },
  unmount: () => {},
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
