# Runtime DOM Update Strategy

This document describes how LLui translates state changes into DOM mutations. The design is intentionally minimal: no virtual DOM, no diff-then-patch, no framework-managed component lifecycle tree. Instead, LLui builds real DOM once, drives reactivity through a flat array of mask-gated _bindings_, and delegates lifetime management entirely to the scope hierarchy.

The runtime lives in `packages/dom/src/signals/`. There is one runtime — the **signal runtime** — and it is the whole of `@llui/dom`. The earlier two-phase mask/`maskHi` runtime, `elSplit`, `__dirty`, and per-component `__update`/`__handlers` code generation were deleted; nothing in this document describes a fallback path because there isn't one.

---

## No Virtual DOM: `view` Runs Once

`view` is a one-shot imperative call. It runs exactly once, at mount, building real DOM nodes. As it builds, every reactive value it encounters — a `text(state.map(...))` child, a `div({ class: state.map(...) })` prop — registers a **binding**: an accessor `produce(state)` paired with the absolute dependency paths it reads and a `commit(value)` that writes the DOM. After mount, `view` is never called again. State changes drive the binding array, not a re-render.

Concretely, the build collects a flat list of binding specs:

```ts
interface BindingSpec {
  deps: readonly string[] // absolute state paths this binding reads, e.g. ['count']
  produce: (state: unknown) => unknown // the compiled accessor
  commit: (value: unknown) => void // the DOM mutation
}
```

A `signalText(produce, deps)` call creates a text node and pushes `{ deps, produce, commit: v => (node.data = String(v)) }`. An element's reactive prop pushes `{ deps, produce, commit: out => applyAttr(node, name, out) }`. Static props and event listeners are applied immediately during the build and register no binding. Event handlers are plain functions wired with `addEventListener`; they are not reactive and carry no deps.

When the build finishes, `buildScope` turns the collected specs into a `SignalScope`: it builds a `PathTable` over the union of all dependency paths, computes each binding's sparse chunked mask, and constructs the reconciler. The component lifecycle (`mountSignalComponent`) inserts the built nodes, runs `scope.mount(initialState)` to commit every binding once, then drives `scope.update(old, new)` on each state change.

---

## The Chunked-Mask Reconciler

Reactivity is a single-pass sweep over the flat binding array, gated by a chunked dirty mask. The reconciler is `createSignalScope` (`signals/runtime.ts`); the mask machinery is `signals/mask.ts`.

### Path table and per-binding masks

A component's `PathTable` assigns every unique dependency path a bit index. Bits are packed into N 32-bit chunks (`Uint32Array`), so there is **no 31-path ceiling** — a component with 200 distinct reactive paths simply uses 7 chunks. Each binding carries a **sparse mask**: a sorted list of `[chunk, bits]` pairs for only the chunks it actually touches. Most bindings read one path and touch one chunk, so a binding's mask stays ~constant regardless of how many total paths the component has.

```ts
type SparseMask = ReadonlyArray<readonly [chunk: number, bits: number]>
```

The table also groups paths by their top-level segment (`root`), so an unchanged subtree can be dismissed with a single `Object.is` without ever resolving its leaves — this is the per-row fast path that keeps `each` updates proportional to the rows that changed.

### The update sweep

On `scope.update(oldState, newState)`:

```ts
update(oldState, newState) {
  // 1. Compute the dirty chunk-set from old→new by reference-equality per path.
  //    Short-circuits when whole-state ref is unchanged, and per root group when
  //    that subtree's ref is unchanged. Returns false if nothing this scope reads
  //    changed — then the entire binding sweep is skipped.
  if (computeDirtyInto(table, oldState, newState, dirty)) {
    for (const b of bindings) {
      if (!intersects(b.mask, dirty)) continue // gate: skip irrelevant bindings
      const v = b.produce(newState)
      if (!Object.is(v, last.get(b))) {
        b.commit(v) // output-equality: commit only real changes
        last.set(b, v)
      }
    }
  }
  for (const c of children) c.update(oldState, newState) // propagate to child scopes
}
```

