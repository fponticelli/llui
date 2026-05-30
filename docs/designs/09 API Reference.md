# API Reference

This document provides the authoritative type signatures for the public exports of the LLui framework and its companion packages. For design rationale and usage patterns, see the document referenced in each section.

There is a single import surface for the runtime: **`@llui/dom`**. Server-only and compiler-only surfaces live under sub-entries (`@llui/dom/ssr`, `@llui/dom/ssr/jsdom`, `@llui/dom/ssr/linkedom`, `@llui/dom/devtools`, `@llui/dom/internal`). There is no `/signals` subpath and no separate legacy runtime.

---

## Core Runtime (`@llui/dom`)

### `component<S, M, E>(spec)`

Defines a signal component. Identity at runtime — the value passed in is the definition the compiler annotates and the runtime mounts.

```typescript
function component<S, M, E = never>(spec: SignalComponentSpec<S, M, E>): SignalComponentDef<S, M, E>

interface SignalComponentSpec<S, M, E = never> {
  /** optional name — debug registry / agent identity */
  name?: string
  /** initial state, optionally with initial effects */
  init: () => S | [S, E[]]
  /** pure reducer; returns next state, optionally with effects (bare S accepted) */
  update: (state: S, msg: M) => [S, E[]] | S
  /** build the view once; reactive reads are signal bindings */
  view: (bag: SignalViewBag<S, M>) => readonly Node[]
  /** handle an effect; may return a cleanup function */
  onEffect?: (effect: E, api: { send: Send<M>; state: Signal<S> }) => void | (() => void)
}

interface SignalViewBag<S, M> {
  state: Signal<S>
  send: Send<M>
}

type Send<M> = (msg: M) => void
```

**Constraints:**

- `S` must be JSON-serializable (no `Map`, `Set`, `Date`, class instances, functions).
- `M` and `E` should be discriminated unions with a `type` field.
- `init()` takes **no arguments**.
- `update()` must be pure — no side effects, no DOM access, no async. A bare `S` return is normalized to `[S, []]`.
- `view` runs once at mount. Its bag carries `state: Signal<S>` and `send` — **not** element helpers. Element and structural helpers are module imports from `@llui/dom`.

The compiler injects optional introspection metadata (`__msgSchema`, `__stateSchema`, `__effectSchema`, `__msgAnnotations`, `__schemaHash`, `__componentMeta`) into the definition in dev/agent builds; these are tree-shaken from production. They are not part of the authored API.

See: 01 Architecture.md, 02 Compiler.md, 07 LLM Friendliness.md

---

### `Signal<T>`

The reactive view of a value. The entire reactive vocabulary is three methods plus the standalone `derived`.

```typescript
interface Signal<T> {
  /** slice into a sub-signal via a statically-typed dot path */
  at<P extends ValidPath<T>>(path: P): Signal<PathValue<T, P>>
  /** derive a single-source signal */
  map<U>(fn: (value: T) => U): Signal<U>
  /** one-shot, non-reactive read — handlers / effects / lifecycle only */
  peek(): T
}
```

- `.at('a.b')` narrows to a sub-path signal; the path is statically validated against `T` (`ValidPath<T>`), and the result type is `PathValue<T, P>` with nullability bubbled through optional/array segments.
- `.map(fn)` derives. Deps carry through unchanged — a mapped value can only change when its source path changes. `.at()` on a mapped signal is unsupported (slice with `.at()` _before_ `.map()`).
- `.peek()` reads the current value once with no binding. Using it in a reactive slot is a compile error (`peek-in-slot`).

A reactive slot is a signal: `text(state.at('count').map(String))`, `div({ class: state.at('open').map(o => o ? 'on' : '') })`. Operating on a signal directly (`state.at('n') + 1`, ternary on a signal, template span) is a compile error (`operator-on-signal`) — derive with `.map`.

`derived(sigs, fn)` combines N independent signals into a derived signal (use `.map` for a single source); it is the type surface, runtime support is not implemented.

See: 01 Architecture.md, 03 Runtime DOM.md

---

### `mountApp(container, def)`

