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

**The contract**: a reactive `value:` binding is **controlled** — the
framework writes whatever the accessor returns to `el.value` on every
commit where the result differs from what it last wrote. Keep state in
sync via `onInput` (as above), and the accessor's return value always
matches what the user has typed.

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

view: ({ send }) => [
  input({
    type: 'text',
    // Read the in-progress edit if present; otherwise the persisted
    // value; otherwise empty.
    value: (s: State) => s.edits.name ?? s.persisted?.name ?? '',
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
  value: (s) => s.entities[id]?.facts.name ?? '',
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
          http.post(
            `/save/${msg.field}`,
            { value },
            {
              onOk: (canonical: string) => ({ type: 'saveOk', field: msg.field, canonical }),
              onErr: (reason: string) => ({ type: 'saveErr', field: msg.field, reason }),
            },
          ),
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

### Reading current state from event handlers with `h.getState()`

Event handlers fire outside the render context — there's no `s`
argument, and `sample()` throws because the active render scope
is gone. When a handler needs the current state to decide what to
dispatch (e.g. compute a submit payload at click time), use
`h.getState()`:

```typescript
view: (h: View<State, Msg>) => [
  button(
    {
      onClick: () => {
        const s = h.getState()
        h.send({ type: 'save', payload: { name: s.draft.name, body: s.draft.body } })
      },
    },
    [text('Save')],
  ),
]
```

`h.getState()` mirrors `AppHandle.getState()` — same name, same
contract, but typed by the view's `S` and available inside the
view function's closure (where the `AppHandle` isn't). Safe to
call from event handlers, async callbacks (`setTimeout`,
`Promise.then`), and post-mount adapter code. Each call reads the
_current_ state, not a snapshot captured at view construction.

**Anti-pattern — sentinel-class binding writing state to a module ref**:

```typescript
// ❌ Side effects in a reactive accessor. The class accessor fires
//    on every commit, scribbles state into a module-local ref purely
//    so the onClick handler can read it. Triggers the file-wide
//    opaque warning when the ref-update calls cross-module helpers.
const latest: { name: string | null } = { name: null }

view: (h) => [
  div({
    class: (s) => {
      latest.name = opts.name(s) // side effect
      return 'hidden'
    },
  }),
  button({
    onClick: () => {
      if (latest.name) h.send({ type: 'save', name: latest.name })
    },
  }),
]
```

Replace with `h.getState()`:

```typescript
// ✅ No side effects, no module-local ref. The handler reads the
//    parent state at click-time and computes whatever it needs.
view: (h) => [
  button(
    {
      onClick: () => {
        const s = h.getState()
        h.send({ type: 'save', name: opts.name(s) })
      },
    },
    [text('Save')],
  ),
]
```

**Don't use `getState()` inside a reactive accessor**:

```typescript
// ❌ Bypasses bitmask tracking — the binding degrades to FULL_MASK
//    and fires on every state change.
text(() => h.getState().count.toString())

// ✅ Reactive — receives state via the closure argument, mask is
//    derived from the read.
text((s) => s.count.toString())
```

The accessor argument is already the live state during render.
`getState()` is the _event-time_ escape hatch — render-time reads
go through accessors.

### `track({ deps: (s) => [...] })` — declaring paths the walker can't statically infer

`track()` is a narrow escape hatch. It exists for cases where the
compiler can't see specific property reads in the accessor body
itself (dynamic indexing, helpers reached via cross-file context
chains, dispatch tables indexed by state) — but the user CAN
name the paths the accessor actually reads.

The compiler reads the `deps` callback, folds its paths into the
component's `__prefixes`, and strips the entire `track()` call
from the emitted bundle. Zero runtime cost, precise mask.

```typescript
import { track } from '@llui/dom'

// Plugin registry: `pluginRegistry[name].render(...)`. The walker
// can't trace through dynamic indexing — `name` is state — so it
// flags the file. `track` declares the dependencies explicitly.
view: (h) => [
  scope({
    on: (s) => s.activePluginName,
    render: () => [
      ...renderArea((s) => {
        track<State>({
          deps: (s) => [s.pluginRegistry, s.activePluginName, s.pluginState],
        })
        const plugin = s.pluginRegistry[s.activePluginName]
        return plugin.render(h, s.pluginState)
      }),
    ],
  }),
]
```

**Both** `llui/opaque-state-flow` (error) and
`llui/opaque-accessor-file-wide-mask` (perf warning) honour the
suppression — **inside the `deps` callback only**. Opaque reads in
the rest of the enclosing accessor's body are analysed
independently. If your body has a separate `opts.X(s)` outside
`deps`, that's its own opaque flow and will still fire the
diagnostic. Read deeply-nested or dynamically-indexed values via
the looked-up handle (e.g. assign to a local from `s.collection[s.key]`
once at the top of the body, then read property-access chains off
the local) so the outer body has only direct property reads.

#### When `track` does NOT help — the function-parameter-callback anti-pattern

`track()` only delivers a precise mask when the `deps` body itself
reads paths the walker CAN extract — concrete property-access
chains like `(s) => [s.foo, s.bar.baz]`. If the deps body is
itself opaque (e.g. `(s) => [opts.getError(s)]` where `opts.getError`
is a function-parameter callback), the walker can't pull any
paths out of it and `track` collapses to FULL_MASK + sentinel
**at runtime**, exactly as if you hadn't written `track` at all.
The compile-time diagnostic may go quiet, but the runtime perf
cost is identical.

**Anti-pattern**:

```typescript
// ❌ `opts.host.name` is a function parameter. The walker can't see
//    what it reads. `track` with an opaque deps body silences the
//    diagnostic but does not produce a precise mask — every binding
//    in the file still falls back to whole-state sentinel.
function dialog<PS>(h: View<PS, Msg>, opts: { host: { name: (s: PS) => string } }) {
  return [
    text((s) => {
      track<PS>({ deps: (s) => [opts.host.name(s)] }) // ← opaque deps body
      return opts.host.name(s)
    }),
  ]
}
```

The fix is composition restructuring — pass reactive primitives
across the boundary instead of state-reading callbacks. See
[composition-patterns.md](./composition-patterns.md) for the four
documented migration shapes (`Props<T, S>`, slotted text/each,
service injection via context, derived view bag).

**When `track` is right**:

- **Dynamic indexing**: `s.collection[s.activeKey]` where
  `activeKey` is state. The walker can't see what `[expr]` does.
- **Cross-context chains**: a value reached through two-plus
  `useContext` providers in different files.
- **Dispatch tables**: helpers stored in arrays / records and
  indexed by state.

**When `track` is wrong**:

- Function-parameter callbacks (`opts.X: (s) => …`) — restructure
  the composition.
- The reads are direct (`s.foo`, `s.foo[i]` with literal index) —
  let the walker derive the mask.
- The opaque helper lives in your file or a same-package module —
  inline it as a `const` / `function` declaration so the walker
  can resolve it.

### Recovering from view-construction errors with `errorBoundary`

Wrap a subtree that might throw at render time (e.g. reaches into
state that's incompletely loaded, or calls a helper that can fail)
with `errorBoundary`. The boundary catches anything thrown during
the wrapped subtree's view construction, disposes the partial scope,
and renders the fallback instead.

```typescript
import { errorBoundary, div, button, text } from '@llui/dom'

view: ({ send }) => [
  div({ class: 'page' }, [
    // Header / nav / chrome stay mounted even if the panel crashes.
    div({ class: 'header' }, [text('My App')]),

    // Risky subtree — wrap it.
    ...errorBoundary({
      render: () => [
        // Anything thrown inside (helpers, accessors, child views)
        // is caught and routed to `fallback`.
        riskyPanel(send),
      ],
      fallback: (error) => [
        div({ class: 'error-panel' }, [
          text(() => `Couldn't render this panel: ${error.message}`),
          button({ onClick: () => send({ type: 'retryPanel' }) }, [text('Retry')]),
        ]),
      ],
      onError: (error) => {
        // Optional — report to your error tracker.
        console.error('[panel]', error)
      },
    }),
  ]),
]
```

**What's caught**:

- Synchronous throws during view construction inside `render` — e.g.
  helper functions that throw on bad inputs, accessors that destructure
  unexpected state shapes during build, primitive construction errors.

**What's NOT caught** (and shouldn't be):

- **Binding-evaluation errors during Phase 2.** A reactive accessor
  that throws on commit is reported via the binding-error hook
  (`__lluiDebug.onBindingError` or console.warn fallback), not by
  `errorBoundary`. The DOM keeps the last good value for the binding;
  sibling bindings continue to fire. See [debugging.md](./debugging.md).
- **Effects** (`http`, `delay`, etc.) — these have their own
  `onError` callback that dispatches a Msg. Handle failures in
  `update`, not in the view.
- **Async errors** in user code (Promises, timers). Catch them
  yourself and dispatch a Msg.

**Where to place the boundary**: around the smallest subtree that
makes sense to fail independently. Wrapping the entire app means a
single crash unmounts everything; wrapping each risky panel keeps
the rest of the UI live.

## Composition

### View Functions

The only composition primitive. Split views into separate modules; the parent owns state, the child module operates on a slice of it.

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

### Helpers that read state: avoid the opaque-flow trap

When you write a helper that derives a value from state, **prefer
same-module function/const declarations over method calls on imported
objects**. The compiler's accessor walker can resolve calls to
local declarations (and follow them to compute precise masks). It
cannot resolve method dispatch through an imported host object —
that path is opaque, flips the file to `hasOpaqueAccessor = true`,
and degrades every binding in the component to FULL_MASK (fires on
every state change, not just relevant ones).

**Anti-pattern**:

```typescript
// host.ts
export const host = {
  activeCalendar: (s: State) => s.calendars[s.activeId],
  dirtyAt: (s: State, eid: string, pred: string) => s.entities[eid]?.dirty[pred],
}