Three layers of work-elimination, in order:

1. **Dirty computation by reference-equality.** `computeDirtyInto` walks the path table comparing the old and new value at each path with `Object.is`. Because TEA reducers return immutable, structurally-shared state, an unchanged field is reference-identical and contributes no dirty bit. An unchanged top-level subtree (e.g. `state.user` returns the same ref) short-circuits all its leaves at once. If no tracked path changed, the function returns `false` and the binding sweep is skipped entirely.

2. **Mask gating.** `intersects(b.mask, dirty)` is a handful of integer ANDs over the binding's sparse chunks. A binding whose paths aren't in the dirty set is skipped without calling `produce` — no accessor invocation, no DOM access.

3. **Output equality.** When a binding does pass the gate, `produce` runs and the result is compared against the binding's last value with `Object.is`. A coarse dependency (e.g. a `.map` over a parent object) might waste a `produce` call, but it never wastes a DOM write — `commit` fires only when the produced value actually changed.

The `dirty` `Uint32Array` is owned by the scope and reused across updates (update is synchronous and non-reentrant under TEA), so a hot reconcile allocates no masks.

### Why reference-equality is sound

The correctness guarantee is: a binding re-runs whenever its output could change. It rests on two invariants. (1) The reducer is immutable with structural sharing, so any output-affecting change to a path changes that path's value by reference. (2) The compiler's dependency analysis is a conservative superset — every path a binding's accessor reads is in its `deps`. Together: if a binding's output could change, some dep changed by reference, the dirty bit is set, the gate passes, and `produce` runs. A mask that is too _narrow_ would silently strand stale DOM; a mask that is too _broad_ merely wastes a `produce`. The compiler must therefore never under-approximate deps (see 02 Compiler.md).

---

## Bindings and `commit`

A binding is the unit connecting a state-dependency set to a single DOM write. It is `{ mask, produce, commit }`. There is no `node`/`kind`/`key`/`lastValue` record threaded through a switch — the `commit` closure captures the node and performs the exact mutation it needs, decided once during the build:

- **Reactive text** (`signalText`): `node.data = value == null ? '' : String(value)`.
- **Reactive prop/attr** (`react(...)` lowered onto an element): `applyAttr(node, name, out)`. `applyAttr` handles the cases: `style.X` → `style.setProperty('x', …)` (or `removeProperty` on nullish/false); `null`/`false` → `removeAttribute`; `true` → `setAttribute(name, '')`; otherwise `setAttribute(name, String(value))`.

Static values and event handlers never become bindings. During the element build (`populate`), a `react(...)`-wrapped prop becomes a binding, an `on*` function prop becomes an `addEventListener`, and everything else is applied once as a static attribute.

The binding's `last` value is held in a per-scope `Map<binding, value>`, set at mount and on each committed change — this is what backs the output-equality check.

---

## Structural Primitives

Structural primitives (`show`, `branch`, `each`, `virtualEach`) are not plain bindings. Each registers a **structural binding** gated on its own deps, but its `commit` _reconciles_ rather than writing a single value, and it owns one or more **child scopes**. The structural binding's `produce` returns the whole component state (`(s) => s`) so the reconcile callback can build content against it.

### `show(cond, render, orElse?)`

`signalShow` inserts a `<!--show-->`/`<!--/show-->` anchor pair. Its structural binding is gated on the condition's deps; the `commit` evaluates `cond.produce(state)` and:

- If the truthiness is unchanged from the mounted arm, it returns immediately — the mounted arm's own child scope handles its inner reactivity. A same-truthiness state change does **not** remount.
- If it flipped, it removes the old arm (running its onMount cleanups + foreign unmounts, removing its nodes, and `ownerScope.removeChild(oldScope)`), then builds the new arm via `runBuild`, mounts its scope against the component state, inserts the nodes before the end anchor, and registers it via `ownerScope.addChild(scope)` so it receives future state updates while mounted.