Mounts a component into a container element and drives its update loop.

```typescript
function mountApp<S, M, E = never>(
  container: Element,
  def: SignalComponentDef<S, M, E>,
): SignalComponentHandle<S, M>
```

A fresh mount appends the built nodes; init effects are dispatched after mount. Returns the component handle (below).

See: 08 Ecosystem Integration.md

---

### `mountSignalComponent(target, def, opts?)`

The full mount entry — `mountApp` is the container-only convenience over it.

```typescript
function mountSignalComponent<S, M, E = never>(
  target: Element | MountTarget,
  def: SignalComponentDef<S, M, E>,
  opts?: MountSignalOptions<S>,
): SignalComponentHandle<S, M>

type MountTarget =
  | { container: Element; mode?: 'append' | 'replace' }
  | { anchor: Comment; mode?: 'append' | 'replace' }

interface MountSignalOptions<S> {
  /** hydrate over server HTML: seed with serverState, atomically replace */
  hydrate?: { serverState: S; runInitEffects?: boolean }
  /** seed state instead of init()'s result (init() still runs for its effects) */
  initialState?: S
  /** context values exposed at the build root (see provide/useContext) */
  contexts?: ReadonlyMap<symbol, unknown>
}
```

A bare `Element` is treated as `{ container, mode: hydrate ? 'replace' : 'append' }`. An `{ anchor }` target inserts nodes after a comment anchor, bracketed by a synthesized `<!--llui-mount-end-->` sentinel — used by `@llui/vike` and by `lazy` to mount a nested layer without owning the parent element.

See: 03 Runtime DOM.md, 08 Ecosystem Integration.md

---

### `hydrateSignalApp(target, def, serverState, options?)`

Hydrates server-rendered HTML.

```typescript
function hydrateSignalApp<S, M, E = never>(
  target: Element | MountTarget,
  def: SignalComponentDef<S, M, E>,
  serverState: S,
  options?: { runInitEffects?: boolean; contexts?: ReadonlyMap<symbol, unknown> },
): SignalComponentHandle<S, M>
```

Builds the client tree against `serverState` (matching the SSR render) and atomically swaps it in — server HTML stays visible until the swap, so no flash. `init()`'s effects are skipped by default (the server already ran them); pass `runInitEffects: true` for init()s that no-op on the server. Hydration does **not** claim server nodes; there are no `data-llui-hydrate` markers.

See: 03 Runtime DOM.md, 08 Ecosystem Integration.md

---

### `SignalComponentHandle<S, M>`

The handle returned by mounting — the agent / test / HMR contract.

```typescript
interface SignalComponentHandle<S, M> {
  send(msg: M): void
  getState(): S
  /** no-op: signal send is synchronous (kept for harness/agent parity) */
  flush(): void
  /** run all effect cleanups + the build's teardowns */
  dispose(): void
  /** fires synchronously after every state-changing update; returns unsubscribe */
  subscribe(listener: (state: S) => void): () => void
  /** run the reducer in isolation against current state; no commit/dispatch */
  runReducer(msg: M): { state: S; effects: unknown[] } | null
  /** Msg variants dispatchable from currently-rendered UI (live tagSend regs) */
  getBindingDescriptors(): Array<{ variant: string }>
  /** hot-swap the reducer (and optionally onEffect) without rebuilding the DOM */
  swapUpdate(
    newUpdate: (state: unknown, msg: unknown) => [unknown, unknown[]] | unknown,
    newOnEffect?: unknown,
  ): void
  /** install a hook for binding-accessor throws during an update */
  setOnBindingError(hook: ((e: BindingError) => void) | null): void
}

interface BindingError {
  kind: string
  key?: string
  message: string
  stack?: string
}
```

