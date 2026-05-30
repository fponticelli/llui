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

**The contract**: a signal `value:` binding is **controlled** — the
framework writes whatever the signal produces to `el.value` on every
commit where the result differs from what it last wrote. Keep state in
sync via `onInput` (as above), and the signal's value always matches
what the user has typed.

This works cleanly when `state.name` is initialised synchronously and
only changes in response to `setName`. If `state.name` can load
asynchronously — e.g., after a network round-trip — see the next
recipe.

### Form editing when the persisted value loads asynchronously

Mounting a form before its data has loaded sets up a race: the
accessor returns `''` (or a default), the user starts typing, then
the data Msg arrives and the framework writes the loaded value into
`el.value` — destroying the typed text.

This is the standard controlled-input contract (same as React, Vue,
Solid). The fix is to **model the in-progress edit explicitly** and
read it from the accessor whenever it's set, falling back to the
persisted value only when the field is clean.

```typescript
type State = {
  // Persisted slot — populated by load Msg, updated on save.
  persisted: { name: string } | undefined
  // Edit buffer — keyed so the form can edit multiple fields.
  // `undefined` means "field is clean, show the persisted value."
  edits: { [field: string]: string | undefined }
}

type Msg =
  | { type: 'load'; data: { name: string } }
  | { type: 'edit'; field: string; value: string }
  | { type: 'save' }
  | { type: 'discard' }

const update = (s: State, msg: Msg): [State, Effect[]] => {
  switch (msg.type) {
    case 'load':
      return [{ ...s, persisted: msg.data }, []]
    case 'edit':
      return [{ ...s, edits: { ...s.edits, [msg.field]: msg.value } }, []]
    case 'save':
      // Commit the edit buffer into the persisted slot, then clear it.
      const merged = { ...s.persisted, ...s.edits } as { name: string }
      return [{ persisted: merged, edits: {} }, []]
    case 'discard':
      return [{ ...s, edits: {} }, []]
  }
}

view: ({ state, send }) => [
  input({
    type: 'text',
    // Read the in-progress edit if present; otherwise the persisted
    // value; otherwise empty.
    value: state.map((s) => s.edits.name ?? s.persisted?.name ?? ''),
    onInput: (e: Event) =>
      send({ type: 'edit', field: 'name', value: (e.target as HTMLInputElement).value }),
  }),
]
```

Why this works:

- **Load races resolved.** While `edits.name` is set, the accessor
  returns the typed text regardless of what arrives in `persisted`.
  A late ACK can't overwrite typed input.
- **Form reset works.** `discard` clears the edit buffer; the
  accessor falls back to `persisted` on the next commit; the input
  shows the canonical server value.
- **Validation correction works.** Server normalises input on save;
  the `save` Msg replaces `persisted` and clears `edits`; the
  binding reflects the canonical form on the next commit.
- **Optimistic updates work.** Show the typed value while a save is
  in flight (`edits.name`), revert on error by clearing the entry
  in `edits`.
- **Multi-field forms work.** Add fields to `edits` as needed; the
  pattern is the same per field.

**Anti-pattern**: binding `value:` directly to deep state that can
load or change underfoot, without an edit buffer:

```typescript
// Fragile — typed text is destroyed when persisted state arrives or
// changes (load race, peer edit in collaborative app, validation
// correction).
input({
  value: state.map((s) => s.entities[id]?.facts.name ?? ''),
  onInput: ...
})
```

The fix is to route the edit through an explicit buffer in state, as
above.

#### Variation: optimistic save with server-side validation

The same buffer handles optimistic saves where the server can
reject or normalise the edit:

```typescript
type Msg =
  | { type: 'edit'; field: string; value: string }
  | { type: 'save'; field: string }
  | { type: 'saveOk'; field: string; canonical: string }
  | { type: 'saveErr'; field: string; reason: string }

const update = (s: State, msg: Msg): [State, Effect[]] => {
  switch (msg.type) {
    case 'save': {
      // Send to server. Keep the edit buffer set so the user still
      // sees their typed value while the request is in flight.
      const value = s.edits[msg.field]
      if (value === undefined) return [s, []]
      return [
        s,
        [
          http({
            url: `/save/${msg.field}`,
            method: 'POST',
            body: { value },
            onSuccess: (data) => ({ type: 'saveOk', field: msg.field, canonical: String(data) }),
            onError: (err) => ({ type: 'saveErr', field: msg.field, reason: err.message }),
          }),
        ],
      ]
    }
    case 'saveOk': {
      // Server accepted (possibly normalised). Write the canonical
      // value into persisted, clear the edit buffer so the binding
      // falls back to persisted on the next commit.
      return [
        {
          persisted: { ...s.persisted!, [msg.field]: msg.canonical },
          edits: { ...s.edits, [msg.field]: undefined },
        },
        [],
      ]
    }
    case 'saveErr': {
      // Keep the edit buffer set so the user can fix and retry.
      // Surface the error elsewhere in state.
      return [{ ...s, errors: { ...s.errors, [msg.field]: msg.reason } }, []]
    }
    // ... 'edit' as before
  }
}
```

The accessor stays the same — `s.edits.name ?? s.persisted?.name ?? ''`.
The Msg flow handles the variants. Each transition leaves the
binding in a consistent state without overwriting user input.

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

// In view — branch selects the discriminant; each arm gets the
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

### Reading current state from event handlers with `.peek()`

Event handlers fire outside the render context — there's no live
signal value flowing in. When a handler needs the current state to
decide what to dispatch (e.g. compute a submit payload at click
time), read it off a signal with `.peek()`:

```typescript
view: ({ state, send }) => [
  button(
    {
      onClick: () => {
        const draft = state.at('draft').peek()
        send({ type: 'save', payload: { name: draft.name, body: draft.body } })
      },
    },
    [text('Save')],
  ),
]
```

`.peek()` reads the _current_ value once, with no binding. It is safe
to call from event handlers, async callbacks (`setTimeout`,
`Promise.then`), and `onMount` — but never as a slot value.

**Don't use `.peek()` in a reactive slot**:

```typescript
// ❌ Reads once at build time and never updates. The compiler's
//    `peek-in-slot` rule rejects this.
text(state.at('count').peek())

// ✅ Reactive — the slot is a signal, so it re-commits when count changes.
text(state.at('count').map(String))
```

A slot is a signal; `.peek()` is the _event-time_ escape hatch.

## Composition

### View functions (default)

Split views into separate modules. The parent owns all state; a child view function takes
a **signal handle** for its slice plus the parent's `send`.

```typescript
import { nav, button, text } from '@llui/dom'
import type { Signal, Send } from '@llui/dom'

// views/header.ts
export function header(user: Signal<{ name: string } | null>, send: Send<Msg>): Node[] {
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
tax: `state.at('dashboard').at('toolbar').at('menuOpen')` gets its own dependency path, and
unchanged subtrees gate out under a structural-sharing reducer.

### Reusable helper that renders a slice

A reusable view function takes a `Signal<Slice>` and reads via the signal's own
`.at`/`.map` — no `(s) => …` callbacks cross the boundary, and the helper's type stays
decoupled from the parent's full state shape.

```typescript
import { div, text, span } from '@llui/dom'
import type { Signal } from '@llui/dom'

type UserSlice = { name: string; email: string; active: boolean }

function userCard(user: Signal<UserSlice>): Node[] {
  return [
    div({ class: user.at('active').map((a) => (a ? 'card active' : 'card')) }, [
      span([text(user.at('name'))]),
      span([text(user.at('email'))]),
    ]),
  ]
}

// CALLER — slice the parent state to the shape the helper wants:
view: ({ state }) => [userCard(state.at('currentUser'))]
```

See [composition-patterns.md](./composition-patterns.md) for the full set of patterns
(sliced signal, `each` over a sliced list, derived signal, `Node[]` slots, and library
`connect()`).

### List of editable rows — reactive cells over `each`

When per-row fields change in place (a row's title gets edited, a flag flips), every cell
that reads from the row must use a **per-row signal**, not a snapshot. `each` gives the
render a `item: Signal<Row>`; `item.at('field')` is a reactive cell.

```typescript
import { each, tr, td, text, show, span } from '@llui/dom'
import type { Signal } from '@llui/dom'