// view.ts
import { host } from './host.js'

view: () => [
  div({
    // ↓↓ Both accessors flip the file to FULL_MASK: state flows into
    // a method call (`host.activeCalendar(s)`, `host.dirtyAt(s, …)`).
    // The compiler can't trace what `host.X` reads, so it bails.
    title: (s) => host.activeCalendar(s)?.name ?? '',
    class: (s) => (host.dirtyAt(s, eid, pred) ? 'dirty' : 'clean'),
  }),
]
```

The compile-time diagnostic `llui/opaque-accessor-file-wide-mask`
fires for this and names the offending accessor's file and line.
See [debugging.md → Reading compiler diagnostics](./debugging.md#reading-compiler-diagnostics)
for how it surfaces in `vite build` output.

**Fix — inline the helpers as same-module functions**:

```typescript
// view.ts (helpers and view in one module)
function activeCalendar(s: State): Calendar | undefined {
  return s.calendars[s.activeId]
}
function dirtyAt(s: State, eid: string, pred: string): boolean {
  return s.entities[eid]?.dirty[pred] ?? false
}

view: () => [
  div({
    // ↓↓ Now precise — the walker follows the function bodies and
    // sees `s.calendars`, `s.activeId`, `s.entities` as the reactive
    // paths. Each binding's mask reflects exactly what it reads.
    title: (s) => activeCalendar(s)?.name ?? '',
    class: (s) => (dirtyAt(s, eid, pred) ? 'dirty' : 'clean'),
  }),
]
```

**Alternative — declare deps explicitly with `track()`** when the
helper genuinely needs to live in another module or do something
opaque:

```typescript
import { track } from '@llui/dom'
import { host } from './host.js'