The mounted arm reads the owning component's state directly — its bindings re-run when _their_ deps change, not only when the condition flips. The `orElse` arm (a `() => Node[]`) renders when the condition is falsy.

### `branch(disc, arms)`

`signalBranch` is the discriminated-union form of `show`: it keys on a discriminant `String(disc.produce(state))` and mounts the matching arm. Swapping the discriminant value unmounts the old arm and mounts the new one as a child scope; a same-key update does not remount. An absent arm renders nothing.

The authoring `branch` has two shapes (see 09 API Reference.md): a 3-arg form `branch(sig, u => u.type, { ... })` whose arms receive the **narrowed variant signal**, and a 2-arg form `branch(sig, { ... })` keyed directly on a string/number signal's value. Both lower to `signalBranch`.

### `each(items, { key, render })`

`signalEach` inserts an `<!--each-->`/`<!--/each-->` anchor pair and reconciles a keyed list. Its structural binding is gated on the list's deps (the items path plus any component-state paths the rows read). Each row is its **own** `SignalScope`, mounted on a combined `{ item, state, index }` context — so a row reacts both to its own item and to component state, with per-row, per-binding gating. The row's `produce`/`commit` accessors read `ctx.item.*` (dep `item.*`), `ctx.state.*` (dep `state.*`), and `ctx.index` (dep `index`).

The reconcile is a minimal-move keyed diff:

- Build a key for each item via `key(item)`.
- **New key** → build the row (`runBuild` inheriting the parent context so `provide`/descriptors flow in), mount its scope on the row ctx, insert its nodes in order before the cursor, run its onMount callbacks.
- **Existing key** → reuse the row in place. A scratch `spare` ctx is mutated with the new `{ item, state, index }` and swapped in as the new current, then `row.scope.update(oldCtx, newCtx)` re-runs only the bindings whose part of the ctx changed (item ref, state ref, or index). Kept rows are **mutated in place, never recreated**. If the row's first node is already at the cursor, no DOM move happens; otherwise its nodes are moved before the cursor.
- **Dropped key** → run the row's teardowns (onMount cleanups, foreign unmounts), remove its nodes.

The cursor walks the desired order so DOM mutations are proportional to the number of _moved_ rows, not the total. Per-row item/index handles (`render: (item, index) => …`, where `item`/`index` are signals) read a live `{ item, state, index }` holder so `.peek()` in an event handler sees the current row.

### `virtualEach(opts)`

`signalVirtualEach` is a windowed keyed list: only rows in the scroll viewport (+`overscan`) exist in the DOM. A scroll container (fixed `containerHeight`) holds a spacer sized to `items.length * itemHeight`; each visible row is absolutely positioned at `index * itemHeight`. It reuses the same per-row scope machinery as `each` (per-row sub-build, a row scope mounted on `{ item, state, index }`, teardowns on removal). The window recomputes on `scroll` (without a state change) and when the items deps change. Fixed `itemHeight` only.

### Anchors and child-scope propagation

Comment anchors (`<!--each-->`, `<!--show-->`, …) are stable insertion points, so multiple structural primitives can coexist in one parent without knowing each other's positions. Mounted arms/rows are registered as child scopes of the owner; `scope.update` propagates to children after sweeping its own bindings. Newly-mounted children are already current (mounted against the latest state) and no-op on the immediate propagation via output-equality.

---

## Component Lifecycle

`mountSignalComponent(target, def, opts?)` (`signals/component.ts`) drives the TEA loop:

1. Run `def.init()` → `[seedState, initialEffects]` (a bare `S` return is normalized to `[S, []]`).
2. Build the view once: `mountSignal(target, state, () => def.view({ state: handle, send }))`. The target is a container `Element` (append on fresh mount, replace on hydrate) or a `MountTarget` descriptor (`{ container }` or `{ anchor }`). The build inserts nodes first, then `mount(state)` commits bindings + runs the first structural reconcile, then onMount callbacks fire on the attached nodes.
3. Dispatch `initialEffects` to `onEffect` (skipped by default when hydrating).
4. In dev (`import.meta.env.DEV`), install the debug API (`installSignalDebug`) for the MCP/agent relay and capture a bounded message history.