interface Row {
  id: string
  title: string
  banned: boolean
}

view: ({ state }) => [
  table([
    tbody(
      each(state.at('list').at('items'), {
        key: (r) => r.id, // ← plain id; do NOT include mutable fields
        render: (item) => [tableRow(item)],
      }),
    ),
  ]),
]

const tableRow = (item: Signal<Row>) =>
  tr({}, [
    // Reactive cell — re-reads when this row's `title` changes:
    td([text(item.at('title'))]),
    // Reactive condition — the truthy arm gets the narrowed signal:
    td([show(item.at('banned'), () => [span({ class: 'badge' }, [text('banned')])])]),
  ])
```

Key points:

- **`item.at('title')` is reactive** — the runtime mutates kept rows in place rather than
  recreating them.
- **Read the row id in handlers with `.peek()`**:
  `onClick: () => send({ type: 'select', id: item.at('id').peek() })`.
- **Key is `(r) => r.id` only.** Including mutable fields (`` `${r.id}:${r.editedAt}` ``)
  forces a remove+insert of the whole row on every change — focus, scroll position, and
  transitions all reset.

If a cell needs to combine the row signal with a parent signal (e.g. "is this the active
row?"), use `derived([item, activeId], (r, active) => …)`.

### Normalized entity store + route-keyed branch

A `Record<id, Entity>` store with a detail page reached via
`route: { page: 'entity'; entityId: string }` is idiomatic TEA. Project entities to a row
type in the `each` items signal so cell bindings are simple field reads with precise
per-field masks:

```typescript
interface Entity {
  id: string
  facts: Record<string, { value: string }>
}
interface State {
  entities: Record<string, Entity>
  route: Route
}

view: ({ state }) => [
  each(
    state.at('entities').map((e) =>
      Object.values(e).map((entity) => ({
        id: entity.id,
        name: entity.facts.name?.value ?? '',
        population: entity.facts.population?.value ?? '',
      })),
    ),
    {
      key: (r) => r.id,
      render: (item) => [li([text(item.at('name'))])],
    },
  ),
]
```

For a detail page reached by `branch(state.at('route').at('page'), { entity, list })`, the
arm stays mounted across `entity:A → entity:B` because the page key (`'entity'`) doesn't
change — but every binding inside reads through the **current** `state.at('route')` signal,
so it re-commits when `entityId` changes. There's no stale-capture trap: bindings read the
live signal, not a value captured at render time. Read the active id inside an event
handler with `state.at('route').peek()` (narrow on the discriminant first).

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

### Library components: `connect()` + delegated update

`@llui/components` use a state-machine + `connect` convention. The component exports pure
`init` / `update` functions plus `connect(state: Signal<Slice>, send, opts?)` returning
reactive props to spread onto elements. The parent owns the slice, delegates to the
component's `update`, and routes its messages through its own `Msg` union.

```typescript
import { dialog } from '@llui/components/dialog'
import { button, h2, div, text } from '@llui/dom'

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

The parent stays type-safe: each component gets a branded message variant
(`{ type: 'dialog'; msg: dialog.DialogMsg }`) so the parent's `Msg` union is exhaustive and
routing is explicit. A reviewer sees every state transition in one flat switch; an LLM
generates it mechanically from the types.

### Context: avoiding prop drilling

For ambient data that many components need (theme, user session, i18n) without threading it
through every view function:

```typescript
import { createContext, provide, useContext, div, text } from '@llui/dom'
import type { Signal } from '@llui/dom'

// Declare a typed context with a default value:
const ThemeContext = createContext<Signal<'light' | 'dark'>>(/* default */ undefined!)

// Provide a value to every descendant built inside the render callback:
view: ({ state, send }) =>
  provide(ThemeContext, state.at('theme'), () => [header(state.at('user'), send), main([])])

// Consume anywhere in the subtree:
export function card(): Node[] {
  const theme = useContext(ThemeContext)
  return [div({ class: theme.map((t) => `card theme-${t}`) }, [...])]
}
```

`provide` sets a value for everything `render` builds, then restores it for siblings.
`useContext` reads the nearest provided value (or the context default). Provided values
flow into nested builds (each rows, show/branch arms). Values may be plain or signals.

