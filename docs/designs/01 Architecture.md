# LLui Architecture

## Mental Model

LLui is a compile-time-optimized web framework built around The Elm Architecture (TEA). The core loop is identical to Elm's: state is immutable, the only way to change it is to dispatch a `Msg`, `update()` folds the message over the current state and returns a new state plus a list of effects, and the runtime executes those effects outside the pure function boundary.

The critical departure from Elm — and from virtually every other TEA-inspired framework — is what happens when state changes arrive at the DOM. Traditional approaches re-run a virtual DOM diffing pass over the entire tree. LLui has no virtual DOM. `view` is a one-shot imperative call that runs exactly once at mount, building real DOM nodes and recording _where_ state is consumed. Every reactive value passed to an element helper or `text()` becomes a **binding**: an accessor `produce(state)` paired with the dependency paths it reads and a `commit(value)` that writes a specific DOM node. After mount, state changes skip `view` entirely.

Reactivity is expressed through **signals**. The view bag carries `state`, a `Signal<State>` handle. You slice into it with `.at('field')` to get a sub-path signal, derive with `.map(fn)`, and read a one-shot snapshot with `.peek()`. A reactive slot is a signal: `text(state.at('count').map(String))`, `div({ class: state.at('open').map(o => o ? 'on' : '') }, [...])`. A static value is a plain value; an event handler is a plain function. `.peek()` is for event handlers and effects — never as a slot value, because a peek reads once and never updates.

When state changes, the runtime drives a single mask-gated sweep over the flat binding array (`packages/dom/src/signals/runtime.ts`):

1. **Compute the dirty set.** From old→new state, reference-equality at each tracked path yields a dirty chunk-set (`mask.ts`). Because TEA reducers return immutable, structurally-shared state, an unchanged field is reference-identical and dirties nothing; an unchanged subtree short-circuits all its leaves with one `Object.is`. If nothing a scope reads changed, its whole sweep is skipped.
2. **Gate by mask.** Each binding carries a sparse mask of the dependency-path chunks it reads. A binding whose mask doesn't intersect the dirty set is skipped without calling `produce` — no accessor invocation, no DOM access.
3. **Output equality.** A binding that passes the gate runs `produce`; `commit` fires only if the value actually changed (`Object.is` against the last value). A coarse dependency wastes a `produce` but never a DOM write.

The mask is a chunked bitset: a `PathTable` assigns each unique dependency path a bit across N 32-bit chunks, and each binding's sparse mask lists only the chunks it touches. There is **no path ceiling** — a 200-path component uses 7 chunks and each binding's gate is still a handful of integer ANDs. (This replaces the older fixed two-word `mask`/`maskHi` design with its 62-path limit.)

Structural primitives — `show`, `branch`, `each` — are not plain bindings. Each registers a structural binding gated on its own deps, but its `commit` _reconciles_ (swaps an arm, diffs keyed rows) and owns child scopes. Non-structural slots are gated bindings. Both kinds live in the same sweep; structural reconcile and binding commits happen as their deps dirty.

**`send()` is synchronous.** `send(msg)` runs the pure reducer immediately; if the returned state differs by reference, it commits to the reconciler, notifies subscribers, then dispatches effects to `onEffect`. There is no microtask queue and no combined-dirty coalescing — each `send` is its own update cycle. `flush()` is retained as a no-op on the handle, for harness/agent parity with frameworks that batch. (An effect that calls `send` again is an ordinary synchronous reducer step, not re-entrant reconciliation.)

The scope tree is the ownership graph. Every binding, every event listener, every `onMount` callback, every portal, every `foreign` instance, and every mounted `show`/`branch` arm or `each` row is owned by a `SignalScope`. Disposal runs the scope's teardowns (onMount cleanups, foreign unmounts, subscription disposal) and removes its nodes. When a `show` flips or an `each` row drops, its scope's teardowns fire before the nodes leave. No GC roots remain; the lifetime of every DOM resource is the lifetime of the scope that created it.

