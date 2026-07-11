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

| Helper shape                                  | Pattern                           | Composition surface                                                                 |
| --------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| Renders a slice of state                      | **1 — sliced signal**             | Helper takes `Signal<Slice>`; caller passes `state.at('slice')`                     |
| Renders a list of rows                        | **2 — `each` over a sliced list** | Helper takes `Signal<Row[]>`; per-row `item` signal feeds the cell bindings         |
| Renders a single derived value                | **3 — derived signal**            | Helper takes `Signal<T>`; caller passes `state.map(fn)` or a `.at()` slice          |
| Layout chrome (header, sidebar, dialog frame) | **4 — child slots**               | Helper takes `children: ChildNode[]`; caller fills slots with its own bindings      |
| Library component with its own state machine  | **5 — `connect()` + delegation**  | Component exports `init`/`update`/`connect`; parent owns the slice, routes messages |

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
        tr({}, [
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
  return header({}, [nav({}, opts.navItems), opts.userBadge])
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

If the chrome itself has local UI state (`isOpen`, `expanded`), model it as a slice the
host owns and pass the sliced signal in (Pattern 1), or — for genuine isolation — use a
full `child()` boundary.

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
import { toggle } from '@llui/components/toggle'
import { button, text } from '@llui/dom'

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
  const parts = toggle.connect(state.at('bold'), (m) => send({ type: 'bold', msg: m }))
  return [button({ ...parts.root, class: 'btn' }, [text('Bold')])]
}
```

The parent stays type-safe: each component gets a branded message variant
(`{ type: 'bold'; msg: toggle.ToggleMsg }`) so the parent's `Msg` union is exhaustive and
routing is explicit. A reviewer sees every state transition in one flat switch; an LLM
generates it mechanically from the types.

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

## When to reach for `child()`

For genuine isolation — embedding an independent app whose lifetime is distinct from the
host's, a library bundle shipping its own complete TEA loop, or an independent effect
lifecycle — use a full `child()` boundary (its own scope tree and update loop; `lazy()`
loads one asynchronously over the same machinery).

Use it sparingly. A child boundary is a region the unified reactivity model can't see
across. The chunked-mask reactivity scales precisely with the number of paths read, not
with state depth, so a large flat state shared through sliced signals is fine — reach for
view functions first.