**When to use context:** theme, route, user session, feature flags, design tokens.
**When NOT to use it:** data that's specific to a subtree — pass a sliced signal handle to
the view function instead.

### Derived values — compute inline by default

State is the source of truth; derived values are pure functions of it. The runtime already
deduplicates binding writes via `Object.is`, so a cheap inline derivation is free even when
it re-evaluates on every commit:

```typescript
// Good — derived inline with .map / derived. No abstraction needed.
text(state.at('user').map((u) => `${u.firstName} ${u.lastName}`))
text(state.at('items').map((items) => `${items.length} items`))
```

**Anti-pattern — denormalized state.** Storing a derived value alongside its inputs invites
drift: the reducer has to remember to update the derived field on every Msg that touches an
input.

```typescript
// ❌ `fullName` will drift if `update` forgets to recompute it.
type State = { user: { firstName: string; lastName: string; fullName: string } }

// ✅ Always consistent. No reducer bookkeeping — derive on read.
type State = { user: { firstName: string; lastName: string } }
text(state.at('user').map((u) => `${u.firstName} ${u.lastName}`))
```

For a value derived from multiple independent signals, combine them with
`derived([sigA, sigB], fn)`.

## Code Splitting

### Lazy-loaded components with `lazy()`

`lazy()` loads a component asynchronously via dynamic `import()`. The
fallback renders immediately; the loaded component swaps in when the
Promise resolves:

```typescript
import { lazy, show, p, text } from '@llui/dom'

view: ({ state }) => [
  show(state.at('showChart'), () => [
    lazy({
      loader: () => import('./chart').then((m) => m.default),
      fallback: () => [p([text('Loading chart...')])],
      error: (err) => [p([text(`Failed: ${err.message}`)])],
    }),
  ]),
]
```

The loaded component's `S`/`M`/`E` types are erased to the loader's type
parameters at the module boundary, so the loader needs no casts:

```typescript
// chart.ts — the loaded module
const Chart = component<ChartState, ChartMsg, never>({
  name: 'Chart',
  init: () => [{ points: [], zoom: 1 }, []],
  // ... own state/msg/view — invisible to the parent
})
export default Chart
```

Pass `initialState` to seed the loaded component's state instead of its `init()` result.

### Virtualized lists with `virtualEach()`

For large lists (1k+ items), `virtualEach` renders only the visible rows.
It requires a fixed row height and a known container height:

```typescript
import { virtualEach, div, span, text } from '@llui/dom'

view: ({ state }) => [
  virtualEach({
    items: state.at('logs'),
    key: (log) => log.id,
    itemHeight: 32,
    containerHeight: 600,
    overscan: 3,
    class: 'log-list',
    render: (item) => [
      div({ class: 'row' }, [span([text(item.at('timestamp'))]), span([text(item.at('message'))])]),
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
import { ul, li, div, text, each } from '@llui/dom'

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

// In view — connect() takes a Signal<SortableState>:
view: ({ state, send }) => {
  const parts = sortable.connect(
    state.at('sort'),
    (m) => send({ type: 'sort', msg: m }),
    { id: 'list' },
  )
  return [
    ul({ ...parts.root, class: 'list' }, [
      each(state.at('items'), {
        key: (x) => x,
        // parts.item / parts.handle take the raw id + index — read them
        // off the per-row signals with .peek():
        render: (item, index) => [
          li({ ...parts.item(item.peek(), index.peek()), class: 'item' }, [
            div({ ...parts.handle(item.peek(), index.peek()), class: 'handle' }, [text('⋮')]),
            text(item),
          ]),
        ],
      }),
    ]),
  ]
}
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

`renderToString(def, initialState, env)` builds the component against a
server `DomEnv` and serializes it to HTML. Effects are **not** dispatched
on the server, so run any data loading yourself and seed the state you
pass in:

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

For composing multiple node trees (layout + page) before one
serialization, use `renderNodes(def, state, env, contexts?)` +
`serializeNodes(nodes)`. On Cloudflare Workers, swap `jsdomEnv` for
`linkedomEnv` from `@llui/dom/ssr/linkedom`.

### Client Hydration

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

`hydrateSignalApp` rebuilds the client tree against the `serverState` you
pass in (matching the SSR render) and atomically swaps it in — server
HTML stays visible until the swap, so no flash. **`init()`'s effects are
skipped by default** during hydration (the server already produced the
state). Pass `{ runInitEffects: true }` for init()s whose effects no-op
on the server (subscriptions, client-only wiring):

```typescript
hydrateSignalApp(container, App, serverState, { runInitEffects: true })
```

### Persistent Layouts

App chrome — header, sidebar, session state, global dialogs — usually
shouldn't re-mount every time the user navigates to a new page. Declare
a `Layout` component that stays alive across client navigation via
`@llui/vike`'s `Layout` option, and use `pageSlot()` inside the layout
to mark where the route's page renders.

> **Don't name the file `+Layout.ts`.** Vike reserves the `+` prefix for
> its own framework-adapter conventions, and `+Layout.ts` is interpreted
> by `vike-react` / `vike-vue` / `vike-solid` as a framework-native
> layout config that conflicts with `@llui/vike`'s `Layout` option. Name
> it `Layout.ts`, `app-layout.ts`, or anywhere outside `/pages` Vike
> won't scan, and import it from `+onRenderClient.ts` by path.

```typescript
// pages/Layout.ts    ← not +Layout.ts
import { component, div, header, main } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'

