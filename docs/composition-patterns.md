# Composition Patterns for Generic Helpers

How to write generic UI helpers (`paramRow`, `tagSelector`, `dieNode`, …) that compose cleanly with the framework's reactivity model. This is the canonical answer to the question that comes up the moment you try to factor reactive UI into reusable functions: **how does the helper know what state to read?**

This file is the spec for the `llui/opaque-state-flow` lint rule's recommended migrations. When the diagnostic fires on `function-parameter callee`, the migration target is one of the patterns described here.

## TL;DR — pick the pattern by shape

| Helper shape                                                 | Pattern                      | Composition surface                                                                         |
| ------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------- |
| Iterating helper (renders a list of rows)                    | **4 — items-bag lift**       | Helper accepts `ItemAccessor<Row>`, caller builds row data in `items: (s) => …`             |
| Single reactive value (button label, status text, one badge) | **1 — accessor passthrough** | Helper accepts `(s: S) => T`, plugs directly into a primitive (`text(value)`, `class: cls`) |
| Form row / multi-field chrome                                | **2 — pre-built Nodes**      | Helper accepts `Node` slots; caller wires up bindings at the call site                      |
| Layout chrome (header, sidebar, dialog frame)                | **3 — Node[] slots**         | Helper accepts `children: Node[]` (and other slots); caller builds the slot content         |

The diagnostic fires on a fifth shape — **function-parameter callback** (`getX: (s: S) => X`) — which is the anti-pattern. See the bottom of this file for why.

---

## Pattern 4 — items-bag lift (primary)

**When**: A generic helper that derives any value from host state in a reactive position AND iterates over a collection.

**Composition**: The helper accepts row data via the items-bag. The caller does state reading in the `items:` accessor at the call site. The helper reads via `item.*` field accessors — no `(s) => …` callbacks cross the boundary.

```ts
// BEFORE — function-parameter callback (anti-pattern, fires `llui/opaque-state-flow`)
function tagRow<PS>(opts: {
  getProps: (s: PS) => { selected: string[]; editing: { highlightIdx: number } | null }
  tag: string
  index: () => number
}): Node {
  return span({
    class: (s: PS) => {
      const sel = opts.getProps(s).selected.includes(opts.tag) // ← opaque
      const e = opts.getProps(s).editing // ← opaque
      const highlighted = e?.field === 'tags' && e.highlightIdx === opts.index()
      return `${highlighted ? 'highlight' : ''} ${sel ? 'bg-blue' : 'hover:bg-card'}`
    },
  })
}

// AFTER — items-bag lift
type TagRow = {
  tag: string
  selected: boolean
  highlighted: boolean
}

function tagList(items: (s: HostState) => TagRow[]): Node[] {
  return each<TagRow>({
    items,
    key: (r) => r.tag,
    render: ({ item }) => [
      span({
        // class derives from item.* — precise per-binding mask, no opaque flow.
        class: () =>
          `${item.highlighted() ? 'highlight' : ''} ${item.selected() ? 'bg-blue' : 'hover:bg-card'}`,
      }),
    ],
  })
}

// CALLER
tagList((s) =>
  s.tags.map((tag, idx) => ({
    tag,
    selected: s.selectedTags.includes(tag),
    highlighted: s.editForm?.field === 'tags' && s.editForm?.highlightIdx === idx,
  })),
)
```

What you traded:

- The helper's API surface no longer accepts `getX: (s) => X` callbacks. It takes one input: how to compute rows.
- The caller does the state reading once per item-list rebuild, not per binding.
- The runtime gets precise per-binding masks (reads from `item.selected`, `item.highlighted` — distinct bits).
- The compiler can analyze the items accessor statically — `s.tags`, `s.selectedTags`, `s.editForm` enter `__prefixes` precisely.

What it costs:

- The caller's items accessor concentrates all the state reads. If you're hitting the 62-path mask budget, this is where the pressure lands first. Mitigate by splitting into multiple `each`s or by using `child()` for rich rows (see CLAUDE.md §"Bitmask").
- Migrating an existing callback-based helper is bespoke work. Each helper's row-data shape is different; each caller's items accessor synthesizes the row data its way. The transformation is mechanical per-site but not automatable — the framework can't infer which fields the helper's bindings will need.

### Reference case: paramControlsView

_Placeholder for the worked example from dicerun2's paramControlsView migration. Will land once the consumer's diffs are available._