`onMount(cb)` runs after the surrounding nodes are inserted, receiving the mounted parent element; a returned function becomes a teardown. If the owning scope is disposed before the callback can register meaningfully (a `show` arm that opens and closes within one cycle), the cleanup is still owned by that scope and runs on its disposal.

Effects are plain data objects. `update()` returns `[newState, effects]` (a bare `S` return is normalized to `[S, []]`); the runtime dispatches each effect to `onEffect(effect, { send, state })` after the DOM is updated. `onEffect` may return a cleanup function, registered for disposal. The core runtime hands all effects to `onEffect`; the `@llui/effects` package provides `handleEffects<Effect>()`, a composable chain that interprets `http`, `cancel`, `debounce`, `sequence`, and `race` effect descriptions, tracks cancellation tokens and debounce timers in a per-component closure, and passes unrecognized effects to a `.else()` callback where the developer handles custom types. TypeScript narrows `.else()` to only the variants the chain doesn't consume.

This means effects are serialisable, loggable, and testable without mocking the DOM or the runtime — you test `update()` in isolation.

```ts
// The complete shape of a component. No surprises.
import { component, mountApp, div, button, text, show } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: Math.max(0, state.count - 1) }, []]
      case 'reset':
        return [{ count: 0 }, []]
    }
  },
  view: ({ state, send }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text(state.at('count').map(String)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    show(
      state.at('count').map((c) => c > 0),
      () => [button({ class: 'reset', onClick: () => send({ type: 'reset' }) }, [text('Reset')])],
    ),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

The view bag is `{ state, send }` — `state: Signal<State>`, `send: (msg: M) => void`. Element and structural helpers (`div`, `button`, `text`, `each`, `show`, `branch`, …) are **module imports** from `@llui/dom`, not bag fields. There is a single import surface: `@llui/dom`. There is no `/signals` subpath, no separate legacy runtime, and no `@llui/eslint-plugin`.

For a component with effects:

```ts
import { component, div, input, text } from '@llui/dom'
import { handleEffects, http, cancel, debounce } from '@llui/effects'

type State = { query: string; results: Item[]; loading: boolean }
type Msg =
  | { type: 'setQuery'; value: string }
  | { type: 'clearSearch' }
  | { type: 'results'; payload: Item[] }
  | { type: 'error'; error: string }
  | { type: 'analytics'; event: string } // custom effect's resulting msg
type Effect =
  | { type: 'http'; url: string; onSuccess: string; onError: string }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'debounce'; key: string; ms: number; inner: Effect }
  | { type: 'analytics'; event: string }