type LayoutState = { session: string | null }
type LayoutMsg = { type: 'login' } | { type: 'logout' }

export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => [{ session: null }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'login':
        return [{ session: 'alice' }, []]
      case 'logout':
        return [{ session: null }, []]
    }
  },
  view: ({ send }) => [
    div({ class: 'app-shell' }, [
      header([
        /* persistent chrome — stays mounted across nav */
      ]),
      main([pageSlot()]), // ← route's Page renders here
    ]),
  ],
})
```

```typescript
// pages/+onRenderClient.ts
import { createOnRenderClient } from '@llui/vike/client'
import { AppLayout } from './Layout'

export const onRenderClient = createOnRenderClient({
  Layout: AppLayout,
})
```

```typescript
// pages/+onRenderHtml.ts — same Layout on the server
import { createOnRenderHtml } from '@llui/vike/server'
import { jsdomEnv } from '@llui/dom/ssr/jsdom'
import { AppLayout } from './Layout'

export const onRenderHtml = createOnRenderHtml({
  Layout: AppLayout,
  domEnv: jsdomEnv, // jsdomEnv, or linkedomEnv on Cloudflare Workers
})
```

On the first page load the layout hydrates once. On every subsequent
client navigation only the `Page` is disposed and re-mounted — the
layout's DOM nodes, focus traps, portals, scroll positions, and effect
subscriptions all survive. A dialog rendered from the layout
(`AuthDialog`, a settings drawer, etc.) keeps its open/closed state
across nav; pages render inside the slot without touching it.

**Nested layouts.** Pass an array outermost-to-innermost. Every layout
except the innermost calls its own `pageSlot()`:

```typescript
export const onRenderClient = createOnRenderClient({
  Layout: [AppLayout, DashboardLayout],
})
```

For per-route chains — e.g. dashboard routes get the nested layout,
other routes get just the app layout — pass a resolver:

```typescript
export const onRenderClient = createOnRenderClient({
  Layout: (pageContext) =>
    pageContext.urlPathname.startsWith('/dashboard') ? [AppLayout, DashboardLayout] : [AppLayout],
})
```

The chain diff on each nav preserves every layer that matches by
identity with the previous render. Navigating from `/dashboard/reports`
to `/dashboard/overview` disposes only the `Page`; navigating to
`/settings` collapses the chain to `[AppLayout]`, disposing
`DashboardLayout` and its page but leaving `AppLayout` alive.

### Layout → Page communication via context

Layouts and pages are independent component instances, but `pageSlot()`
parents the page's scope inside the layout's scope tree. That means
`useContext` walks from the page up through the slot and finds any
providers the layout installed above it. Use this for layout-owned
operations that pages need to trigger — toast queues, global progress
bars, breadcrumbs, session refresh, chrome visibility toggles.

```typescript
// pages/Layout.ts
import { component, div, main, provide, createContext } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'

