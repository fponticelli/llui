---
title: Composition Patterns
description: 'How to factor reactive UI into reusable view functions and library components using signal handles.'
---

# Composition Patterns

How to factor reactive UI into reusable functions that compose cleanly with the signal
reactivity model. This is the answer to the question that comes up the moment you try to
split a view into reusable pieces: **how does the helper know what state to read?**

The answer is uniform: a reusable view function takes a **signal handle** for the slice it
renders. It never takes a `(s) => …` callback, and it never reads the whole component
state. Reactivity flows through signals, and the runtime gates each binding by exactly the
paths its signal reads.

## TL;DR — pick the pattern by shape

| Helper shape                                  | Pattern                           | Composition surface                                                                       |
| --------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| Renders a slice of state                      | **1 — sliced signal**             | Helper takes `Signal<Slice>`; caller passes `state.at('slice')`                           |
| Renders a list of rows                        | **2 — `each` over a sliced list** | Helper takes `Signal<Row[]>`; per-row `item` signal feeds the cell bindings               |
| Renders a single derived value                | **3 — derived signal**            | Helper takes `Signal<T>`; caller passes `state.map(fn)` or a `.at()` slice                |
| Layout chrome (header, sidebar, dialog frame) | **4 — child slots**               | Helper takes `children: ChildNode[]`; caller fills slots with its own bindings            |
| Library component with its own state machine  | **5 — `connect()` + delegation**  | Component exports `init`/`update`/`connect`; parent owns the slice, routes messages       |
| Widget whose state nobody else reads          | **`island()` (T2)**               | Own update loop + mask scope; props in via `props`/`onProps`, messages out via `onHandle` |

---

## Pattern 1 — sliced signal (primary)

**When**: a reusable view function renders a sub-tree of state.

**Composition**: the helper takes a `Signal<Slice>`. The caller slices at the call site
with `.at('field')`. The helper reads via the signal's own `.at`/`.map` — no `(s) => …`
callbacks cross the boundary, and the helper's type is decoupled from the parent's full
state shape.

```ts
import { div, text, span } from '@llui/dom'
import type { Signal, Send, Renderable } from '@llui/dom'

type UserSlice = { name: string; email: string; active: boolean }

// The helper only knows about its slice — not the host state type.
// `Renderable` is `readonly Mountable[]` — what every view helper returns.
function userCard(user: Signal<UserSlice>, send: Send<Msg>): Renderable {
  return [
    div({ class: user.at('active').map((a) => (a ? 'card active' : 'card')) }, [
      span([text(user.at('name'))]),
      span([text(user.at('email'))]),
    ]),
  ]
}

// CALLER — slice the parent state to the shape the helper wants:
view: ({ state, send }) => [userCard(state.at('currentUser'), send)]
```

What you get:

- The helper's type signature is tight (`Signal<UserSlice>`), decoupled from the host.
- Each binding inside reads a precise path (`currentUser.active`, `currentUser.name`, …),
  so the runtime gates it on exactly those paths.
- Adding the helper to a new host is just passing the right slice.

---

## Pattern 2 — `each` over a sliced list

**When**: a generic helper renders a list of rows whose per-row fields change in place.

**Composition**: the helper takes a `Signal<Row[]>`. `each` gives the row render a per-row
`item: Signal<Row>` (and an `index: Signal<number>`). Cell bindings read `item.at('field')`
so they update surgically when that row's data changes.

```ts
import { each, tr, td, text, show, span } from '@llui/dom'
import type { Signal, Renderable } from '@llui/dom'

interface Row {
  id: string
  title: string
  banned: boolean
}

function table(rows: Signal<Row[]>): Renderable {
  return [
    each(rows, {
      key: (r) => r.id, // ← plain id; do NOT include mutable fields
      render: (item) => [
        tr([
          // Reactive cell — re-reads when this row's `title` changes:
          td([text(item.at('title'))]),
          td([show(item.at('banned'), () => [span({ class: 'badge' }, [text('banned')])])]),
        ]),
      ],
    }),
  ]
}
```

Key points:

- **`item.at('title')` is a reactive per-row slot.** The runtime mutates kept rows in place
  rather than recreating them.