view: () => [
  div({
    // `track({ deps })` tells the compiler exactly which paths the
    // accessor reads. The opaque body is fine; the deps are explicit.
    title: track({
      deps: (s) => [s.calendars, s.activeId],
      get: (s) => host.activeCalendar(s)?.name ?? '',
    }),
  }),
]
```

Why same-module wins:

- **Compile-time analysis sees the body.** The walker reads
  `s.calendars` and `s.activeId` literally, assigns precise bits,
  and the binding's mask reflects them.
- **Refactoring stays cheap.** A new helper added to the module
  joins the analysis automatically.
- **No `track()` ceremony.** Deps stay implicit when the analyser
  can derive them.

Cross-file walker bonus (LLui ≥ 0.5.10): when a helper is a
view-helper (returns `Node[]` or has `@llui-helper` tag), the
walker follows the call across files automatically. The
opaque-flow trap fires for arbitrary helpers (returning string /
boolean / etc.), not for view-helpers.

### List of editable rows -- reactive cells over `each`

When per-row fields change in place (a row's title gets edited, a flag flips, a status updates), every cell that reads from the row must use a **reactive accessor**, not a snapshot. Otherwise the row's DOM stays stuck on the value it had when the list was first built. The shape is `each` + `ItemAccessor` + reactive bindings inside the cells:

```typescript
import { each, tr, td, text, show } from '@llui/dom'
import type { ItemAccessor, View } from '@llui/dom'