const Search = component<State, Msg, Effect>({
  name: 'Search',
  init: () => [{ query: '', results: [], loading: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setQuery':
        return [
          { ...state, query: msg.value, loading: true },
          [
            cancel(
              'search',
              debounce(
                'search',
                300,
                http({
                  url: `/api?q=${msg.value}`,
                  onSuccess: (data) => ({ type: 'results', payload: data as Item[] }),
                  onError: (err) => ({ type: 'error', error: err.message }),
                }),
              ),
            ),
            { type: 'analytics', event: 'search_typed' },
          ],
        ]
      case 'clearSearch':
        return [{ ...state, query: '', results: [], loading: false }, [cancel('search')]]
      case 'results':
        return [{ ...state, results: msg.payload, loading: false }, []]
      case 'error':
        return [{ ...state, loading: false }, []]
      case 'analytics':
        return [state, []]
    }
  },
  // handleEffects consumes http/cancel/debounce; .else() sees only the rest.
  // The handler receives one ctx object: { effect, send, signal }.
  onEffect: handleEffects<Effect, Msg>().else(({ effect }) => {
    switch (effect.type) {
      case 'analytics':
        window.analytics?.track(effect.event)
        break
    }
  }),
  view: ({ state, send }) => [
    input({
      value: state.at('query'),
      onInput: (e: Event) =>
        send({ type: 'setQuery', value: (e.target as HTMLInputElement).value }),
    }),
  ],
})
```

After the Vite plugin runs, the inline `view` is **lowered** to runtime helpers (`signalText`, `el`, `react`, `signalEach`, …) as an optimization — erasing the signal-handle allocation for the hot view. Views it can't lower (helper functions, block bodies) run via the runtime authoring helpers, which consume the same signal handles. Either way the runtime builds the same mask-gated bindings (see 02 Compiler.md).

---

## Composition Model

LLui is designed for **LLM-first authoring**: an LLM generates the code, a human reviews and makes small changes. This means optimizing for pattern predictability (the LLM always uses the same shape), exhaustiveness checking (TypeScript catches missing cases), and scanability (the reviewer verifies correctness by local inspection). The composition model follows from this: it should be the simplest thing that works, with no hidden mechanisms.

### View functions — the default decomposition primitive

A "child component" is not a component. It is a module that exports typed `update` / `view` (or `connect`) functions operating on a slice of the parent's state. The parent owns all state; the child reads a `Signal` of its slice and sends through the parent's `send`. This is pure Elm-style composition: no component instances, no props watcher, no lifecycle hooks.

The convention used across `@llui/components` is a **state machine + `connect`**: `init` / `update` are pure functions over the slice, and `connect(state: Signal<Slice>, send: Send<SliceMsg>)` returns reactive (signal-based) props to spread onto elements. For example, a toggle's `connect` returns:

```ts
export function connect(state: Signal<ToggleState>, send: Send<ToggleMsg>): ToggleParts {
  return {
    root: {
      type: 'button',
      role: 'button',
      'aria-pressed': state.map((s) => s.pressed),
      'data-state': state.map((s) => (s.pressed ? 'on' : 'off')),
      disabled: state.map((s) => s.disabled),
      onClick: tagSend(send, ['toggle'], () => send({ type: 'toggle' })),
    },
  }
}
```

The parent destructures its slice with `state.at('toggle')` and routes child messages through its own `Msg` union: `send({ type: 'toggle', msg })`. The parent's `update` delegates `case 'toggle': return [{ ...state, toggle: toggleUpdate(state.toggle, msg.msg) }, []]`. A reviewer sees every state transition in one flat switch; an LLM generates it mechanically from the types.

Reactivity has no nesting tax: `state.at('dashboard').at('toolbar').at('menuOpen')` (or `state.map(s => s.dashboard.toolbar.menuOpen)`) gets its own dependency path, just as `state.at('count')` does. Under a structural-sharing reducer, unchanged subtrees stay reference-equal across old/new, so every signal reading into them gates out. There is no second composition tier needed for reactivity reasons.

### `child()` — the full-boundary escape hatch

For the rare case of genuine isolation — embedding an independent app whose lifetime is distinct from the host's, a library bundle shipping its own complete TEA loop, or an independent effect lifecycle — a full child component boundary is the escape hatch (mounted as an anchor-bracketed region with its own scope tree and update loop; `lazy()` uses the same machinery to load a child component asynchronously). Use sparingly: a child boundary is a region the unified reactivity model can't see across. Reach for view functions first; the chunked-mask reactivity scales precisely with the number of paths read, not with state depth, so a large flat state is fine.

### `tagSend` — agent affordances

Wrapping a handler with `tagSend(send, ['variant', …], handler)` tags it with the Msg variants it can dispatch. The runtime maintains a live registry of these (refcounted per mounted scope), so an agent can ask the running app which actions are currently dispatchable (`getBindingDescriptors` / `list_actions`). This is how headless components advertise their affordances to the agent protocol (see 10 Agent Protocol.md, 11 Agent Annotations and Tools.md).

### LLM-First Boilerplate

TEA's explicit message types are a feature, not a cost, in LLM-first development. The `Msg` union is the complete menu of valid transitions; the `update` switch is a mechanical enumeration. The LLM never decides "hook, ref, callback, or state?" — the answer is always "a message." For forms with many fields, the idiomatic pattern uses a generic `setField` message to avoid per-field boilerplate:

```typescript
type Msg =
  | { type: 'setField'; field: keyof FormFields; value: string }
  | { type: 'submit' }
  | { type: 'submitSuccess'; data: Response }
  | { type: 'submitError'; error: string }