interface ToastDispatcher {
  show: (msg: string) => void
}
export const ToastContext = createContext<ToastDispatcher>({ show: () => {} }, 'Toast')

export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => [{ toasts: [] }, []],
  update: layoutUpdate,
  view: ({ send }) => [
    div({ class: 'app-shell' }, [
      ToastStack(), // rendered from layout state
      provide(ToastContext, { show: (msg) => send({ type: 'toast/show', msg }) }, () => [
        main([pageSlot()]),
      ]),
    ]),
  ],
})
```

```typescript
// Any page below the layout reads the dispatcher and triggers it.
// pages/studio/+Page.ts
import { component, button, text, useContext } from '@llui/dom'
import { ToastContext } from '../Layout'

export const StudioPage = component<StudioState, StudioMsg>({
  name: 'StudioPage',
  init: () => [{ saved: false }, []],
  update: (s) => [s, []],
  view: ({ send }) => {
    const toast = useContext(ToastContext)
    return [button({ onClick: () => toast.show('Saved') }, [text('Save')])]
  },
})
```

The page never imports from the layout's internals — it just reads the
context value and calls its methods. The dispatcher is a closure over
the layout's `send`, so calls into it land as messages in the layout's
own update loop. This works uniformly for toast queues, session
refresh, breadcrumb updates, and any other "page triggers layout
operation" pattern.

`provide(ctx, value, render)` sets the value for everything `render`
builds; `useContext(ctx)` reads the nearest provided value (or the
context default). The value is resolved **once at view-construction
time**, so the idiomatic value is a stable record (a dispatcher, a
locale) — capture it in a `const` and call it from event handlers. For
a value that must track parent state per-keystroke, read it from a
sliced `state.at(...)` signal in the view instead of through context.

## Foreign Libraries

`foreign({ tag?, state?, mount, unmount? })` declares reactive inputs as
a record of signals. The runtime materializes each to a `LiveSignal`
(`peek` + `bind`) and hands them to `mount({ el, state })`. `bind` fires
immediately and on every change.

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

MCP is **opt-in** — pass a port to the Vite plugin to enable it:

```typescript
// vite.config.ts
import llui from '@llui/vite-plugin'

export default {
  plugins: [llui({ mcpPort: 5200 })],
}
```

Then run both processes:

```bash
# 1. Start the MCP server (separate terminal)
npx @llui/mcp