interface Row {
  id: string
  title: string
  banned: boolean
  lastEditAt: number
}

view: (h) => [
  table([
    tbody(
      h.each({
        items: (s) => s.list.items,
        key: (r) => r.id, // ← plain id; do NOT include mutable fields
        render: ({ item }) => [tableRow(h, item)],
      }),
    ),
  ]),
]

const tableRow = (h: View<State, Msg>, item: ItemAccessor<Row>) =>
  tr({}, [
    // Reactive: text(item.title) — zero-arg accessor, re-reads on every commit
    td([text(item.title)]),
    // Reactive predicate: () => item.banned() — same pattern
    td([
      ...h.show({
        when: () => item.banned(),
        render: () => [span({ class: 'badge' }, [text('banned')])],
      }),
    ]),
  ])
```

Key points:

- **`text(item.title)` is reactive** — passes the accessor function. The runtime detects the zero-arg form and re-reads on every commit.
- **`text(item.title())` is static** — the agent-no-eager-item-accessor lint rule flags this. Calling the accessor at construction time captures the value once; the cell never updates.
- **`show.when: () => item.banned()` is reactive** — same zero-arg form. Avoid `when: (s) => …` here; the row's data lives on the item, not the parent state.
- **Key is `(r) => r.id` only.** Including mutable fields (`${r.id}:${r.lastEditAt}`) forces a remove+insert of the entire row on every change — focus, scroll position, and transitions all reset.

### Normalized entity store + route-keyed scope

A `Record<id, Entity>` store with a detail page reached via `route: { name: 'entity'; entityId: string }` is idiomatic TEA. There are two traps in this shape that aren't obvious from the quick-start:

**1. Per-row reads with `item.current().field.nested[K]`** fall back to a wide bitmask. The compiler can't trace through the `.current()` call to know which state path you read, so the binding fires on every state change. Worse, the chained access throws on any commit where the row hasn't been reconciled yet but a parent binding re-fired. Destructure once at the top of each accessor, or project to a row type in `items`:

```typescript
interface Entity {
  id: string
  facts: Record<string, Fact>
}
interface State {
  entities: Record<string, Entity>
  route: Route
}

// ❌ FULL_MASK + repeated .current() — fragile under reconcile races
h.each<Entity>({
  items: (s) => Object.values(s.entities),
  key: (e) => e.id,
  render: ({ item }) => [
    li([
      h.text(() => item.current().facts.name?.value ?? ''),
      h.text(() => item.current().facts.population?.value ?? ''),
    ]),
  ],
})

// ✅ destructure once per accessor
render: ({ item }) => [
  li([
    h.text(() => {
      const e = item.current()
      return e.facts.name?.value ?? ''
    }),
  ]),
]

// ✅✅ project to a row type in `items` — bindings become simple field
//     reads with precise per-field masks
h.each<{ id: string; name: string; population: number | null }>({
  items: (s) =>
    Object.values(s.entities).map((e) => ({
      id: e.id,
      name: String(e.facts.name?.value ?? ''),
      population: Number(e.facts.population?.value ?? null),
    })),
  key: (r) => r.id,
  render: ({ item }) => [li([h.text(item.name)])],
})
```

**2. `branch` doesn't reconcile when navigating between siblings of the same case key.** `branch({ on: s => s.route.name, cases: { entity, list } })` stays mounted across `entity:A → entity:B` — the case key (`'entity'`) doesn't change. Any binding inside the `entity` case that captured the OLD `entityId` at render-time via `h.sample` keeps firing against the old id.

**What breaks without the scope wrapper** (concrete failure pattern):

```typescript
// Inside the entity case:
function viewEntity(h: View<State, Msg>): Node[] {
  const id = h.sample((s: State) => (s.route.name === 'entity' ? s.route.entityId : ''))
  return [
    // ❌ `id` was captured at render-time. Navigating entity:A → entity:B
    //    doesn't re-run viewEntity — same case key. The input keeps
    //    reading from entities['A'] forever, even when the URL says B.
    input({
      value: (s) => s.entities[id]?.name ?? '',
      onInput: (e) =>
        h.send({
          type: 'rename',
          id,
          value: (e.target as HTMLInputElement).value,
        }),
    }),
  ]
}
```

Result: silent data corruption. The user navigates to B, types into the input, and the `rename` Msg dispatches with `id: 'A'` — they edit entity A while looking at entity B.

Wrap the branch with `scope` keyed on the identity that should force remount:

```typescript
// ❌ stale bindings persist when navigating entity:A → entity:B
...h.branch({
  on: (s) => s.route.name,
  cases: { entity: () => [viewEntity(h)], list: () => [viewList(h)] },
})

