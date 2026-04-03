# LLui Architecture

## Mental Model

LLui is a compile-time-optimized web framework built around The Elm Architecture (TEA). The core loop is identical to Elm's: state is immutable, the only way to change it is to dispatch a `Msg`, `update()` folds the message over the current state and returns a new state plus a list of effects, and the runtime executes those effects outside the pure function boundary.

The critical departure from Elm — and from virtually every other TEA-inspired framework — is what happens when state changes arrive at the DOM. Traditional approaches re-run a virtual DOM diffing pass over the entire tree. LLui does not have a virtual DOM. `view()` is a one-shot imperative call that runs exactly once at mount time, building real DOM nodes and recording *where* state is consumed. Every arrow function passed to an element helper or `text()` is a *binding*: an accessor `(state: S) => T` attached to a specific DOM node. After mount, state changes skip `view()` entirely. The runtime instead drives two subsequent phases:

**Phase 1 — Structural reconciliation.** `branch`, `each`, and `show` are structural primitives. They own comment-node markers and lists of scopes. When the discriminant or item array changes, Phase 1 surgically removes old DOM subtrees (disposing their scopes), creates new ones by re-invoking the case or item builder functions, and splices them into the live DOM. Transitions hook in here via `enter`/`leave`/`onTransition` fields on the primitive's object parameter. `foreign()` creates an opaque container for third-party imperative components (ProseMirror, Monaco, etc.) — LLui owns the container but not its contents; a typed `sync` bridge handles state propagation.

**Phase 2 — Binding updates.** Every non-structural reactive value is a `Binding` record: `{ node, kind, accessor, lastValue, mask }`. Phase 2 iterates the flat binding list and, for each binding, checks `(binding.mask & dirty) === 0` to skip it cheaply, then calls `Object.is(newValue, lastValue)` to skip identity-equal values, then calls `applyBinding`. Nothing else touches the DOM.

The `dirty` bitmask is injected by the Vite plugin at compile time. The plugin's TypeScript transform scans every reactive accessor in the file, extracts the **access paths** each accessor reads from the state parameter — not just top-level fields but nested property chains up to depth 2 (e.g., `s.user.name`, `s.user.email`, `s.filter`) — assigns each unique path a bit position, and synthesizes a `__dirty(oldState, newState): number` function that ORs together bits for paths whose values changed. An accessor reading `s.user.name` gets a different bit from one reading `s.user.email`, so changing the user's name does not trigger re-evaluation of email bindings. An accessor reading a parent path (`s.user` as a whole object) gets the union of all child path bits, correctly marking it as dependent on any sub-field change.

The compiler uses a **tiered mask strategy** based on the number of unique access paths in the component:

- **Single word** (≤31 paths): one `number` mask. The Phase 2 check is a single bitwise AND: `(binding.mask & dirty) === 0`. This is the common case and the fastest path.
- **Two words** (32–62 paths): a `mask0`/`mask1` pair on each binding, and a `dirty0`/`dirty1` pair from `__dirty`. The Phase 2 check becomes `(binding.mask0 & dirty0) === 0 && (binding.mask1 & dirty1) === 0` — two ANDs with short-circuit. The branch predictor handles this well because if the first word covers the commonly-changed fields, most bindings exit on the first check.
- **63+ paths**: the compiler emits a warning recommending decomposition into child components. No silent fallback — the developer is told exactly which component exceeded the capacity and why.

This is inserted as a `__dirty` property on the `component({...})` call. At runtime, `processMessages` calls `__dirty(oldState, newState)` and passes the result through both phases. Bindings whose mask has no overlap with the dirty bits are unconditionally skipped — not inspected, not called, not compared. For arrays, path tracking stops at the array field itself (`s.todos` is a single bit); per-item granularity is handled by the `eachItemStable` mechanism in Phase 2 rather than by the bitmask.

**Batching: `send()` and `flush()`.** `send(msg)` does not execute an update cycle immediately. It enqueues the message and schedules a microtask if one is not already pending. When the microtask fires, `processMessages` drains the queue: it folds every pending message through `update()` in order, OR-merges their individual dirty masks into a single combined mask, then runs Phase 1 and Phase 2 exactly once with that combined mask. Multiple rapid `send()` calls — e.g., a WebSocket handler forwarding a burst of messages, or a drag event handler updating both position and hover target — coalesce into one update cycle with one set of DOM writes. This is LLui's primary batching mechanism: it eliminates redundant intermediate renders without developer opt-in.