# 2. Start your dev server
npx vite
```

Without `mcpPort`, the plugin skips the discovery endpoint entirely
— no 404 polling, no browser-side relay code. Opt in only when you
actually want interactive debugging.

Configure a custom port via the plugin option:

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

| Tool                      | Description                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llui_get_state`          | Get the current component state                                                                                                                                              |
| `llui_send_message`       | Send a message and return new state + effects                                                                                                                                |
| `llui_eval_update`        | Dry-run a message without applying it                                                                                                                                        |
| `llui_get_bindings`       | List all bindings with mask, kind, and last value                                                                                                                            |
| `llui_why_did_update`     | Explain why a specific binding updated (mask match, value diff)                                                                                                              |
| `llui_validate_message`   | Validate a message against the compiled schema                                                                                                                               |
| `llui_get_message_schema` | Get the discriminated union schema for Msg                                                                                                                                   |
| `llui_decode_mask`        | Translate a dirty-mask number to field names                                                                                                                                 |
| `llui_search_state`       | Dot-path lookup into state (e.g. `route.data.repos`)                                                                                                                         |
| `llui_export_trace`       | Export message history as a replayable trace                                                                                                                                 |
| `llui_snapshot_state`     | Checkpoint the current state                                                                                                                                                 |
| `llui_restore_state`      | Restore a previously-captured snapshot                                                                                                                                       |
| `llui_list_components`    | List all mounted components                                                                                                                                                  |
| `llui_select_component`   | Switch the active debug target                                                                                                                                               |
| `llui_lint`               | Lint TypeScript source against `@llui/compiler`'s signal lint rules — pass a `path` to a file. Returns violations + score. Lets an LLM self-correct without running a build. |
| `llui_inspect_element`    | Rich report: tag, attrs, classes, data-\*, text, computed box model, and binding indices for a selector.                                                                     |
| `llui_get_rendered_html`  | Return outerHTML of a selector (defaults to mount root); accepts a max-length limit.                                                                                         |
| `llui_dom_diff`           | Compare expected HTML against the currently rendered HTML and return a structured diff.                                                                                      |
| `llui_dispatch_event`     | Synthesize a browser event on a selector; returns the Msgs produced and resulting state.                                                                                     |
| `llui_get_focus`          | Return active-element info: selector, tag name, and text selection range.                                                                                                    |
| `llui_force_rerender`     | Re-evaluate all bindings and return the indices that produced a new value.                                                                                                   |
| `llui_each_diff`          | Show per-each-site add/remove/move/reuse counts for the last update.                                                                                                         |
| `llui_scope_tree`         | Return the scope hierarchy annotated with kind (root/show/each/branch/child/portal).                                                                                         |
| `llui_disposer_log`       | List recent scope disposals with the cause of each disposal.                                                                                                                 |
| `llui_list_dead_bindings` | Return bindings that are currently dead or have never changed value.                                                                                                         |
| `llui_binding_graph`      | Invert the compiler mask legend: map state paths to the binding indices they gate.                                                                                           |
| `llui_pending_effects`    | List effects that are currently queued or in-flight.                                                                                                                         |
| `llui_effect_timeline`    | Phased log of every effect: dispatched → in-flight → resolved/cancelled.                                                                                                     |
| `llui_mock_effect`        | Register a match→response mock; the next matching effect resolves with the mock value.                                                                                       |
| `llui_resolve_effect`     | Manually resolve a specific pending effect by id.                                                                                                                            |
| `llui_step_back`          | Rewind N messages by replaying from init (pure mode by default).                                                                                                             |
| `llui_coverage`           | Return per-Msg variant fire counts and a list of never-fired variants.                                                                                                       |
| `llui_diff_state`         | Produce a structured JSON diff between two state values.                                                                                                                     |
| `llui_assert`             | Evaluate an eq/neq/exists/gt/lt/in predicate against a state path.                                                                                                           |
| `llui_search_history`     | Filter message history by type, state-path change, effect type, or index range.                                                                                              |
| `llui_eval`               | Run arbitrary JS in the page context; returns the result plus an observability envelope.                                                                                     |

## Agent Visibility Surface

`@llui/agent` ships a set of Level 1 slices that surface what the agent is doing inside your app. The conversation itself happens in the user's external LLM client (Claude Desktop / IDE / wherever the MCP bridge is mounted) — the framework doesn't try to be a chat surface. What it gives you is _visibility_: a connection panel, an activity log, attention flashes on changed DOM, and a one-way `narrate` channel for the LLM to surface its thinking inline with its actions.

Four slices compose into one panel:

| Slice            | Owns                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `agentConnect`   | Connection lifecycle (mint / pending-claude / active / reconnecting / failed)    |
| `agentConfirm`   | Confirm dialog state for `requiresConfirm` Msg dispatches                        |
| `agentLog`       | Ring-buffered activity timeline (every rpc, with intent + payload detail + diff) |
| `agentAttention` | Current dispatch's spotlight: which DOM regions to flash when state changes      |

Each is an `init` / `update` / `Msg` / `connect()` triple. The host nests each slice's state under its own `agent` field, routes each slice's Msgs through its root `update()` (enveloped as `{ type: 'agent', sub, msg }`), and spreads the slices' signal-handle part bags into its own layout. The `createAgentClient` factory fans inbound WS log-append frames out to both `agentLog` and `agentAttention` via its `wrapMsg` callbacks.

### Wiring the slices