```ts
// Before/after diffs of paramControlsView's signature and call sites here.
// The migration template the other helpers follow:
//   1. Identify every `opts.getX(s)` call in the helper's bindings.
//   2. Bundle the values those calls produce into a row data shape.
//   3. Change the helper API: replace callbacks with `items: (s) => Row[]`.
//   4. At each call site, write the items accessor that builds the row data
//      from concrete state reads.
```

---

## Pattern 1 — accessor passthrough (single reactive value)

**When**: A generic helper renders a single reactive value (button label, status badge, error text). No iteration.

**Composition**: The helper accepts a `(s: S) => T` accessor function. Plugs it directly into a primitive — `text(accessor)` or `{class: accessor}`. The helper writes NO arrow wrapping the accessor.

```ts
// BEFORE — wrapping arrow is the anti-pattern
function statusBadge<S>(opts: { isActive: (s: S) => boolean }): Node {
  return span({
    class: (s: S) => (opts.isActive(s) ? 'active' : 'inactive'), // ← opaque
  })
}

// AFTER — pass the accessor as a direct binding source
function statusBadge<S>(opts: { className: (s: S) => string }): Node {
  return span({ class: opts.className }) // direct passthrough; no arrow
}

// CALLER does the derivation, against literal state reads
statusBadge<HostState>({
  className: (s) => (s.session.isActive ? 'active' : 'inactive'),
})
```

What you traded:

- The helper exposes a less semantic API (`className: (s) => string` instead of `isActive: (s) => boolean`). The trade-off is that the helper itself emits no opaque flow.
- The caller's accessor reads `s.session.isActive` literally → precise mask.
- If multiple callers all derive the same boolean → string mapping, the deriver lives in a free function the callers reuse — still keeps the binding-position accessor simple.

When this isn't enough:

- If the derivation depends on multiple state reads (`s.foo` AND `s.bar` → string), the deriver still lives at the caller (the helper stays simple). Closure-capturing constants from the helper's args is fine — only `s` reads need to be literal.

---

## Pattern 2 — pre-built Nodes (form row chrome)

**When**: A generic helper provides structural chrome around multiple reactive fields (form rows: label, input, error message).

**Composition**: The helper accepts `Node` slots. The caller wires up bindings at the call site.

```ts
// BEFORE — function-parameter callbacks at every field
function fieldRow<S>(opts: {
  label: string
  value: (s: S) => string
  error: (s: S) => string | undefined
  onInput: (v: string) => void
}): Node {
  return div({}, [
    span({}, [text(opts.label)]),
    input({ value: opts.value, onInput: (e) => opts.onInput(e.target.value) }),
    span({ class: (s: S) => (opts.error(s) ? 'err' : 'hidden') }, [
      text((s: S) => opts.error(s) ?? ''), // ← opaque
    ]),
  ])
}

// AFTER — Node slots; caller wires bindings
function fieldRow(opts: { label: string; input: Node; error: Node }): Node {
  return div({}, [span({}, [text(opts.label)]), opts.input, opts.error])
}

// CALLER
fieldRow({
  label: 'Name',
  input: input({
    value: (s: HostState) => s.form.name,
    onInput: (e) => send({ type: 'setName', value: e.target.value }),
  }),
  error: span({ class: (s: HostState) => (s.form.errors.name ? 'err' : 'hidden') }, [
    text((s: HostState) => s.form.errors.name ?? ''),
  ]),
})
```

What you traded:

- "DRY violation" concern: the caller writes more verbose call sites. In practice, the row's structural template (label-input-error layout, label styling, error position) IS the reuse — that stays in `fieldRow`. The bindings naturally live where the state is.
- Each binding reads state literally → precise masks.

When this isn't enough:

- For deeply nested forms with consistent binding shapes, write a thin layer over `fieldRow` per state shape: `myFormFieldRow(s, fieldKey)` reads `s.form[fieldKey]` and emits the bindings. That layer is application-specific; the framework-generic `fieldRow` stays Node-typed.

---

## Pattern 3 — `Node[]` slots (layout chrome)

**When**: A generic helper provides outer-layout structure (header, sidebar, dialog frame, panel) with content rendered by the page.

**Composition**: The helper accepts `Node[]` slot(s). The caller fills them with whatever bindings the page needs.

