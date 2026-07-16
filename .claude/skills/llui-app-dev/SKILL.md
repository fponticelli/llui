---
name: llui-app-dev
description: >-
  Use whenever a question involves app code built with LLui — anything importing
  @llui/dom, @llui/components, @llui/effects, @llui/router, @llui/vike, @llui/markdown,
  @llui/markdown-editor, @llui/a2ui, @llui/agent. Load it before answering, not after.
  Every shape of LLui question qualifies: write a feature, review a PR or diff, answer
  an API question, or debug a plain-English symptom — UI stuck at its initial value,
  stale reads, effects that never fire, lists that duplicate/throw/lag on reorder, SSR
  or hydration flashes, "what should State hold?", "is this idiomatic?". The framework
  name need not appear; an @llui/* import is enough. Why: LLui has no virtual DOM and
  view() runs exactly once, building bindings instead of re-rendering, so
  React/Vue/Solid/Elm reasoning yields fluent, confident, wrong diagnoses here — this
  skill carries the real rules and the failure-mode checklist. Not for other frameworks,
  nor for publishing/versioning the @llui packages themselves.
---

# Working on LLui app code

You are reviewing or writing code for an application built on **LLui** — a
compile-time-optimized web framework on The Elm Architecture (TEA) with **no virtual
DOM**. Most bugs in LLui apps come from carrying React/Solid intuitions into a
runtime that works differently. This skill gives you the correct model, a review
checklist for the non-obvious failure modes, and pointers to per-area references.

**Read this whole file first.** Then, for anything beyond core authoring, open the
matching reference in `references/` (see the router at the bottom). Ground every API
you use in these docs or in the app's own code — do not invent signatures.

---

## The one idea everything follows from: `view()` runs once

`view()` is called **once, at mount**. It builds real DOM nodes wired with reactive
bindings, then never runs again. State changes don't re-run `view` — they drive a
**chunked-mask reconciler**: each binding records the state paths it reads; on update,
the runtime diffs old→new state by reference-equality per path, and re-commits only
the bindings whose paths actually changed.

If you remember one thing: **you are building a static graph of reactive bindings, not
re-rendering.** Almost every LLui footgun is a corollary of "build-once." A value read
outside a reactive binding is captured once and frozen forever.

### The TEA shape

```ts
component<State, Msg, Effect>({
  name,
  init: () => State | [State, Effect[]],          // no arguments; State must be JSON-serializable
  update: (state, msg) => [State, Effect[]] | State,   // pure; return NEW state, never mutate
  view: ({ state, send, batch }) => Renderable,    // runs once; state is a Signal
  onEffect?: (effect, api) => void | (() => void), // where side effects actually happen
})
```

- `State` **must be JSON-serializable** — no `Map`/`Set`/`Date`/class instances/functions. This isn't cosmetic: devtools time-travel, `@llui/test` replay, agent state snapshots, and Vike SSR all serialize state, and non-JSON values break them silently.
- `Msg` and `Effect` are discriminated unions with a `type` field.
- `update` is pure and returns a **new** state object (`{ ...state, field }`). The reconciler detects change by reference-equality per path — mutating the existing state in place means the change is invisible (or, if you mutate then return it, everything looks dirty).
- **Effects are data.** `update` returns effects; the runtime hands each to `onEffect`. With no `onEffect` handler, an emitted effect is silently dropped (dev warns). See `references/effects-routing-ssr.md`.

### The view bag and the authoring surface

`view` receives exactly `{ state, send, batch }`. Everything else (elements, structural
primitives) is a **module import from `@llui/dom`**, not a bag member.

```ts
import { component, mountApp, div, button, text, show, each } from '@llui/dom'
```

Apps are written in the **direct view-array form** — `view` returns `[...mountables]`:

```ts
view: ({ state, send }) => [
  div({ class: 'counter' }, [
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
    text(state.at('count').map(String)),
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ]),
  show(
    state.at('count').map((c) => c > 0),
    () => [button({ onClick: () => send({ type: 'reset' }) }, [text('Reset')])],
  ),
]
```

The compiler lowers this to internal `signalText`/`signalEach`/`signalShow` helpers.
**App authors never write those `signal*` names** — they're compiler targets. If you
see hand-written `signalText`/`signalEach`/`signalShow` in app code, that's a smell
(it means someone reached under the compiler). Author with `text`/`each`/`show`.

### Signal handles — the whole surface

`state` is a `Signal<State>` with exactly **three** methods:

- **`state.at('field')`** — narrow to a sub-path signal (chainable: `state.at('user').at('name')`). Reads a **precise** path. Prefer this.
- **`state.map(fn)`** — derive a reactive value. Reads the **whole** state (its dep is the root).
- **`state.peek()`** — one-shot, non-reactive read. Only in event handlers, effects, and `onMount` — **never** in a reactive slot.

There is **no `.select`**. You cannot call `.at()` on a `.map()` result (compile error).
Combine multiple signals with `derived(a, b, fn)` / `derived([a, b], fn)` (a module
import, not a handle method). Reactive slots take a `Signal`, a `.map`, or a plain value.

To mount: `mountApp(container, def, opts?)` → a handle with `send`, `batch`,
`getState()`, `subscribe(fn)`, `flush()`, `dispose()`. `opts.scheduler: 'raf'` coalesces
DOM commits to one per frame (default `'sync'`, where `send` applies immediately).

For structural primitives (`each`, `show`, `branch`, `virtualEach`, `lazy`,
`unsafeHtml`, `portal`, `foreign`), context (`provide`/`useContext`/`createContext`),
and `onMount`/`batch`, see the **Core authoring reference** below — but the review
checklist is what catches the real bugs, so read it now.

---

## Review checklist — the LLui-specific failure modes

Scan any LLui diff or file against these. Each is a "build-once" corollary that
React/Solid intuition misses. For each, the **symptom** is what the user reports, the
**tell** is what to look for, the **fix** is the idiom.

### 1. `peek()` in a reactive slot → the value renders once and never updates

The most common LLui bug. `peek()` is a one-shot read; used where a reactive value
belongs (element children, an attribute binding, a `show`/`each` condition), the UI
freezes at the initial value.

- **Tell:** `text(state.peek().x)`, `div({ class: state.at('open').peek() ? … })`, `show(() => state.peek().visible, …)`, or reading `state.peek()` at the top of `view` and using the plain value in the tree.
- **Fix:** read reactively — `text(state.at('x'))`, `div({ class: state.at('open').map((o) => (o ? 'open' : '')) })`, `show(state.at('visible'), …)`. Reserve `peek()` for inside `onClick`/`onEffect` handlers where you need a one-shot current value (`send({ type: 'toggle', id: item.at('id').peek() })`).
- **Why:** the reactive slot wants a `Signal` so it can re-commit on change; a peeked plain value has no binding, so build-once freezes it. The compiler's `peek-in-slot` lint catches many cases, but not all (e.g. via a helper).

### 2. A discarded `onMount()` / helper return is inert

`onMount(cb)` (and every authoring helper) returns a `Mountable`. It does nothing
unless that `Mountable` is **placed in the view array**. Calling it for its side effect
and throwing the result away registers nothing.

- **Tell:** `onMount(() => …)` on its own line, its result unused; a helper called but not spread into the returned array.
- **Fix:** place it: `view: () => [ onMount(() => setupHotkeys()), div(...) ]`.

### 3. Ungatable list → O(n) re-evaluation of every row on every state change

In an `each`/`virtualEach`, if a row reads component state via `state.map(...)` or the
whole `state` (or contains a structural child that reads state), the list becomes
**ungatable**: every state change sweeps and re-evaluates every row, even unrelated
changes. On a big list this is the difference between O(1) and O(n) per update.

- **Tell:** inside a row `render`, a binding like `state.map((s) => s.theme)`; the list is slow / janky on unrelated updates.
- **Fix:** read the precise path with `state.at('theme')` so the row's dep is gatable — a state change that doesn't touch `theme` then skips the row sweep entirely.
- **Why:** `.at('x')` records the exact path; `.map` reads the root, so the gate can't prove the row is unaffected.

### 4. Capturing a keyed row's build-time `index` for identity → stale after reorder/filter

`each` rows are **reused** (moved, not rebuilt) when the list reorders or filters.
A row's `render` receives `index` as a `Signal<number>` precisely because the row's
position changes under it. Capturing the build-time index for identity gives every
reused row a stale position.

- **Tell:** `render: (item, index) => { const i = index.peek(); … use i for highlight/selection/aria … }` where `i` feeds an ongoing binding rather than a one-shot event.
- **Fix:** key state by **value**, not index. Read `index` reactively (`index.map(...)`) where you need live position; only `.peek()` it inside an event handler at the moment the event fires.

### 5. Non-JSON-serializable state → silent breakage in devtools/replay/SSR/agent

- **Tell:** `Map`/`Set`/`Date`/class instances/functions stored in `State`.
- **Fix:** keep state plain — store timestamps as numbers, sets as arrays or `Record<string, true>`, etc. Not enforced by the compiler yet, so it's a review responsibility.

### 6. Mutating state in `update` instead of returning a new object

- **Tell:** `state.items.push(x); return state`, `state.count++`, direct field assignment then `return state`.
- **Fix:** return a new object: `return { ...state, items: [...state.items, x] }`. The reconciler diffs by reference-equality per path; an in-place mutation is either invisible or makes the whole path look dirty.

### 7. Side effects or non-determinism in `init`/`view`

`init()` runs on both server and client under SSR; `view` runs once at mount. A
non-deterministic `init` (`Date.now()`, `Math.random()`, reading `localStorage`/
`window`) diverges between server and client and corrupts hydration. DOM access in
`view`'s synchronous body (rather than in `onMount`) runs before nodes are attached.

- **Tell:** `Date.now()`/`window`/`localStorage` in `init`; `document.querySelector` in the top level of `view`.
- **Fix:** keep `init` pure and deterministic; seed environment-dependent state via an init **effect** handled in `onEffect`; do DOM work in `onMount` (whose returned function is the cleanup).

### 8. Operators applied to a signal, or `.at()` on a `.map()`

`state.at('n') + 1`, `` `count: ${state.at('n')}` ``, or `state.at('n').map(...).at('x')`
are mistakes — a signal isn't its value.

- **Fix:** map: `state.at('n').map((n) => n + 1)`, `state.at('n').map((n) => \`count: ${n}\`)`. Narrow with `.at`**before**`.map`, or combine with `derived`. The compiler's `operator-on-signal` lint catches many of these.

### 9. `connect()` called with an accessor instead of a sliced signal

Headless `@llui/components` take the **sliced signal handle**, not a getter.

- **Tell:** `dialog.connect(() => state.dialog, …)` or `connect(state, …)` passing the whole root.
- **Fix:** `dialog.connect(state.at('dialog'), (m) => send({ type: 'dialog', msg: m }), { id })`. See `references/components.md`.

### 10. A keyed `each` row whose root is a fragment or a structural primitive

A keyed row must be **one or more stable elements**. A bare `show`/`branch`/`each` (or
a fragment) as the row's top node has no stable handle to move/remove, corrupting
reorder.

- **Fix:** wrap the row body in a stable element (`li({}, [ show(...) ])`).

### 11. Placing the same `Mountable` variable twice → two independent live instances

A `Mountable` captured in a variable and placed in two spots materializes twice. Usually
a mistake; if you need the same content in two places, use a function that returns a
fresh `Mountable` per call.

---

## Working a task

### Reviewing LLui code

1. Confirm which `@llui/*` packages the file touches and open the matching reference(s).
2. Walk the checklist above against the diff — items 1, 3, 4 are the highest-frequency real bugs.
3. Check the effect path: does every `update` effect have a handler? Is `onEffect` wired via `handleEffects`/`asOnEffect`? (see effects reference)
4. Check state shape: JSON-serializable? new-object updates? discriminated `Msg`/`Effect`?
5. For components, verify `connect(sliceSignal, send, opts)` and part-bag spreading; for lists, verify keying + gatability; for routing/SSR, check guards and hydration determinism.
6. Report each finding as: the symptom it would cause → the tell (file:line) → the idiomatic fix, with a one-line "why" tied to build-once. Don't flag non-LLui style nits.

### Writing LLui code

1. Model state as plain JSON; `Msg`/`Effect` as `type`-tagged unions.
2. Write `update` pure, returning new state; put I/O in effects handled by `onEffect`.
3. Author the view in direct-array form with `text`/`each`/`show`/`branch`; read reactively (`.at`/`.map`), `peek()` only in handlers.
4. Factor sub-views as plain functions taking signal handles (`header(state.at('header'), send)`) — they compose without compilation. Annotate their return as `Renderable` or `Mountable`.
5. Reach for `@llui/components` before hand-rolling interactive UI (dialogs, menus, selects, tabs, trees, forms); reach for `@llui/effects` builders before hand-rolling fetch/debounce/cancel.
6. Match the app's existing conventions (import style, file layout, how it wires `onEffect` and the router).

---

## Reference router — open the file that matches the task

| Working on…                                                                                                                                                                                                          | Open                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Core authoring depth: all structural primitives (`each`/`show`/`branch`/`virtualEach`/`lazy`/`portal`/`foreign`/`unsafeHtml`), `provide`/`useContext`, `onMount`, `batch`, the `raf` scheduler, sub-view composition | `references/core-authoring.md`      |
| Headless components: `connect`/`overlay`, part bags, dialogs/menus/selects/tabs/trees, forms + validation, i18n/theme, the value-based select/combobox model                                                         | `references/components.md`          |
| Effects, data fetching, routing, SSR: effect builders + `handleEffects`/`asOnEffect`, `ApiError`, `@llui/router` (routes/guards/links), `@llui/vike` (SSR + hydration + the JSON-state contract)                     | `references/effects-routing-ssr.md` |
| Markdown + rich-text editing: `@llui/markdown` renderers + streaming, `@llui/markdown-editor` config/plugins/handle, the Lexical `foreign` seam                                                                      | `references/rich-text.md`           |
| Server-driven UI + agent surfaces: `@llui/a2ui` (envelopes, catalogs), `@llui/agent` (LAP client/server, agent-driven apps)                                                                                          | `references/a2ui-agent.md`          |

When a reference and the app's own code disagree, trust the app's installed version —
check `node_modules/@llui/<pkg>/package.json` for the version and the app's usage for
the local convention.