```

The reviewer sees 4 cases, not 13; the interesting logic is in `submit`/`submitSuccess`/`submitError`.

---

## What Adds Value

**Surgical DOM updates without a virtual DOM.** The mask-gated sweep means update cost scales with what changed, not with tree size. A message that changes one field touches only the bindings whose mask includes that path's chunk. A 50-binding component pays one integer-AND gate per unrelated binding when an irrelevant field changes — and nothing at all if no path it reads changed. This is a static structural property, not a diff heuristic.

**Chunked-mask reactivity with no path ceiling.** Sparse per-binding masks over N 32-bit chunks make the gate ~constant regardless of total path count, and remove the old two-word 62-path limit. A 200-path component is no more expensive per binding than a 5-path one. Dirty computation short-circuits unchanged subtrees with a single `Object.is`, which is what keeps `each` updates proportional to the rows that changed.

**Signals as the authoring surface.** `state.at('a.b')`, `.map(fn)`, `.peek()` are the entire reactive vocabulary. A slot is a signal; a static value is plain; a handler is a function. The compiler lowers the common inline-view shape to allocation-free runtime calls, and the runtime handles every other shape by consuming signal handles directly — so view-helper composition Just Works.

**Effects as data, tested in isolation.** Because `update()` returns effect descriptions, the business logic is a pure function. `@llui/test`'s `testComponent(def)` runs `init`/`update` with no DOM and tracks state/effects/history; `testView(def, state)` mounts against a real container and exposes query/click/input/send helpers that auto-flush. The async loading pattern is fully testable without a browser or fetch mock.

```ts
import { testComponent } from '@llui/test'
const t = testComponent(Search)
t.send({ type: 'setQuery', value: 'milk' })
expect(t.state.loading).toBe(true)
expect(t.effects[0]).toMatchObject({ type: 'cancel', token: 'search' })
```

**Scope-managed lifetimes.** Every resource with a lifetime — binding, listener, onMount callback, portal, `foreign` instance, mounted arm/row — is owned by a scope. Disposing a scope is complete cleanup: no leaks, no stale listeners. When a `show` arm leaves, its teardowns fire before its nodes are removed.

**Per-row scopes in `each`.** Each row is its own scope mounted on a combined `{ item, state, index }` context, so a shared-state change fans out only to the row bindings that read it, an item change hits only that row, and kept rows are mutated in place rather than recreated.

**`foreign()` for imperative libraries.** ProseMirror, Monaco, MapboxGL and friends own their own DOM and event loops. `foreign()` hands LLui-owned `LiveSignal`s (peek + bind) for declared reactive inputs to a `mount` callback that builds the third-party instance; communication out is via `send`. The declared inputs participate in the same mask gating; `unmount` runs on disposal.

**`onMount`, `portal`, context as first-class primitives.** `onMount` runs after insertion with the parent element. `portal(content, target?)` renders out-of-tree (default `document.body`) while keeping the content's bindings in the current scope and reactive. `createContext`/`provide`/`useContext` give build-time dependency injection that flows into nested builds (each rows, arms).

---

## What to Avoid

**Mutating state inside `update()`.** The dirty computation is reference-equality per path. A reducer that mutates and returns the same object produces zero dirty bits, and the UI appears frozen. Always return new state: `return [{ ...state, count: state.count + 1 }, []]`.

**`.peek()` in a reactive slot.** `text(state.at('count').peek())` reads once at build time and never updates. Slots and props must be signals (`.at`/`.map`); `.peek()` belongs in event handlers and `.map` bodies. The compiler's `peek-in-slot` rule rejects this at build time.

**Operating on a signal as if it were a value.** `state.at('n') + 1`, `` `${state.at('s')}` ``, `state.at('flag') ? a : b` operate on the handle, not its contents. Derive: `state.at('n').map(n => n + 1)`. The `operator-on-signal` rule rejects these.

**Side effects or DOM construction inside a `.map` body.** A derive body must be pure over plain values — no `send`/`fetch`/timers, no `Date.now`/`Math.random`, no `.at`/`.map`/`.peek` on a signal, no element/text helpers. Use a structural primitive to build conditional DOM. The `pure-derive-body` and `no-node-construction-in-body` rules enforce this; the bans are correctness-critical because a path read only through such an expression would be invisible to dependency analysis.

**Passing the whole `state` to a value slot.** Prefer a slice — `text(makeLabel(state.at('label')))` over `text(makeLabel(state))` — so the binding depends on `label` rather than re-running on every change (output-equality keeps it correct either way, so coarseness is a perf preference, not an error — there is no lint for it). Rendering the whole state object directly _is_ a type error (`text`/`AttrValue` accept `Reactive<string | number>`), and a `Signal` coerced inside a template/operator (``text(`${state}`)``) is caught by `operator-on-signal`.

**Calling view primitives outside `view`.** The build context is a module-level singleton set during the one-shot view build. Calling `text()`/`each()`/`onMount()`/`portal()` outside it throws. Post-mount imperative work belongs in `onMount` or an effect.

**Holding DOM references across a structural swap.** `view` runs once, so its nodes are stable for the component's lifetime — _except_ inside `show`/`branch` arms and `each` rows, which are built fresh on mount and removed on unmount. Hoist a needed reference outside the structural primitive, or capture it in `onMount` within the arm/row.

---

## What Seems Valuable But Isn't

**A separate fine-grained signal graph with per-binding subscriptions.** The chunked mask already gives per-path selectivity at the cost of a few integer ANDs, with no subscription objects and no per-read bookkeeping. Bindings are pulled, not pushed: the reconciler iterates the flat array and gates by mask. A subscription per `(binding, path)` would add GC pressure for selectivity that's already there.

**Memoizing or skipping `update()` when state is unchanged.** `update()` is pure; if a message doesn't change state it should return the same reference (`return [state, []]`). `send` detects `Object.is(next, state)` and skips the reconcile. There is nothing to cache at the call site.

**A JSX transform.** The view is already JavaScript — element helpers are regular function calls usable imperatively. The compiler works on the TypeScript AST, not a separate syntax layer, and lowers signal slots directly. JSX would add a parse step and a pragma for no gain.

**A virtual DOM for structural reconciliation.** `each` does keyed diffing with a minimal-move cursor: rows already in position aren't touched, only displaced or new rows move, and DOM mutations are proportional to moved rows. `show`/`branch` swap a whole arm keyed on a discriminant — there's nothing to diff. The real-DOM reconciler is faster in the common case and simpler.

**Re-introducing a microtask `send` queue.** The signal runtime applies each `send` synchronously and writes its DOM mutations before the next paint. Coalescing sends into one reconcile would re-add a scheduler and the `flush()` semantics it needed; under synchronous TEA the mask-gated reconcile is cheap enough that it isn't warranted. `flush()` stays only as a no-op handle method for harness/agent parity.

**Component-level shouldUpdate guards.** A component pays only for bindings whose mask overlaps the dirty set. There is no render function to suppress — the sweep is already a filtered iteration.

---

## Design Decisions (Resolved)

**Reactivity model: resolved — signals over a chunked-mask reconciler.** The view bag carries `state: Signal<State>`; slots are signals (`state.at('a.b')`, `.map`, with `.peek` for handlers/effects). At build time the compiler lowers the common inline-view shape to runtime helpers carrying `(produce, deps)`; other shapes run via the authoring helpers, which consume signal handles. At update time, the runtime computes a dirty chunk-set by reference-equality per tracked path, gates each binding by its sparse mask, and commits only changed values. There is no fixed path budget — paths are packed into N 32-bit chunks. This replaces the prior two-phase, two-word `mask`/`maskHi`, `elSplit`, `__dirty` design, which was deleted.

**Composition: resolved — view functions + `connect`, with `child()`/`lazy()` as the isolation escape hatch.** The parent owns all state; child modules export `update`/`connect` over a `Signal` slice and route messages through the parent's `Msg` union. `child()` is the full-boundary escape hatch (own scope tree, update loop, effect lifecycle); `lazy()` loads a child component asynchronously over the same anchor-mount machinery.

**Effects: resolved — effects as data, interpreted by `@llui/effects`.** `update()` returns `[state, effects]`; the runtime hands each effect to `onEffect(effect, { send, state })`. `handleEffects<Effect>().else(handler)` interprets `http`/`cancel`/`debounce`/`sequence`/`race` and narrows `.else()` to the remaining custom variants. `cancel(token)` aborts in-flight work for that token; `cancel(token, inner)` aborts and dispatches `inner` as the replacement.

**Server-side rendering: resolved — signal SSR + atomic-swap hydration.** `renderToString(def, initialState, env)` (and `renderNodes`/`serializeNodes`) build the component's DOM against a server `DomEnv` and serialize it to HTML; effects are not dispatched (server render is pure). On the client, `hydrateSignalApp(container, def, serverState)` rebuilds the deterministic client tree against `serverState` and atomically swaps it in — server HTML stays visible until the swap, so no flash, and the client owns reconciliation from there. There are no `data-llui-hydrate` markers; hydration does not claim server nodes. See 08 Ecosystem Integration.md.

**Third-party embedding: resolved — `foreign()` with `LiveSignal` inputs.** `foreign({ tag?, state?, mount, unmount? })` declares reactive inputs as a record of signals; the runtime materializes each to a `LiveSignal` (`peek` + `bind`) and hands them to `mount({ el, state })`, which builds the instance. When a declared input changes, its `LiveSignal` fires bound callbacks; `unmount` runs on the owning component's dispose. Communicate out via `send` closed over from the view. The analyzer sees the declared deps; the imperative body is opaque.

```typescript
import { foreign } from '@llui/dom'