// ✅ scope's key includes the entity id; entity:A → entity:B forces a
//    full remount of the entity view, so every binding inside is fresh
//    and captures the current id at render-time
...h.scope({
  on: (s) =>
    s.route.name === 'entity' ? `entity:${s.route.entityId}` : 'list',
  render: (sub) => [
    ...sub.branch({
      on: (s) => s.route.name,
      cases: { entity: () => [viewEntity(sub)], list: () => [viewList(sub)] },
    }),
  ],
})
```

The cost is one extra render per navigation between different entities — negligible for most apps, and the safety win is large.

### Anti-pattern: don't wrap a list in `sample`

```typescript
// ❌ WRONG — looks idiomatic, silently breaks when rows mutate in place
loaded: (h) =>
  h.sample((s) => (s.list.items.length === 0 ? [emptyState] : [table(s.list.items.map(rowFn))]))
```

`sample` is a one-shot imperative read at view-construction time. The `.map(...)` runs once, captures each row in closure, and never re-runs when state updates. Cells inside read static row objects; the rendered DOM goes stale. Only a parent structural rebuild (e.g. a `branch` swapping arms) refreshes them — which makes the bug invisible to typecheck, tests, and casual smoke testing. Use `each` (above). `sample` is for passing a state snapshot to imperative renderers (foreign libraries, canvas), not for laying out variable-length lists.

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

**When NOT to use it:** for view-function composition where the parent owns
the state directly and passes accessors down via `Props<T, S>`. `sliceHandler`
is for genuine sub-modules with their own update logic.

### Type-level composition with `ModulesState` / `ModulesMsg`

When composing many embedded modules, the State and Msg union declarations
become repetitive. `ModulesState` and `ModulesMsg` derive the sub-state /
sub-msg portions from a map of component modules, and `composeModules`
creates the merged handler at runtime:

```typescript
import { mergeHandlers, composeModules } from '@llui/dom'
import type { ModulesState, ModulesMsg } from '@llui/dom'
import { dialog } from '@llui/components/dialog'
import { tabs } from '@llui/components/tabs'
import { sortable } from '@llui/components/sortable'

const modules = { dialog, tabs, sort: sortable } as const

// ModulesState derives { dialog: DialogState; tabs: TabsState; sort: SortableState }
// ModulesMsg   derives { type: 'dialog'; msg: DialogMsg } | { type: 'tabs'; msg: TabsMsg } | ...
type State = ModulesState<typeof modules> & { items: string[] }
type Msg = ModulesMsg<typeof modules> | { type: 'addItem'; text: string }

