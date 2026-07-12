# Signals: The View-Layer Reactive Surface

> **Status (2026-07): CORRECTION.** The signal runtime described here **shipped** in `@llui/dom`, but the 2026-06-02 note below names compiler artifacts that were **deleted** and overstates the cross-package layer. Ground truth (root `CLAUDE.md` "Active proposals"): cross-file/local-helper narrowing is live via `packages/compiler/src/cross-file-resolver.ts` (+ the signal transform's `signals/analyze-deps.ts` / `extract-deps.ts`), **not** a `cross-file-walker.ts` — that walker was deleted. There is **no runtime `track()` primitive** in `@llui/dom`; only a compiler annotation ever existed. The cross-_package_ `__llui_deps.json` ABI is **dormant**, not fully shipped: the producer emits manifests but consumer narrowing is **not** wired into the live transform (`transformSignalComponentSource`), which emits metadata inline. Read this as design rationale; the authoritative reference is the runtime source + root `CLAUDE.md`.

> **Status (2026-06-02): SHIPPED.** _(Superseded by the 2026-07 correction above — `cross-file-walker.ts`, the `track()` primitive, and the "shipped" `__llui_deps.json` layer are inaccurate.)_ The runtime described here is live in `@llui/dom` — `Signal` handles (`.at`/`.map`/`.peek`), `derived`, `each`/`show`/`branch`/`component`, and the chunked-mask reconciler. Cross-file/local-helper narrowing also shipped. The `track()` runtime _primitive_ was retired in favour of the compiler-recognized `track({ deps })` escape hatch. See `docs/publishing-a-precompiled-library.md` for the (dormant) precompiled-library ABI.

> Status: proposal, design-locked. Supersedes the arrow-accessor authoring model
> (`(s) => s.x.y`, `track()`, `sample()`, `h.getState()`, `item.current()`,
> `memo()`).

## Why

LLui's reactive surface today exposes six distinct ways to read state depending
on context (arrow accessors, `track()`, `sample()`, `h.getState()`,
`item.current()`, `memo()`). The compiler walkers that infer dependency tracking
from arbitrary arrow bodies have been the single largest source of correctness
bugs across the LLui fix-trail: variable shadowing, opaque-state-flow,
file-wide FULL_MASK collapse, lo/hi mask asymmetry, item-keyed binding loss.

The root cause is structural: **inferring dependencies from arbitrary
JavaScript whose state flows through unboundable channels** (named parameters
matched by string, helpers, cross-file closures). When the inference misses a
channel, it emits a dependency that is too _narrow_ — a missed dep — and the UI
goes stale. That is the malfunction class.

Signals replace this with a single, explicit, type-safe primitive. State reads
become member-access chains rooted at a known signal, and the dependency
analyzer operates only on **bodies whose state entry is structurally fenced to a
single parameter** — which makes the analysis sound by construction (see
[Dependency Analysis](#dependency-analysis)).

**TEA is preserved.** State remains plain data. `init`, `update`, `onEffect`
operate on plain `State`. Signals exist only at the view-layer boundary — they
are the reactive _view_ of state, not state itself.

## The Signal Type

```ts
interface Signal<T> {
  at<P extends ValidPath<T>>(path: P): Signal<PathValue<T, P>>
  map<U>(fn: (value: T) => U): Signal<U>
  peek(): T
}

declare function derived<T extends readonly unknown[], U>(
  sigs: { readonly [K in keyof T]: Signal<T[K]> },
  fn: (...values: T) => U,
): Signal<U>
```

Three methods on a signal; one combinator. That is the entire reactive
vocabulary. Everything else is plain TypeScript.

- `.at(path)` — slice into a sub-signal via a dot-separated path string.
- `.map(fn)` — transform a single signal into a derived signal.
- `.peek()` — snapshot the current value (handlers, effects, lifecycle only).
- `derived([...], fn)` — combine N independent signals into a derived signal.

### Path typing

`.at()` takes a dot-separated path string (Lodash-style), statically typed
against the state shape, with full nullability bubbling.

```ts
type GetKey<T, K extends string> = T extends readonly (infer U)[]
  ? K extends `${number}`
    ? U | undefined
    : K extends 'length'
      ? number
      : never
  : K extends keyof T
    ? T[K]
    : never

type PathValue<T, S extends string> = [Extract<T, null | undefined>] extends [never]
  ? S extends `${infer Head}.${infer Tail}`
    ? PathValue<GetKey<T, Head>, Tail>
    : GetKey<T, S>
  : PathValue<NonNullable<T>, S> | Extract<T, null | undefined>

type ValidPath<T> = T extends null | undefined
  ? ValidPath<NonNullable<T>>
  : T extends readonly (infer U)[]
    ? `${number}` | `${number}.${ValidPath<U>}` | 'length'
    : T extends object
      ? {
          [K in keyof T & string]: NonNullable<T[K]> extends object
            ? K | `${K}.${ValidPath<NonNullable<T[K]>>}`
            : K
        }[keyof T & string]
      : never
```

Properties:

- Dot-separated path strings; arbitrary depth (TS recursion-limited at ~50,
  well beyond realistic state shapes).
- **Nullability bubbles**: array index, optional fields, and nullable fields all
  carry `| undefined` (or `| null`) through to the result. `state.at('cart.items.0.price')`
  is `Signal<number | undefined>`, never `Signal<number>`.
- Arrays support `${number}` indexing and `'length'`.
- Intermediate paths return signals of intermediate types (chaining preserved):
  `state.at('user')` then `.at('profile.name')` is valid and equivalent to
  `state.at('user.profile.name')`.

### Why `.at()` and not `.foo` proxy sugar

`.at()` is standard JS (`Array.prototype.at`), recognized by every model, and
imposes no novel access syntax. The `$`-prefix / proxy-property sugar was
considered and **dropped** — the ergonomic win was too small to justify the
novel-syntax tax and the mapped-type complexity.

After [Dependency Analysis](#dependency-analysis), `.at()` is **no longer
load-bearing for performance** — `state.map(s => s.user.name)` narrows to the
same dependency as `state.at('user.name')`. `.at()` exists now purely for
type-narrowing and readability.

## Component Shape

```ts
component({
  init:    () => initialState,                                 // plain S
  update:  (state, msg) => [newState, effects],                // plain S, plain msg
  view:    ({ state, send }) => HNode[],                       // signals live here
  onEffect?: ({ effect, state, send }) => CleanupOrVoid,
  onMount?:  ({ state, send }) => CleanupOrVoid,
})
```

`init` and `update` never see signals — they operate on plain `State`.
Time-travel debugging, replay, test fixtures, and SSR all operate on `S`,
untouched by the signal layer. The framework wraps `S → Signal<S>` at the view
boundary only. **The migration from current LLui touches only the view layer.**

### The view bag

Two fields, room to grow (see follow-ups doc for the bag-vs-positional
decision — bag was chosen for forward-compatibility):

```ts
type ViewBag<S, M> = {
  state: Signal<S>
  send: Send<M>
}
```

Element helpers (`div`, `text`, `button`, …), structural primitives (`each`,
`branch`, `show`), `derived`, and `foreign` are all **free imports** from
`@llui/dom`. The bag carries only component-instance-bound values.

### onEffect / onMount

Both receive `{ effect?, state: Signal<S>, send }`. The signal stays available so
long-lived effects (timers, subscriptions, observers) can read current state on
each fire via `.peek()`.

## Structural Primitives

```ts
function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => HNode[]
  },
): HNode

function branch<T extends string, M extends Record<T, () => HNode[]>>(
  discriminant: Signal<T>,
  match: M,
): HNode

function show<T>(cond: Signal<T>, render: (narrowed: Signal<NonNullable<T>>) => HNode[]): HNode
```

- **`each.key`** receives plain `T` (not a signal); called once per item during
  reconciliation. The runtime maintains a key→signal map: existing keys reuse the
  same `Signal<T>` instance (value updated), new keys get fresh signals, gone
  keys are disposed.
- **`show` narrows**: `Signal<string | null>` becomes `Signal<string>` inside the
  render; the subtree mounts only when the value is truthy.
- The render callbacks receive **signals**, so nested scopes coexist with full
  precision: each row's `item`, the outer `state`, and any other slice are
  independently tracked.

## Imperative Sites: Handlers, Effects, Lifecycle

All read state the same way — `.peek()`:

```ts
button({ on: { click: () => send({ type: 'Submit', name: state.at('user.name').peek() }) } })

onEffect: ({ effect, state, send }) => {
  if (effect.type === 'StartPolling') {
    const id = setInterval(() => send({ type: 'Tick', userId: state.peek().user.id }), 1000)
    return { cleanup: () => clearInterval(id) }
  }
}

onMount: ({ state, send }) => {
  const obs = new ResizeObserver(() => send({ type: 'Resized', w: state.peek().canvas.width }))
  return { unmount: () => obs.disconnect() }
}
```

Three rules for everything imperative:

1. `state` is `Signal<State>`.
2. Read with `.peek()` (or `.at('x.y').peek()`).
3. Dispatch with `send(msg)`. Never mutate.

`h.getState()` collapses into `.peek()` with the same call-site clarity.

## Composition & Escape Boundaries

How signals behave across the framework's boundaries: in-language composition
(view functions, `combine`, `subApp`), the imperative escape (`foreign`), and the
DOM-relocation escape (`portal`). The guiding principle:

> Signals are compile-time fictions (erased to masks) everywhere **declarative**.
> They **materialize** into real runtime objects at exactly one place — the
> declarative→imperative boundary (`foreign`, and `subApp` only when a reactive
> slice must cross into it).

### Composition — view functions + `combine()` + `subApp` (no reactive sub-boundary)

Signals slot directly into the `unified-composition-model` already on `main`:
`child()` does **not** exist, and it shouldn't — it existed almost entirely to
relieve the 31-path bitmask ceiling (dicerun2 had 62 `child()` calls, nine with
comments citing the ceiling). **Path-keyed reactivity makes that ceiling
irrelevant, and signals + chunked masks _are_ that path-keyed reactivity.** So
there is **one root component / one mask scope**, and decomposition uses plain
functions and slices, not boundaries:

1. **Everyday decomposition = view functions taking `Signal<T>` slices via a bag.**
   The bag mirrors the root view bag (`{ state, send }`) so every view function is
   one shape; the primary slice is named `state`, extra slices are named fields.
   The boundary is a function call; the signal carries reactivity across it.

   ```ts
   // single-slice sub-view — reuses ViewBag<Slice, Msg>
   const formView = ({ state, send }: ViewBag<FormState, Msg>) =>          // state: Signal<FormState>
     [ text(state.at('name')), button({ on: { click: () => send({ type: 'form/save' }) } }, ['Save']) ]
   formView({ state: state.at('form'), send })

   // multi-slice sub-view — extend the bag
   const headerView = ({ state, theme, send }: HeaderBag) => [ ... ]       // state: Signal<HeaderState>, theme: Signal<Theme>
   headerView({ state: state.at('header'), theme: state.at('ui.theme'), send })

   // per-row, inside each
   const todoRow = ({ state, send }: ViewBag<Todo, Msg>) =>
     div([ text(state.at('title')),
           button({ on: { click: () => send({ type: 'todos/toggle', id: state.peek().id }) } }, ['×']) ])
   each(state.at('todos'), { key: (t) => t.id, render: (todo) => todoRow({ state: todo, send }) })
   ```

2. **`combine()` for reducer composition** — slice reducers keyed by `slice/action`
   namespace, operating on plain state. Signal-agnostic (it lives in the `update`
   half, which never sees signals). Unchanged by this proposal.

3. **`subApp` for genuine isolation only** (third-party UI, 60fps drag layer,
   deferred chunks with own lifecycle). Own state tree, own root, required `reason`,
   rare. Pure isolation by default (snapshot in, messages/effects out); if a
   reactive slice must cross in, it materializes to `LiveSignal` exactly as
   `foreign` does — one materialization mechanism, not two.

How this interacts with the analyzer and runtime:

- **The bag destructure is a known-rooted binding.** `({ state, theme }) => …`
  binds each field to the signal passed at the call site (`state.at('form')`,
  `state.at('ui.theme')`); the analyzer follows the sub-view as a local helper and
  substitutes those paths (the inter-procedural narrowing case — object-binding
  param). Soundness unaffected; each field is a known-rooted signal.
- **`.at()` subsumes the old `slice()` helper** — `slice(h, s => s.form)` is just
  `state.at('form')`. Delete `slice()`.
- **One mask scope simplifies the runtime.** There is no per-subtree scope, so the
  chunked-mask gate does **not** need to accept bits from a foreign scope — that
  complexity (which only existed under a `child()` model) is gone. The only per-row
  scoping is `each`'s internal key→signal map, not a user-facing boundary.
- **`Msg` translation** (`combine()` slice routing) is a pure message map, not a
  reactive accessor — outside dependency analysis entirely.

### Foreign / imperative subtrees — `foreign()`

The one boundary the analyzer cannot see through (the body is imperative, mutating
a third-party instance). The contract makes deps explicit via the `state:`
declaration and materializes signals into `LiveSignal` for imperative use.

```ts
foreign({
  state: {
    title: state.at('doc.title'), // narrowed
    wordCount: state.at('doc.content').map((c) => count(c)), // derived — analyzed, dep = doc.content
  },
  mount: ({ el, send, state }) => {
    // state.*: LiveSignal<…>
    const ed = new Editor(el)
    state.title.bind((t) => ed.setTitle(t)) // fires now + on change
    state.wordCount.bind((n) => ed.setBadge(n))
    ed.onChange((c) => send({ type: 'DocEdited', content: c })) // out via send only
    return ed
  },
  unmount: (ed) => ed.destroy(), // REQUIRED (compiler-enforced)
})
```

Design rules:

- **`state:` is the dependency declaration.** A signal or a record of signals,
  analyzed as a normal value position (deps from the `.at()`/`.map` chain). The
  analyzer never looks inside `mount`. Deps of the foreign = deps of `state:`.
- **All derivation stays in `state:`** (the analyzable layer). `LiveSignal` has no
  derivation surface — nothing reactive hides inside the imperative body.
- **State out only via `send`.** The instance never mutates state; keeps TEA intact
  and avoids a second source of truth.
- **`unmount` is mandatory**, compiler-enforced (kills the leak-on-unmount class).
  The runtime re-runs `mount` if the foreign node is re-parented (each/show
  re-mount).

#### `LiveSignal<T>` — the materialized signal

```ts
interface LiveSignal<T> {
  peek(): T // one-shot, non-reactive read (same verb as Signal)
  bind(cb: (value: T) => void): () => void // fires NOW with current value, then on every change
}
```

- **`.bind` includes the initial value** — `s.bind(cb)` fires synchronously with
  the current value, then on every change. One line seeds _and_ subscribes. There
  is deliberately **no `.on`** (event-listener vocabulary trains the
  peek-then-subscribe reflex) and **no change-only mode** (removes the ambiguity).
- **Mount-time `.bind` subscriptions auto-dispose** on unmount. The returned
  unsubscribe is only for dynamic re-subscription.
- **`.peek()`** is for genuine one-shot reads (e.g. a click handler inside `mount`),
  not for seeding a `.bind`.
- **No `.at`/`.map`/`derived`** — derive in the `state:` declaration.
- `LiveSignal` exists _only_ at the foreign boundary and is **DCE'd** when `foreign`
  is unused. Proliferation is a non-issue (a handful of foreigns per app, not
  thousands of bindings).
- **Lint**: in a `mount` body, the same `LiveSignal` both `.peek()`-ed and
  `.bind()`-ed → error ("`.bind` already provides the initial value; remove the
  redundant read"). `.peek()` alone, or `.bind()` alone, is fine.
- **Echo loop** (state holds the doc, editor holds the doc) is inherent to any
  bidirectional foreign and not something the API erases — document the guard
  idiom (skip `send` on programmatic sets, or compare against last-pushed value).

### Portal — `portal()`

`portal` relocates children to a different **physical** DOM position (modal at
`document.body`, tooltip layer) while they remain in the owning component's
**logical** scope and bitmask. It is **not a reactivity boundary** — no new signal
mechanism:

- Portaled children are ordinary nodes with **erased** signal bindings, gated by
  the **owning component's** masks. No `child()` scope, no `foreign`
  materialization.
- Obligations are purely lifecycle: on the owning scope's unmount, the relocated
  DOM (living elsewhere) must be explicitly removed, or it orphans (same leak shape
  as the Canvas bug).
- Caveat: native DOM events bubble through the **physical** tree (`document.body`),
  not the logical component tree. `send` routes correctly (the handler closure
  captured the right `send`); only native bubbling/delegation across the portal
  differs. Doc note, not a signals concern.

## Dependency Analysis

This is the heart of the compiler and the reason the design is sound. The
analyzer recovers **fine-grained, sound dependencies automatically** from
`.map`/`derived` bodies via aggressive intra-procedural dataflow.

### Why these bodies are analyzable when the old `(s) => …` bodies were not

The old accessor let state flow through unboundable channels and matched the
state parameter by name. The new bodies have three structural properties that
invert this:

1. **Single state entry point.** Inside a `.map`/`derived` body there is no free
   `state`, no `.peek()`, no `.at()`, no signal values (all banned — see
   [Rules](#rule-changes)). _Every_ state read is therefore a member-access chain
   rooted at a callback parameter whose source path is known from the call site.
2. **Symbol-based resolution.** The analyzer follows the specific parameter
   _binding_, not identifiers named `s`. Lexical shadowing is handled for free by
   the AST symbol table; the shadowing bug class cannot recur.
3. **No reactive nesting.** The body never recurses into another reactive graph;
   it is pure value-flow within one closed function.

### The soundness invariant

> Every occurrence of a tracked binding must either descend to a precise
> sub-path that is emitted, or emit a wholesale (parent) path. **No occurrence
> may be silently dropped.** Therefore `emitted-deps ⊇ actually-read-paths`
> always.

Corollary: a bug in the _narrowing_ logic produces a dependency that is too
_coarse_ (perf cost: over-firing) — **never one that is missing** (staleness).
Imprecision coarsens; it never misses. This is the structural replacement for
the manual walker audits that have been eating commits.

The invariant holds **only because** state has a single syntactic entry point
per body. The companion bans (no free `state`/`.peek()`/`.at()`/signals in
bodies) are therefore **correctness-critical**, not stylistic, and must be
enforced before or alongside the analyzer.

### The analysis (aggressive)

Taint sources: each callback parameter starts tainted with its source signal's
path. `.map` → first param tainted with the receiver path; `derived([a,b], fn)`
→ params tainted positionally with each input path.

Propagation — abstract-interpret the body, tracking each in-scope binding as
`Path(p)`, `Opaque` (non-state), or escaped. Resolution is by **symbol**.

| Construct on tainted expr `e` with path `p`                | Effect                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `e.k` (property read, not invoked)                         | new tainted value, path `p.k` — descend                      |
| `e[lit]` (static literal key)                              | path `p.lit` — descend                                       |
| `e[dyn]` (dynamic key)                                     | emit dep `p`; result `Opaque`                                |
| `e.k(...)` (method call)                                   | emit dep at the receiver path (path up to method name); stop |
| `e(...)` (tainted value called)                            | emit dep `p`; stop                                           |
| `f(e)` (passed as argument)                                | emit dep `p` (escapes); stop                                 |
| `const x = e`                                              | bind `x ↦ Path(p)` — track alias                             |
| `const {k, ...rest} = e`                                   | `k ↦ p.k`; if `rest` used, emit dep `p`                      |
| `cond ? a : b`, `if/else`, `switch`                        | union deps of all branches (superset)                        |
| leaf use (template, arithmetic, comparison, return)        | emit dep at current path                                     |
| reassignment of tracked binding (not precisely followable) | coarsen that binding's source path to wholesale              |
| anything unclassifiable                                    | emit dep at nearest known path (coarsen)                     |

Worked examples:

```ts
state.map(s => s.user.name)                        // dep: user.name (LLM default narrows optimally)
state.at('user').map(u => u.name)                  // dep: user.name
state.at('user').map(u => u.name.toUpperCase())    // dep: user.name (method receiver, not user)
state.at('user').map(u => `${u.first} ${u.last}`)  // deps: user.first, user.last
state.at('user').map(({first, last}) => …)         // deps: user.first, user.last (destructure)
state.at('price').map(p => p * 1.08)               // dep: price (scalar)
state.at('items').map(a => a.filter(x => x.done).length)  // dep: items (method call → wholesale)
state.at('user').map(u => formatUser(u))           // dep: user (escapes to fn → wholesale, LOCAL)
state.at('user').map(u => u.orders.map(o => o.total + u.taxRate))
//   deps: user.orders (method call), user.taxRate (outer binding inside nested closure)
state.at('user').map(u => { const p = u.profile; return p.city })  // dep: user.profile.city (alias)
```

Opaque cases (escapes, dynamic keys, untrackable reassignment) degrade to a
coarse-but-correct dependency **local to that binding** — never a file-wide
FULL_MASK.

### Guardrail: the superset property test

Generate random constrained bodies; instrument at runtime which state paths a
body actually reads for a given input; assert the analyzer's emitted set is a
superset over thousands of cases. This test is what keeps analyzer bugs in the
perf bucket and out of the malfunction bucket.

## Runtime: Bitmask, Not a Live Signal Graph

Signals are the _authoring surface_; the _runtime mechanism_ is deliberately the
existing chunked bitmask. Signals are **compile-time fictions, erased to masks** —
there are no runtime signal objects for the common path, no subscriber lists, no
2 MB-per-list proliferation.

### Why (decision recorded with evidence)

The authoring surface and runtime are fully decoupled — signals compile to
either. The runtime was chosen on memory/effort/correctness grounds:

- **TEA neutralizes the signal-graph advantage.** In Solid/Preact, signals win
  because mutation is granular and skips the diff. In TEA, `update` returns a
  whole new state, so _something must diff old vs new_ regardless. A signal graph
  just distributes that diff across per-node equality checks instead of one
  compiled `__dirty`. Same work, more objects.
- **Speed is a wash.** A microbenchmark (mask gating vs naive signal-graph
  propagation, TEA-style, 1000 rows × 8 fields × 8 bindings):

  | Workload                   | bitmask  | signal-graph |
  | -------------------------- | -------- | ------------ |
  | select-row (2/1000 change) | 1.12 µs  | 0.99 µs      |
  | update-10th (100/1000)     | 2.32 µs  | 2.40 µs      |
  | update-all (1000/1000)     | 12.73 µs | 15.30 µs     |

  Within noise. (Both prune at the same structural-sharing ref-eq boundaries, so
  both touch identical sets in TEA.)

- **Memory is decisive.** Same scenario: bitmask binding storage is a shared
  ~32-byte mask table; the signal-graph retains **~2.1 MB** (8k signal nodes +
  8k subscriber objects) for one 1000-row list, plus GC churn on every rebuild.
- **Effort/risk.** Bitmask is the existing, working, benchmarked runtime. A
  live-signal-graph runtime is a ground-up rewrite (Solid took years to optimize).
- **Correctness parity.** With the sound aggressive analyzer above, the dep
  inference is reliable; the residual "did the mechanical lowering to bits run
  correctly" risk is a small, central, testable piece — the same risk surface as
  a signal library.

### Lowering

The compiler collects the dependency paths (from `.at()` chains and the
analyzer), assigns each unique path a bit, and emits a `__dirty(old, new)` that
does **pure reference-equality per path** (`old.user.name !== new.user.name`),
relying on TEA's immutable updates + structural sharing. No deep comparison.

### Chunked masks remove the 31/62 cliff

Replace the two 31-bit `mask` + `maskHi` words with a chunked representation
(`Uint32Array` of N words), with a small-mask fast path for ≤62 paths. Per-binding
masks are stored sparsely (most bindings touch one chunk → `(chunkIndex, bits)`),
so per-binding memory stays ~constant regardless of total path count. The
lo/hi-asymmetry contract bug disappears — a single chunk-iteration helper replaces
all the scattered `maskHi: 0` defaults.

### Output equality check

A binding that the mask gate decides to run must compare its produced value to
the last-written value and **skip the DOM mutation if unchanged**. This makes any
residual coarse dependency cheap: a coarse binding wastes a (microsecond) body
re-evaluation but never a DOM write unless the value actually changed.

### The one escape case

A signal that escapes static traceability (stored in an array, conditionally
selected via dispatch the compiler can't follow) has no static bit. Handling:

- **(a)** The surface already bans most of these (static `.at()` paths only;
  dynamic keys go through `.map`). Lean on that first.
- **(b)** If real consumer code demands it: a narrow **runtime-signal fallback**
  for that binding only — the 2 MB case materializes for the handful of bindings
  that truly need it, never the whole app. Ship only if (a) proves insufficient.

## Rule Changes

| Rule                         | Status                          | Note                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no-let-reactive-accessor     | **Removed**                     | No closures over state.                                                                                                                                                                                                                                        |
| each-closure-violation       | **Removed**                     | Item is an explicit signal.                                                                                                                                                                                                                                    |
| no-eager-item-accessor       | **Removed**                     | Same.                                                                                                                                                                                                                                                          |
| no-repeated-item-current     | **Removed**                     | No `.current()` pattern.                                                                                                                                                                                                                                       |
| opaque-state-flow            | **Removed**                     | Inference failure now coarsens locally + correctly; nothing to warn about.                                                                                                                                                                                     |
| derived-with-common-parent   | **Not added**                   | `user.map(u => u.a+u.b)` and `derived([user.at('a'), user.at('b')], …)` now narrow identically; choice is pure style.                                                                                                                                          |
| no-sample-in-\* (×4)         | **Removed**                     | `sample()` is gone.                                                                                                                                                                                                                                            |
| accessor-side-effect         | **Replaced**                    | → pure-derive-body                                                                                                                                                                                                                                             |
| view-bag-import              | **Removed**                     | Helpers are free imports.                                                                                                                                                                                                                                      |
| direct-state-in-view         | **Replaced**                    | → operator-on-signal                                                                                                                                                                                                                                           |
| map-on-state-array           | **Replaced**                    | → operator-on-signal                                                                                                                                                                                                                                           |
| static-on / static-items     | **Folded**                      | Type system requires `Signal<T>` discriminant/items.                                                                                                                                                                                                           |
| each-memo                    | **Auto**                        | Compiler auto-memoizes signal-derived items.                                                                                                                                                                                                                   |
| bitmask-overflow             | **Adjusted**                    | Auto-tracked from analyzer; chunked masks remove the hard cliff.                                                                                                                                                                                               |
| operator-on-signal           | **Added**                       | Errors for arithmetic, comparison, template interpolation, ternary, logical, raw stringification on a `Signal<T>` (outside bodies). Fix-it → `.map()`.                                                                                                         |
| pure-derive-body             | **Added, correctness-critical** | Errors for side effects (`fetch`, DOM, `send`, `setTimeout`, `Math.random`, `Date.now`) **and** reactive-primitive use (`.peek`, `.at`, `.map`, signal refs, free `state`) inside `.map`/`derived` bodies. These bans are load-bearing for analyzer soundness. |
| no-node-construction-in-body | **Added**                       | Element-helper calls inside `.map`/`derived` bodies are an error. Fix-it → `each`/structural primitive. (Catches the React-trained `items.map(i => div(...))` reflex.)                                                                                         |
| whole-state-to-call          | **Added**                       | A value accessor that passes the whole state object to a function call → suggest passing a slice (keeps the dependency narrow). Targets the dominant coarse pattern; see validation.md.                                                                        |
| livesignal-redundant-read    | **Added**                       | In a `foreign` `mount`, the same `LiveSignal` both `.peek()`-ed and `.bind()`-ed → error (`.bind` already provides the initial value).                                                                                                                         |

Net: ~44 → ~33 rules, with the most bug-prone reactivity rules deleted and the
survivors mostly orthogonal to reactivity (update purity, msg shape, a11y,
imports).

## Migration Patterns

| Today                                                 | Signals                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `text((s) => s.user.name)`                            | `text(state.at('user.name'))`                                                    |
| `text(() => \`Hi ${s.x}\`)`                           | `text(state.at('x').map(v => \`Hi ${v}\`))`                                      |
| `text((s) => s.first + ' ' + s.last)`                 | `text(state.map(s => \`${s.first} ${s.last}\`))`                                 |
| `div({ class: (s) => s.busy ? 'spin' : '' })`         | `div({ class: state.at('busy').map(b => b ? 'spin' : '') })`                     |
| `each((s) => s.todos, item => …item.current().title)` | `each(state.at('todos'), { key: t => t.id, render: item => …item.at('title') })` |
| `h.getState()`                                        | `state.peek()`                                                                   |
| `track({ deps: (s) => [...] }, …)`                    | Delete; `.at()` + analyzer handle it.                                            |
| `sample(state.x)`                                     | Move to `init`/lifecycle, or a plain const if no state involved.                 |
| `memo(...)`                                           | `.map` on the parent, or `derived` with explicit inputs.                         |
| `item.current().X`                                    | `item.at('X')`                                                                   |
| `(props: Props<T,S>)` helper                          | `(slice: Signal<T>)` helper                                                      |

## Edge Cases

- **`Record<string, V>`**: `ValidPath` allows any string segment; result is
  `V | undefined`.
- **`Map<K,V>`**: not supported via `.at()`. Read via `state.map(s => s.someMap.get(k))`
  (whole-map dep).
- **Tuples**: `keyof [string, number]` → `'0' | '1' | 'length'`; out-of-bounds → `undefined`.
- **Unions**: shared fields accessible via `.at()`; variant-specific paths require
  `branch` to narrow first.
- **Arrays in deep paths**: `state.at('users.0.name')` works but is usually a smell;
  prefer `each()` for iteration and `.map(arr => arr.find(...))` for lookups.

## What Stays Unchanged

TEA shape (`init`/`update`/`view`/effects-as-data/`onEffect`); element helpers;
the scope tree; `send()` microtask batching; the unified composition model
(one root component; view functions + `combine()` slice reducers; `subApp` for
isolation); effects-package combinators; the bitmask runtime gating (now fed from
the analyzer + chunked). `foreign()` and `portal()` survive but are **reshaped** —
see [Composition & Escape Boundaries](#composition--escape-boundaries). `child()`
is **not** part of LLui (removed pre-signals) and is not reintroduced; `slice()`
is subsumed by `.at()`.

## Reconciliation with Existing Proposals

Verified against `main` (2026-05) and the other `docs/proposals/` entries.

- **`dirty-mask-precision/` — superseded in mechanism; goal adopted.** Same
  problem (per-binding dirty precision / over-firing). Signals adopts the _goal_
  but replaces every concrete mechanism: the two-word `mask`+`maskHi` layout, the
  runtime prefix-walk threshold, the `precise` flag, and popcount tuning all give
  way to **chunked masks + ref-equality lowering + output-equality check**.
  `03-implicit-each-children.md` (rows as implicit Level-2 children) is **fully
  superseded** — signals gives each row its own `Signal<T>` with full per-row
  precision and no child-lifting. **Honor one residual**: dirty-mask-precision's
  finding that the wide-state immutable-spread cost is _intrinsic to immutable
  updates and not framework-reducible_ still stands; signals' coarse-but-correct
  fallback + output-equality do not erase it.

- **`unified-composition-model.md` — CONVERGENT / aligned (resolved).** That
  proposal removed `child()` and introduced `combine()`/`subApp`; `main` confirms
  it. Signals are the **path-keyed reactivity that proposal assumed** — its whole
  thesis ("path-keyed reactivity makes the bitmask budget irrelevant, so `child()`
  disappears") is delivered by signals + chunked masks; the two are halves of one
  design. Signals adopts its model wholesale: one root component, decompose via view
  functions taking `Signal<T>` slice-bags + `combine()` slice reducers, `subApp` as
  the only isolation valve. `.at()` subsumes the proposal's `slice()` helper. The
  reactivity mechanisms share terminology (ref-eq-per-path masks over structural
  sharing) and should share the implementation. **No open contradiction.**

- **`v2-compiler/` — complementary; cross-file substrate ALREADY SHIPS.** Contrary
  to the earlier "rides on v2b (if it ships)" hedge: cross-file resolution
  (`packages/compiler/src/cross-file-resolver.ts` — the earlier `cross-file-walker.ts`
  named here was **deleted**), the signal transform's own dep analysis
  (`signals/analyze-deps.ts` / `extract-deps.ts`), and the function-summary schema
  (`manifest.ts`: `viaParams` = paramReadPaths, `readsThroughResultOf` = returnTaint)
  are **implemented and wired into the Vite build**.
  Inter-procedural narrowing is therefore **extend-existing (small-to-medium)**, not
  a v2b pull-forward. The still-unbuilt piece is the cross-_package_ precompiled
  `__llui_deps.json` manifest layer (schema+algorithm exist and are tested, but
  nothing emits/consumes it). **`track()` is subsumed/retired** by signals (the
  analyzer + the foreign `LiveSignal` fallback cover its role); v2b should note this.

- **`llm-improvements.md` — mostly complementary.** Eval pipeline, MCP, `.d.ts`,
  `setFields` are orthogonal. Items targeting deleted/reshaped APIs (`item.current()`
  ergonomics, `child({props})` footgun, the `memo()`/`.map`-on-state-array idiomatic
  rules) are **obsoleted** when signals lands.

- **`true-dom-reuse-hydration.md` — unrelated.** Hydration/DOM reuse; no reactivity
  interaction.

## Migration Sequencing

1. **Per-view-file flip** — no half-state; the compiler parses one model or the
   other per file.
2. **Per-app**, smallest consumer first (Dungeonlogs or Health), each validating
   the design before the next.
3. **In-tree examples updated as part of the framework PR** — they are the LLM's
   training corpus and must reflect the new shape from day one.

## Implementation Checkpoints

Validate during implementation, not before:

1. The superset property test for the analyzer (the primary correctness gate).
2. TS compile-time perf of `ValidPath`/`PathValue` on Dicerun's `studio/state.ts`
   (47 fields, 6 levels). Expected fine, especially on TS 7.
3. Custom `.at()` path diagnostic quality: invalid-segment position + available
   keys + did-you-mean.
4. The pure-derive-body / no-node-construction bans land _before_ the analyzer
   relies on them.
5. A migration codemod, prototyped after one hand-migration to collect patterns.