foreign({
  state: {
    readonly: state.at('document').at('locked'),
    placeholder: state.at('document').at('placeholder'),
  },
  mount: ({ el, state }) => {
    const view = new EditorView(el, {
      /* … */
    })
    state.readonly.bind((ro) => view.setProps({ editable: () => !ro }))
    state.placeholder.bind((ph) => view.setProps({ attributes: { 'data-placeholder': ph } }))
    return view
  },
  unmount: (view) => view.destroy(),
})
```

**State serialization constraint: state must be JSON-serializable.** `S` must be a plain object tree of `string`/`number`/`boolean`/`null`/arrays/nested plain objects — no `Map`, `Set`, `Date`, class instances, functions, `Symbol` keys, or circular references. Multiple features depend on it: the dev debug protocol exposes state as JSON, SSR renders against a state object, HMR preserves state across edits, and the agent protocol serializes state frames. A `Map<string, T>` is `Record<string, T>`; a `Set<T>` is `T[]` with uniqueness enforced in `update()`; a `Date` is an ISO string or a Unix timestamp. This is the same constraint Elm enforces on its `Model`.

**Compile-time correctness rules are non-bypassable errors.** All framework lint (the ~44 correctness / agent-protocol / convention rules) are compile-time **errors** in `@llui/compiler`, surfaced by the Vite plugin via `this.error`. LLMs ignore warnings, so a build that fails closed is the only effective channel. There is no `@llui/eslint-plugin`. The signal-specific rules (`peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`) are detailed in 02 Compiler.md.

**LLM Debug Protocol: resolved — dev debug API + `@llui/mcp` server.** In dev, the runtime installs a debug API (`installSignalDebug`) exposing read state, send typed messages, dry-run the reducer (`runReducer`), and inspect live affordances (`getBindingDescriptors`). The `@llui/mcp` package wraps this as an MCP server connected over a relay the Vite plugin injects into dev builds. Both are dev-only (tree-shaken in production). See 07 LLM Friendliness §10 and 10 Agent Protocol.md.

**Server framework: resolved — Vike via `@llui/vike` adapter.** `@llui/vike` configures `onRenderHtml` (signal SSR via `renderNodes`/`serializeNodes`, composing layout + page node trees) and `onRenderClient` (`hydrateSignalApp` or `mountApp`). It mounts nested layers at comment anchors so layouts and pages stitch at slot positions, replaying in-scope `provide` contexts across the separate build pass. See 08 Ecosystem Integration §2.

---

**Routing: state-driven, mechanism-agnostic.** LLui ships `@llui/router`, but routing is fundamentally a state field: the current route lives in state, URL changes map to messages, and `branch()` renders the active route's view. The URL is an _effect_, not state — `update()` returns a `pushUrl` effect; the handler calls `history.pushState()`. The browser's `popstate` is captured in `onMount` and dispatched as a message.

```typescript
type Route = { type: 'home' } | { type: 'users' } | { type: 'userDetail'; id: string }