`flush()` forces the pending update cycle to execute synchronously, right now. After `flush()` returns, the DOM reflects all messages sent up to that point. `flush()` exists for two cases: (1) imperative code that must read DOM state immediately after a state change (e.g., measuring an element's position after toggling visibility), and (2) test harnesses that need deterministic step-by-step assertions. If no messages are pending, `flush()` is a no-op. `flush()` does not change the batching model — it simply advances the scheduled microtask to "now."

```ts
// Batching: three sends, one update cycle, one DOM write.
send({ type: 'setX', value: 10 })
send({ type: 'setY', value: 20 })
send({ type: 'setLabel', value: 'moved' })
// DOM unchanged here — microtask hasn't fired yet.
// After the current synchronous JS completes, one update cycle runs.

// flush(): when you need the DOM now.
send({ type: 'togglePanel' })
flush()
// DOM is now updated; safe to measure.
const rect = panelEl.getBoundingClientRect()
```

The scope tree is the ownership graph. Every binding, every event listener, every `onMount` callback, every portal, and every child component is registered under a `Scope`. When a branch swaps arms or an each entry is removed, `disposeScope` walks the subtree and fires all disposers: bindings are spliced out of the flat component array, `PropsWatcher` entries are marked `removed`, child component instances are unmounted, portal nodes are removed from their target elements. No GC roots remain. The lifetime of every DOM resource is exactly the lifetime of the scope that created it.

`onMount` fires via `queueMicrotask` after DOM insertion. The scope registers a disposer that sets a `cancelled` flag. If the owning scope is disposed before the microtask fires — possible when a branch swaps back within the same message-flush cycle — the callback is silently dropped. This is the correct behavior: a branch arm that existed for zero frames has nothing to focus or measure.

**Composition: two levels.** Most composition in LLui uses **view functions** — plain modules that export an `update` function and a `view` function. The parent owns the state; the child module operates on a slice of it. This is pure Elm-style composition: no component instances, no `PropsWatcher`, no lifecycle hooks for prop changes. View functions follow the `(props, send)` convention: a typed props object (generic over the parent state `<S>`) containing named accessor fields, and a `send` callback as the second argument. The parent's `update()` delegates to the child module's `update()` for the relevant slice and wraps the result. The bitmask covers everything — the compiler traces paths like `s.toolbar.menuOpen` as depth-2 paths.

For cases that require isolation — the child has 32+ state paths (bitmask overflow), is a library component with encapsulated internals, or manages its own effect lifecycle — `child()` creates a true component boundary with its own bitmask, own update cycle, and own scope tree. Data crosses this boundary through two typed channels: reactive **props** (parent → child, converted to a message via the component's `propsMsg` function when they change) and **`onMsg`** (child → parent, a typed callback invoked after the child's `update()` that maps child messages selectively to parent messages). For imperative cross-component commands between unrelated components, **typed addressed effects** allow one component to send a fully type-checked effect to another by importing the target's exported `address` builder — no string keys, no `any` types.

Effects are plain data objects. `update()` returns them; the runtime dispatches them after DOM updates have been applied. The core runtime handles two built-in effect types directly: `delay` (setTimeout + message delivery) and `log` (structured console output). All other effects — including HTTP, cancellation, debounce, sequencing, and racing — are consumed by the component's `onEffect` handler. The `@llui/effects` package provides `handleEffects<Effect>()`, a composable chain that interprets `http`, `cancel`, `debounce`, `sequence`, and `race` effects, tracks cancellation tokens and debounce timers in a per-component closure, and passes unrecognized effects through to a `.else()` callback where the developer handles custom effect types. The chain provides exhaustiveness: TypeScript narrows the `.else()` callback to only the effect variants that `handleEffects` doesn't consume, and `noImplicitReturns` catches missing cases. The runtime passes an `AbortSignal` tied to the component's lifetime — when the component unmounts, the signal aborts, and `handleEffects` cleans up all in-flight HTTP requests, pending timers, and debounce entries automatically.

This means effects are serialisable, loggable, and testable without mocking the DOM or the runtime — you test `update()` in isolation.

```ts
// The complete shape of a component. No surprises.
type State = { count: number }
type Msg = { type: 'increment' }
type Effect = never

export const Counter = component<State, Msg, Effect>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'increment': return [{ count: state.count + 1 }, []];
    }
  },
  view: (_state, send) => {
    return div({}, [
      text((s: State) => String(s.count)),
      button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
    ]);
  },
});
```

For a component with effects:

```ts
import { handleEffects, http, cancel, debounce } from '@llui/effects'

type State = { query: string; results: Item[]; loading: boolean }
type Msg =
  | { type: 'setQuery'; value: string }
  | { type: 'clearSearch' }
  | { type: 'results'; items: Item[] }
  | { type: 'error'; msg: string }
  | { type: 'analytics'; event: string }  // custom effect
type Effect =
  | { type: 'http'; url: string; onSuccess: string; onError: string }  // string tags: runtime wraps response into { type: tag, payload: responseData } or { type: tag, error: errorData }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'debounce'; key: string; ms: number; inner: Effect }
  | { type: 'analytics'; event: string }

export const Search = component<State, Msg, Effect>({
  name: 'Search',
  // ...

  update: (state, msg) => {
    switch (msg.type) {
      case 'setQuery':
        return [{ ...state, query: msg.value, loading: true }, [
          cancel('search', debounce('search', 300,
            http({ url: `/api?q=${msg.value}`, onSuccess: 'results', onError: 'error' })
          )),
          { type: 'analytics', event: 'search_typed' },
        ]]
      case 'clearSearch':
        // cancel-only: abort any in-flight or debounced search, no replacement
        return [{ ...state, query: '', results: [], loading: false }, [cancel('search')]]
      // ...
    }
  },

  // onEffect receives (effect, send, signal). handleEffects() consumes http/cancel/debounce.
  // .else() receives only the remaining types — here, just 'analytics'.
  onEffect: handleEffects<Effect>().else((effect, send, signal) => {
    switch (effect.type) {
      case 'analytics': window.analytics?.track(effect.event); break
    }
  }),
})
```

After the Vite plugin runs, the `div` and `button` calls are rewritten to `elSplit(...)` calls with static props applied immediately, event listeners attached once, and reactive tuples `[mask, kind, key, accessor]` registered as bindings. The element helper imports are stripped from the llui import statement; the bundler tree-shakes `elements.ts` entirely.

---

## Composition Model

LLui is designed for **LLM-first authoring**: an LLM generates the code, a human reviews and makes small changes. This means optimizing for pattern predictability (the LLM always uses the same shape), exhaustiveness checking (TypeScript catches missing cases), and scanability (the human reviewer can verify correctness by local inspection). The composition model follows from this: it should be the simplest thing that works, with no hidden mechanisms.

### Level 1 — View Functions (Default)

A "child component" is not a component. It is a module that exports typed `update` and `view` functions. The parent owns the state.

```typescript
// toolbar.ts
export type ToolbarSlice = { menuOpen: boolean }
export type ToolbarMsg =
  | { type: 'toggleMenu' }
  | { type: 'closeMenu' }
  | { type: 'selectTool'; id: string }

export type ToolbarProps<S> = {
  tools: (s: S) => Tool[]
  toolbar: (s: S) => ToolbarSlice
}

export function toolbarUpdate(slice: ToolbarSlice, msg: ToolbarMsg): ToolbarSlice {
  switch (msg.type) {
    case 'toggleMenu': return { ...slice, menuOpen: !slice.menuOpen }
    case 'closeMenu': return { ...slice, menuOpen: false }
    case 'selectTool': return { ...slice, menuOpen: false }
  }
}

export function toolbarView<S>(
  props: ToolbarProps<S>,
  send: (msg: ToolbarMsg) => void,
) {
  div({}, [
    button({ onClick: () => send({ type: 'toggleMenu' }) }, [text('Tools')]),
    show({ when: s => props.toolbar(s).menuOpen, render: (_s, _send) =>
      each({ items: props.tools, key: t => t.id, render: ({ item, index }) =>
        button({
          onClick: () => send({ type: 'selectTool', id: item(t => t.id) }),
        }, [text(item(t => t.name))])
      })
    }),
  ])
}
```

```typescript
// dashboard.ts — the parent owns all state
import { ToolbarSlice, ToolbarMsg, ToolbarProps, toolbarUpdate, toolbarView } from './toolbar'
import { SidebarSlice, SidebarMsg, SidebarProps, sidebarUpdate, sidebarView } from './sidebar'

type State = {
  toolbar: ToolbarSlice
  sidebar: SidebarSlice
  tools: Tool[]
}

type Msg =
  | { type: 'toolbar'; msg: ToolbarMsg }
  | { type: 'sidebar'; msg: SidebarMsg }
  | { type: 'backgroundClick' }

export const Dashboard = component<State, Msg, Effect>({
  init: () => [{ toolbar: { menuOpen: false }, sidebar: { openSectionId: null }, tools: defaultTools }, []],

  update: (state, msg) => {
    switch (msg.type) {
      case 'toolbar':
        return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]
      case 'sidebar':
        return [{ ...state, sidebar: sidebarUpdate(state.sidebar, msg.msg) }, []]
      case 'backgroundClick':
        // Parent directly controls child state — no message routing needed.
        return [{ ...state, toolbar: { ...state.toolbar, menuOpen: false } }, []]
    }
  },

  view: (state, send) =>
    div({ onClick: () => send({ type: 'backgroundClick' }) }, [
      toolbarView({ tools: s => s.tools, toolbar: s => s.toolbar }, msg => send({ type: 'toolbar', msg })),
      sidebarView({ sidebar: s => s.sidebar }, msg => send({ type: 'sidebar', msg })),
    ]),
})
```

No `child()` call, no `PropsWatcher`, no `propsMsg`, no `onMsg`. The parent's `Msg` union namespaces child messages: `{ type: 'toolbar'; msg: ToolbarMsg }`. The compiler traces depth-2 paths through the slices (`s.toolbar.menuOpen`). A human reviewer sees every possible state transition in one flat `update()` switch. An LLM generates this mechanically from the types. View functions use the `(props, send)` convention: a typed props object as the first argument (generic over the parent's state `<S>`), and `send` as the second. This mirrors the `view(state, send)` signature on components and makes every call site self-documenting — named fields eliminate positional ambiguity.

**When to use Level 1:** Always, unless one of the Level 2 criteria applies. Most LLui applications should never use `child()`.

### Level 2 — Isolated Components (Opt-in)

Use `child()` when:
- The child has 32+ state paths of its own (parent bitmask would overflow)
- The child is a library component with encapsulated internals (DataTable, RichTextEditor)
- The child manages its own effect lifecycle (WebSocket connection, timer management)

```typescript
// data-table.ts — a library component
type Props = { rows: Row[]; columns: Column[] }
type State = { rows: Row[]; columns: Column[]; sortBy: string | null; page: number }
type Msg =
  | { type: 'propsChanged'; props: Props }
  | { type: 'sort'; column: string }
  | { type: 'nextPage' }
  | { type: 'prevPage' }

export const DataTable = component<State, Msg, Effect>({
  init: (props: Props) => [{
    rows: props.rows, columns: props.columns,
    sortBy: null, page: 0,
  }, []],

  propsMsg: (props: Props): Msg => ({ type: 'propsChanged', props }),

  receives: {
    scrollToRow: (params: { id: string }) => ({ type: 'scrollTo' as const, id: params.id }),
  },

  update: (state, msg) => {
    switch (msg.type) {
      case 'propsChanged':
        return [{ ...state, rows: msg.props.rows, columns: msg.props.columns, page: 0 }, []]
      case 'sort':
        return [{ ...state, sortBy: msg.column, page: 0 }, []]
      case 'nextPage':
        return [{ ...state, page: state.page + 1 }, []]
      case 'prevPage':
        return [{ ...state, page: Math.max(0, state.page - 1) }, []]
    }
  },

  view: (state, send) => { /* ... */ },
})

// Typed effect builder — derived from the component definition.
export const toDataTable = DataTable.address
// toDataTable.scrollToRow({ id: '123' }) → typed AddressedEffect
```

The parent mounts it:

```typescript
// In the parent's view():
child({
  def: DataTable,
  key: 'table',
  props: s => ({ rows: s.filteredRows, columns: s.columns }),
  onMsg: msg => msg.type === 'rowSelected' ? { type: 'selectRow', id: msg.id } : null,
})

// In the parent's update(), for imperative commands:
import { toDataTable } from './data-table'
case 'jumpToRow':
  return [state, [toDataTable.scrollToRow({ id: msg.id })]]
```

**`propsMsg` mechanism:** The props accessor has a bitmask derived from its state dependencies. The runtime uses a three-step process to decide whether to fire `propsMsg`: (1) it checks the bitmask first — if no relevant parent state paths changed, the props accessor is not called at all; (2) when the bitmask matches, the runtime calls the accessor, then compares each field of the returned object via `Object.is` with the previous props; (3) only if at least one field changed does `propsMsg(newProps)` fire, enqueuing the result into the child's message queue. The child's `update()` handles it like any other message — full control over how to merge new props into state (reset pagination, preserve sort, etc.). No separate props type in view, no separate dirty mask, no `onPropsChanged` hook. It's just a message.