`send(msg)` is **synchronous**: it runs the pure reducer, and if `!Object.is(next, state)` it commits the new state to the reconciler (`mount.update(next)`), notifies subscribers, then dispatches the returned effects to `onEffect`. There is no microtask queue and no combined-dirty-mask coalescing — each `send` is its own update cycle. `flush()` is retained as a no-op for harness/agent parity. (Effects can `send` again; this is an ordinary synchronous reducer step, not re-entrant reconciliation.)

`onEffect(effect, { send, state })` may return a cleanup function, which is registered for disposal. The core runtime treats all effects as data handed to `onEffect`; `@llui/effects` provides `handleEffects` to interpret `http`/`cancel`/`debounce`/`sequence`/`race` (see 01 Architecture.md).

### `SignalComponentHandle`

`mountSignalComponent` returns the handle surface (the agent/test contract):

```ts
interface SignalComponentHandle<S, M> {
  send(msg: M): void
  getState(): S
  flush(): void // no-op: send is synchronous
  dispose(): void // run all effect cleanups + the build's teardowns
  subscribe(listener: (state: S) => void): () => void
  runReducer(msg: M): { state: S; effects: unknown[] } | null // dry-run, no commit
  getBindingDescriptors(): Array<{ variant: string }> // live tagSend affordances
  swapUpdate(newUpdate, newOnEffect?): void // HMR: hot-swap reducer, keep DOM + state
  setOnBindingError(hook: ((e: BindingError) => void) | null): void
}
```

- `subscribe` fires synchronously after every state-changing update; it backs the agent protocol's state-update frames.
- `runReducer` runs the reducer in isolation against the current state with no commit/dispatch; it backs the agent's `would_dispatch`.
- `getBindingDescriptors` snapshots the Msg variants dispatchable from the currently-rendered UI (live `tagSend` registrations); it backs `list_actions`.
- `swapUpdate` hot-swaps `update`/`onEffect` without rebuilding the DOM — the HMR escape hatch for pure `update.ts` edits, keeping live state and DOM.
- `setOnBindingError` installs a hook called when a binding accessor throws during an update; the runtime leaves that binding's DOM at its prior value and continues with siblings, and reports the error via the hook.

### Binding-error isolation

`withBindingErrors(handler, fn)` (`signals/runtime.ts`) wraps the synchronous mount and every `send`. With a hook installed, a throw inside a binding's `produce`/`commit` is reported (`{ kind, message, stack }`) and the sweep continues with sibling bindings, leaving the failed binding's DOM untouched. With no hook, the throw propagates (the default). This backs the agent dispatch envelope's `drain.errors`.

---

## The Scope Hierarchy

A `SignalScope` owns its binding sweep and a set of child scopes; teardown lists (onMount cleanups, foreign unmounts, portal/subscription disposal) are collected per build and run on dispose. The build context (`signals/dom.ts`, the module-level `ctx`) threads through a build:

```ts
interface BuildCtx {
  specs: BindingSpec[] // collected bindings
  doc: SignalDoc // node factory (real Document or server DomEnv)
  host: { scope: SignalScope | null } // the scope these bindings will own
  teardowns: Array<() => void> // foreign unmount, subscription disposal
  mounts: Array<(root) => void | (() => void)> // onMount callbacks
  contexts: Map<symbol, unknown> // provide/useContext values
  descriptors: Map<string, number> // live tagSend affordance refcounts
}
```

`runBuild` runs a build function with a fresh collecting context and nests safely (restoring the previous context). Structural primitives call it to build rows/arms reactively after mount, passing their captured build-time ctx via `inherit` so context values and the descriptor registry flow into nested builds.