- **`key` is `(r) => r.id` only.** Including mutable fields (`` `${r.id}:${r.editedAt}` ``)
  forces a remove+insert of the whole row on every change — focus, scroll position, and
  transitions all reset.
- **Read the row id in handlers with `.peek()`**:
  `onClick: () => send({ type: 'select', id: item.at('id').peek() })`.

If a cell needs to combine the row signal with a parent signal (e.g. "is this the active
row?"), use `derived`:

```ts
import { derived } from '@llui/dom'

render: (item) => [
  tr({ class: derived([item, activeId], (r, active) => (active === r.id ? 'active' : '')) }, [
    /* … */
  ]),
]
```

---

## Pattern 3 — derived signal (single reactive value)

**When**: a generic helper renders one reactive value (button label, status badge, error
text). No iteration.

**Composition**: the helper takes a `Signal<T>` and plugs it directly into a primitive.
The caller does the derivation at the call site with `.map` or a `.at()` slice.

```ts
import { span, text } from '@llui/dom'
import type { Signal, Mountable } from '@llui/dom'

// Helper takes the already-derived signal — no callback, no host state type.
// A single element helper returns a `Mountable` (materialized when placed).
function statusBadge(className: Signal<string>): Mountable {
  return span({ class: className })
}

// CALLER derives against literal state reads:
statusBadge(
  state
    .at('session')
    .at('active')
    .map((a) => (a ? 'active' : 'inactive')),
)
```

The caller's `.map` reads `session.active` literally, so the binding's mask is precise. If
the value depends on multiple reads, combine them with `derived([sigA, sigB], fn)` at the
call site.

---

## Pattern 4 — child slots (layout chrome)

**When**: a generic helper provides outer-layout structure (header, sidebar, dialog frame,
panel) with content rendered by the page.

**Composition**: the helper takes `ChildNode[]` slot(s) (`ChildNode = Mountable | string |
number`). The caller fills them with whatever bindings the page needs, tied to its own state.

```ts
import { header, nav } from '@llui/dom'
import type { ChildNode, Mountable } from '@llui/dom'

function headerView(opts: { navItems: readonly ChildNode[]; userBadge: ChildNode }): Mountable {
  return header([nav(opts.navItems), opts.userBadge])
}

// CALLER fills slots with bindings tied to its concrete state shape:
headerView({
  navItems: [
    a(
      {
        href: '/dashboard',
        class: state.at('route').map((r) => (r === '/dashboard' ? 'active' : '')),
      },
      [text('Dashboard')],
    ),
  ],
  userBadge: span({ class: state.at('user').map((u) => (u ? 'auth' : 'anon')) }, [
    text(state.at('user').map((u) => u?.name ?? 'Sign in')),
  ]),
})
```

The header is no longer a state-generic component — it's a chrome layout that accepts
content. Each page's call site fills the slots with bindings for its own state shape.

If the chrome itself has local UI state (`isOpen`, `expanded`), decide by who else needs to
read it: if a sibling, the URL, or an undo stack does, model it as a slice the host owns and
pass the sliced signal in (Pattern 1); if nobody does, mount it as an `island()` (T2 below).

> **Structural primitives are lazy descriptions — capture and reuse freely.** `each`/`show`/
> `branch`/`unsafeHtml`/`lazy`/`virtualEach`/`foreign`/`portal` return a `Mountable`: a recipe
> that builds its live nodes (and registers its reactive bindings) at the point it is _placed_,
> always under the build then in scope. So a `Mountable` stored in a variable and dropped into
> a slot inside a `show`/`branch` arm rebuilds **fresh on every remount** — no drained nodes, no
> disposed-scope reuse. Placing the same `Mountable` in two slots yields two independent live
> instances. This just works:
>
> ```ts
> // built once, captured, reused across every hide/show — renders correctly each time:
> const slot = [each(rows, { key, render })]
> show(open, () => [div({ class: 'contents' }, slot)])
> ```

---

## Pattern 5 — `connect()` + delegated update (library components)

**When**: embedding a reusable component (dialog, combobox, date-picker) that ships its own
`State`, `Msg`, and `update`.

**Composition**: this is the convention used across `@llui/components`. The component
exports pure `init` / `update` functions plus `connect(state: Signal<Slice>, send, opts?)`
which returns reactive props to spread onto elements. The parent owns the slice in its
state, delegates to the component's `update`, and routes the component's messages through
its own `Msg` union.

```ts
import * as toggle from '@llui/components/toggle'
import { button, mapSend, text } from '@llui/dom'

type State = { bold: toggle.ToggleState; /* … */ }
type Msg = { type: 'bold'; msg: toggle.ToggleMsg } | /* … */

// Parent update delegates to the component's pure update:
update: (state, msg) => {
  switch (msg.type) {
    case 'bold':
      return [{ ...state, bold: toggle.update(state.bold, msg.msg)[0] }, []]
    // …
  }
}

// View — connect() returns spreadable, signal-based props:
view: ({ state, send }) => {
  const toggleState = state.at('bold')
  const toggleSend = mapSend<Msg, toggle.ToggleMsg>(send, (msg) => ({
    type: 'bold',
    msg,
  }))
  const parts = toggle.connect(toggleState, toggleSend)
  return [button({ ...parts.root, class: 'btn' }, [text('Bold')])]
}
```

`mapSend<Outer, Inner>(send, wrap)` adapts the parent's `Send<Outer>` into the
`Send<Inner>` expected by the child. The parent stays type-safe: each component gets a
tagged message variant (`{ type: 'bold'; msg: toggle.ToggleMsg }`) so the parent's `Msg`
union is exhaustive and routing is explicit. Even when two child message unions use the
same discriminants (for example, both contain `{ type: 'reset' }`), their distinct parent
variants route them without a cast or ambiguity. A reviewer sees every state transition in
one flat switch; an LLM generates it mechanically from the types.

Components that render an overlay (dialog, popover, tooltip) also export an `overlay()`
view helper that builds the portal tree and wires accessibility utilities — see the
[Composition recipe in the cookbook](cookbook.md#library-components-connect--delegated-update).

---

## What to avoid

**Passing a `(s) => T` callback across a helper boundary.** The signal runtime has no
notion of an accessor callback — reactivity flows through signals. A helper that wants a
reactive value takes a `Signal<T>`; the caller derives it at the call site.

**Reading the whole `state` signal in a helper.** Pass a sliced signal
(`state.at('slice')`), not the root `state`. A helper that maps over the entire state
object depends on every field and re-runs on every change.

**`.peek()` in a slot.** `text(signal.peek())` reads once at build time and never updates.
`.peek()` belongs in event handlers, effects, and `onMount` — never as a slot value.

**Operating on a signal as if it were a value.** `signal + 1`, `` `${signal}` ``,
`signal ? a : b` operate on the handle, not its contents. Derive: `signal.map((n) => n + 1)`.

**Side effects or DOM construction inside a `.map` body.** A derive body must be pure over
plain values — no `send`/`fetch`/timers, no `.at`/`.map`/`.peek` on a signal, no element or
text helpers. Use a structural primitive (`show`/`branch`/`each`) to build conditional DOM.

**Returning a fresh object/array from `.map`/`derived` every call.** The reconciler decides
whether to commit a binding by reference equality (`Object.is`) against the value it last
produced. A derive that allocates a new value each run — `state.map((s) => ({ ...s.user }))`,
`state.map((s) => s.items.filter(...))`, `state.map((s) => [...s.rows])` — is **never equal to
its previous output**, so it re-commits on every state change even when nothing it reads
changed. This is silent (correct, just wasteful). Prefer narrowing with `.at()` so the binding
depends only on what it uses, keep derives returning primitives or stable references, and let
`each` (keyed by id) own list identity rather than mapping to a fresh array in a slot.

---

## Where a widget's state lives — the three tiers

Every widget's state sits on one of three rungs, and picking the wrong one is the most
common structural mistake in an LLui app. The cliff to avoid is landing T1 and T2 widgets
on T3, which is how a page ends up with thirteen state slices for thirteen copy buttons —
and then with an imperative `textContent` workaround written behind the reconciler's back.

| Tier                                                         | Example                           | Mechanism                            |
| ------------------------------------------------------------ | --------------------------------- | ------------------------------------ |
| **T1 static** — no state after build                         | meter, sparkline, chip, badge     | `connect(constant(v), noSend, opts)` |
| **T2 local** — private and transient                         | copy button, disclosure, tooltip  | `island({ def })`                    |
| **T3 hoisted** — app-level: URL, undo, persistence, siblings | dialog, tabs, form, router-driven | `connect(state.at('x'), send)`       |

**Move UP a rung the moment the state stops being private.** If it has to survive a route
change, appear in a URL, be undoable, be persisted, or be read by a sibling, it belongs in
the host's State (T3). An island's state is unreachable from the host except through
`onHandle`, which is a feature until it isn't.

### T2 — `island()`

`island({ def })` (from `@llui/dom`) mounts a component instance with its own update loop,
mask scope and DOM region. It is **not** registered as a child scope, so the host's
reconciler never walks it — host state changes don't invalidate it and vice versa. It is
disposed with the host, and `lazy()` loads one asynchronously over the same machinery.

```ts
island({ def: CopyButton })
```

Props go **in** declaratively, and each change becomes a message rather than a poke at the
island's state — so the island's reducer stays the single writer and devtools shows where
the value came from:

```ts
island({
  def: Clipboard,
  props: state.at('token'),
  onProps: (value) => ({ type: 'setValue', value }),
})
```

`props` is a real binding in the host's scope, so it is mask-gated like any other reactive
read: a host update that doesn't touch `token` sends nothing. Messages come **out** through
`onHandle`'s handle. `reason` is optional — a note for the reader, never consulted at
runtime.

#### An island is not a valid bare `each` row root

Wrap it in an element — `li([island({ def })])` — the same rule `show`/`branch`/`each`
already carry. It bites asymmetrically, and the server half bites first, so a page that
looks fine locally is a 500 in production:

```ts
render: () => [island({ def: Leaf })] // ✗ island as the row's only node
render: () => [li([island({ def: Leaf })])] // ✓ the row has a stable node to key
```

On the **server** the island's body is a multi-node fragment, so `each`'s stable-row-root
guard throws. On the **client** it is a bare anchor comment, which that guard cannot see —
the row renders, and then corrupts on the first reorder: the anchors migrate and the
mounted bodies stay where they were. `show`/`branch` **arms** are unaffected in both
directions; only `each` rows.

#### On the server

Islands render on the server too — a build plus one mount against the seed state — so they
are not a post-hydration pop-in and are not blank without JS.

One limit, and it has a workaround: the server body reflects `init()`/`initialState`, **not**
the first `props` value. A `props`-driven island therefore paints its default in the server
HTML, and hydration replaces it with the prop value. A prop is a binding in the _host's_
scope and is only resolvable once that scope reconciles, which is after the island's body
has already been built — and inside an `each` row the row ctx it would need does not exist
yet, so resolving it early would be wrong exactly where lists are.

**So for a value the server already knows — a locale, a route param, a token — prefer
`initialState`, which the server does bake into the HTML, over `props` for the first
paint.** Use `props` for what changes afterwards; the two compose (`initialState` seeds,
`onProps` keeps it current).

### What an island costs — measured, not feared

At N=500 leaves in jsdom (absolute numbers inflated by the environment; the ratio is the
signal):

|               | mount   | 50 host updates |
| ------------- | ------- | --------------- |
| inline widget | 22.0 ms | 2.19 ms         |
| island        | 53.3 ms | **1.14 ms**     |

Islands cost **~2.4x at mount** and are **~2x cheaper on update**, because an island is not
a child scope so the host reconciler never walks it. That is mount cost traded for update
isolation: a good trade for many leaves under a host whose state churns, the wrong one for
a handful of leaves under a host that never updates. It is not a reason to avoid the tier —
it is the number to decide with.

The other cost is not measured in milliseconds: an island is a region the unified
reactivity model cannot see across. Its state does not appear in the host's state snapshot,
so devtools time-travel, `@llui/test` replay and the agent protocol see it as a separate
component. That is the right shape for state nobody else owns, and the wrong shape for
anything on the T3 list above.

### The deprecated `subApp()`

`subApp()` at `@llui/dom/escape-hatch` is the same primitive under its old name, kept as a
deprecated alias. It required a `reason` and was framed as an escape hatch for third-party
60fps layers — correct friction there, wrong for the thirteenth copy button. New code
writes `island()`; `subApp()` returns a `Renderable` array, so drop the spread when you
migrate.