**Typed addressed effects:** The `receives` map on the component definition declares what commands the component accepts, with typed parameters. The framework derives a typed `address` builder (`DataTable.address`), exported as `toDataTable`. The sender imports it and gets full autocomplete and compile-time type checking. Invalid handler names or mismatched parameters are caught at compile time.

### LLM-First Boilerplate

TEA's explicit message types are a feature, not a cost, in LLM-first development. The `Msg` union is the complete menu of valid transitions. The `update()` switch is a mechanical enumeration. The LLM never decides "should this be a hook, a ref, a callback, or state?" — the answer is always "a message."

For forms with many fields, the idiomatic pattern uses a generic `setField` message to avoid per-field boilerplate:

```typescript
type Msg =
  | { type: 'setField'; field: keyof FormFields; value: string }
  | { type: 'submit' }
  | { type: 'submitSuccess'; data: Response }
  | { type: 'submitError'; error: string }
```

The reviewer sees 4 cases, not 13. The `setField` case is mechanical. The interesting logic is in `submit`, `submitSuccess`, `submitError`. The LLM system prompt should prescribe this pattern for forms.

---

## What Adds Value

**Surgical DOM updates without a virtual DOM.** The two-phase update with bitmask gating means the cost of an update scales with what changed, not with the size of the component tree. A message that changes one field touches only bindings whose mask includes that field's bit. A counter with fifty bindings to fields other than `count` pays zero binding-evaluation cost when `count` changes. This is not a heuristic or a diff optimisation — it is a static guarantee expressed in integers.

**Compile-time dependency tracking with path-level granularity.** The Vite plugin's TypeScript AST walk extracts access paths from accessor bodies — direct property access (`s.fieldName`, `s['fieldName']`), destructuring patterns (`const { count, title } = s`), single-assignment aliases (`const c = s.count`), and nested property chains up to depth 2 (`s.user.name`). Each unique path is assigned a bit, per-binding masks are computed, and `__dirty` is synthesized. The developer writes `(s: State) => s.user.name` and gets correct granularity for free — a change to `s.user.email` will not trigger re-evaluation. The fallback when the component is uncompiled or props are dirty is `0xFFFFFFFF` — all bindings run, nothing breaks, it degrades gracefully to the same behavior as a naively implemented fine-grained reactive system. When the compiler cannot determine which paths an accessor reads (computed property access, multi-hop aliases, closure-captured variables), it emits a diagnostic warning identifying the exact accessor and the reason for the bail-out, then assigns the conservative `0xFFFFFFFF` mask.

**Effects as data, tested in isolation.** Because `update()` returns effect descriptions rather than executing side effects, the entire business logic of a component is a pure function. The `@llui/test` package provides `testComponent()` to wrap a component definition with a test harness that calls `update()` and accumulates effects, and `assertEffects()` for structural matching of effect trees (including nested `cancel`/`debounce`/`http` compositions). `propertyTest()` fuzzes arbitrary message sequences against developer-defined invariants, catching edge cases that hand-written tests miss. The async loading pattern — optimistic update, http effect, rollback on error — is fully testable without a browser, a fetch mock, or a DOM.

```ts
// testComponent wraps update() with send/state/effects tracking.
import { testComponent, assertEffects } from '@llui/test'
const t = testComponent(MyComponent)
t.send({ type: 'fetch' })
expect(t.state.phase).toBe('loading')
assertEffects(t.effects, [{ type: 'http', url: '/api/data' }])
```

**Scope-managed lifetimes.** Every resource that has a lifetime — binding, listener, onMount callback, portal, child component — is owned by a scope. Disposing a scope is a complete cleanup: no leaks, no stale listeners, no zombie child components. This is especially valuable for structural primitives: when `branch` swaps arms, the leaving scope's disposal fires immediately, before the entering arm's builder runs.