**Disposal** runs the relevant teardowns and removes nodes. A `show`/`branch` arm swap disposes the leaving arm before the entering arm builds; a dropped `each` row runs its teardowns and removes its nodes; component `dispose()` runs `mount.dispose()` (every live structural teardown) plus the registered effect cleanups. Because every onMount cleanup and foreign unmount is a teardown owned by the scope that built it, "forgot to clean up" is structurally impossible — the only communication channel into an imperative subtree (`foreign`) registers its `unmount` as a teardown automatically.

### `onMount`, `portal`, `provide`/`useContext`

- **`onMount(cb)`** queues a callback that runs after the surrounding view's nodes are inserted, receiving the mounted parent element. A returned function becomes a teardown. Returns a marker comment node for the view array. Cancellation-by-disposal applies: a `show` arm that opens and closes before mount callbacks run has its callback dropped.
- **`portal(content, target?)`** renders `content()` into `target` (default `document.body`) instead of inline; the content's bindings join the current scope (so it stays reactive), and a teardown removes the nodes on dispose. Returns an inline placeholder comment. During SSR the server `DomEnv` has no `document.body`, so a portal needs an explicit target.
- **Context** is build-time dependency injection. `createContext(default, name?)` makes a context; `provide(context, value, render)` sets a value for the subtree `render` builds (restoring afterward); `useContext(context)` reads the nearest provided value (or the default — outside a build it returns the default rather than throwing). Values may be plain or signals; a reactive context is just a `Signal` value. Provided values are inherited into nested builds (each rows, show/branch arms).

---

## Mount targets, hydration, and `lazy`

`mountSignal(target, initial, build, …)` is the shared mount core. A `{ container }` target appends (fresh mount) or atomically replaces children (hydration). An `{ anchor }` target inserts nodes immediately after a comment anchor, bracketed by a synthesized `<!--llui-mount-end-->` sentinel — `dispose()` removes exactly that bracketed region, leaving the anchor and outer siblings intact. Adapters like `@llui/vike` use the anchor form to mount a nested layer as siblings of a slot anchor without owning the parent element.

**Hydration** does not claim server nodes. The client rebuilds the (deterministic) tree against `serverState` and atomically swaps it in — server HTML stays visible until the swap, so no flash. `hydrateSignalApp(target, def, serverState, options?)` is the entry; it seeds the loop with `serverState`, skips `init()`'s effects by default (the server already ran them), and `replace`s the server region.

**`lazy(opts)`** renders `fallback()` immediately as siblings of an anchor (built in the current build, so the fallback is reactive), then on `loader()` resolution removes the fallback and mounts the loaded component via `mountSignalComponent({ anchor, mode: 'append' })` — reusing the anchor-mount infra. On reject it swaps in `error(err)` (or nothing). If the surrounding build is torn down before the loader settles, a cancelled flag skips the deferred mount and disposes any already-mounted child.

---

## What Adds Value

**Real DOM built once.** `view` runs a single time; there is no re-render to suppress and no tree to diff. The cost of an update is the cost of the bindings whose deps changed, plus structural reconcile for the primitives whose deps changed — never proportional to the size of the view.

**Chunked masks with no path ceiling.** Sparse per-binding masks over N 32-bit chunks make the gate a few integer ANDs regardless of total path count, and lift the old two-word 62-path limit entirely. A 200-path component is no more expensive per binding than a 5-path one.

**Three independent work-elimination layers.** Reference-equality dirty computation (with subtree short-circuiting), mask gating, and output-equality each remove work proportional to a different kind of stability. An unchanged `each` row's identical item ref dismisses the whole subtree in one `Object.is`.

**Scope as lifetime unit.** Composable, zero-overhead at runtime (no reference counting), and impossible to misuse — every reactive resource and every imperative teardown is owned by the scope that created it, disposed exactly when its DOM region is removed.

**Per-row scopes for `each`.** Each row is an independent scope mounted on a combined item+state ctx, so a shared-state change fans out only to the row bindings that read it, an item change hits only that row, and kept rows are mutated in place.