`subscribe` backs the agent protocol's state-update frames; `runReducer` backs `would_dispatch`; `getBindingDescriptors` backs `list_actions`; `swapUpdate` is the HMR escape hatch for pure `update.ts` edits (keeps live state + DOM); `setOnBindingError` backs the dispatch envelope's `drain.errors` (the runtime leaves a throwing binding's DOM at its prior value and continues with siblings).

See: 03 Runtime DOM.md, 10 Agent Protocol.md

---

### `send` / `flush`

`send` is the second field of the view bag and the `api.send` in `onEffect`. It runs the pure reducer **synchronously**; if the new state differs by reference, it commits to the reconciler, notifies subscribers, then dispatches effects. There is no message queue — each `send` is its own update cycle.

`handle.flush()` is a no-op (signal `send` is synchronous); it exists for parity with harnesses/agents that assume an async batch model.

See: 01 Architecture.md, 03 Runtime DOM.md

---

### `text(value)`

Reactive or static text node.

```typescript
function text(value: Reactive<string | number>): Node
type Reactive<T> = Signal<T> | T
```

A signal value (`text(state.at('count').map(String))`) becomes a reactive text binding; a plain value (`text('-')`) becomes a static text node. The compiler lowers a direct-view `text(...)` to `signalText`/`staticText`; in view-helper code it runs as a real function consuming the signal handle.

See: 01 Architecture.md

---

### Element Helpers (`div`, `span`, `button`, …)

HTML element helpers. Each accepts `tag(children)`, `tag(props, children)`, `tag(props)`, or `tag()` — a leading array literal is children.

```typescript
interface ElementHelper {
  (children: readonly Node[]): Node
  (props?: ElProps, children?: readonly Node[]): Node
}

type AttrValue = Reactive<string | number | boolean | null | undefined>
type ElProps = Record<string, AttrValue | ((ev: Event) => void)>
```

Props: a signal value becomes a reactive binding; an `on*` function becomes an event listener (`onClick` → `click`); everything else is a static attribute. A `style.X` prop sets an individual style property; `null`/`false` removes the attribute, `true` sets it to `''`.

Exported HTML helpers: `div span p a button input label form ul ol li section header footer nav main h1 h2 h3 h4 h5 h6 img small strong em table thead tbody tr td th pre code canvas aside article figure figcaption blockquote hr br select option optgroup textarea fieldset legend dl dt dd caption time details summary`.

See: 01 Architecture.md

---

### SVG Element Helpers

Namespaced SVG helpers, same call forms as HTML helpers: `svg path g circle rect line polyline polygon ellipse`, plus `svgText` (the SVG `<text>` element — named to avoid colliding with the `text()` node helper).

---

## Structural Primitives

### `each(items, opts)`

Keyed list. `items` is a signal of the array; rows are reconciled by key, each row its own scope mounted on a combined item+state context.

```typescript
function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
  },
): Node
```

`render` receives per-row `item` and `index` **signals** — `item.at('field')` is a reactive per-row slot; `item.at('id').peek()` reads the current value inside an event handler. `key` receives the **raw** item value (a plain function, not reactive). Kept rows are mutated in place; the keyed diff moves only displaced rows. (See `examples/todomvc/src/main.ts`.)

See: 03 Runtime DOM.md

---

### `show(cond, render, orElse?)`

Conditional render keyed on a truthiness.

```typescript
function show<T>(
  cond: Signal<T>,
  render: (narrowed: Signal<NonNullable<T>>) => readonly Node[],
  orElse?: () => readonly Node[],
): Node
```

Mounts `render`'s content when `cond` is truthy, `orElse`'s when falsy (or nothing). The `render` arm receives the **narrowed** signal (the cond handle, non-null), so it can read narrowed fields. A same-truthiness state update does not remount — the mounted arm's own scope handles its inner reactivity.

See: 03 Runtime DOM.md

---

### `branch(value, …)`

Discriminated-union or value-keyed render.

```typescript
// 3-arg: discriminant selector + narrowed arms
function branch<U extends object, D extends keyof U>(
  value: Signal<U>,
  discriminant: (u: U) => U[D],
  arms: {
    [K in U[D] & (string | number)]: (v: Signal<Extract<U, Record<D, K>>>) => readonly Node[]
  },
): Node

// 2-arg: keyed directly on a string/number signal's value
function branch<K extends string | number>(
  value: Signal<K>,
  arms: Partial<Record<K, () => readonly Node[]>>,
): Node
```

The 3-arg form selects the union's tag field (`v => v.type`); each arm receives the **narrowed variant signal**, so it reads variant-only fields with full types (`v.at('data')`). Swapping the discriminant value unmounts the old arm and mounts the new one; a same-key update does not remount; an absent arm renders nothing.

See: 03 Runtime DOM.md

---

### `virtualEach(opts)`

Windowed keyed list — only rows in the scroll viewport (+overscan) exist in the DOM.

```typescript
function virtualEach<T>(opts: {
  items: Signal<readonly T[]>
  key: (item: T) => string | number
  itemHeight: number
  containerHeight: number
  overscan?: number
  class?: string
  render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
}): Node
```

A scroll container (`containerHeight`) holds a spacer sized to `items.length * itemHeight`; each visible row is absolutely positioned at `index * itemHeight`. Reuses `each`'s per-row scope machinery. The window recomputes on scroll and when the items deps change. **Fixed `itemHeight` only.**

See: 03 Runtime DOM.md

---

### `lazy(opts)`

Asynchronously load a signal component on demand.

```typescript
function lazy<LS = unknown, LM = unknown, LE = unknown>(opts: {
  loader: () => Promise<SignalComponentDef<LS, LM, LE>>
  fallback: () => readonly Node[]
  error?: (err: Error) => readonly Node[]
  initialState?: LS
}): Node
```

Renders `fallback()` immediately (reactive, built in the current build), then on `loader()` resolution removes the fallback and mounts the loaded component at an anchor via `mountSignalComponent`. On reject it swaps in `error(err)` (or nothing). If the surrounding build is torn down before the loader settles, the deferred mount is cancelled and any already-mounted child is disposed. The loaded component's `S`/`M`/`E` are erased to the loader's type parameters — the single documented type-erasure boundary. Integrates with Vite's dynamic `import()` for code splitting.

See: 06 Bundle Size.md

---

### `foreign(spec)`

Imperative-library boundary. LLui owns the host element; the library owns everything inside it.

```typescript
function foreign<Inst, State extends Record<string, Signal<unknown>>>(spec: {
  tag?: string // host element tag, default 'div'
  state?: State // declared reactive inputs
  mount: (args: {
    el: Element
    state: { [K in keyof State]: LiveSignal<State[K] extends Signal<infer T> ? T : unknown> }
  }) => Inst
  unmount?: (instance: Inst) => void
}): Node

interface LiveSignal<T> {
  peek(): T
  bind(cb: (value: T) => void): () => void // fires immediately + on change
}
```

Each declared `state` signal is materialized to a `LiveSignal` (peek + bind) and handed to `mount`, which builds the third-party instance into the host element. When a declared input changes, its `LiveSignal` fires bound callbacks. Communicate out via `send` closed over from the view bag. `unmount` runs on the owning component's dispose. The analyzer sees the declared deps; the imperative body is opaque.

See: 01 Architecture.md

---

### `onMount(callback)`

Run a callback after the surrounding view's nodes are inserted.

```typescript
function onMount(cb: (root: Element) => void | (() => void)): Node
```

Receives the mounted parent element. A returned function is registered as a teardown (run on unmount/dispose). Returns a marker comment node for the view array.

See: 03 Runtime DOM.md

---

### `portal(content, target?)`

Render content out-of-tree while keeping it in the current scope.

```typescript
function portal(content: () => readonly Node[], target?: Element): Node
```

Renders `content()` into `target` (default `document.body`); the content's bindings join the current scope (so it stays reactive), and a teardown removes the nodes on unmount/dispose. Returns an inline placeholder comment. During SSR the server `DomEnv` has no `document.body`, so a portal needs an explicit target.

See: 03 Runtime DOM.md

---

### Context: `createContext` / `provide` / `useContext`

Build-time dependency injection.

```typescript
interface Context<T> {
  readonly id: symbol
  readonly default: T
}
function createContext<T>(defaultValue: T, name?: string): Context<T>
function provide<T>(context: Context<T>, value: T, render: () => readonly Node[]): Node
function useContext<T>(context: Context<T>): T
```

`provide` sets a value for everything `render` builds, then restores. `useContext` reads the nearest provided value (or the default — outside a build it returns the default rather than throwing). Values may be plain or signals; provided values flow into nested builds (each rows, show/branch arms).

See: 03 Runtime DOM.md

---

### `tagSend(send, variants, handler)`

Tag an event handler with the Msg variants it can dispatch, for the agent affordance registry.

```typescript
function tagSend<F extends (...args: never[]) => unknown>(
  send: unknown,
  variants: readonly string[],
  fn: F,
): F
```

The tagged handler registers its variants live (refcounted per mounted scope) so `handle.getBindingDescriptors()` / the agent's `list_actions` can report which actions the rendered UI currently affords. Used throughout `@llui/components`' `connect()` parts.

See: 10 Agent Protocol.md, 11 Agent Annotations and Tools.md

---

### Signal handle utilities

Advanced/test composition: build a signal handle outside a component bag.

```typescript
function pathHandle<T>(get: () => unknown, base: string): SignalHandle<T>
function isSignalHandle(v: unknown): v is SignalHandle<unknown>

interface SignalHandle<T> extends Signal<T> {
  readonly produce: (state: unknown) => T
  readonly deps: readonly string[]
}
```

`pathHandle(get, base)` constructs a runtime `Signal` rooted at a path: `produce` resolves `base` from the binding's state; `peek` reads the live value via `get`; `.at` extends the path; `.map` derives. The runtime realizes the bag's `state` handle this way. Most application code never imports these.

---

## SSR (`@llui/dom` + `@llui/dom/ssr`)

### `renderToString(def, initialState, env)`

```typescript
function renderToString<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  initialState: S | undefined,
  env: ServerDoc,
): string
```

Builds the component's DOM against a server `DomEnv` and serializes it to an HTML string. Effects are not dispatched (server render is pure). `initialState` defaults to `init()`'s state.

### `renderNodes(def, initialState, env, contexts?)`

```typescript
function renderNodes<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  initialState: S | undefined,
  env: ServerDoc,
  contexts?: ReadonlyMap<symbol, unknown>,
): { nodes: readonly Node[]; dispose: () => void }
```

Returns the built (detached) nodes plus a `dispose` that runs the build's teardowns — for adapters that compose multiple node trees (layout + page) before one final serialization. `contexts` replays a layout's in-scope `provide` values into the nested build.

### `serializeNodes(nodes)`

```typescript
function serializeNodes(nodes: readonly Node[]): string
```

Serialize already-built DOM nodes to HTML (event handlers are dropped; void elements self-close).

### `ServerDoc` / `DomEnv` / env factories

```typescript
type ServerDoc = SignalDoc // node-factory subset the build needs
type DomEnv // from @llui/dom/ssr — the env contract + browserEnv() helper

// @llui/dom/ssr/jsdom
function jsdomEnv(): Promise<DomEnv>
// @llui/dom/ssr/linkedom
function linkedomEnv(): Promise<DomEnv>
```

`@llui/dom/ssr` exports the `DomEnv` contract and `browserEnv()` but imports no DOM implementation; pick a backend via `@llui/dom/ssr/jsdom` or `@llui/dom/ssr/linkedom` and pass the resulting env to `renderToString`/`renderNodes`.

See: 08 Ecosystem Integration.md

---

## Debug API (`@llui/dom/devtools`)

Dev-only surface for the MCP/agent relay. Installed automatically by `mountSignalComponent` when `import.meta.env.DEV` is true.

```typescript
function installSignalDebug(hooks: SignalDebugHooks): () => void
// plus exported types: LluiDebugAPI, SignalDebugHooks, SignalMessageRecord,
// MessageRecord, StateDiff, ValidationError, BindingDebugInfo, UpdateExplanation,
// ComponentInfo, MessageSchemaInfo, BindingLocation, ElementReport, HydrationDivergence
```

The Vite plugin injects a `startRelay(port)` bootstrap into dev signal bundles when MCP is enabled; `@llui/mcp` connects to it. Production builds tree-shake the whole surface.

See: 07 LLM Friendliness.md, 10 Agent Protocol.md

---

## `@llui/effects`

Composable effect description builders and a runtime chain for interpreting them in `onEffect`.

### Effect Builders

```typescript
function http<M>(opts: {
  url: string
  method?: string
  body?: unknown
  contentType?: string
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'
  onSuccess: (data: unknown, headers: Headers) => M
  onError: (error: ApiError) => M
}): HttpEffect<M>

function cancel(token: string): CancelEffect
function cancel(token: string, inner: BuiltinEffect): CancelReplaceEffect

function debounce(key: string, ms: number, inner: BuiltinEffect): DebounceEffect
function timeout<M>(ms: number, msg: M): TimeoutEffect
function interval<M>(key: string, ms: number, msg: M): IntervalEffect
```

`onSuccess`/`onError` are **functions** mapping the response (or `ApiError`) to a `Msg` — not string tags. All builders return plain data objects, returned from `update()`, not executed directly. (`@llui/effects` also ships builders for storage/broadcast/websocket/upload/clipboard/notification/geolocation; see the package source.)

### `handleEffects<E, M>()`

```typescript
interface EffectCtx<E, M> {
  effect: E
  send: Send<M>
  signal: AbortSignal
}
function handleEffects<E extends { type: string }, M = never>(): {
  else(handler: (ctx: EffectCtx<E, M>) => void): (ctx: EffectCtx<E, M>) => void
}
```

The canonical `onEffect` handler. Consumes the built-in effects (`http`, `cancel`, `debounce`, `timeout`, `interval`, …); `.else(handler)` receives a single `{ effect, send, signal }` context for the remaining custom effect types (TypeScript narrows `effect` to those automatically). The chain tracks cancellation tokens and debounce timers in a per-component closure and uses `signal` (aborted on dispose) for cleanup.

See: 01 Architecture.md

---

## `@llui/test`

Test harnesses. DevDependency only — zero production bundle cost.

### `testComponent(def)`

Zero-DOM harness over `init`/`update`. Runs in Node.

```typescript
function testComponent<S, M, E>(def: SignalComponentDef<S, M, E>): TestHarness<S, M, E>

interface TestHarness<S, M, E> {
  state: S
  effects: E[] // effects from the last send
  allEffects: E[] // effects accumulated across all sends (incl. init)
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send(msg: M): void
  sendAll(msgs: M[]): S
}
```

`init()`'s state and effects seed the harness; `send` runs the reducer and records history.

### `testView(def, state)`

Mounts the component against a fresh container, seeding it with `state` (not `init()`'s data), and returns an interactive harness with auto-flush.

```typescript
function testView<S, M, E>(def: SignalComponentDef<S, M, E>, state: S): ViewHarness<S, M>

interface ViewHarness<S, M> {
  readonly container: HTMLElement
  readonly handle: SignalComponentHandle<S, M>
  query(selector: string): Element | null
  queryAll(selector: string): Element[]
  text(selector: string): string
  attr(selector: string, name: string): string | null
  send(msg: M): void
  click(selector: string): void
  input(selector: string, value: string): void
  fire(selector: string, type: string, init?: EventInit): void
  unmount(): void
}
```

`click`/`input`/`fire` simulate events and flush so tests chain assertions naturally; `unmount` disposes and removes the DOM (idempotent).

### Also exported

- **`defineTestComponent(input)`** — build a `SignalComponentDef` inline for a test (seed state in `init()`), returned ready to hand to `testComponent`/`testView`.
- **`reducer(def, opts?)`** — a zero-DOM reducer driver over `update` alone, for pure state-transition assertions.
- **`assertEffects(actual, expected)`** — structural assertion over an effect array.
- **`propertyTest(...)`** — property/fuzz harness that drives random `Msg` sequences and checks invariants.
- **`replayTrace(def, trace)`** — re-run a recorded message trace against a component and assert the resulting states.
- **`recordAgentSession` / `replayAgentSession`** — capture and replay an agent-driven dispatch session (see 10 Agent Protocol.md).

See: 04 Test Strategy.md