**`memo()` for shared derived state.** The `memo` helper memoizes an accessor using a two-level cache. First, the bitmask check gates evaluation: if no relevant state paths changed (per the accessor's dirty mask), the cached result is returned without calling the accessor. Second, when the accessor does re-run, `memo` compares its return value via `Object.is` with the previous result — if the output is identical despite input changes, downstream bindings skip their updates. This two-level strategy (bitmask fast path + output stability) ensures one computation per update cycle regardless of how many consumers reference the memoized value. The todo list example uses `memo(filteredTodos)` and passes the result to both `each()` and the count `text()`: one computation per update cycle, however many consumers reference it.

**Per-item stability optimization in `each`.** The `each()` render callback receives a **scoped accessor** `item` — a function `<R>(selector: (t: T) => R) => Binding<R>` — rather than the item value directly. The `item` accessor returns a reactive binding, not a resolved value. `item(t => t.name)` produces a zero-argument closure that the runtime evaluates during Phase 2, enabling per-item dirty checking. Bindings created via `item(t => t.title)` are tagged `perItem: true`. When `updateEach` detects that an entry's item reference is unchanged (`Object.is(existing.item, item)`), it sets `eachItemStable = true` on the entry's scope. Phase 2 checks `binding.perItem && binding.ownerScope.eachItemStable` and skips the binding entirely. A list update that appends one item does no work for the unchanged rows' per-item bindings. The scoped accessor pattern mirrors the component-level `s => s.field` pattern — `item(t => t.title)` reads like the item-level equivalent of `text(s => s.title)` — making the reactive intent unambiguous without requiring closure-calling syntax like `getItem().title`.

**`onMount` with implicit cancellation.** Focus management, third-party library initialization, and layout measurements all require the DOM to be live. `onMount` fires asynchronously after insertion. The cancellation-by-scope-disposal pattern correctly handles transient views — a branch arm that opens and closes within one update cycle will have its `onMount` silently dropped.

**`portal` as a first-class primitive.** Portal nodes are rendered out-of-tree (to `document.body` or any other target) but bindings inside the portal participate in the same update cycle as the rest of the component. Portals are disposed when their owning scope is disposed. There is no separate subscription, no cross-component event bus, and no manual cleanup.

**Typed addressed effects for inter-component messaging.** When isolated components (Level 2) need to communicate without a shared parent, the sender imports the target's typed `address` builder. The target component declares its `receives` handlers with typed parameter signatures; the framework derives a type-safe effect builder from them. Calling `toDetailView.selectItem({ id: '123' })` produces a fully typed `AddressedEffect` — the compiler verifies the target exists, the handler name is valid, and the parameters match. The sender has an import dependency on the target, which makes the coupling explicit and discoverable. The effect router resolves the target key against the global component registry at dispatch time. This is the correct abstraction for cross-cutting concerns like a toast manager, a global loading indicator, or a shared modal controller.

---

## What to Avoid

**Mutating state inside `update()`.** LLui's entire update optimization — bitmask computation, `Object.is` comparisons, `memo` caching — depends on state immutability. If `update()` mutates the existing state object and returns it, `__dirty` will see `Object.is(o.field, n.field) === true` for every field (because `o` and `n` are the same object), compute a dirty mask of zero, and skip every binding. The component will appear frozen. Always return a new state: `return [{ ...state, count: state.count + 1 }, []]`.

**Calling `view()` primitives outside `view()`.** The render context is a module-level singleton set up by `withRenderContext` during the one-shot `view()` call. Calling `text()`, `branch()`, `each()`, `onMount()`, etc. outside this window throws a `NO_RENDER_CONTEXT` error. There is no equivalent of React's hooks dependency array to defer effects — side-effectful view work that needs to happen after mount belongs in `onMount`.

**Storing DOM references across re-renders.** Because `view()` runs once, the DOM nodes it returns are stable for the component's lifetime — *except* inside `branch` and `each` subtrees. Nodes inside a branch arm are created fresh when the arm activates and destroyed when it deactivates. Holding a reference to such a node past the arm's lifetime is a leak and a logic error. If you need a stable reference, hoist the node outside the structural primitive or use `onMount` within the arm's builder.

**Using `branch` keys that change identity on every render.** `branch` uses `Object.is(newKey, currentKey)` to detect arm changes. If the discriminant accessor returns a new object or string on every call even when logically equal, every update triggers a full DOM tear-down and rebuild. Discriminants should return primitive values (`string | number | boolean`), which is what the type signature enforces.

**Reading DOM immediately after `send()` without `flush()`.** Because `send()` enqueues a message and defers the update cycle to a microtask, the DOM is not yet updated when `send()` returns. Code that calls `send({ type: 'show' })` and then immediately reads `element.offsetHeight` will see the pre-update value. Use `flush()` after `send()` when imperative DOM reads depend on the updated state. This is the only case where `flush()` is needed in application code — in normal reactive flows, the microtask batching handles everything automatically.

**Circular addressed effects.** Because addressed effects dispatch into the target's `send()`, which queues a microtask, cycles are not infinite loops — but they can produce difficult-to-trace message chains. Two components sending addressed effects at each other in response to the same user action will process in two microtask turns, which is often acceptable, but the causal chain is non-obvious. Prefer Level 1 composition (view functions with a shared parent state) for tight coordination. Level 2 addressed effects are for loosely-coupled cross-cutting concerns.

**Using `.map()` on state arrays in `view()`.** Because `view()` runs once at mount time, `state.items.map(item => div(...))` creates DOM nodes from the initial array and never updates them. If the array changes, the nodes are stale. Always use `each({ items, key, render })` for arrays that come from state. `.map()` is only valid for truly static arrays (constants, hardcoded lists) that never change for the component's lifetime.

**Using `child()` when a view function suffices.** `child()` creates a full component boundary with its own bitmask, scope tree, and update cycle. For most composition, a view function (Level 1) is simpler, has no overhead, and lets the parent own the state directly. Use `child()` only when you need bitmask isolation (32+ child state paths), encapsulated internals (library components), or independent effect lifecycle.

**Registering `onMsg` handlers that produce messages unconditionally.** The `onMsg` callback on a `child()` call is invoked after every `update()` in the child, whether or not the parent cares. If `onMsg` returns a non-null message for messages the parent doesn't need, the parent processes unnecessary updates. Return `null` for messages the parent should ignore.

**Large component trees as a single component.** LLui's update cost is proportional to the number of bindings in a component times the cost of the bitmask check. A monolithic component with thousands of bindings will pay a linear scan on every update even with aggressive masking. When the compiler warns about 63+ access paths, split independent subsections into `child()` components (Level 2). The overhead of `child()` is a single `propsMsg` check per parent update, which is cheaper than the binding scan for most real cases.

**Using `innerHTML` bindings for user-supplied content.** The `PROP_KEYS` set in the transform includes `innerHTML`, making it a valid reactive prop. This is correct for template-authored content but is an XSS vector for user-supplied strings. It exists for completeness; use `text()` for user content and reserve `innerHTML` for pre-sanitized or developer-authored markup.

---

## What Seems Valuable But Isn't

**A fine-grained reactive signal layer inside state.** Because LLui already computes dirty bitmasks at compile time, adding a signal graph (MobX-style observable fields) would be redundant. The bitmask is strictly cheaper for the common case — a flat-ish state object with well-typed fields — and requires no subscription bookkeeping. Signal systems (Solid, Preact Signals) track dependencies lazily during effect execution, which is efficient for deep trees but adds per-read bookkeeping during reactive scope evaluation. LLui pays nothing at read time and O(n bindings with matching masks) at write time. The bitmask approach trades flexibility (depth-2 ceiling, flat state bias) for lower constant overhead in the common case.

**Memoizing `update()` or skipping it when state reference is unchanged.** `update()` is a pure function that takes the previous state and returns a new one. If the message doesn't change state, `update()` should return the same reference: `return [state, []]`. The update loop detects `Object.is(oldState, newState)` and can short-circuit before Phase 1 and Phase 2. There is no value in caching `update()` at the call site; the correct response to a no-op update is `return [state, []]`.

**A JSX transform.** The Vite plugin already does what a JSX transform does — it rewrites `div({ class: 'foo' }, [...])` calls to `elSplit(...)` with separated static, event, and reactive concerns. JSX would require an additional parse step, a custom pragma, and would obscure the fact that LLui's element helpers are regular function calls that can be used imperatively. The `view()` model is already JavaScript; the plugin works on TypeScript AST, not a separate syntax layer.

**A virtual DOM for structural reconciliation.** The `each` reconciler does keyed diffing with several fast paths: same reference → skip everything; no reordering + only appends → single fragment insert; exactly two entries swapped → two targeted moves; otherwise → full fragment rebuild. This covers the realistic distribution of list mutations without the overhead of virtual node allocation, diffing two trees, and patching. The real-DOM reconciler is both faster in the common case and simpler to reason about.

**Subscriptions as a first-class effect type.** Elm has a `Sub` mechanism for external event sources (WebSocket messages, timer ticks, keyboard events). LLui handles these through the `onEffect` handler: a custom effect `{ type: 'ws:subscribe'; topic: string }` is defined in the component's `Effect` union and handled in the `.else()` callback of the `handleEffects` chain. The handler opens a WebSocket, pipes messages back via `send()`, and uses the `AbortSignal` to clean up on unmount. The pattern is slightly more verbose than Elm's `Sub` but gives the developer full control over connection lifecycle, reconnection strategy, and message parsing — all outside the pure update loop where they can use async/await and imperative patterns naturally.

**Component-level shouldUpdate guards.** React's `shouldComponentUpdate` / `memo` exist because re-rendering is expensive and you need an escape hatch. In LLui, the bitmask eliminates the need. A component only pays for bindings whose masks overlap the dirty field set. There is no "re-render" to prevent because there is no render function to suppress — Phase 2 is already a filtered iteration.

---

## Design Decisions (Resolved)

**Bitmask width: resolved via tiered masks and path-level tracking (depth 2 for v1).** The compiler uses a tiered strategy — single word for ≤31 unique access paths, two words for 32–62 paths, and a compiler warning for 63+ paths recommending decomposition into child components. Path-level tracking (assigning bits to `s.user.name` and `s.user.email` separately rather than a single bit for `s.user`) means the bit budget tracks independent change dimensions, not just top-level field count. A component with a state shape `{ user: { name, email, avatar }, settings: { theme, lang }, todos: Todo[], filter: string }` uses 7 bits (3 for user sub-fields, 2 for settings sub-fields, 1 for todos, 1 for filter), well within the single-word capacity, even though it has nested objects. Arrays remain single-bit because per-index tracking is not statically resolvable; `eachItemStable` provides the per-item granularity. Depth-2 path tracking is the v1 ceiling. Accessors that read deeper than depth 2 (e.g., `s.user.address.city`) trigger a compiler warning identifying the exact accessor and recommending either flattening the state shape or wrapping the accessor in `memo()`. The compiler assigns the conservative `0xFFFFFFFF` mask for that accessor. Configurable depth is deferred — depth 2 covers the vast majority of real-world state shapes, and the bail-out path is safe (overly broad mask, not silent stale values).

**Animated transitions: resolved — `TransitionOptions` with coordinated enter/leave via `onTransition`.** The `TransitionOptions` API provides two levels. The simple level: `enter(nodes)` fires immediately after DOM insertion, `leave(nodes)` fires before removal and defers removal until the returned Promise resolves. This handles CSS class-based transitions and is the common case. The coordinated level: `onTransition({ entering, leaving, parent })` receives both entering and leaving node sets simultaneously in the same cycle. This enables FLIP animations — the handler reads leaving nodes' layout positions (`getBoundingClientRect`), inserts entering nodes, reads their new positions, and animates the delta. `onTransition` composes with `enter`/`leave` when both are specified: `onTransition` fires first (for FLIP position capture and layout animation), then `enter` and `leave` fire for their respective elements (for per-element CSS transitions like fades or slides). The `leaving` nodes remain in the DOM until the returned Promise resolves, at which point `disposeScope` removes them. The `entering` nodes are already inserted but may be styled with `opacity: 0` or `transform` offsets that the animation resolves. Both `branch` and `each` support `TransitionOptions`; `show` inherits it through `branch`. The FLIP calculation runs synchronously before the browser paints (it fires inside the update cycle, before yielding to the microtask boundary), ensuring no visible flash of unstyled content.

**Server-side rendering: resolved — compiler-driven static HTML emission for v1.** `view()` calls `document.createElement` directly and cannot run on the server. Instead of abstracting the DOM (which would add runtime cost to client-side rendering), the Vite plugin emits a parallel `__renderToString(state)` function at compile time for each component. The compiler already knows the full view tree structure, which props are static, and which are reactive. For static subtrees, it emits literal HTML strings. For reactive bindings, it evaluates the accessor against the provided state and interpolates the result. Structural primitives (`branch`, `each`, `show`) are evaluated eagerly: the compiler emits the branch arm or list items that match the initial state. The output is a plain HTML string with `data-llui-hydrate` markers on nodes that have reactive bindings or structural primitives. On the client, `hydrateApp()` walks the existing DOM, attaches bindings to the marked nodes, and registers structural blocks — without recreating any DOM nodes. The hydration path reuses the same bitmask infrastructure; the `__dirty` function is the same. Mismatches between server HTML and client hydration (different state at hydration time) are handled by falling back to full client render for the affected subtree, with a development-mode console warning identifying the mismatch. `__renderToString` is tree-shakeable from client bundles (it is only imported by the server entry point).

**Typed addressed effects: resolved.** Components declare `receives` handlers with fully typed parameter signatures. The framework derives a typed `address` builder from the component definition. The sender imports the builder (`import { toDetailView } from './detail-view'`) and gets full autocomplete and compile-time type checking: `toDetailView.selectItem({ id: '123' })`. Invalid handler names or mismatched parameter types are caught at compile time. The import dependency makes the coupling explicit and discoverable by both LLMs and human reviewers.

**Recursive `each` for tree views: resolved — nested `each` with transparent scope optimization.** Nested `each` calls work today: a `renderItem` callback may itself call `each({ items: ..., key: ..., render: ... })` inside a `show` for expanded/collapsed state. Previously, each nesting level registered its structural blocks in the parent component's flat `structuralBlocks` list, making Phase 1 iteration `O(total visible nodes)` even when only a leaf changed. The v1 optimization: the runtime detects when an `each` is created inside another `each`'s render callback and registers its structural blocks with the parent `each`'s scope rather than the component's flat list. This creates a tree of scopes mirroring the data tree. When a node's children change, only that subtree's structural blocks are reconciled — sibling subtrees are untouched. The reconciliation algorithm at each level uses the same keyed-diff fast paths as flat `each` (append-only, single swap, full rebuild). No new primitive (`eachTree`) is needed — the optimization is transparent to the developer. The API surface stays the same: developers write nested `each` + `show` as they do today, and the runtime handles hierarchical scoping automatically.

**Effect composition and consumption: resolved via `@llui/effects`.** The core runtime handles only `delay` and `log` directly. The `@llui/effects` package provides two things: (1) composable effect description builders — `http(opts)`, `cancel(token)` / `cancel(token, effect)`, `debounce(key, ms, effect)`, `sequence([...effects])`, `race([...effects])` — which are pure data objects that `update()` returns, and (2) `handleEffects<Effect>()`, a chain that interprets those effect descriptions at runtime in `onEffect`. The chain tracks cancellation tokens and debounce timers in a per-component closure, uses the `AbortSignal` (third argument to `onEffect`) for cleanup on unmount, and passes unrecognized effects to `.else()` where the developer handles custom types. TypeScript narrows the `.else()` callback to only the custom effect variants, providing exhaustiveness checking.

`cancel` has two forms: `cancel(token, inner)` cancels any in-flight effect with the same token and dispatches `inner` as its replacement. `cancel(token)` (no inner) cancels only — it aborts the in-flight request, clears any pending debounce timer sharing that token, and discards pending sequence/race entries, without starting anything new. The token is the universal handle for a logical operation; `cancel('search')` clears everything associated with the `'search'` token regardless of whether it's an HTTP request, a debounced timer, or a composed sequence.

The generation-counter workaround for cancellation is no longer needed: `cancel('search', http({ url, onSuccess, onError }))` replaces it with a one-liner. The package is tree-shakeable and versioned independently from the core runtime.

**DevTools integration: resolved — `@llui/devtools` hook with per-transition recording.** The runtime exposes a `__lluiDevTools` global hook point. When the DevTools extension is connected, `processMessages` emits a `{ component, oldState, msg, newState, effects, dirtyMask, timestamp }` record for each individual `update()` call — not per flush, per message. A burst of 5 `send()` calls that coalesce into one DOM update produces 5 transition records followed by one `{ type: 'flush', dirtyMask: combinedMask }` record. This gives the DevTools time-travel per-message granularity while showing the user which messages were batched into a single DOM write.

The DevTools panel displays: (1) a message log with expandable state diffs per transition, (2) a component tree with live state inspection, (3) effect tracking — which effects were dispatched, which are in-flight, which were cancelled, (4) a time-travel slider that replays transitions by re-running `update()` from `init` through message N and calling `flush()` to update the DOM. The `replayTrace()` function and the `LluiTrace` type live in the core `llui/trace` module (not in `@llui/test`), making them the shared contract between DevTools and the test harness. The DevTools can export any session as a trace file; `@llui/test` re-exports `replayTrace()` for convenience. Both packages import the same format — no coupling between them.

The hook is inert when DevTools are not connected — no allocation, no recording, no performance impact. The check is a single `if (window.__lluiDevTools)` guard at the top of `processMessages`. The `@llui/devtools` package (browser extension + panel) is versioned independently from the core runtime.

**LLM Debug Protocol: resolved — `window.__lluiDebug` API + `@llui/mcp` server (v1 scope).** The dev runtime exposes a `window.__lluiDebug` API that gives LLM agents direct access to the TEA state machine: read state, send typed messages, inspect effects, replay traces, dry-run `update()` calls (`evalUpdate`), validate messages against the component's `Msg` type (`validateMessage`), and explain binding re-evaluations (`whyDidUpdate`). This is architecturally distinct from DOM-level debugging — the LLM operates on the state machine directly, not on its DOM projection. The `@llui/mcp` package wraps this API as an MCP server, connected to the Vite dev server via a `llui:debug` WebSocket channel, exposing native tools like `llui_get_state`, `llui_send_message`, `llui_eval_update`, and `llui_replay_trace`. Both layers are dev-only (tree-shaken in production, zero bundle cost). The debug API shares infrastructure with the DevTools hook — both consume the same per-transition records from `processMessages` and the same `LluiTrace` format from `llui/trace`. The full protocol specification, including type contracts and MCP tool schemas, is in 07 LLM Friendliness §10.

**Server framework: resolved — Vike via `@llui/vike` adapter.** Vike is a Vite-based server framework designed for "build your own framework" integration. The `@llui/vike` package configures two hooks: `onRenderHtml` calls `__renderToString(state)` for SSR, and `onRenderClient` calls `hydrateApp()` or `mountApp()` depending on `isHydration`. Vike provides filesystem routing, data loading (`+data.ts`), pre-rendering (SSG), and deployment adapters. LLui's Vite plugin and Vike's Vite plugin compose without conflict. See 08 Ecosystem Integration §2 for the full specification.

**Third-party component embedding: resolved — `foreign()` primitive with typed imperative bridge.** Complex imperative components (ProseMirror, Monaco, Lexical, CodeMirror, MapboxGL, D3 visualizations) manage their own internal state, DOM, and event loops. They are fundamentally incompatible with LLui's declarative binding model — you cannot express a ProseMirror editor as a pure function of state. The `foreign()` primitive creates an explicit, typed handoff boundary: LLui creates and owns a container element, the library owns everything inside it, and a typed bridge synchronizes state in both directions.

```typescript
function foreign<S, T extends Record<string, unknown>, Instance>(opts: {
  /** Create the third-party instance. Runs once at mount time. */
  mount: (container: HTMLElement, send: (msg: Msg) => void) => Instance;
  /** Accessor for the state slice relevant to this foreign component.
   *  Participates in bitmask tracking — sync only fires when props change. */
  props: (s: S) => T;
  /** Push state changes to the imperative instance.
   *  Function form: called with full props and prev on any change.
   *  Record form: per-field handlers, each called only when that field changes. */
  sync:
    | ((instance: Instance, props: T, prev: T | undefined) => void)
    | { [K in keyof T]?: (instance: Instance, value: T[K], prev: T[K] | undefined) => void };
  /** Clean up the instance. Runs when the owning scope is disposed. */
  destroy: (instance: Instance) => void;
  /** Optional container configuration. Defaults to a plain div. */
  container?: { tag?: string; attrs?: Record<string, string> };
}): Node[];
```

The three generic parameters are fully inferred and type-checked:
- `S` — parent state type (inferred from the component context)
- `T` — the props type (inferred from the `props` accessor return type, constrained to `Record<string, unknown>`)
- `Instance` — the third-party instance type (inferred from `mount`'s return type)

If the developer writes `mount: (el, send) => new EditorView(el, config)`, TypeScript infers `Instance = EditorView`. The `sync` and `destroy` functions must accept `EditorView` — a type mismatch is a compile error. The `props` accessor return type flows into `sync`'s type — if `props` returns `{ readonly: boolean, theme: string }`, both sync forms are type-checked against those exact fields.

**`sync` has two forms.** The function form receives the full props object and previous props — the developer diffs manually. The record form maps each field to its own handler — the runtime diffs per-field and dispatches only changed fields:

```typescript
// Function form — manual diffing, full control
sync: (editor, props, prev) => {
  if (!prev || props.readonly !== prev.readonly)
    editor.setProps({ editable: () => !props.readonly })
  if (!prev || props.theme !== prev.theme)
    editor.setTheme(props.theme)
}

// Record form — runtime diffs per-field, each handler fires independently
sync: {
  readonly: (editor, val) => editor.setProps({ editable: () => !val }),
  theme: (editor, val) => editor.setTheme(val),
}
```

The function form is appropriate when fields interact (e.g., setting `readonly` and `theme` together in a single `updateOptions` call). The record form is appropriate when each field maps cleanly to a single imperative API call — which is the common case for libraries like Monaco, MapboxGL, and CodeMirror.

**Runtime behavior of record sync.** When `sync` is a record, the runtime calls the `props` accessor, shallow-diffs each key of the result against the previous props object (using `Object.is`), and for each key where the value changed, calls `sync[key](instance, newValue, prevValue)`. Keys not present in the `sync` record are ignored — the developer can track fields that are read by the library without writing a handler. On the first call after mount (where `prev` is `undefined`), all handlers fire with `prev` as `undefined`.

**Source of truth semantics.** The critical design principle for `foreign()` is that the foreign library often owns its own content state. A ProseMirror editor's document state lives inside ProseMirror, not in LLui state. The LLui state may hold a *snapshot* of the content (for persistence, validation, or derived computations), but the editor is authoritative during active editing. This means the `sync` flow is asymmetric:

- **LLui → library** (via `sync`): configuration changes — readonly flag, theme, language mode, external cursor position. These are *metadata*, not content.
- **Library → LLui** (via `send` in `mount`): content changes — the editor dispatches messages when the user types, selects, or formats text. These become `Msg` values in the parent component's `update()`.

Content is typically NOT pushed from LLui → library during active editing. If external state forces a content reset (e.g., loading a new document), the `sync` function handles it explicitly — the developer checks whether the content actually changed from an external source vs. from the editor itself.

**Runtime behavior.** `foreign()` creates a container element (default: `<div>`) and registers it with the current scope. On mount, it calls `mount(container, send)` and stores the returned instance. The `props` accessor is registered as a binding with a mask derived by the compiler — it participates in the same bitmask dirty-tracking as any other binding. When the mask matches and the accessor's result differs from the previous value (by shallow equality), the runtime calls `sync(instance, newProps, prevProps)`. On scope disposal (the `foreign()` node leaves the DOM), the runtime calls `destroy(instance)`, then removes the container from the DOM.

**No transitions on `foreign()` itself.** The foreign component manages its own DOM, so LLui's `enter`/`leave`/`onTransition` don't apply to its internals. To animate the container's appearance, wrap `foreign()` in `show({ when, render: (_s, _send) => foreign(...), enter, leave })`. The container element receives the CSS classes; the library inside is unaware.

**No Phase 2 bindings inside the container.** LLui does not walk the foreign component's DOM subtree during Phase 2. No bindings, no structural blocks, no scope children exist inside the container. The container is an opaque boundary — the only communication is through `sync` (LLui → library) and `send` (library → LLui). This is enforced at the type level: `mount`'s `container` parameter is a plain `HTMLElement`, not a LLui render context. Calling `text()`, `div()`, `each()`, etc. inside `mount` would throw `NO_RENDER_CONTEXT`.

**Error handling.** If `mount` throws, `errorBoundary` catches it (zone 1 — view construction). If `sync` throws, it is caught per-binding (zone 2). If `destroy` throws, the error is logged but disposal continues — partial cleanup is better than a leaked instance. The `send` callback is the same `send` as the parent component's; messages dispatched from the foreign library enter the normal message queue and are processed by `update()`.

**Error boundary propagation: resolved — three protection zones with explicit boundaries.** `errorBoundary` protects three distinct zones:

(1) **View construction errors.** If a builder function (inside `branch`, `each`, `show`, or the initial `view()` call) throws during scope creation, `errorBoundary` catches it, disposes the partially-created scope, and renders the fallback subtree. This is synchronous and fully protected — the DOM is never left in an intermediate state because the builder runs inside a try/catch before any nodes are inserted.

(2) **Binding evaluation errors (Phase 2).** If an accessor `(s: S) => T` throws during `applyBinding`, `errorBoundary` catches it for all bindings within its scope. The binding's `lastValue` is not updated, so the DOM retains its previous value. The error is reported to the boundary's `onError` callback with the binding location. Phase 2 continues for bindings outside the boundary's scope — one failing binding does not halt the entire update cycle.

(3) **Effect handler errors.** If `onEffect` (or a handler inside the `handleEffects` chain) throws, the error is caught by the nearest `errorBoundary` in the throwing component's scope chain. The effect is considered failed — no retry, no partial execution. The boundary's `onError` callback receives the effect object and the error, giving the developer enough information to dispatch a recovery message.

**What is NOT protected:** `update()` is a pure function and must not throw. If it does, the error propagates to `processMessages`, which logs it and drops the message. This is intentional — a throwing `update()` is a bug, not a recoverable error. The framework does not wrap `update()` in a try/catch per message because a throwing `update()` is a programmer error (a bug in a pure function), not a recoverable runtime condition — wrapping it in try/catch would mask bugs. Instead, `errorBoundary` catches errors that propagate from `update()` at the component boundary level. If `update()` needs to signal an error condition, it returns an error state and an effect — it does not throw.

**State serialization constraint: state must be JSON-serializable.** Multiple features depend on state being serializable: `replayTrace()` serializes state snapshots to JSON, the DevTools hook records state diffs as JSON, the LLM debug protocol exposes state via `window.__lluiDebug.getState()` and `llui_get_state`, SSR's `__renderToString()` evaluates accessors against a state object that was deserialized from the server, and HMR preserves state across file changes by keeping the plain object reference. If state contains non-serializable values — `Map`, `Set`, `Date`, class instances, functions, `Symbol` keys, circular references, `undefined` values (dropped by `JSON.stringify`) — these features fail silently or produce incorrect results.

The constraint: state (`S`) must be a plain object tree composed of JSON-compatible types: `string`, `number`, `boolean`, `null`, arrays, and nested plain objects. This is the same constraint Elm enforces on its `Model` type. It does not limit expressiveness — a `Map<string, T>` is `Record<string, T>`, a `Set<T>` is `T[]` with uniqueness enforced in `update()`, a `Date` is an ISO string or a Unix timestamp number.

The compiler emits a diagnostic warning when it detects non-serializable patterns in `init()` return values or `update()` return values: `new Map()`, `new Set()`, `new Date()`, class constructors, or function expressions assigned to state fields. The detection is syntactic (pattern-matching on `NewExpression` and `ArrowFunctionExpression` in state-producing positions) and conservative — it catches the obvious cases but cannot detect non-serializable values injected through function calls or imports. The warning message includes the specific field and a suggested serializable alternative.

**Compile-time accessibility diagnostics: five checks.** The compiler detects common accessibility violations at build time through five diagnostics (warnings, not errors — see 02 Compiler.md for the authoritative specification): (1) `<img>` without `alt` attribute, (2) interactive elements (`button`, `a`) without an accessible name (text content or `aria-label`), (3) `onClick` on a non-interactive element without `role` and `tabIndex`, (4) form `input`/`textarea`/`select` without label association (`id` + `<label for>` or `aria-label`), and (5) reactive value binding on a controlled input without a corresponding `onInput` handler. Check (5) is also a correctness diagnostic — without `onInput`, the binding overwrites user keystrokes. These checks are per-element, per-file; cross-element analysis (e.g., matching `<label for>` to `<input id>`) is not performed because structural primitives build subtrees at runtime. The full specification and error message formats are in 02 Compiler.md.

---

**Routing: state-driven, mechanism-agnostic.** LLui does not ship a router. The framework's architecture makes routing a natural consequence of the state model: the current route is a field in state, URL changes map to messages, and `branch()` renders the active route's view. Different applications need different routing mechanisms (hash-based, history API, static generation, SSR with server-provided routes), so the framework provides the primitives without prescribing a specific router.

The canonical pattern:

```typescript
type Route = 'home' | 'about' | 'users' | 'userDetail'

type State = {
  route: Route
  routeParams: Record<string, string>  // e.g., { id: '123' } for /users/123
  // ... per-route state slices
}

type Msg =
  | { type: 'navigate'; route: Route; params?: Record<string, string> }
  | { type: 'popstate'; route: Route; params?: Record<string, string> }
  // ... per-route messages

// In update():
case 'navigate':
  return [
    { ...state, route: msg.route, routeParams: msg.params ?? {} },
    [{ type: 'pushUrl', url: routeToUrl(msg.route, msg.params) }],
  ]
case 'popstate':
  return [{ ...state, route: msg.route, routeParams: msg.params ?? {} }, []]
```

The URL is an *effect*, not state. `update()` returns a `pushUrl` effect; the effect handler calls `history.pushState()`. The browser's `popstate` event is captured in `onMount` and dispatched as a `popstate` message. This keeps URL manipulation outside `update()` while keeping route state fully in the TEA cycle.

Route rendering is `branch()`:

```typescript
branch({ on: s => s.route, cases: {
  home: () => homeView(homeProps, send),
  about: () => aboutView(aboutProps, send),
  users: () => usersView(usersProps, send),
  userDetail: () => userDetailView(userDetailProps, send),
}})
```

The compiler's exhaustive `branch()` diagnostic ensures all routes are handled. Code splitting for inactive `branch()` cases is an open compiler optimization (see 02 Compiler.md — "Code splitting for `branch()` cases"): the compiler could emit dynamic imports for cases that are not active at initial load. The mechanism for this — how a synchronous case builder integrates with an async `import()` — requires framework-level support for lazy case loading, which is not yet specified. Route transitions use `onTransition` on the `branch()` for page-level animations.

**The framework does not prescribe how URLs map to routes.** A simple app uses `switch` on `location.pathname`. A complex app uses a URL pattern library (`URLPattern`, `path-to-regexp`). An SSR app receives the initial route from the server. The `navigate` / `popstate` message pattern works with all of these — only the URL→Route parsing logic changes.

---

## Expressibility Catalogue

**Counter.** The canonical pattern: `State = { count: number }`, `Msg = Increment | Decrement | Reset`. `update()` returns a new state each time; the compiler assigns `count` bit 1. The text binding `text((s) => String(s.count))` gets mask `0b1`. After `Increment`, `__dirty` returns `0b1`, Phase 2 evaluates only that binding. `branch` handles the `counting`/`resetting` phase distinction without a boolean flag, as shown in the counter example.

**Form.** The idiomatic form pattern uses a single `setField` message type for all fields, per-field error state, and `memo`-wrapped derived validation. With 10 fields in state, each binding's mask targets exactly one access path bit; typing in one input triggers Phase 2 only for that path's bindings.

```typescript
type Fields = { name: string; email: string; phone: string }
type Errors = Partial<Record<keyof Fields, string>>
type State = { fields: Fields; errors: Errors; submitted: boolean }

type Msg =
  | { type: 'setField'; field: keyof Fields; value: string }
  | { type: 'submit' }
  | { type: 'submitResult'; success: boolean; errors?: Errors }

// update():
case 'setField':
  const fields = { ...state.fields, [msg.field]: msg.value }
  return [{ ...state, fields, errors: validate(fields) }, []]
case 'submit':
  const errors = validate(state.fields)
  if (Object.keys(errors).length > 0) return [{ ...state, errors, submitted: true }, []]
  return [{ ...state, submitted: true }, [{ type: 'http', url: '/api/submit', body: state.fields, onSuccess: 'submitResult', onError: 'submitResult' }]]
```

The `setField` pattern avoids the LLM anti-pattern of creating one message type per field (`SetName`, `SetEmail`, `SetPhone`). The `keyof Fields` constraint ensures type safety — `send({ type: 'setField', field: 'address', value: '...' })` is a compile error if `address` is not in `Fields`. Validation runs in `update()` on every keystroke (pure, testable) and errors are part of state (renderable, inspectable). Form-level derived state (`isValid`, `isDirty`) uses `memo()` to compute once per update cycle regardless of how many bindings reference it:

```typescript
const isValid = memo((s: State) => Object.keys(validate(s.fields)).length === 0)
const isDirty = memo((s: State) => !deepEqual(s.fields, initialFields))

// In view:
button({ disabled: s => !isValid(s) || !isDirty(s), onClick: () => send({ type: 'submit' }) },
  [text('Submit')])
```

The compiler's controlled-input diagnostic (02 Compiler.md) catches the most common form bug: an `input({ value: s => s.fields.name })` without an `onInput` handler. Per-field rendering follows the standard element pattern — no special form primitive needed.

**Todo list.** `each({ items: memo(filteredTodos), key: t => t.id, render: renderItem })` is the idiomatic form. The `memo` wrapper prevents the filter from running once per each binding per update. The scoped accessor `item` in the render callback enables per-item bindings like `item(t => t.text)` that are automatically stable-checked: unchanged todo items pay zero Phase 2 cost. Adding a todo appends to the array reference, triggering structural reconciliation for the new entry only.

**Async loading / optimistic updates.** Model state as a discriminated union: `idle | loading | success | error`. `update()` on a `submit` message transitions to `loading` and returns an `http` effect with `onSuccess` and `onError` message types. For optimistic updates, transition directly to the success state in `update()` and include both the http effect and a rollback effect (or track the pre-optimistic state). If `fetchError` arrives, `update()` restores the pre-optimistic state. The rollback is purely state manipulation — no DOM callbacks, no undo stack, just immutable state replacement.

**Multi-step wizard.** A `phase` discriminant field drives `branch({ on: s => s.phase, cases: { ... } })` with one arm per step. Each step is a scope; navigating forward disposes the current scope, creates the next, and carries forward any collected data in the state object. State accumulates across steps because `update()` always receives the full current state. Validation for each step runs in `update()` before the phase transition — if invalid, `update()` returns the same state with error fields populated.

**Modal / dialog.** `show({ when: s => s.modalOpen, render: (_s, _send) => portal({ target: document.body, render: (_s, _send) => div({ class: 'modal' }, [...]) }) })` is the canonical form. The portal renders into `document.body`, escaping any `overflow: hidden` container. Focus trap and initial focus go in `onMount` inside the portal builder. When `modalOpen` becomes false, `show` disposes its scope, which disposes the portal scope, which removes the modal nodes from `document.body` and fires the focus-trap's cleanup disposer.

**Tooltip / popover.** Same as modal but typically triggered by `mouseenter`/`mouseleave` events on a trigger element rather than an explicit message. The trigger element's event handler sends `{ type: 'showTooltip' }` / `{ type: 'hideTooltip' }`. The tooltip itself lives in a `show`-guarded `portal({ target, render })` call. Positioning logic (e.g., using `getBoundingClientRect`) runs in `onMount`. Because `onMount` fires asynchronously, the tooltip is positioned after it is in the DOM and measurable.

**Drag and drop with reordering.** The drag state (`{ dragging: id | null, overIndex: number | null }`) lives in the component state. `each` uses the item key to preserve DOM node identity during reorder; the `updateEach` swap-detection fast path handles the common case of dragging one item past one other (exactly two positions change) with two DOM moves. Drag events dispatch messages that update the order in the `todos` array. The enter/leave transitions on `each` can animate items sliding into position.

**Typeahead / autocomplete.** Keystrokes send `setQuery` messages. `update()` returns a composed effect: `cancel('search', debounce('search', 300, http({ url: \`/api/search?q=\${state.query}\`, onSuccess: 'results', onError: 'searchError' })))`. The `cancel` wrapper discards any pending search when a new keystroke arrives; the `debounce` wrapper delays the HTTP request by 300ms; the `http` wrapper performs the fetch. No generation counter, no manual cancellation tracking. The component state is just `{ query, results, loading }`. Results render via `each` keyed by result id.

**Infinite scroll.** State holds `{ items: T[], cursor: string | null, loading: boolean }`. An `onMount` (or an event listener disposer registered via a scope disposer) observes an intersection observer on the sentinel element at the list bottom. When the sentinel is visible, it sends `loadMore`. `update()` returns the http effect and sets `loading: true`. On success, `update()` appends to `items` and updates `cursor`. `each` with key-by-id appends new entries at the tail; `updateEach` detects the append-at-end fast path and inserts a single fragment.

**Real-time / WebSocket.** The custom `ws:connect` effect is handled in the `.else()` callback of the `handleEffects` chain. The handler opens the WebSocket, calls `send()` with incoming messages, and uses the `AbortSignal` to close the connection on unmount: `signal.addEventListener('abort', () => ws.close())`. Reconnection logic lives entirely in the handler closure (retry count, backoff timer) without polluting component state. Because effects are dispatched after DOM updates, the first `ws:connect` effect fires after the initial render. The component's `update()` handles the messages the handler forwards and is unaware of the connection details.

**Rich text editor (ProseMirror) — record sync.** The canonical `foreign()` use case. ProseMirror owns its document state; LLui owns everything outside the editor. Uses the record sync form because each config field maps to one ProseMirror API call.

```typescript
type EditorMsg =
  | { type: 'contentChanged'; html: string; text: string }
  | { type: 'selectionChanged'; from: number; to: number }
  | { type: 'focused' }
  | { type: 'blurred' }

foreign<State, { readonly: boolean; placeholder: string }, EditorView>({
  mount: (container, send) => {
    const view = new EditorView(container, {
      state: EditorState.create({ schema, plugins }),
      dispatchTransaction: (tr) => {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (tr.docChanged) {
          send({ type: 'contentChanged',
            html: serializer.serializeFragment(newState.doc.content),
            text: newState.doc.textContent })
        }
        if (tr.selectionSet) {
          send({ type: 'selectionChanged',
            from: newState.selection.from, to: newState.selection.to })
        }
      },
    })
    view.dom.addEventListener('focus', () => send({ type: 'focused' }))
    view.dom.addEventListener('blur', () => send({ type: 'blurred' }))
    return view
  },
  props: s => ({ readonly: s.document.locked, placeholder: s.document.placeholder }),
  // Record sync — each field fires independently when it changes.
  // Content is NOT a prop — ProseMirror is the source of truth during editing.
  sync: {
    readonly: (view, val) => view.setProps({ editable: () => !val }),
    placeholder: (view, val) => view.setProps({ attributes: { 'data-placeholder': val } }),
  },
  destroy: (view) => view.destroy(),
  container: { tag: 'div', attrs: { class: 'editor-container' } },
})
```

The `props` accessor tracks `s.document.locked` and `s.document.placeholder` — these get bitmask bits. When `readonly` changes, only the `sync.readonly` handler fires. When `placeholder` changes, only `sync.placeholder` fires. No manual diffing. The editor's content changes flow back to LLui via `send()` in the `dispatchTransaction` hook.

**Code editor (Monaco) — function sync.** Uses the function sync form because `readOnly` and `theme` interact (both go through `updateOptions` or global API calls, and the developer may want to batch them).

```typescript
foreign<State, { language: string; readOnly: boolean; theme: string }, editor.IStandaloneCodeEditor>({
  mount: (container, send) => {
    const ed = monaco.editor.create(container, {
      value: '', language: 'typescript', automaticLayout: true,
    })
    ed.onDidChangeModelContent(() => {
      send({ type: 'codeChanged', value: ed.getValue() })
    })
    ed.onDidChangeCursorPosition((e) => {
      send({ type: 'cursorMoved', line: e.position.lineNumber, col: e.position.column })
    })
    return ed
  },
  props: s => ({ language: s.editor.language, readOnly: s.editor.readOnly, theme: s.editor.theme }),
  // Function sync — manual diffing, needed because language uses a global API
  // while readOnly uses instance options.
  sync: (ed, props, prev) => {
    if (!prev || props.language !== prev.language)
      monaco.editor.setModelLanguage(ed.getModel()!, props.language)
    if (!prev || props.readOnly !== prev.readOnly)
      ed.updateOptions({ readOnly: props.readOnly })
    if (!prev || props.theme !== prev.theme)
      monaco.editor.setTheme(props.theme)
  },
  destroy: (ed) => ed.dispose(),
  container: { attrs: { style: 'width:100%;height:400px' } },
})
```

The two examples demonstrate both sync forms. Record sync is cleaner when fields are independent (ProseMirror). Function sync gives full control when fields interact or use different API patterns (Monaco). The type system enforces correctness in both: record sync handlers receive the exact field type from `T`, function sync receives the full `T` and `T | undefined`.

**Parent-child coordination (Level 1 — view functions).** The default composition model. The parent owns a state slice for the child; the child module exports `update` and `view` functions that operate on that slice. The parent's `update()` delegates: `case 'toolbar': return [{ ...state, toolbar: toolbarUpdate(state.toolbar, msg.msg) }, []]`. The parent's `view()` calls: `toolbarView({ tools: s => s.tools, toolbar: s => s.toolbar }, msg => send({ type: 'toolbar', msg }))`. No `child()` call, no `PropsWatcher`, no `onMsg`. The parent directly controls the child's state — including closing the toolbar's menu on a background click: `return [{ ...state, toolbar: { ...state.toolbar, menuOpen: false } }, []]`. The compiler traces `s.toolbar.menuOpen` as a depth-2 path with its own bit. This model is preferred for most composition because it is simpler, has no overhead, and keeps all state transitions visible in the parent's `update()`.

**Parent-child coordination (Level 2 — isolated components).** For components that need their own bitmask (32+ paths), encapsulated internals (library widgets), or independent effect lifecycle: `child({ def: DataTable, key: 'table', props: s => ({ rows: s.filteredRows, columns: s.columns }), onMsg: msg => msg.type === 'rowSelected' ? { type: 'selectRow', id: msg.id } : null })`. The props accessor has a bitmask derived from its parent state dependencies. The runtime checks the bitmask first (skipping the accessor entirely if no relevant paths changed), then calls the accessor and compares each field via `Object.is` with the previous props — only if at least one field changed does it convert them to a message via the component's `propsMsg` function and enqueue it into the child's message queue. The child's `update()` handles it like any other message — deciding how to merge new props into its own state (e.g., resetting pagination when rows change). `onMsg` maps child messages selectively — returning `null` for messages the parent should ignore. For imperative cross-component commands: `import { toDataTable } from './data-table'; return [state, [toDataTable.scrollToRow({ id: msg.id })]]`.

**Tree view.** Recursive `each` works today: `renderItem` may itself call `each({ items: n => n.children, ... })` inside a `show`. Each nesting level registers its structural blocks with the parent component's flat `structuralBlocks` list. The runtime optimizes nested `each` calls by detecting when an `each` is created inside another `each`'s render callback and registering its structural blocks with the parent `each`'s scope rather than the component's flat list. This keeps reconciliation scoped to the changed subtree — a leaf node expansion touches only that node's sibling list, not the entire tree. A practical mitigation for very deep trees (100+ levels) is to make subtrees child components at a reasonable depth, amortizing the scope tree overhead.

**Data table with sort, filter, paginate.** All three dimensions live in state. `memo(applyFiltersAndSort)` produces the filtered+sorted array; `memo(currentPage)` slices it for display. Column header clicks send `setSort` messages; filter inputs send `setFilter` messages; page controls send `setPage`. The `__dirty` bitmask for a table with these fields will assign separate bits to `sortField`, `sortDir`, `filters`, `page`, and `rows`; a page change touches only `page`, so the filter/sort computation — if already memoized — is not re-run.

**Form validation (sync + async).** Synchronous validation runs inside `update()`: the new state carries `errors` derived from the submitted values. Async validation (e.g., username availability check) returns a cancellable http effect: `cancel('validate-username', http({ url: \`/api/check?name=\${state.username}\`, onSuccess: 'usernameAvailable', onError: 'validationError' }))`. The `cancel` wrapper discards any pending validation when the user types again. The form is in a `validating` phase while the check is in flight; the submit button is disabled via a binding `(s) => s.phase === 'validating'` with the appropriate mask.

**Animated transitions.** `branch`, `each`, and `show` all accept transition fields on their object parameter: `enter?`, `leave?`, and `onTransition?`. `leave` is called with the departing nodes before removal; if it returns a Promise, removal is deferred until the promise resolves. `enter` is called immediately after insertion. CSS class-based transitions work naturally: `each({ items: ..., key: ..., render: ..., enter: nodes => { nodes.forEach(n => n.classList.add('entering')); return waitForTransition(nodes[0]) } })`. For coordinated enter/leave (cross-fades, FLIP animations), `onTransition({ entering, leaving, parent })` fires first, followed by individual `enter`/`leave` handlers — they compose rather than override.

**Keyboard navigation and focus management.** Focus state can live in component state or be managed imperatively. For a listbox, state holds `{ focusedIndex: number }`; arrow key handlers send `moveFocus` messages; Phase 2 updates an `aria-activedescendant` binding. Actual `.focus()` calls — needed for roving tabindex patterns — go in `onMount` inside the focused item's render, or in a cleanup-safe disposer pattern registered on the scope. The `onMount`-on-branch pattern works for panels that should focus their first interactive element on activation.

**Tab panels.** `branch({ on: s => s.activeTab, cases: { home: () => HomePanel(), settings: () => SettingsPanel() } })`. The tab button group uses per-tab class bindings `(s) => s.activeTab === 'home' ? 'active' : ''` — each gets a mask for `activeTab` only. Switching tabs swaps the branch arm, disposing the leaving panel's scope (and any active effects within it) and creating the entering panel's scope (firing its `onMount`). Panel state resets on tab switch unless persisted in the parent's state before the transition.

**Accordion.** Multiple independent `show` primitives, one per section. `show({ when: s => s.openSection === 'faq', render: (_s, _send) => FaqContent() })`. `show` is a two-case `branch` — when the condition becomes false, the scope is disposed and nodes are removed; when it becomes true again, the builder re-runs from scratch. Mutual exclusion (only one section open) is enforced by `update()` if the accordion is single-open. For multi-open accordions, `s.openSections: string[]` with per-section `show({ when: s => s.openSections.includes('faq'), render: ... })` bindings, each with mask for `openSections`. (State must be JSON-serializable — use `string[]` with uniqueness enforced in `update()`, not `Set<string>`.)

**Collaborative editing.** Multiple message sources — local user actions, WebSocket messages from other users, and periodic sync operations — all flow through `send()`. The effect handler receives `ws:subscribe` and pipes remote operations as messages. `update()` applies operational transforms or CRDT merges and returns new state. Because all updates go through the same pure `update()` function, the order of application is deterministic and testable. Conflict resolution logic is entirely in `update()`, isolated from DOM and network concerns.