---

## What to Avoid

**Re-running `view` on state changes.** `view` builds nodes and registers bindings; running it again would duplicate both. The model is build-once, reconcile-many.

**Mutating state inside `update`.** The reconciler detects change by reference-equality per path. A reducer that mutates and returns the same object produces zero dirty bits and the UI appears frozen. Always return new state with structural sharing.

**`.peek()` in a reactive slot.** `state.at('x').peek()` reads the current value _once_ and never updates — correct inside an event handler or a `.map` body, wrong as a slot value or prop. Use `.at(...)`/`.map(...)` for reactivity. The compiler's `peek-in-slot` rule rejects this at build time.

**Operating on a signal directly.** A signal is not a value; `state.at('n') + 1`, `` `${state.at('s')}` ``, or `state.at('flag') ? a : b` operate on the handle, not its contents. Derive with `.map`: `state.at('n').map(n => n + 1)`. The `operator-on-signal` rule rejects these.

**Building DOM or causing side effects inside a `.map` body.** A derive body must be a pure function of plain values — no element/text construction (use a structural primitive), no `send`/`fetch`/timers, no `.at`/`.map`/`.peek` on a signal, no `Date.now`/`Math.random`. The `no-node-construction-in-body` and `pure-derive-body` rules enforce analyzer soundness here.

**Passing whole `state` to a value slot.** `text(makeLabel(state))` reads the entire state object as the binding's dep, so it re-runs on every change. Prefer a slice — `text(makeLabel(state.at('label')))`. Output-equality still gates the commit, so this is a perf preference, not an error (no lint gates it). Rendering whole `state` directly is a _type_ error (slots take `Reactive<string | number>`), and a `Signal` coerced in a template/operator is caught by `operator-on-signal`.

---

## What Seems Valuable But Isn't

**A virtual DOM.** The binding model already knows exactly which nodes a state path can affect (the mask) and writes only those. VDOM solves a diffing problem the runtime doesn't have, and would add tree allocation on every update.

**A push-based signal graph (per-binding subscriptions).** Bindings are pulled, not pushed: the reconciler iterates the flat array and gates by mask. A subscription object per `(binding, path)` would add per-read bookkeeping and GC pressure for selectivity the chunked mask already provides at the cost of a few integer ANDs.

**`requestAnimationFrame` batching.** `send` is synchronous and applies its DOM writes immediately, before the browser's next paint. There is no microtask queue to coalesce, and rAF would only add a frame of latency.

**Reintroducing a microtask `send` queue.** The signal runtime applies each `send` synchronously. Coalescing multiple sends into one reconcile would re-add a scheduler and the `flush()` semantics it required; under synchronous TEA the reconcile is cheap enough (gated by masks) that it isn't warranted. `flush()` remains only as a no-op parity method on the handle.

---

## Open Questions and Future Directions

**Move-minimizing `each` reorder.** The keyed reconcile is correct-and-simple: it walks the desired order and moves any displaced row before the cursor. A longest-increasing-subsequence pass could reduce DOM moves in the worst reorder case, at the cost of more reconcile bookkeeping. Whether real workloads (drag of one item, append at tail) justify it is open.

**Dynamic-height `virtualEach`.** The windowed list assumes a uniform `itemHeight`. Variable-height virtualization needs a measured-offset index and a resize-observation strategy; not yet specified.

**Streaming hydration.** Signal hydration today rebuilds the deterministic client tree and atomically swaps it in — server HTML is for first paint, the client owns reconciliation from there. True streaming (attach bindings to existing server nodes incrementally) would require a build mode that adopts nodes rather than creating them, plus agreed scope-boundary markers. The comment anchors structural primitives already emit are a natural fit.

**Pooled row reuse for high-churn lists.** Typeahead-style full replacement disposes and rebuilds row scopes. A pool of resettable `(scope, nodes)` pairs (RecyclerView-style) would cut allocation, but requires cleanly separating built structure from rebindable content per row.