const update = mergeHandlers<State, Msg, never>(composeModules(modules), (state, msg) => {
  if (msg.type === 'addItem') {
    return [{ ...state, items: [...state.items, msg.text] }, []]
  }
  return null
})
```

Each module's `update` is wired via the key convention automatically.
The parent only writes its own State fields and Msg variants — module wiring
is zero boilerplate.

Use this stack when embedded modules emit bare messages (`{ type: 'open' }`)
— typically components from `@llui/components` or third-party packages. When
you own the slice's message shape, prefer `combine()` with slash-routing
(`{ type: 'slice/action' }`) instead.

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

### Derived state: when to compute, memoize, or normalize

LLui has three primitives for working with values derived from state:
inline computation in an accessor, `memo()`, `selector()`, and
`slice()`. They overlap in purpose; the choice depends on cost,
sharing, and access shape.

**Default — compute inline.** State is the source of truth; derived
values are pure functions of it. The runtime already deduplicates
binding writes via `Object.is(newValue, lastValue)`, so a cheap
inline computation is free even when it re-evaluates on every
commit:

```typescript
// Good — derived inline. No abstraction needed.
text((s: State) => `${s.user.firstName} ${s.user.lastName}`)
text((s: State) => `${s.items.length} items`)
```

**Anti-pattern — denormalized state.** Storing a derived value
alongside its inputs invites them to drift. The reducer has to
remember to update the derived field on every Msg that touches an
input. Misses produce silent staleness.

```typescript
// ❌ `fullName` will drift if `update` forgets to recompute it.
type State = {
  user: { firstName: string; lastName: string; fullName: string }
}
```

Compute `fullName` on read instead:

```typescript
// ✅ Always consistent. No reducer bookkeeping.
type State = { user: { firstName: string; lastName: string } }
text((s) => `${s.user.firstName} ${s.user.lastName}`)
```

**Reach for `memo()` when the computation is expensive AND the
result is unchanged between commits.** The bitmask gate already
skips bindings whose dependencies didn't change; `memo` adds an
output-stability cache. Useful for:

- Computations that allocate or sort/filter arrays where the inputs
  haven't changed (e.g., `(s) => s.items.filter(predicate).sort()`
  — see the each-memo recipe).
- Multiple bindings reading the same derived value where the
  underlying state mask is wide.

```typescript
import { memo } from '@llui/dom'
const filtered = memo((s: State) => s.items.filter((i) => i.active))
// Used by multiple bindings — each binding pays a cache lookup,
// not a full recomputation.
```

**Reach for `selector()` when N bindings each ask "is the current
value of X equal to _my_ value Y?"** (the "one-of-N highlight"
shape: only one tab/row/cell is active at a time). Switching
between values is O(2) instead of O(N) — the leaving entry's
binding fires, the new entry's binding fires, every other entry
sleeps.

```typescript
// See `### Derived values with selector` below for the full example.
const activeId = selector((s: State) => s.selectedId)
// Each row asks `activeId.bind('row-42', kind, key, ...)` — the
// `selector` routes updates O(1) on change.
```

**Reach for `slice()` when a view function operates on a sub-tree**
and you don't want it coupled to the parent state's full type.
`slice` is a type-narrowing tool, not a memoization one.

Decision tree:

| Situation                                     | Use                                                |
| --------------------------------------------- | -------------------------------------------------- |
| Cheap pure derivation                         | inline accessor                                    |
| Expensive computation, multiple readers       | `memo()`                                           |
| One-of-N comparison (active row, current tab) | `selector()`                                       |
| View function on a focused sub-shape          | `slice()`                                          |
| Multiple of the above for the same value      | combine — `memo` inside a `selector` field is fine |

The runtime's existing equality check makes inline computation the
right default. Reach for the abstractions only when you can name a
specific cost they save (allocation, repeated O(N), type-coupling).

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

### Rebuild a subtree when a derived value changes

When a piece of state bumps an epoch/version counter and you want the
downstream subtree to rebuild from scratch — not diff in place — use
`scope()`:

```typescript
import { scope, sample } from '@llui/dom'

view: () => [
  ...scope({
    on: (s) => String(s.chartEpoch),
    render: () => {
      const stats = sample<State, Stats>((s) => s.stats)
      return [chartView(stats)]
    },
  }),
]
```

- `on` gates when the subtree rebuilds. Only state paths read inside `on`
  contribute to the `scope`'s dirty mask; stats-only changes that don't
  bump `chartEpoch` do **not** trigger a rebuild.
- `sample()` reads the current state snapshot without creating a binding.
  Use it when the imperative renderer wants the whole record, not a
  single reactive field. Inside a `View` bag, `h.sample(...)` is the
  destructure-friendly form; the top-level import works anywhere a
  render context is live.

**Avoid the old workaround.** Before `scope()` existed, authors used
`each()` with a singleton-array plus a closure-captured snapshot:

```typescript
// Don't do this — use scope() instead
let chartSnap: Stats | null = null
each({
  items: (s) => {
    chartSnap = s.stats
    return [s.chartEpoch]
  },
  key: (n) => String(n),
  render: () => chartView(chartSnap!),
})
```

`scope({ on, render })` + `sample()` is the idiomatic replacement.

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

`hydrateApp` uses the `serverState` you pass in (instead of whatever
`init()` would return) so the client tree lines up with the HTML the
server already rendered. **Effects from the original `init()` are
still dispatched** after hydration completes — subscriptions,
initial data loads, and other effect-based wiring work the same way
they would on a fresh mount. If your `init` returns effects that
would duplicate work already done by the server (e.g. re-fetching
data that's baked into `serverState`), gate them inside `init`
based on a flag in state:

```typescript
init: (data) => {
  const loaded = data?.loaded === true
  return [data ?? { loaded: false, items: [] }, loaded ? [] : [http({ url: '/api/items' /* … */ })]]
}
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
import { AppLayout } from './Layout'