```ts
// state.ts
type State = {
  agent: {
    connect: agentConnect.AgentConnectState
    confirm: agentConfirm.AgentConfirmState
    log: agentLog.AgentLogState
    attention: agentAttention.AgentAttentionState
  }
}

const initial: State = {
  agent: {
    connect: agentConnect.init({ mintUrl: '/agent/mint' })[0],
    confirm: agentConfirm.init()[0],
    log: agentLog.init()[0],
    attention: agentAttention.init()[0],
  },
}

// update.ts — envelope each slice's Msgs and route to its update():
//   { type: 'agent', sub: 'connect', msg: agentConnect.AgentConnectMsg }
//   { type: 'agent', sub: 'log',     msg: agentLog.AgentLogMsg }
//   { type: 'agent', sub: 'attention', msg: agentAttention.AgentAttentionMsg }

// main.ts — wire the factory's wrapMsg callbacks
createAgentClient<State, Msg>({
  handle,
  def,
  rootElement,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m }),
    wrapLogMsg: (m) => ({ type: 'agent', sub: 'log', msg: m }),
    wrapAttentionMsg: (m) => ({ type: 'agent', sub: 'attention', msg: m }),
  },
})
```

### Rendering the panel

```ts
// agent-panel.ts — bare bones. A view-helper that takes the state signal.
import { div, text, each, type Signal } from '@llui/dom'
import { summarizeDiff } from '@llui/agent/client'

function panel(state: Signal<State>) {
  return div([
    // Activity feed — `each` over a derived signal of the recent entries.
    // Each row gets a `Signal<LogEntry>`; read fields with `.map`.
    each(
      state
        .at('agent')
        .at('log')
        .map((log) => log.entries.slice(-20).reverse()),
      {
        key: (e) => e.id,
        render: (item) => [
          div([
            text(item.map((e) => e.kind)), // chip
            text(item.map((e) => e.intent ?? e.variant ?? '—')), // headline
            text(item.map((e) => e.detail ?? '')), // payload k=v
            text(item.map((e) => summarizeDiff(e.stateDiff))), // "3 changes in cart"
          ]),
        ],
      },
    ),
  ])
}
```

### Visual attention layer

`agentAttention.connect(state, send).flashClass(path)` returns a `Signal<string | undefined>` that resolves to `'agent-flash'` when the path is in the most recent dispatch's affected set. Drop the handle straight onto a reactive `class` slot:

```ts
const att = agentAttention.connect(state.at('agent').at('attention'), (m) =>
  send({ type: 'agent', sub: 'attention', msg: m }),
)

// In your view layout — flashClass('cart') is a Signal, so the class is reactive:
div({ class: att.flashClass('cart') }, [
  // cart contents — flashes when an agent dispatch touches /cart/*
])
```

Then import the optional default stylesheet (or write your own keyframes):

```ts
import '@llui/agent/styles/agent-panel.css'
```

The default ships an `.agent-flash` keyframe with `prefers-reduced-motion` fallback and tunable CSS custom properties (`--llui-agent-flash-color`, `--llui-agent-flash-duration`).

### Helper utilities

`@llui/agent/client` exports three pure renderers for `LogEntry.stateDiff`:

| Helper          | Returns                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `summarizeDiff` | One-line headline: `'3 changes in cart'` / `'2 items added across 3 regions'`    |
| `groupDiff`     | `[{ region, adds, removes, replaces, paths }, …]` for region-by-region rendering |
| `describeOp`    | One-op short verb + dotted path: `'changed cart.total'`                          |

All schema-free; the host renders however it likes.

### When to use which agent tool

| User wants…                              | Tool                       |
| ---------------------------------------- | -------------------------- |
| Read state                               | `get_state`, `query_state` |
| Dispatch a Msg                           | `send_message`             |
| Push prose into the activity feed        | `narrate`                  |
| Wait for a specific state path to change | `wait_for_change`          |

A typical multi-step run reads as: `narrate("about to do X") → send_message(...) → narrate("here's the result")`. The user reads the narration inline with the dispatches; if they want to redirect, they reply in their LLM's own chat window — the framework doesn't try to compete with that.

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

// Phase 1 additions:
__lluiDebug.inspectElement('#btn') // → rich element report
__lluiDebug.getPendingEffects() // → list of queued/in-flight effects
__lluiDebug.mockEffect({ type: 'http' }, { data: 'fake' }) // → { mockId }
__lluiDebug.stepBack(3, 'pure') // → rewind 3 messages
__lluiDebug.getCoverage() // → { fired, neverFired }

// Multi-component apps:
__lluiComponents // → { Counter: api, Dashboard: api }
__lluiDebug = __lluiComponents.Dashboard // switch target
```