```ts
// BEFORE — host-state-typed generic, threading callbacks through
function headerView<S>(opts: {
  pathname: (s: S) => string
  isAuthed: (s: S) => boolean
  userName: (s: S) => string | null
  onLogout: () => void
}): Node {
  return header({}, [
    nav({}, [
      // …complicated chrome with multiple opaque getProps calls…
    ]),
  ])
}

// AFTER — Node[] slots
function headerView(opts: { navItems: Node[]; userBadge: Node }): Node {
  return header({}, [nav({}, opts.navItems), opts.userBadge])
}

// CALLER fills slots with bindings tied to its concrete state shape
headerView({
  navItems: [
    a({ href: '/dashboard', class: (s: HostState) => (s.route === '/dashboard' ? 'active' : '') }, [
      text('Dashboard'),
    ]),
    // …
  ],
  userBadge: span({ class: (s: HostState) => (s.user ? 'auth' : 'anon') }, [
    text((s: HostState) => s.user?.name ?? 'Sign in'),
  ]),
})
```

What you traded:

- The header is no longer a state-generic component (`<S>`). It's a chrome layout that accepts content.
- Each page's call site fills the slots with bindings for its own state shape.
- The header has no opaque flow because it has no state callbacks.

When this isn't enough:

- If the chrome itself has its own state (`isOpen`, `expanded`, …), that's a separate `child()` component (Level 2 composition per CLAUDE.md). Don't conflate "chrome owns local UI state" with "chrome accepts host state callbacks." Local state goes in `child()`; host state flows through slots.

---

## Anti-pattern — function-parameter callbacks

**When**: Any helper that takes `getX: (s: S) => X` from its caller and uses the result inside a reactive accessor body.

**Why it's anti-pattern**: The closure passed at the call site is opaque to per-binding analysis. The compiler can't trace what `getX(s)` reads, so the binding falls back to FULL_MASK + sentinel — re-evaluating on every state change instead of only when its actual reads change. The runtime is correct, but the perf cliff is invisible to the author and persists indefinitely.

The `llui/opaque-state-flow` rule fires on this shape:

```
Reactive accessor flows state opaquely — call to an unresolvable callee
`getX(s)` (function parameter, import, or destructured binding).
The compiler ships a correct binding (FULL_MASK + whole-state sentinel),
but it re-evaluates on every state change. This callee is a function
parameter — the closure passed at the call site is opaque to per-binding
analysis. The framework expects per-row dynamic state to flow through
`each` items (slot data on `item.*`) rather than through `(s) => ...`
callback parameters; restructure the helper so its bindings read
`item.*` and the call site builds the slot data once in
`items: (s) => …`.
```

The diagnostic's recommended migration is **Pattern 4** when iterating, or one of **Patterns 1–3** otherwise. The mapping by shape lives at the top of this file.

### What about `track({deps})`?

`track({deps: (s) => [getX(s), …]})` does NOT silence the diagnostic in a way that helps here, even though `llui/opaque-state-flow` is suppressed inside `track.deps` (0.5.4+). If the deps body itself reads via opaque callees, the runtime extracts no useful paths from it — `track` collapses to the same FULL_MASK + sentinel behavior the diagnostic was warning about. `track` only helps when its deps body is statically extractable (literal property-access chains).

See `track.ts`'s docstring for the canonical use cases (plugin registries, useContext chains where the provider is two-plus files away).

---

## Bitmask budget under items-bag lift

Pattern 4 concentrates state reads in the items accessor at the call site. If a single `each`'s items reads from many top-level State paths, that's many bits on a single binding. The cap is 62 bits before FULL_MASK kicks in (with a compiler diagnostic naming the fields to extract).

Mitigations, in order of preference:

1. **Split into multiple `each`s.** If a "rich row" pulls from 30+ State paths, the row probably represents two structural concerns — split the items into two `each`s and let each accumulate fewer bits.
2. **Use `child()` at the row boundary.** Level 2 composition exists for exactly this: a `child()`'d row gets its own bitmask, takes typed props derived from the parent, and is opaque to the parent's mask.
3. **Restructure State.** If a set of fields are always co-read, group them under a single key. Each top-level key is one bit; nesting under it is free.

The 62-path budget is intentionally tight — it's what lets the runtime gate updates with two integer ANDs.

---

## When a helper genuinely can't pick a pattern

Sometimes a helper is too deeply generic for any of these patterns to apply cleanly — for example, plugin-registry dispatch where the row data shape isn't known until runtime. That's the case `track({deps: (s) => [s.pluginRegistry, s.activePluginName]})` exists for — explicit declaration of the host's read set, no per-binding precision possible.

Reach for `track` only when:

- Plugin registries dispatched by name.
- Helpers stored in arrays and dispatched by index.
- `useContext` chains where the provider lives two-plus files away.

A clean codebase has zero `track()` calls. If you find yourself reaching for it on a normal helper, the helper is probably the function-parameter anti-pattern in disguise — Patterns 1–4 fit it.