export const onRenderHtml = createOnRenderHtml({
  Layout: AppLayout,
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
export const ToastContext = createContext<ToastDispatcher>(undefined, 'Toast')

export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => [{ toasts: [] }, []],
  update: layoutUpdate,
  view: ({ send }) => [
    div({ class: 'app-shell' }, [
      ToastStack(), // rendered from layout state
      ...provideValue(
        ToastContext,
        {
          show: (msg) => send({ type: 'toast/show', msg }),
        },
        () => [main([pageSlot()])],
      ),
    ]),
  ],
})
```

```typescript
// Any page below the layout reads the dispatcher and triggers it.
// pages/studio/+Page.ts
import { component, button, text, useContextValue } from '@llui/dom'
import { ToastContext } from '../Layout'

export const StudioPage = component<StudioState, StudioMsg>({
  name: 'StudioPage',
  init: () => [{ saved: false }, []],
  update: (s) => [s, []],
  view: ({ send }) => {
    const toast = useContextValue(ToastContext)
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

`provideValue` and `useContextValue` are the static-bag companions to
the reactive `provide` / `useContext` primitives. Use them whenever the
context value is a stable dispatcher record that doesn't depend on
parent state — they let you write `useContextValue(ctx).method(...)`
in one call instead of `useContext(ctx)(undefined as never).method(...)`.
Reach for the reactive form (`provide(ctx, accessor, children)` +
`useContext(ctx)`) when the context value DOES need to track state,
e.g. `provide(ThemeContext, (s) => s.theme, () => [...])` for a
theme value that changes on user interaction.

**Capture contract:** `useContextValue(ctx)` returns the value **once,
at view-construction time**. Assigning it to a `const` inside `view()`
and reading it from an event handler is the correct and efficient
pattern — the closure captures the stable dispatcher record and
handlers fire against it forever. But it also means: if a parent
re-`provideValue`s the context with a different object later,
consumers already holding the captured reference still see the old
one. For that case — rare, since dispatcher records are typically
identity-stable — reach for the reactive `useContext(ctx)` form, which
re-reads the provider on every binding evaluation.

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

| Tool                      | Description                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llui_get_state`          | Get the current component state                                                                                                                                                    |
| `llui_send_message`       | Send a message and return new state + effects                                                                                                                                      |
| `llui_eval_update`        | Dry-run a message without applying it                                                                                                                                              |
| `llui_get_bindings`       | List all bindings with mask, kind, and last value                                                                                                                                  |
| `llui_why_did_update`     | Explain why a specific binding updated (mask match, value diff)                                                                                                                    |
| `llui_validate_message`   | Validate a message against the compiled schema                                                                                                                                     |
| `llui_get_message_schema` | Get the discriminated union schema for Msg                                                                                                                                         |
| `llui_decode_mask`        | Translate a dirty-mask number to field names                                                                                                                                       |
| `llui_search_state`       | Dot-path lookup into state (e.g. `route.data.repos`)                                                                                                                               |
| `llui_export_trace`       | Export message history as a replayable trace                                                                                                                                       |
| `llui_snapshot_state`     | Checkpoint the current state                                                                                                                                                       |
| `llui_restore_state`      | Restore a previously-captured snapshot                                                                                                                                             |
| `llui_list_components`    | List all mounted components                                                                                                                                                        |
| `llui_select_component`   | Switch the active debug target                                                                                                                                                     |
| `llui_lint`               | Lint TypeScript source against `@llui/compiler`'s 41 idiomatic-LLui rules — pass a `path` to a file. Returns violations + score. Lets an LLM self-correct without running a build. |
| `llui_inspect_element`    | Rich report: tag, attrs, classes, data-\*, text, computed box model, and binding indices for a selector.                                                                           |
| `llui_get_rendered_html`  | Return outerHTML of a selector (defaults to mount root); accepts a max-length limit.                                                                                               |
| `llui_dom_diff`           | Compare expected HTML against the currently rendered HTML and return a structured diff.                                                                                            |
| `llui_dispatch_event`     | Synthesize a browser event on a selector; returns the Msgs produced and resulting state.                                                                                           |
| `llui_get_focus`          | Return active-element info: selector, tag name, and text selection range.                                                                                                          |
| `llui_force_rerender`     | Re-evaluate all bindings and return the indices that produced a new value.                                                                                                         |
| `llui_each_diff`          | Show per-each-site add/remove/move/reuse counts for the last update.                                                                                                               |
| `llui_scope_tree`         | Return the scope hierarchy annotated with kind (root/show/each/branch/child/portal).                                                                                               |
| `llui_disposer_log`       | List recent scope disposals with the cause of each disposal.                                                                                                                       |
| `llui_list_dead_bindings` | Return bindings that are currently dead or have never changed value.                                                                                                               |
| `llui_binding_graph`      | Invert the compiler mask legend: map state paths to the binding indices they gate.                                                                                                 |
| `llui_pending_effects`    | List effects that are currently queued or in-flight.                                                                                                                               |
| `llui_effect_timeline`    | Phased log of every effect: dispatched → in-flight → resolved/cancelled.                                                                                                           |
| `llui_mock_effect`        | Register a match→response mock; the next matching effect resolves with the mock value.                                                                                             |
| `llui_resolve_effect`     | Manually resolve a specific pending effect by id.                                                                                                                                  |
| `llui_step_back`          | Rewind N messages by replaying from init (pure mode by default).                                                                                                                   |
| `llui_coverage`           | Return per-Msg variant fire counts and a list of never-fired variants.                                                                                                             |
| `llui_diff_state`         | Produce a structured JSON diff between two state values.                                                                                                                           |
| `llui_assert`             | Evaluate an eq/neq/exists/gt/lt/in predicate against a state path.                                                                                                                 |
| `llui_search_history`     | Filter message history by type, state-path change, effect type, or index range.                                                                                                    |
| `llui_eval`               | Run arbitrary JS in the page context; returns the result plus an observability envelope.                                                                                           |

## Agent Visibility Surface

`@llui/agent` ships a set of Level 1 slices that surface what the agent is doing inside your app. The conversation itself happens in the user's external LLM client (Claude Desktop / IDE / wherever the MCP bridge is mounted) — the framework doesn't try to be a chat surface. What it gives you is _visibility_: a connection panel, an activity log, attention flashes on changed DOM, and a one-way `narrate` channel for the LLM to surface its thinking inline with its actions.

Four slices compose into one panel:

| Slice            | Owns                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `agentConnect`   | Connection lifecycle (mint / pending-claude / active / reconnecting / failed)    |
| `agentConfirm`   | Confirm dialog state for `requiresConfirm` Msg dispatches                        |
| `agentLog`       | Ring-buffered activity timeline (every rpc, with intent + payload detail + diff) |
| `agentAttention` | Current dispatch's spotlight: which DOM regions to flash when state changes      |

Each is an `init` / `update` / `Msg` / `connect()` triple. The host slots them into its app state via `sliceHandler`, routes inbound `Append { entry }` Msgs from the WS log-append channel to BOTH `agentLog` and `agentAttention` (the framework fans out automatically through the factory), and spreads the prop bags into its own layout.

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
// agent-panel.ts — bare bones
import { div, text, each } from '@llui/dom'
import { summarizeDiff } from '@llui/agent/client'

function panel() {
  return div([
    // Activity feed — the prop bag exposes visibleEntries as a reactive accessor
    ...each<State, LogEntry>({
      items: (s) => s.agent.log.entries.slice(-20).reverse(),
      key: (e) => e.id,
      render: ({ item }) => [
        div([
          text(item((e) => e.kind)), // chip
          text(item((e) => e.intent ?? e.variant ?? '—')), // headline
          text(item((e) => e.detail ?? '')), // payload k=v
          text(item((e) => summarizeDiff(e.stateDiff))), // "3 changes in cart"
        ]),
      ],
    }),
  ])
}
```

### Visual attention layer

`agentAttention.connect().flashClass(path)` returns the class name `'agent-flash'` when the path is in the most recent dispatch's affected set. Spread it onto regions you want highlightable:

```ts
const att = agentAttention.connect<State>(
  (s) => s.agent.attention,
  (m) => send({ type: 'agent', sub: 'attention', msg: m }),
)

// In your view layout:
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