type State = { route: Route /* … per-route slices */ }
type Msg = { type: 'navigate'; route: Route } | { type: 'popstate'; route: Route }

// In view: branch on the route discriminant.
branch(state.at('route'), (r) => r.type, {
  home: () => homeView(send),
  users: () => usersView(send),
  userDetail: (r) => userDetailView(r, send), // r: Signal<{ type:'userDetail'; id:string }>
})
```

The 3-arg `branch` selects the discriminant (`r => r.type`) and gives each arm the **narrowed variant signal**, so `userDetail`'s arm can read `r.at('id')` with full types. **The framework does not prescribe how URLs map to routes** — `switch` on `location.pathname`, a `URLPattern`, or a server-provided initial route all work with the same `navigate`/`popstate` message pattern.

---

## Styling

Components are headless by default — they emit `data-scope` / `data-part` attributes on every element and prescribe no visual appearance. An opt-in styling layer provides two mechanisms:

**CSS theme (`theme.css`).** A single CSS import that styles all components via attribute selectors, with design tokens in a Tailwind 4 `@theme` block (colors, radii, spacing, shadows, transitions, z-indexes). Override any token by redeclaring it. Dark mode lives in a separate `theme-dark.css`, imported after `theme.css`.

**JS class helpers (`styles/`).** Each component has a function (e.g. `tabsClasses({ size: 'sm', variant: 'pill' })`) returning Tailwind utility strings per part, powered by a `createVariants()` engine with compound-variant support. For apps using utilities rather than attribute selectors. Both mechanisms coexist.

**Shared utilities.** `theme.css` also provides `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-danger`, `.confirm-dialog`, `.sr-only`, and marquee keyframes.

---

## Expressibility Catalogue

**Counter.** `State = { count: number }`, `Msg = inc | dec | reset`. `text(state.at('count').map(String))` is the reactive count; `show(state.at('count').map(c => c > 0), () => [...])` reveals a reset button. After `inc`, only `count` dirties, so only the count text and the `show` condition re-evaluate.

**Form.** A single `setField` message type for all fields, per-field error state, derived validation via `.map`. With 10 fields in state, each binding's mask targets exactly its path; typing in one input dirties only that field. `keyof Fields` on `setField` makes a typo a compile error. Validation runs in `update()` (pure, testable); errors are part of state. A controlled input must pair `value: state.at('name')` with an `onInput` that sends `setField` — otherwise the binding overwrites keystrokes.

**Todo list.** `each(state.map(s => filter(s)), { key: t => t.id, render: (item) => [...] })`. The items accessor derives the filtered array; the row render receives per-row `item`/`index` signals. `item.at('completed')` is a reactive per-row slot; an event handler reads `item.at('id').peek()`. Adding a todo changes the array reference; the keyed diff inserts only the new row. (See `examples/todomvc/src/main.ts`.)

**Async loading / optimistic updates.** Model state as a discriminated union (`idle | loading | success | error`); `branch(state.at('phase'), p => p.type, { ... })` renders the active arm. `update()` on `submit` transitions to `loading` and returns an `http` effect with `onSuccess`/`onError` message tags. Optimistic updates transition to success in `update()` and roll back on the error message — pure state manipulation, no undo stack.

**Multi-step wizard.** A `phase` discriminant drives `branch` with one arm per step. Navigating disposes the current arm's scope and mounts the next; collected data lives in the carried state. Per-step validation runs in `update()` before the transition.

**Modal / dialog.** `show(state.at('open'), () => [portal(() => [div({ ...parts.content }, [...])])])`. The portal renders into `document.body`, escaping `overflow: hidden`. Focus trap, body-scroll lock, and dismissable wiring go in `onMount` inside the portal builder; their cleanups are teardowns that fire when `show` flips false. `@llui/components`' `dialog.overlay({ … })` packages this (see `packages/components/src/components/dialog.ts`).

**Tooltip / popover.** Same as modal but triggered by `mouseenter`/`mouseleave` sending show/hide messages; the tooltip lives in a `show`-guarded `portal`. Positioning (`getBoundingClientRect`) runs in `onMount`.

**Drag and drop with reordering.** Drag state (`{ dragging, overIndex }`) lives in state. `each`'s keyed minimal-move reconcile preserves DOM identity during reorder — moving one item past one other moves only the displaced row's nodes before the cursor. Drag events send messages that reorder the array.

**Typeahead / autocomplete.** Keystrokes send `setQuery`; `update()` returns `cancel('search', debounce('search', 300, http({ … })))`. The `cancel` wrapper discards any pending search, `debounce` delays 300ms, `http` fetches. No generation counter. Results render via `each` keyed by id.

**Infinite scroll.** `{ items, cursor, loading }` in state; an `IntersectionObserver` on a sentinel (set up in `onMount`) sends `loadMore`. On success `update()` appends to `items`; the keyed `each` inserts the new tail rows only. Or use `virtualEach` for very large lists — only viewport rows (+overscan) exist in the DOM.

**Real-time / WebSocket.** A custom `ws:connect` effect handled in `.else()`: the handler opens the socket, pipes incoming messages via `send`, and registers a cleanup (returned from `onEffect`) that closes it on dispose. Reconnection logic lives in the handler closure, not in state.

**Rich text editor (ProseMirror) / code editor (Monaco).** The canonical `foreign()` use cases. The editor owns its document; LLui owns everything outside. Declare config inputs (readonly, theme, language) as a `state` record of signals; `bind` each in `mount` to call the editor's imperative API on change. Content flows back via `send` in the editor's transaction/change hook. `unmount` calls `view.destroy()` / `editor.dispose()`.

**Parent-child coordination — view functions.** The parent owns a state slice for the child; the child exports `update`/`connect` over a `Signal` slice. The parent's `update` delegates (`case 'toolbar': return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]`) and its view spreads `connect(state.at('toolbar'), msg => send({ type: 'toolbar', msg }))`'s parts. The parent can directly control child state (e.g. close a menu on background click). No child instance, no props watcher.

**Tree view.** Recursive `each`: a row's render may itself call `each` (inside a `show` for expand/collapse) over the node's children. Each level's rows are their own scopes nested under the parent row's scope, so collapsing a node disposes its subtree depth-first.

**Data table with sort, filter, paginate.** All three dimensions in state; derive the filtered+sorted+paged array with `.map` and feed it to `each`. A page change dirties only `page`, so the sort/filter derive (if its inputs are unchanged) re-runs but commits nothing past the output-equality check.

**Accordion.** Independent `show` per section (`show(state.at('openSections').map(o => o.includes('faq')), () => [...])`), each gated on `openSections`. Single-open exclusion is enforced in `update()`. State stays JSON-serializable — `string[]` with uniqueness enforced in `update()`, not `Set`.

**Tab panels.** `branch(state.at('activeTab'), t => t, { home: () => HomePanel(), settings: () => SettingsPanel() })`. Per-tab class via `state.at('activeTab').map(t => t === 'home' ? 'active' : '')`. Switching swaps the arm, disposing the leaving panel's scope (and its effects) and mounting the entering one (firing its `onMount`).

**Presence / exit animations.** The `presence` state machine (`packages/components/src/components/presence.ts`) tracks `closed → opening → open → closing`, advanced by an `animationEnd` message, so an element can stay mounted through its exit animation before unmounting. Its `connect` exposes reactive `data-state`/`hidden` props plus `onAnimationEnd`/`onTransitionEnd` handlers.

**Collaborative editing.** All message sources — local actions, WebSocket messages, periodic sync — flow through `send`. A `ws:subscribe` effect pipes remote ops as messages; `update()` applies OT/CRDT merges and returns new state. Deterministic and testable because everything goes through the pure reducer.
