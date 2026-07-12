---
title: '@llui/dom'
description: 'Runtime API: component, mount, view, primitives, element helpers'
---

# @llui/dom

Runtime for the [LLui](https://github.com/fponticelli/llui) web framework — The Elm Architecture on a compile-time-optimized **signal** runtime.

No virtual DOM. `view()` runs once at mount, building real DOM nodes with reactive bindings; a **chunked-mask reconciler** updates only the bindings whose dependency paths actually changed.

## Install

```bash
pnpm add @llui/dom
```

## Quick Start

```typescript
import { component, mountApp, button, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => ({ count: 0 }),
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return { ...state, count: state.count + 1 }
      case 'dec':
        return { ...state, count: state.count - 1 }
    }
  },
  // `state` is a Signal<State> — derive reactive values with `.map` / `.at`.
  view: ({ state, send }) => [
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
    text(state.map((s) => String(s.count))),
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

## The view bag and signal handles

`view` receives `{ state, send }`. `state` is a **`Signal<State>`** — a read handle, not the value:

- `state.at('field')` — narrow to a sub-path signal (`state.at('user').at('name')`).
- `state.map((s) => …)` — derive a reactive value; the binding's mask tracks exactly the paths read.
- `state.peek()` — one-shot read, for handlers / effects / `onMount` (never as a slot value).

Element helpers (`div`, `button`, …) and structural primitives (`each`, `show`, `branch`, …) are **module imports**, not bag members. Combine multiple signals with `derived([a, b], (av, bv) => …)`.

## Mountable — everything you build is a lazy description

Every authoring helper (`el`/`div`/`text`/`each`/`show`/`branch`/`unsafeHtml`/`lazy`/`virtualEach`/`foreign`/`portal`/`provide`) returns a **`Mountable`** — a recipe materialized into live DOM at the point it is _placed_ (as an element child, or in a view / arm / row return). Consequences:

- **Annotate view helpers `Renderable`** (`readonly Mountable[]` — a list) or **`Mountable`** (a single element) — not `Node`/`Node[]`.
- **Capture and reuse freely.** A `Mountable` stored in a variable and reused across a `show`/`branch` remount rebuilds fresh each time; placing one twice yields two independent live instances.
- **Side-effect helpers must be placed.** `onMount(cb)` registers nothing unless its returned `Mountable` is in the view array — it is not an eager side effect.
- **Raw DOM interop:** wrap an existing node with `mountable(() => node)`.

## API

### Core

| Export                                       | Purpose                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `component(spec)`                            | Define a component (`init` / `update` / `view` / `onEffect?`)           |
| `mountApp(el, def)`                          | Mount a component into a container element                              |
| `mountSignalComponent(target, def, opts?)`   | Lower-level mount — container or `{ anchor }` target, optional hydrate  |
| `hydrateSignalApp(target, def, serverState)` | Hydrate server-rendered HTML                                            |
| `derived(sigs, fn)`                          | Combine N signals into one derived signal                               |
| `pathHandle` / `isSignalHandle`              | Construct / detect a runtime signal handle                              |
| `tagSend(handler, variants)`                 | Tag an event handler with the msg variants it can send (agent protocol) |

### View content

| Export                              | Purpose                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `text(value)`                       | Reactive (or static) text node                                                                            |
| `unsafeHtml(value)`                 | Render a raw HTML string (escape hatch; caller owns sanitization)                                         |
| `each(items, { key, render })`      | Keyed list                                                                                                |
| `show(cond, render, orElse?)`       | Conditional render (the condition signal is narrowed for the arm)                                         |
| `branch(value, discriminant, arms)` | Discriminated-union / keyed render                                                                        |
| `virtualEach(opts)`                 | Windowed keyed list (uniform `number` or per-item `(item, index) => number` row height)                   |
| `lazy(opts)`                        | Async-loaded child component with `fallback` / `error`                                                    |
| `foreign(spec)`                     | Imperative-library boundary (declared signals → LiveSignals)                                              |
| `portal(content, target?)`          | Render into a different DOM location (default `document.body`)                                            |
| `onMount(cb)`                       | Run after mount; return a cleanup. **Place the returned marker.**                                         |
| `mountable(build)`                  | Wrap a build closure / raw node as placeable content                                                      |
| element helpers                     | `div`, `span`, `button`, `input`, `a`, `h1`–`h6`, `ul`/`li`, `table`/`tr`/`td`, `svg`/`path`/…, 60+ total |

### Context

| Export                          | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `createContext(default, name?)` | Create a context                                 |
| `provide(ctx, value, render)`   | Provide a value to everything `render` builds    |
| `useContext(ctx)`               | Read the nearest provided value (or the default) |

### SSR

| Export                            | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `renderToString(def, state, env)` | Render a component to an HTML string                 |
| `renderNodes(def, state, env)`    | Render to detached nodes (adapter use)               |
| `serializeNodes(nodes)`           | Serialize nodes to an HTML string                    |
| `browserEnv` / `DomEnv`           | SSR document-env contract (pick a backing DOM below) |

## Sub-path Exports

```typescript
import { installSignalDebug } from '@llui/dom/devtools' // dev/agent relay — kept out of prod bundles
import { jsdomEnv } from '@llui/dom/ssr/jsdom' // server: jsdom-backed DomEnv
import { linkedomEnv } from '@llui/dom/ssr/linkedom' // server: linkedom-backed DomEnv
import { subApp } from '@llui/dom/escape-hatch' // isolated child TEA loop (rare)
// '@llui/dom/internal' — render-context glue for sibling adapter packages (e.g. @llui/vike)
```

## Performance

Competitive with the fastest fine-grained reactive frameworks on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) — see the [benchmarks page](/benchmarks).

<!-- auto-api:start -->

## Functions

### `__currentBuildInfo()`

Adapter hook (`@llui/vike`): the build currently in progress, or null when
called outside a signal build. Exposes the build's `doc` (to create anchor
nodes that belong to the same document as the surrounding tree) and a SNAPSHOT
of the context values in scope at the call site (so an adapter that mounts a
NESTED build in a separate pass can replay them via `runBuild`'s `seedContexts`
/ the `contexts` mount option). Returns a fresh snapshot map — safe to retain.

```typescript
function __currentBuildInfo(): {
  doc: SignalDoc
  contexts: ReadonlyMap<symbol, unknown>
} | null
```

### `__registerScopeVariants()`

Compiler-emitted (signal connect-translator path) + library helper: register
the variants for the active build scope. No-op outside a build.

```typescript
function __registerScopeVariants(variants: readonly string[]): void
```

### `applyAttr()`

Apply a single non-reactive prop VALUE to `node`: `style.*` → individual style
property, form-control IDL props (`value`/`checked`/`selected`/`indeterminate`)
→ live property assignment, everything else → content attribute (null/false
removes, true sets empty). Exported so a compiler-emitted {@link RowFactory}'s
reactive-prop `commit` routes through the same DOM-application logic the
authoring path uses (rather than re-inlining the IDL/style quirks).

```typescript
function applyAttr(node: Element, name: string, value: unknown): void
```

### `base()`

Set the document `<base>` (one per document — dedups to a single tag).

```typescript
function base(attrs: BaseAttrs): Mountable
```

### `bodyAttr()`

Set attribute(s) on `<body>` (e.g. `bodyAttr({ class: theme })`).

```typescript
function bodyAttr(attrs: Record<string, HeadValue<string | boolean | null>>): Mountable
```

### `branch()`

Discriminated-union render. `discriminant` selects the union's tag field
(`v => v.kind`, `v => v.type`, …); each arm receives the NARROWED variant
signal, so it can read variant-only fields with full types (`v.at('data')`).
Mirrors `show`'s narrowing. Rewritten by the compiler to `signalBranch`.

```typescript
export function branch<U extends object, D extends keyof U>(
  value: Signal<U>,
  discriminant: (u: U) => U[D],
  arms: {
    [K in U[D] & (string | number)]: (v: Signal<Extract<U, Record<D, K>>>) => Renderable
  },
  /** Optional element-level transition hooks — animate the arm swap (see `show`). */
  transition?: TransitionOptions,
): Mountable
export function branch<K extends string | number>(
  value: Signal<K>,
  arms: Partial<Record<K, () => Renderable>>,
  /** Optional element-level transition hooks — animate the arm swap (see `show`). */
  transition?: TransitionOptions,
): Mountable
```

### `browserEnv()`

Wrap the browser globals as a `DomEnv`. Used as the default env for
`mountApp` / `hydrateSignalApp` on the client.
The returned object delegates to `globalThis.document` / `globalThis.X`
lazily — evaluating `browserEnv()` on a server process before a DOM
exists is safe because the delegation only dereferences the globals
when a method is actually called.
Never mutates `globalThis`. A process with no browser globals that
invokes one of the factory methods gets a `TypeError` / `ReferenceError`
at the call site — which is correct: you're trying to build DOM on a
runtime that has no DOM.

```typescript
function browserEnv(): DomEnv
```

### `collectHeadSink()`

```typescript
function collectHeadSink(): CollectHeadSink
```

### `component()`

Define a signal component. Identity at runtime — the view has been lowered by
the compiler; the authoring/runtime bag shapes coincide (state: Signal<S>).
The three type parameters:

- **`S` — State.** The component's state shape. Must be JSON-serializable
  (plain objects/arrays/primitives — no class instances, functions, Maps, or
  Dates) so it can be snapshotted, time-travelled, and sent over the agent
  wire. In `view`, `state` arrives as a `Signal<S>` — read it with
  `state.at('field')`, `state.map(fn)`, or `state.peek()` (handlers/effects).
- **`M` — Msg.** The message/action union the reducer handles. A
  **discriminated union with a `type` field** (`{ type: 'inc' } | { type:
'set'; value: number }`); the `type` discriminant is what the compiler,
  devtools, and agent surface key off. Enforced by `M extends { type: string }`.
- **`E` — Effect.** The effect union returned from `init`/`update`, also a
  **discriminated union with a `type` field**. Defaults to `never` (a pure
  component with no effects). Handled in `onEffect` (or by `@llui/effects`).
  Spelling these out (and the `{ type: string }` constraint) catches a malformed
  Msg/Effect union at the call site instead of at the first failed dispatch.

```typescript
function component<S, M extends { type: string }, E extends { type: string } = never>(
  spec: SignalComponentSpec<S, M, E>,
): SignalComponentDef<S, M, E>
```

### `createContext()`

```typescript
function createContext<T>(defaultValue: T, name = 'context'): Context<T>
```

### `currentDoc()`

The document of the ACTIVE build — a live client `Document` on the client, a
server `DomEnv` under SSR. Public so sibling modules can create nodes / read
`head`/`documentElement`/`body` in the same environment the runtime builds in.
Must be called during a build.

```typescript
function currentDoc(): SignalDoc
```

### `derived()`

Combine N independent signals into one derived signal. Use when the inputs have
no shared parent signal (cross-tree, or a per-row item signal + a component-state
signal); for a single source, prefer {@link Signal.map}.
Two call forms — pick whichever reads cleaner:
derived(a, b, (va, vb) => …) // variadic: 2–4 sources, positional values
derived([a, b, …c], (…vals) => …) // array: any N, tuple-typed values
The compiler lowers `derived(...)` inside a DIRECT view to an inline call. This
is the equivalent RUNTIME handle for view-helper composition (where there is no
statically-known path): `produce`/`peek` apply `fn` over the resolved sources and
`deps` is the UNION of the sources' deps — so the chunked-mask reconciler fires
the binding whenever ANY source changes, and commits only on an output change.
All inputs must resolve against the same binding state (the common case: each is
rooted at the component state, or all at the same row ctx). The result is a
{@link MappedSignal} — like a `.map()`, it carries no path, so `.at()` on it is
a compile error (slice the sources before combining).

```typescript
export function derived<A, B, U>(a: Signal<A>, b: Signal<B>, fn: (a: A, b: B) => U): MappedSignal<U>
export function derived<A, B, C, U>(
  a: Signal<A>,
  b: Signal<B>,
  c: Signal<C>,
  fn: (a: A, b: B, c: C) => U,
): MappedSignal<U>
export function derived<A, B, C, D, U>(
  a: Signal<A>,
  b: Signal<B>,
  c: Signal<C>,
  d: Signal<D>,
  fn: (a: A, b: B, c: C, d: D) => U,
): MappedSignal<U>
export function derived<T extends readonly unknown[], U>(
  sigs: { readonly [K in keyof T]: Signal<T[K]> },
  fn: (...values: T) => U,
): MappedSignal<U>
```

### `domHeadSink()`

Build a sink that writes to `doc`'s live `<head>` / `<html>` / `<body>`. Returns
an inert sink when the document has no `<head>` (server `DomEnv` — those go
through the collector instead).

```typescript
function domHeadSink(doc: SignalDoc): HeadSink
```

### `each()`

```typescript
function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => Renderable
    /** Optional element-level transition hooks (from `@llui/transitions` — e.g.
     * `fade()`, `flip()`, `mergeTransitions(fade(), flip())`): `enter` animates
     * newly-inserted rows, `leave` defers a removed row's detach until its promise
     * resolves, and `onTransition` runs after each keyed reconcile so FLIP can
     * glide surviving rows to their new positions. Omitted ⇒ no animation (the
     * reconcile is unchanged). Never runs under SSR. */
    transition?: TransitionOptions
  },
): Mountable
```

### `eachArm()`

Compiled render-arm keyed list — the MID-TIER between {@link eachDirect}
(full direct construction) and the verbatim authoring {@link each}: the items
source is a verbatim runtime handle (a view-helper's call-site-bound signal the
compiler can't resolve), but the ROW is a compiled `() => [...]` arm whose
binding producers read the combined row ctx (`ctx.item` / `ctx.index`) directly
— no per-row item/index handle allocation. Un-lowerable children inside the arm
(a nested `show` on a state handle, a helper call without the row param) stay
verbatim and run via the authoring path within the row build. Emitted by the
compiler's pass-2 helper-each lowering when the row factory bails on a
structural child.

```typescript
function eachArm<T>(
  items: Signal<readonly T[]>,
  key: (item: T) => string | number,
  render: (getCtx: () => RowCtx<T>) => Renderable,
  stateDeps?: readonly string[],
): Mountable
```

### `eachDirect()`

Direct-construction keyed list. Same keyed reconcile as {@link each}, but each
row is built by `row` (a {@link RowFactory}: direct DOM + binding specs wired by
node reference) instead of authoring helpers — the compiled fast path. The
factory's spec `produce(ctx)` reads the row ctx `{ item, state, index }`.
`stateDeps` names the component-state paths the factory's bindings read (the
compiler passes the collected set, often empty); omitted (legacy emissions),
it falls back to whole-state so `ctx.state` reads stay live.

```typescript
function eachDirect<T>(
  items: Signal<readonly T[]>,
  key: (item: T) => string | number,
  row: RowFactory,
  stateDeps?: readonly string[],
): Mountable
```

### `el()`

Build an element. `on*` function props become event listeners; `react(...)`
props become reactive bindings; everything else is a static attribute. Returns a
`Mountable` that creates the element and materializes its children when placed.

```typescript
function el(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
): Mountable
```

### `elNS()`

Build an SVG-namespaced element (svg/path/g/circle/…). Same prop/child
semantics as `el`, via createElementNS.

```typescript
function elNS(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
): Mountable
```

### `foreign()`

Embed an imperative library. Declared `state` signals are materialized to
LiveSignals for `mount`. A REAL runtime helper (like text/each/show/branch):
the compiler lowers a direct-view `foreign()` to `signalForeign`, but in
view-helper functions / uncompiled code it runs here — converting each declared
state HANDLE to its `{produce, deps}` spec and delegating to `signalForeign`.

```typescript
function foreign<Inst, State extends Record<string, Signal<unknown>>>(spec: {
  tag?: string
  state?: State
  mount: (args: {
    el: Element
    state: { [K in keyof State]: LiveSignal<State[K] extends Signal<infer T> ? T : unknown> }
  }) => Inst
  unmount?: (instance: Inst) => void
}): Mountable
```

### `htmlAttr()`

Set attribute(s) on `<html>` (e.g. `htmlAttr({ lang })`). Each attribute
dedups independently and restores its pre-existing value on unmount.

```typescript
function htmlAttr(attrs: Record<string, HeadValue<string | boolean | null>>): Mountable
```

### `hydrateSignalApp()`

Hydrate a signal component over server-rendered HTML in `container`. Builds the
client tree against `serverState` (matching the SSR render) and atomically
swaps it in — server HTML stays visible until the swap, so no flash. init()'s
effects are skipped by default (already run on the server); pass
`runInitEffects: true` for init()s that no-op on the server.

```typescript
function hydrateSignalApp<S, M, E = never>(
  target: Element | MountTarget,
  def: SignalComponentDef<S, M, E>,
  serverState: S,
  options?: { runInitEffects?: boolean; contexts?: ReadonlyMap<symbol, unknown> },
): SignalComponentHandle<S, M>
```

### `isMountable()`

```typescript
function isMountable(v: unknown): v is Mountable
```

### `isSignalHandle()`

```typescript
function isSignalHandle(v: unknown): v is SignalHandle<unknown>
```

### `lazy()`

Load a signal component asynchronously: render `fallback()` immediately, then
swap in the loaded component when `loader()` resolves (or `error(err)` on
reject). Identity at runtime — a real runtime helper (not compiled away), so
view-helper composition and uncompiled tests can call it directly.

```typescript
function lazy<LS = unknown, LM = unknown, LE = unknown>(
  opts: SignalLazyOptions<LS, LM, LE>,
): Mountable
```

### `link()`

Add a `<link>` tag (canonical, preload, stylesheet, …). Dedups by `rel`+`href`.

```typescript
function link(attrs: LinkAttrs): Mountable
```

### `mergeStaticHead()`

Merge a static `+Head.ts` head string with collected component head, letting
component entries WIN: any `<title>` / `<meta name|property>` in `staticHead`
whose key the component also set is stripped, so the document never carries two
`<title>`s (the browser would silently use the first). Returns
`strippedStatic + collected.head`.

```typescript
function mergeStaticHead(staticHead: string, collected: CollectedHead): string
```

### `meta()`

Add a `<meta>` tag. Dedups by `name`/`property`/`httpEquiv`/`charset`.

```typescript
function meta(attrs: MetaAttrs): Mountable
```

### `mountable()`

Wrap a build closure as a `Mountable`. `build` runs (with a live `ctx`) when the
Mountable is placed — see `populate`/`runBuild`. Public so adapter packages
(`@llui/vike`'s `pageSlot`) and raw-DOM interop can produce placeable view content:
`mountable(() => someRawNode)`. Note the build runs once per placement, so a build
that returns a captured node (rather than creating a fresh one) reintroduces the
single-parent footgun — create the node inside the closure.

```typescript
function mountable(build: () => Node): Mountable
```

### `mountApp()`

Mount a signal component into a container.

```typescript
function mountApp<S, M, E = never>(
  container: Element,
  def: SignalComponentDef<S, M, E>,
  opts?: MountSignalOptions<S>,
): SignalComponentHandle<S, M>
```

### `mountSignal()`

Mount a signal view: build the nodes (collecting bindings), attach them at the
target, and wire a chunked-mask reconciler over the collected bindings.
For a `container` target, 'append' (fresh mount) leaves existing children and
'replace' swaps server HTML out atomically (hydration). For an `anchor` target,
the nodes are inserted immediately after the anchor comment and bracketed by a
synthesized end sentinel — `dispose()` removes that bracketed region.
`seedContexts` seeds the build's root context values (see `runBuild`); used by
adapters mounting a nested build whose providers live in a different pass.

```typescript
function mountSignal(
  target: Element | MountTarget,
  initial: unknown,
  build: () => Renderable,
  modeOrSeed?: 'append' | 'replace' | ReadonlyMap<symbol, unknown>,
  seedContexts?: ReadonlyMap<symbol, unknown>,
  getState?: () => unknown,
): SignalMount
```

### `mountSignalComponent()`

Mount a signal component and drive its update loop. The target is a container
`Element` (fresh mount appends; hydration replaces) OR a `MountTarget`
descriptor — including `{ anchor }` for adapters mounting a nested layer as
siblings of a slot anchor. With `opts.hydrate`, takes over server-rendered
HTML (see MountSignalOptions).

```typescript
function mountSignalComponent<S, M, E = never>(
  target: Element | MountTarget,
  def: SignalComponentDef<S, M, E>,
  opts?: MountSignalOptions<S>,
): SignalComponentHandle<S, M>
```

### `normalizeUpdateResult()`

Normalize an `init()` / `update()` result — a `[state, effects]` tuple or a
bare `state` (the convenience return) — to a `[state, effects]` pair. This is
the ONE place the `[S, E[]] | S` heuristic lives; component, SSR, and (later)
`@llui/test` / `@llui/vike` all route through it so the shape decision never
diverges.
The heuristic: a 2-element array whose SECOND element is itself an array is
read as `[state, effects]`; anything else is a bare state with no effects.
KNOWN AMBIGUITY (deliberately unchanged — dropping the bare-`S` convenience is
a repo-wide breaking ripple, out of scope here): a state that is ITSELF a
2-tuple whose second element is an array (e.g. the whole state is
`[number, string[]]`) is mis-read as `[state, effects]`. Such a state must be
returned explicitly as `[state, []]`.

```typescript
function normalizeUpdateResult<S, E>(r: [S, E[]] | S): [S, E[]]
```

### `noscript()`

Add a `<noscript>` with `body` as its text content.

```typescript
function noscript(body: HeadValue<string>): Mountable
```

### `onMount()`

Register a callback to run after the surrounding view's nodes are mounted,
receiving the mounted parent element. Returning a function registers a
teardown (run on unmount / dispose). Returns a marker node for the view array.

```typescript
function onMount(cb: (root: Element) => void | (() => void)): Mountable
```

### `onTeardown()`

Register a teardown to run when the owning scope is disposed (unmount). Public
companion to {@link registerBinding} for sibling modules. Must be called during
a build.

```typescript
function onTeardown(fn: () => void): void
```

### `pathHandle()`

A path-rooted handle: `produce` resolves `base` from the binding state;
`peek` reads the live value via `get`. `at` extends the path; `map` derives.
`rowLocal` marks a handle rooted at a ROW ctx (the internal `rowHandle` for
`item`/`index`); it propagates through `.at`/`.map` so row locality is carried,
never string-inferred. Component-state handles default to `false`.

```typescript
function pathHandle<T>(get: () => unknown, base: string, rowLocal = false): SignalHandle<T>
```

### `portal()`

Render `content` into `target` (default `document.body`) instead of inline —
for overlays (dialog/popover/toast). The content's bindings join the current
scope (so it stays reactive); a teardown removes the nodes on unmount/dispose.
Returns an inline placeholder comment.

```typescript
function portal(content: () => Renderable, target?: Element): Mountable
```

### `provide()`

Provide `value` for `context` to everything `render` builds, then restore.

```typescript
function provide<T>(context: Context<T>, value: T, render: () => Renderable): Mountable
```

### `react()`

```typescript
function react(produce: Producer, deps: readonly string[], componentRooted?: boolean): Reactive
```

### `registerBinding()`

Register a reactive binding into the ACTIVE build whose `commit` applies the
value to a custom target (not an inline element). Public so sibling modules
(e.g. head/metadata management) can build bindings with non-element commit
targets that still ride the component's one chunked-mask reconciler — `produce`
runs on mount and whenever `deps` chunks go dirty; `commit` gets the new value.
Must be called during a build (inside a `mountable(...)` recipe).

```typescript
function registerBinding(
  deps: readonly string[],
  produce: (state: unknown) => unknown,
  commit: (value: unknown) => void,
): void
```

### `renderNodes()`

Build a signal component's DOM tree on the server, returning the (detached)
nodes plus a `dispose` that runs the build's teardowns. The caller composes /
serializes the nodes; effects are NOT dispatched (server render is pure).
For persistent layouts, compose multiple `renderNodes` results before
`serializeNodes` so the layout/page trees are stitched at the slot position.

```typescript
function renderNodes<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  initialState: S | undefined,
  env: ServerDoc,
  contexts?: ReadonlyMap<symbol, unknown>,
): { nodes: readonly Node[]; dispose: () => void }
```

### `renderToString()`

Render a signal component to an HTML string against the initial state (or a
provided override). `env` is a server `DomEnv` from `@llui/dom/ssr/jsdom` or
`@llui/dom/ssr/linkedom`.

```typescript
function renderToString<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  initialState: S | undefined,
  env: ServerDoc,
): string
```

### `rowHandle()`

A ROW-rooted path handle (`item`/`index` inside an `each`/`virtualEach` row).
Identical to {@link pathHandle} but branded `rowLocal` — so a spec built from it
(or from `.at`/`.map` off it) reads the row ctx and is NOT rebased to
`ctx.state`. This is the emission target for the compiled each-arm prelude
(`const item = rowHandle(getCtx, 'item')`) and the authoring `each`/`virtualEach`
item/index handles.

```typescript
function rowHandle<T>(get: () => unknown, base: string): SignalHandle<T>
```

### `script()`

Add a `<script>` (external via `src`, or inline via `body`). Dedups by static
`id` or `src`; otherwise anonymous (keyed by stable construction order).

```typescript
function script(attrs: ScriptAttrs = {}, body?: HeadValue<string>): Mountable
```

### `serializeNodes()`

Serialize an array of (already-built) DOM nodes to an HTML string. Used by
adapters (`@llui/vike`) that compose layout + page node trees before one final
serialization pass.

```typescript
function serializeNodes(nodes: readonly Node[]): string
```

### `show()`

```typescript
function show<T>(
  cond: Signal<T>,
  render: (narrowed: Signal<NonNullable<T>>) => Renderable,
  orElse?: () => Renderable,
  transition?: TransitionOptions,
): Mountable
```

### `signalBranch()`

Discriminated-union render. Mounts the arm matching the discriminant's current
value; swaps arms when it changes (the old arm unmounts, the new one mounts as
a child scope). Same-value updates do NOT remount — the mounted arm's child
scope handles its own inner reactivity. An absent arm renders nothing.

```typescript
function signalBranch(
  disc: ShowCond,
  arms: Readonly<Record<string, () => Renderable>>,
  transition?: TransitionOptions,
): Mountable
```

### `signalEach()`

Keyed list primitive. A structural binding gated on the list's deps (items
path + row-state paths); on change it reconciles by key. Each row is its OWN
signal scope mounted on a combined `{ item, state }` context — so a row reacts
to its item AND to component state, with per-row, per-binding gating (a shared
state change fans out only to the row bindings that read it; item changes hit
only that row). Kept rows are mutated in place, never recreated.
Reorder is move-minimizing via a longest-increasing-subsequence pass over the
rows' previous DOM positions: only `n − |LIS|` rows move, so a 2-row swap is 2
DOM moves and a single removal is 0 — not the O(n) re-insert the naive cursor
walk degraded to (swap/remove were ~6×/4× slower than peer frameworks).

```typescript
function signalEach<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  renderRow: (getCtx: () => RowCtx<T>) => Renderable,
  extraDeps?: readonly string[],
  transition?: TransitionOptions,
): Mountable
```

### `signalEachDirect()`

Direct-construction keyed list: same keyed reconcile as {@link signalEach},
but each row is built by a {@link RowFactory} (direct DOM + direct binding
wiring) instead of running authoring helpers per row. The compiler-emitted fast
path for lowerable rows; also usable hand-written.

```typescript
function signalEachDirect<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  rowFactory: RowFactory,
  extraDeps?: readonly string[],
  transition?: TransitionOptions,
): Mountable
```

### `signalForeign()`

Imperative-subtree boundary. Declared `state` signals are materialized to
LiveSignals (peek + bind) and handed to `mount`, which builds a third-party
instance into the host element. The signals stay reactive: when a declared
input changes, its LiveSignal fires bound callbacks. `unmount` runs on the
owning component's dispose. Communicate OUT via `send` (closed over from the
view bag). The analyzer sees the declared deps; the imperative body is opaque.

```typescript
function signalForeign<Inst, State extends Record<string, SignalSpec<unknown>>>(
  spec: ForeignSpec<Inst, State>,
): Mountable
```

### `signalLazy()`

Load a signal component asynchronously. Renders `fallback()` immediately as
siblings of an anchor comment (built in the CURRENT build, so the fallback is
reactive). When `loader()` resolves, the fallback region is removed and the
loaded component is mounted via `mountSignalComponent({ anchor, mode:'append' })`
— reusing the anchor-mount infra (nodes inserted after the anchor, bracketed by
an `llui-mount-end` sentinel; its handle owns that region's update loop and
dispose). If the loader rejects, `error(err)` is swapped in (or nothing).
If the surrounding build is torn down before the loader settles, a cancelled
flag skips the deferred mount; any already-mounted child handle is disposed.

```typescript
function signalLazy<LS = unknown, LM = unknown, LE = unknown>(
  opts: SignalLazyOptions<LS, LM, LE>,
): Mountable
```

### `signalShow()`

Conditional render. Mounts `render`'s content when the condition is truthy; if
an `orElse` arm is given, mounts it when falsy (otherwise nothing). The mounted
arm is its OWN scope that reads the owning component's state, registered as a
child of the owning scope — so while mounted it receives state updates (its
bindings re-run when THEIR deps change, not just when the condition flips).
Toggling the condition swaps arms; a same-truthiness update does NOT remount.

```typescript
function signalShow(
  cond: ShowCond,
  render: () => Renderable,
  orElse?: () => Renderable,
  transition?: TransitionOptions,
): Mountable
```

### `signalText()`

A reactive text node bound to a signal accessor. Returns a `Mountable` that
builds the text node and registers its binding when placed. `componentRooted`
(set by the authoring layer from the origin handle) drives correct row rebasing;
compiler-emitted calls omit it and rely on dep-string inference.

```typescript
function signalText(
  produce: Producer,
  deps: readonly string[],
  componentRooted?: boolean,
): Mountable
```

### `signalUnsafeHtml()`

Render a raw HTML string as live DOM nodes, inline between anchor comments (no
wrapper element). Reactive: when the bound string changes, the previously
inserted fragment is removed and the new HTML parsed in. The parsed nodes carry
NO reactive bindings — `unsafeHtml` is an escape hatch for pre-rendered markup
(markdown, syntax highlighting). The caller is responsible for trust/sanitization.

```typescript
function signalUnsafeHtml(
  produce: Producer,
  deps: readonly string[],
  componentRooted?: boolean,
): Mountable
```

### `signalVirtualEach()`

Virtualized keyed list — only the rows in the scroll viewport (+overscan) exist
in the DOM. A scroll container (fixed `containerHeight`, `data-virtual-container`)
holds an inner spacer (`data-virtual-spacer`) sized to the total height; each
visible row is absolutely positioned (`translateY`) at its cumulative offset.
On scroll the visible window is recomputed and rows are reconciled BY KEY using
the same per-row machinery as `signalEach` (per-row sub-build via `runBuild`
with `inherit`, a row scope mounted on a `{ item, state, index }` ctx, teardowns
on removal). Rows scrolled out are disposed; rows scrolled in are built. The
window also recomputes when `items` changes (a spec gated on `items.deps`).
`itemHeight` is a uniform `number` (O(1) windowing) or a per-item function
`(item, index) => number` for variable-height rows (cumulative offsets via a
prefix sum, rebuilt when `items` changes). Heights come from the data —
measured/auto heights are not supported.

```typescript
function signalVirtualEach<T>(spec: VirtualEachSpec<T>): Mountable
```

### `staticText()`

A static text node.

```typescript
function staticText(value: string): Mountable
```

### `style()`

Add an inline `<style>` with `css` as its text content.

```typescript
function style(css: HeadValue<string>, attrs: StyleAttrs = {}): Mountable
```

### `tagSend()`

Library helper for `*.connect` implementations: tags an event
handler with the variants it dispatches at runtime, so the binding
registers them when the user spreads the bag onto an element.
Resolution rules — choose whichever is defined and non-empty:

1. **`send.__lluiVariants`** (translator pattern). When the user
   passed a compiler-tagged dispatch translator like
   `(m) => dispatch({type: 'Auth/UserMenu'})`, `send` itself
   carries the user-side variants the translator forwards. We
   surface those — the agent should see what `update()` actually
   receives, not the library's internal Msg shape.
2. **`libraryVariants`** fallback. When `send` is the user's raw
   component send (no translator), the library's internal Msgs flow
   directly into `update()`, so the library's own variants ARE the
   user variants. Library author hand-lists them once per handler.
   Returns `fn` mutated (via `Object.assign`) so the same reference
   remains identity-equal — important for downstream code that diffs
   handlers across re-bindings.
   @example

```ts
import { tagSend } from '@llui/dom'
export function connect<S>(get, send, opts) {
  return {
    trigger: {
      onClick: tagSend(send, ['Open'], () => send({ type: 'open' })),
    },
  }
}
```

```typescript
function tagSend<F extends (...args: never[]) => unknown>(
  send: unknown,
  libraryVariants: readonly string[],
  fn: F,
): F
```

### `text()`

```typescript
function text(value: Reactive<string | number>): Mountable
```

### `title()`

Set the document `<title>`. Reactive when given a signal. Last writer in the
tree (deepest layout/page) wins; restored on unmount. Combine with
{@link titleTemplate}.

```typescript
function title(value: HeadValue<string>): Mountable
```

### `titleTemplate()`

A `%s` template the active {@link title} is interpolated into — e.g.
`titleTemplate('%s · LLui')` + `title('Docs')` → `Docs · LLui`. Applies only
while a title is set.

```typescript
function titleTemplate(value: HeadValue<string>): Mountable
```

### `unsafeHtml()`

Render a raw HTML string as live DOM nodes (escape hatch for pre-rendered
markup — markdown, syntax highlighting). Reactive on a `Signal<string>`; a
plain string renders once. The HTML is inserted as-is — the caller owns
trust/sanitization.

```typescript
function unsafeHtml(value: Reactive<string>): Mountable
```

### `useContext()`

Read the nearest provided value for `context`, or its default. Outside a
signal build (e.g. a unit test calling `connect()` directly) no provider can
exist, so the default is returned rather than throwing.

```typescript
function useContext<T>(context: Context<T>): T
```

### `virtualEach()`

Virtualized keyed list — only the rows in the scroll viewport (+overscan)
exist in the DOM. `items` is a signal handle (like `each`); the render callback
receives per-row `item` + `index` signal handles. `itemHeight` is either a
uniform `number` (O(1) windowing) or a per-item `(item, index) => number` for
variable-height rows (cumulative offsets via a prefix sum, rebuilt when `items`
changes). Heights come from the data — measured/auto heights are not supported.

```typescript
function virtualEach<T>(opts: {
  items: Signal<readonly T[]>
  key: (item: T) => string | number
  itemHeight: number | ((item: T, index: number) => number)
  containerHeight: number
  overscan?: number
  class?: string
  render: (item: Signal<T>, index: Signal<number>) => Renderable
}): Mountable
```

## Types

### `AttrValue`

```typescript
export type AttrValue = Reactive<string | number | boolean | null | undefined>
```

### `ChildNode`

A child slot: a lazy `Mountable` (everything LLui builds — elements, text, and
structural primitives — is a Mountable, materialized at placement), or a bare
string/number coerced to a static text node at append time (so `div(['hi', 42])`
works without an explicit `text(...)` — the same coercion every mainstream framework
does). There is no bare `Node` here: a node lives in one place, so exposing one would
reintroduce the silent double-placement footgun. Wrap raw DOM via `foreign`.

```typescript
export type ChildNode = Mountable | string | number
```

### `ElProps`

Props for an element helper. Well-known `on*` handlers (see {@link ElEventMap})
get their precise DOM event type, so `onClick: (e) => e.clientX` infers
`e: MouseEvent` with no annotation. Every other key — attributes, `data-*`,
`aria-*`, signals, and less-common events — is an {@link AttrValue} or a
loosely-typed handler via the index signature, which also lets `connect()`
part bags (with their own pre-typed handlers) spread in cleanly.
The handler index falls back to `any` ON PURPOSE: a stricter index type would
be a supertype of the precise `on*` handlers and reject them (function params
are contravariant), so the precise types live in the mapped half and the
index stays permissive.

```typescript
export type ElProps = {
  [K in keyof ElEventMap]?: (ev: ElEventMap[K]) => void
} & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: AttrValue | ((ev: any) => void) | undefined
}
```

### `EventHandler`

```typescript
export type EventHandler = (ev: Event) => void
```

### `HeadTarget`

Where a head entry lands: a `<head>` element, an attribute on `<html>`/`<body>`,
or the (template-composed) `<title>`.

```typescript
export type HeadTarget =
  | { kind: 'element'; tag: string }
  | { kind: 'attr'; on: 'html' | 'body'; name: string }
  | { kind: 'title' }
  | { kind: 'titleTemplate' }
```

### `HeadValue`

A head value: a plain value (committed once) or a `Signal` (committed on
mount and on every change). Mirrors how `foreign` accepts handles-or-values.

```typescript
export type HeadValue<T> = T | Signal<T>
```

### `MountTarget`

Where a `mountSignal` call attaches its built nodes. A `container` element
(the common case — append, or replace its children on hydration) OR an
`anchor` comment, for adapters like `@llui/vike` that mount a nested layer as
siblings of a slot anchor without owning the parent element. The owned region
is bracketed by the anchor and a synthesized end sentinel; `dispose()` removes
exactly that region (leaving the anchor + outer siblings intact).

```typescript
export type MountTarget =
  | { container: Element; mode?: 'append' | 'replace' }
  // `mode: 'replace'` (hydration) first removes any existing server region
  // between the anchor and the next `llui-mount-end` sentinel, then mounts fresh
  // — mirroring container hydration's atomic swap (no claim of server nodes).
  | { anchor: Comment; mode?: 'append' | 'replace' }
```

### `PathValue`

Resolve the value type at a dot-separated `path` of `T`, bubbling
nullability: once any segment introduces `null`/`undefined` (optional field,
nullable field, array index), it carries through to the result.

```typescript
export type PathValue<T, S extends string> = [Extract<T, null | undefined>] extends [never]
  ? S extends `${infer Head}.${infer Tail}`
    ? PathValue<GetKey<T, Head>, Tail>
    : GetKey<T, S>
  : PathValue<NonNullable<T>, S> | Extract<T, null | undefined>
```

### `PropValue`

```typescript
export type PropValue = string | number | boolean | null | Reactive | EventHandler
```

### `Reactive`

A reactive value in a slot: a signal of T, or a plain T.

```typescript
export type Reactive<T> = Signal<T> | T
```

### `Renderable`

The result of a render callback / view: lazy `Mountable`s, materialized at
placement by `populate`/`runBuild`.

```typescript
export type Renderable = readonly Mountable[]
```

### `RowFactory`

Builds a fresh {@link DirectRow} (new nodes + binding closures) per row.
`getCtx` exposes the row's LIVE `{ item, state, index }` ctx (the same box the
binding `produce(ctx)` reads), so a row's event-handler closures can read the
current row item at event time — `onClick: () => send({ type: 'toggle', id:
getCtx().item.id })` — the direct-path analogue of the render path's
`pathHandle(getCtx, 'item')`. Rows with no item-referencing handlers ignore it.

```typescript
export type RowFactory = (doc: SignalDoc, getCtx: () => RowCtx<unknown>) => DirectRow
```

### `Send`

```typescript
export type Send<M> = (msg: M) => void
```

### `ServerDoc`

A server DOM document: the node-factory subset the build needs. A `DomEnv`
from `@llui/dom/ssr/jsdom` or `@llui/dom/ssr/linkedom` satisfies it.

```typescript
export type ServerDoc = SignalDoc
```

### `StateHandle`

The bag's `state` is a `Signal<S>` so authored handler code reads it the same
way as the view (`state.at('x').peek()`). At runtime it's a read handle: `.at`
narrows, `.peek` reads the current value; `.map` is a view-build-time concept
and throws if reached on the handle.

```typescript
export type StateHandle<S> = Signal<S>
```

### `ValidPath`

The union of all valid dot-separated paths of `T` — both intermediate
(object) paths and leaf paths. Arrays contribute `${number}` indices,
`${number}.<sub>` nested paths, and `'length'`. Navigation descends through
nullable/optional fields (via `NonNullable`), bounded by {@link PathDepthBudget}.

```typescript
export type ValidPath<T, D extends number = PathDepthBudget> = T extends null | undefined
  ? ValidPath<NonNullable<T>, D>
  : T extends readonly (infer U)[]
    ? D extends 0
      ? `${number}` | 'length'
      : `${number}` | `${number}.${ValidPath<U, DecrDepth[D]>}` | 'length'
    : T extends object
      ? {
          [K in keyof T & string]: NonNullable<T[K]> extends object
            ? D extends 0
              ? K
              : K | `${K}.${ValidPath<NonNullable<T[K]>, DecrDepth[D]>}`
            : K
        }[keyof T & string]
      : never
```

## Interfaces

### `BaseAttrs`

Attributes accepted by {@link base}.

```typescript
export interface BaseAttrs {
  href?: HeadValue<string>
  target?: HeadValue<string>
}
```

### `BindingDebugInfo`

```typescript
export interface BindingDebugInfo {
  index: number
  mask: number
  lastValue: unknown
  kind: string
  key: string | undefined
  dead: boolean
  perItem: boolean
}
```

### `BindingError`

A binding-evaluation failure surfaced to a `setOnBindingError` hook. Shape
matches the agent's dispatch-envelope `drain.errors` entries.

```typescript
export interface BindingError {
  kind: string
  key?: string
  message: string
  stack?: string
}
```

### `BindingLocation`

```typescript
export interface BindingLocation {
  bindingIndex: number
  kind: string
  key: string | undefined
  mask: number
  lastValue: unknown
  /** How the binding's node relates to the matched element. */
  relation: 'self' | 'text-child' | 'comment-child'
}
```

### `BindingSpec`

A reactive binding: the dependency paths it reads + an accessor (`produce`)
and a `commit` that applies the value. This is the compiler transform's output
target, and the contract a {@link DirectRow} (compiled `each` row) supplies.

```typescript
export interface BindingSpec {
  deps: readonly string[]
  produce: Producer
  commit: (value: unknown) => void
  // A structural primitive's spec (show/branch/each): its `produce` is identity
  // and `commit` reconciles arms/rows owning child scopes. Structural specs make
  // themselves row-aware at build time (see `c.inRow`), so the enclosing `each`'s
  // value-spec rebasing must SKIP them rather than rewrite their identity produce.
  structural?: boolean
  // Root discriminant for row rebasing — set from the ORIGIN handle, so row
  // locality never depends on string-inferring `item`/`index`/`state` prefixes
  // (which collide with a component-state field literally named that). `true` ⇒
  // the produce reads the COMPONENT state (rebase to `ctx.state` inside a row);
  // `false` ⇒ it already reads the row ctx (an item/index handle, or an
  // already-rebased spec — leave it). `undefined` ⇒ a compiler-emitted spec with
  // no handle origin: fall back to the legacy `isRowLocalDep` string inference
  // (compiled rows use the `item.*`/`state.*` ctx convention, so this is sound).
  componentRooted?: boolean
}
```

### `CollectedHead`

The serialized output of a server render's head collection.

```typescript
export interface CollectedHead {
  /** `<head>` element markup (title/meta/link/…), each marked `data-llui-head`. */
  head: string
  /** Attribute string for `<html …>` (leading space included), already escaped. */
  htmlAttrs: string
  /** Attribute string for `<body …>` (leading space included), already escaped. */
  bodyAttrs: string
  /** Dedup keys present in `head` (e.g. `title`, `meta:name=description`). Used by
   * {@link mergeStaticHead} to strip colliding tags from a static `+Head.ts`. */
  keys: readonly string[]
}
```

### `CollectHeadSink`

A server-side {@link HeadSink} that collects entries and serializes them. Seed
it via {@link HEAD_SINK} before rendering, then call `serialize(env)`.

```typescript
export interface CollectHeadSink extends HeadSink {
  serialize(doc: SignalDoc): CollectedHead
}
```

### `ComponentBag`

```typescript
export interface ComponentBag<S, M> {
  state: Signal<S>
  send: (msg: M) => void
  /** Coalesce a burst of `send`s into ONE reconcile (see the handle's `batch`).
   * Reducers/effects still run per message; only the DOM commit is deferred to the
   * outermost `batch` exit. Use it to drain a burst of dispatches (e.g. a stream
   * frame) from a handler/subscription as a single re-render. */
  batch: (fn: () => void) => void
}
```

### `ComponentInfo`

```typescript
export interface ComponentInfo {
  name: string
  file: string | null
  line: number | null
  /** Identifies which runtime mounted the component. */
  runtime?: 'signal' | 'legacy'
}
```

### `Context`

```typescript
export interface Context<T> {
  readonly id: symbol
  readonly default: T
}
```

### `CoverageSnapshot`

Per-variant Msg coverage tracker — dev-only.
Records each dispatched message's discriminant (or `<non-discriminant>`
for objects missing a `type` field) along with the message index it
fired at. Consumed by the `llui_coverage` MCP tool to surface untested
Msg variants: any variant declared in the compiled `__msgSchema` that
never fired in the current session shows up in `neverFired`.
Zero cost in production: `installSignalDebug` is the only caller, and it
never runs in prod builds. Hot path is one optional-chain read per
dispatched message (`ci._coverage?.record(...)`).

```typescript
export interface CoverageSnapshot {
  fired: Record<string, { count: number; lastIndex: number }>
  neverFired: string[]
}
```

### `DirectRow`

A compiler-emitted (or hand-written) direct `each` row: real DOM nodes built
with direct ops + binding specs wired by DIRECT node reference — bypassing the
authoring-helper / `Mountable` / `populate` / `pathHandle` machinery the
generic row path runs per row. The factory runs per row under the build ctx;
each spec's `produce(ctx)` reads the row ctx (`{ item, state, index }`) and its
`commit` writes straight to the located node. See
`docs/proposals/v2-compiler/compiled-row-construction.md`.

```typescript
export interface DirectRow {
  nodes: Node[]
  bindings: readonly BindingSpec[]
}
```

### `DisposerEvent`

Dev-only disposer log entry, emitted once per `disposeLifetime` call
when the owning component instance has an `_disposerLog` ring buffer
installed by `installSignalDebug`.
`cause` is set by the structural primitive (each / branch / child)
immediately before calling `disposeLifetime`. When no cause was
explicitly set, `disposeLifetime` falls back to `'component-unmount'`.
`'app-unmount'` is reserved for the top-level `mountApp` teardown.
Used by the `llui_disposer_log` MCP tool to diagnose leaks on
structural transitions (e.g., branch swap that fails to release a
subscription registered in the old arm).

```typescript
export interface DisposerEvent {
  scopeId: string
  cause:
    | 'branch-swap'
    | 'each-remove'
    | 'show-hide'
    | 'scope-rebuild'
    | 'child-unmount'
    | 'app-unmount'
    | 'component-unmount'
  timestamp: number
}
```

### `DomEnv`

Minimal DOM surface that `@llui/dom`'s internals depend on. Passed to
`mountApp` / `hydrateSignalApp` / `renderToString` as a context object so
the runtime never reaches for `globalThis.document` directly.
Why an injected shape instead of a global shim:

1. **Bundler-friendly.** A Cloudflare Worker that imports
   `@llui/dom/ssr/linkedom` reaches only linkedom via its module
   graph. No `await import('jsdom')` appears in reachable source,
   so rollup doesn't inline the 9 MiB jsdom bundle.
2. **Concurrency-safe.** Two `renderToString` calls can pass
   different envs; no process-level singleton to collide on.
3. **Strict-isolate safe.** No `globalThis[key] = ...` mutation —
   Cloudflare workerd and Deno strict modes forbid it.
   The surface is deliberately narrow: exactly the methods and
   constructors the runtime touches. Grep `document\.` /
   `instanceof (HTMLElement|Element|...)` inside `@llui/dom/src` for
   the exhaustive set.

```typescript
export interface DomEnv {
  // ── Factories ────────────────────────────────────────────────────
  createElement(tag: string): Element
  createElementNS(ns: string, tag: string): Element
  createTextNode(text: string): Text
  createComment(text: string): Comment
  createDocumentFragment(): DocumentFragment
  /**
   * Used by `each()`'s fast clear/bulk-remove paths to delete a range
   * of siblings in one call. SSR adapters that don't need those paths
   * (jsdom + linkedom both do) can stub — the runtime tolerates a
   * missing range during SSR render, which never hits the bulk paths.
   */
  createRange(): Range

  // ── Node / element constructors ─────────────────────────────────
  // Exposed for `instanceof` checks in binding targeting + for any
  // rare site that needs to construct a node type directly.
  readonly Element: typeof Element
  readonly Node: typeof Node
  readonly Text: typeof Text
  readonly Comment: typeof Comment
  readonly DocumentFragment: typeof DocumentFragment
  readonly HTMLElement: typeof HTMLElement
  readonly HTMLTemplateElement: typeof HTMLTemplateElement
  readonly ShadowRoot: typeof ShadowRoot

  // ── Event constructor ───────────────────────────────────────────
  readonly MouseEvent: typeof MouseEvent

  /**
   * Parse an HTML fragment string into a `DocumentFragment`. Used by
   * `unsafeHtml()`. Browsers and jsdom parse via template-element
   * innerHTML; linkedom has its own fragment parser. Adapter chooses
   * the right mechanism.
   */
  parseHtmlFragment(html: string): DocumentFragment

  /**
   * Resolve a CSS selector against the env's root document. Used by
   * `portal()` to locate its target when `opts.target` is a string.
   *
   * Returns `null` when the selector doesn't match — portal callers
   * treat a null target as a no-op (render nothing), so adapters on
   * runtimes where no real document exists (detached linkedom, empty
   * shadow root, etc.) can safely return `null` here.
   *
   * Required — making this mandatory on the interface means a custom
   * env that forgets to wire up selector resolution fails compile
   * instead of silently falling back to `globalThis.document` at
   * render time (which would crash under Cloudflare Workers + other
   * strict-isolate runtimes). The three first-party envs
   * (`browserEnv`, `jsdomEnv`, `linkedomEnv`) all implement it.
   */
  querySelector(selector: string): Element | null

  /**
   * @internal Lets hot-path code (e.g. `el-split.ts`'s template-clone)
   * skip env indirection when the env wraps the browser globals. Only
   * set by `browserEnv()`.
   */
  readonly isBrowser?: boolean
}
```

### `EachDiff`

Per-each-block reconciliation diff, recorded once per update that
mutates an each() block's key set. Dev-only — populated when
`installSignalDebug` has initialized an `_eachDiffLog` on the instance.
`updateIndex` correlates with the message-history index recorded by
`devtools.ts` so tools can join diffs back to the message that caused
them. `eachSiteId` identifies the each() call site stably across
updates (currently derived from the block's index in the instance's
`structuralBlocks` array at creation time).

```typescript
export interface EachDiff {
  /**
   * Message-history index at the time the diff was emitted. When messages are
   * batched (multiple send() calls coalescing into one microtask), this is
   * the index of the LAST message in the batch — not necessarily the one that
   * caused the structural change. For per-message correlation, use
   * getMessageHistory with this index as an upper bound.
   */
  updateIndex: number
  /**
   * Stable-ish identifier for the each() call site. Currently derived from the
   * position of the block in `ComponentInstance.structuralBlocks` at the moment
   * of registration, formatted as `each#${N}`.
   *
   * Caveats for consumers:
   * - The counter includes ALL structural blocks (branches, shows, portals,
   *   eaches), not just eaches. So `each#3` means "the 4th structural block",
   *   not "the 4th each".
   * - Blocks registered inside a `branch` arm that switches away are spliced
   *   out; a subsequent each registration can reuse the same N.
   * - Across HMR reloads the ID may drift if the view's structural-block
   *   order changed.
   *
   * For precise correlation across updates, pair with `updateIndex` and the
   * enclosing component's state at that index (retrievable via
   * getMessageHistory).
   */
  eachSiteId: string
  added: string[]
  removed: string[]
  moved: Array<{ key: string; from: number; to: number }>
  reused: string[]
}
```

### `EachSource`

Items source for `signalEach`: an accessor reading the array out of the
component state, plus the dep paths the list depends on — the items path AND
any component-state paths the rows read (so the list reconciles on either).

```typescript
export interface EachSource<T> {
  items: (state: unknown) => readonly T[]
  deps: readonly string[]
  /** See {@link BindingSpec.componentRooted}: `true` when the items accessor reads
   * the COMPONENT state (so a nested each reads `ctx.state`, not the enclosing row
   * ctx). Set by the authoring layer from the items handle; unbranded → inference. */
  componentRooted?: boolean
}
```

### `EffectApi`

```typescript
export interface EffectApi<S, M> {
  send: (msg: M) => void
  state: Signal<S>
  /** Coalesce a burst of `send`s into ONE reconcile (see {@link ComponentBag.batch}). */
  batch: (fn: () => void) => void
  /** This mount's lifecycle {@link AbortSignal}. Aborted exactly once, on THIS
   * mount's `dispose()`. Each mount of a definition owns a distinct signal, so an
   * effect handler can key per-mount resources off it — pass it to `fetch`, or
   * `signal.addEventListener('abort', cleanup)` — and disposing one mount never
   * aborts a concurrent mount of the same definition. Prefer this over a
   * definition-level controller for anything whose lifetime is the mount's. */
  signal: AbortSignal
}
```

### `EffectMatch`

Match predicate for the mock registry. All provided fields must
match for the mock to fire:

- `type`: exact-match against the effect's `type` discriminant.
- `payloadPath`: dotted path into the effect object (e.g. `'url'` or
  `'body.key'`). When present without `payloadEquals`, presence of
  the path is sufficient.
- `payloadEquals`: strict (`===`) equality check at `payloadPath`.
  An empty match (no fields) matches every effect — callers should
  set at least `type` to avoid accidental catch-all.

```typescript
export interface EffectMatch {
  type?: string
  payloadPath?: string
  payloadEquals?: unknown
}
```

### `EffectTimelineEntry`

```typescript
export interface EffectTimelineEntry {
  effectId: string
  type: string
  phase: 'dispatched' | 'in-flight' | 'resolved' | 'resolved-mocked' | 'cancelled'
  timestamp: number
  /** Populated on `resolved` / `resolved-mocked` / `cancelled` entries; undefined on open phases. */
  durationMs?: number
}
```

### `ElementReport`

```typescript
export interface ElementReport {
  selector: string
  tagName: string
  attributes: Record<string, string>
  classes: string[]
  dataset: Record<string, string>
  text: string
  computed: {
    display: string
    visibility: string
    position: string
    width: number
    height: number
  }
  boundingBox: { x: number; y: number; width: number; height: number }
  bindings: Array<{
    bindingIndex: number
    kind: string
    mask: number
    lastValue: unknown
    relation: 'self' | 'text-child' | 'comment-child'
  }>
}
```

### `ForeignSpec`

```typescript
export interface ForeignSpec<Inst, State extends Record<string, SignalSpec<unknown>>> {
  /** host element tag (default 'div') */
  tag?: string
  /** declared reactive inputs — materialized to LiveSignals for `mount` */
  state?: State
  /** build the imperative instance into the host element */
  mount: (args: {
    el: Element
    state: { [K in keyof State]: LiveSignal<State[K] extends SignalSpec<infer T> ? T : unknown> }
  }) => Inst
  /** tear down the instance (runs on the owning component's dispose) */
  unmount?: (instance: Inst) => void
}
```

### `HeadController`

A single registered writer's handle: the binding `set`s its value(s) here;
teardown `release`s it.

```typescript
export interface HeadController {
  set(attrs: Record<string, unknown>, text?: string): void
  release(): void
}
```

### `HeadSink`

The coordinator a head primitive commits through. One per app document (client)
or one per render (server collector).

```typescript
export interface HeadSink {
  register(key: string, target: HeadTarget): HeadController
}
```

### `HydrationDivergence`

```typescript
export interface HydrationDivergence {
  path: string
  kind: 'attribute' | 'text' | 'structural'
  server: unknown
  client: unknown
}
```

### `LifetimeNode`

Lifetime-tree node for the debug/agent surface. A serialized snapshot
of the live scope tree — the signal devtools surface and MCP tools
read this shape to render scope lifecycle.

```typescript
export interface LifetimeNode {
  scopeId: string
  kind: 'root' | 'show' | 'each' | 'branch' | 'scope' | 'child' | 'portal' | 'foreign'
  active: boolean
  children: LifetimeNode[]
}
```

### `LinkAttrs`

Attributes accepted by {@link link}.

```typescript
export interface LinkAttrs {
  rel?: string
  href?: HeadValue<string>
  [attr: string]: HeadValue<string> | undefined
}
```

### `LiveSignal`

A materialized signal handed to imperative code at the `foreign` boundary.
Minimal on purpose — all derivation stays in the declarative `state:`
declaration, so this is a read+subscribe handle only.

- `peek()` — one-shot, non-reactive read (same verb as {@link Signal}).
- `bind(cb)` — fires `cb` synchronously with the current value, then on every
  change; returns an unsubscribe. Mount-time `bind`s auto-dispose on unmount.
  Deliberately no `on` (event-listener vocabulary trains a redundant
  peek-then-subscribe), no change-only mode, and no `at`/`map`/`derived`.

```typescript
export interface LiveSignal<T> {
  peek(): T
  bind(cb: (value: T) => void): () => void
}
```

### `LluiDebugAPI`

The relay-callable debug surface of a mounted LLui component.
Required methods are implemented by every runtime (and by
`installSignalDebug`). Optional methods are binding/scope/effect
introspection that only the legacy runtime provides — callers must
feature-detect and degrade when they are absent.

```typescript
export interface LluiDebugAPI {
  // ── Core (always implemented) ──────────────────────────────────
  getState(): unknown
  send(msg: unknown): void
  flush(): void
  getMessageHistory(opts?: { since?: number; limit?: number }): MessageRecord[]
  evalUpdate(msg: unknown): { state: unknown; effects: unknown[] }
  exportTrace(): {
    lluiTrace: 1
    component: string
    generatedBy: string
    timestamp: string
    entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
  }
  clearLog(): void
  validateMessage(msg: unknown): ValidationError[] | null
  searchState(query: string): unknown
  getMessageSchema(): MessageSchemaInfo | object | null
  getStateSchema(): object | null
  getEffectSchema(): object | null
  getComponentInfo(): ComponentInfo
  snapshotState(): unknown
  restoreState(snap: unknown): void

  // ── Binding / scope introspection (legacy-only; optional) ──────
  getBindings?(): BindingDebugInfo[]
  whyDidUpdate?(bindingIndex: number): UpdateExplanation
  getMaskLegend?(): Record<string, number> | null
  decodeMask?(mask: number): string[]
  getBindingsFor?(selector: string): BindingLocation[]
  getBindingGraph?(): Array<{ statePath: string; bindingIndices: number[] }>
  getBindingSource?(bindingIndex: number): { file: string; line: number; column: number } | null
  forceRerender?(): { changedBindings: number[] }
  getEachDiff?(sinceIndex?: number): EachDiff[]
  getScopeTree?(opts?: { depth?: number; scopeId?: string }): LifetimeNode
  getDisposerLog?(limit?: number): DisposerEvent[]

  // ── DOM inspection (legacy-only; optional) ─────────────────────
  inspectElement?(selector: string): ElementReport | null
  getRenderedHtml?(selector?: string, maxlength?: number): string
  dispatchDomEvent?(
    selector: string,
    type: string,
    init?: EventInit,
  ): {
    dispatched: boolean
    messagesProducedIndices: number[]
    resultingState: unknown | null
  }
  getFocus?(): {
    selector: string | null
    tagName: string | null
    selectionStart: number | null
    selectionEnd: number | null
  }
  getHydrationReport?(): HydrationDivergence[]

  // ── Effect introspection (legacy-only; optional) ───────────────
  getPendingEffects?(): PendingEffect[]
  getEffectTimeline?(limit?: number): EffectTimelineEntry[]
  mockEffect?(
    match: EffectMatch,
    response: unknown,
    opts?: { persist?: boolean },
  ): { mockId: string }
  resolveEffect?(effectId: string, response: unknown): { resolved: boolean }

  // ── Time-travel / coverage / eval (legacy-only; optional) ──────
  stepBack?(n: number, mode: 'pure' | 'live'): { state: unknown; rewindDepth: number }
  getCoverage?(): CoverageSnapshot
  getCompiledSource?(viewFn?: string): { pre: string; post: string } | null
  getMsgMaskMap?(): Record<string, number> | null
  evalInPage?(code: string): {
    result: unknown | { error: string }
    sideEffects: {
      stateChanged: StateDiff | null
      newHistoryEntries: number
      newPendingEffects: PendingEffect[]
      dirtyBindingIndices: number[]
    }
  }
}
```

### `MessageRecord`

```typescript
export interface MessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
  /** Present only on the legacy runtime, which computes a dirty mask per update. */
  dirtyMask?: number
}
```

### `MessageSchemaInfo`

```typescript
export interface MessageSchemaInfo {
  discriminant: string
  variants: Record<string, Record<string, unknown>>
}
```

### `MetaAttrs`

Attributes accepted by {@link meta}. Identity attrs (`name`/`property`/
`httpEquiv`/`charset`) should be static so the entry can dedup.

```typescript
export interface MetaAttrs {
  name?: string
  property?: string
  httpEquiv?: string
  charset?: string
  content?: HeadValue<string>
  [attr: string]: HeadValue<string> | undefined
}
```

### `Mountable`

A lazy node description: `mount()` builds the live node (and registers its
bindings into the active build) at placement time. Everything LLui builds —
elements, text, and structural primitives — is a `Mountable`, materialized
where it is placed (see `populate`/`runBuild`).

```typescript
export interface Mountable {
  readonly [MOUNTABLE]: true
  mount(): Node
}
```

### `MountSignalOptions`

Options for `mountSignalComponent`.

```typescript
export interface MountSignalOptions<S> {
  /** Hydrate over server-rendered DOM instead of a fresh mount: seed the loop
   * with `serverState` (what the server rendered with) and atomically REPLACE the
   * server HTML with the freshly-built client tree. init()'s effects are skipped
   * by default (the server pass already ran them) — opt back in with
   * `runInitEffects` for init()s gated to no-op on the server. */
  hydrate?: { serverState: S; runInitEffects?: boolean }
  /** Seed state to mount with instead of `init()`'s result (adapters that derive
   * the seed externally, e.g. per-route data). init() still runs so its effects
   * are captured; only the returned state is overridden. Ignored when hydrating
   * (use `hydrate.serverState` there). */
  initialState?: S
  /** Context values to expose at the root of this build (see `runBuild`'s
   * `seedContexts`). `@llui/vike` replays a layout's in-scope contexts here so a
   * nested page reads providers that live above its slot in a SEPARATE build. */
  contexts?: ReadonlyMap<symbol, unknown>
  /** Commit scheduling. `'sync'` (the default) commits the DOM + notifies
   * subscribers inside every top-level `send` — the synchronous contract.
   * `'raf'` is the OPT-IN streaming/burst fast path: reducers and effects
   * still run synchronously per send (state and `getState()` advance
   * immediately — the data contract holds), but the DOM commit + subscriber
   * notification coalesce to ONE reconcile per animation frame (microtask
   * fallback where rAF doesn't exist: SSR, plain jsdom, the headless agent).
   * The DOM therefore lags state by up to a frame; `handle.flush()` forces
   * the pending commit synchronously (tests, the agent protocol, a
   * read-after-write). Measured on the ticker suite's 1k-send burst:
   * 14.1ms per-send vs 5.9ms coalesced (hand-written-vanilla parity). */
  scheduler?: 'sync' | 'raf'
  /** Register this component in the global devtools registry
   * (`__lluiComponents` / `__lluiDebug`). Default `true` in dev. Set `false`
   * for self-introspecting dev tooling (e.g. an in-app debug HUD authored with
   * LLui) so it doesn't pollute the host app's component list that external
   * tools — the MCP server, agent bridge, debug-collector — read. */
  devtools?: boolean
}
```

### `PendingEffect`

```typescript
export interface PendingEffect {
  id: string
  type: string
  dispatchedAt: number
  status: 'queued' | 'in-flight'
  payload: unknown
}
```

### `RowCtx`

The per-row context a row scope mounts on: its `item` plus the current
component `state`. Row bindings read `ctx.item.*` (dep `item.*`) and
`ctx.state.*` (dep `state.*`) — so a row can react to BOTH its own item and
the component state (e.g. a shared display mode).

```typescript
export interface RowCtx<T> {
  item: T
  state: unknown
  /** the row's current position (dep `index`) — for runtime `each` index handles */
  index: number
}
```

### `ScriptAttrs`

Attributes accepted by {@link script}.

```typescript
export interface ScriptAttrs {
  src?: HeadValue<string>
  type?: HeadValue<string>
  async?: HeadValue<boolean>
  defer?: HeadValue<boolean>
  id?: string
  [attr: string]: HeadValue<string | boolean> | undefined
}
```

### `ShowCond`

Condition source for `signalShow` / discriminant source for `signalBranch`: an
accessor plus its dep paths.

```typescript
export interface ShowCond {
  produce: (state: unknown) => unknown
  deps: readonly string[]
  /** See {@link BindingSpec.componentRooted}: `true` when the condition reads the
   * COMPONENT state (so inside a row it's fed `ctx.state`, not the combined ctx).
   * Set by the authoring layer from the cond handle; unbranded → string inference. */
  componentRooted?: boolean
}
```

### `Signal`

A reactive view of a value of type `T`. Three methods, the entire reactive
vocabulary alongside `derived`:

- `at(path)` — slice into a sub-signal via a statically-typed dot path.
- `map(fn)` — transform into a derived signal (single source).
- `peek()` — one-shot, non-reactive read (handlers / effects / lifecycle).

```typescript
export interface Signal<T> {
  /**
   * Slice into a sub-signal via a statically-typed dot path
   * (`state.at('user.profile.name')`). The path is validated and the result type
   * resolved at compile time.
   *
   * **Depth limit.** `ValidPath<T>` enumerates the union of *every* valid dotted
   * path of `T` (to validate the argument and power autocomplete). That union
   * grows multiplicatively with the state's width × depth, so on a large /
   * deeply-nested `T` it can exceed TypeScript's instantiation limit and surface
   * as `TS2589: Type instantiation is excessively deep`. The cost comes from the
   * *whole state shape*, not the single path you wrote. If you hit it, reach for
   * `.map(s => s.deep.path)` instead — a `.map()` derive sidesteps path typing
   * entirely (it reads the whole slice; the runtime still gates it correctly) and
   * is the supported escape hatch for very deep paths.
   */
  at<P extends ValidPath<T>>(path: P): Signal<PathValue<T, P>>
  map<U>(fn: (value: T) => U): MappedSignal<U>
  peek(): T
}
```

### `SignalComponentDef`

```typescript
export interface SignalComponentDef<S, M, E = never> {
  /** optional component name (for the debug registry / agent identity) */
  readonly name?: string
  /** initial state, optionally with initial effects */
  init: () => S | [S, E[]]
  /** pure reducer; returns the next state, optionally with effects. A bare `S`
   * (non-tuple) return is accepted for convenience. */
  update: (state: S, msg: M) => [S, E[]] | S
  /** build the view once; reactive reads are signal bindings (they don't close
   * over `state`). The bag's `state` handle is for handlers/effects. */
  view: (bag: ComponentBag<S, M>) => Renderable
  /** handle an effect; may return a cleanup function */
  onEffect?: (effect: E, api: EffectApi<S, M>) => void | (() => void)

  // ── Compiler-injected introspection metadata (see @llui/compiler signals
  // transform). Optional — present only in dev / agent builds. Read by the
  // agent-client pairing path and the (signal) debug surface. ──
  /** discriminated-union schema of Msg ({ discriminant, variants }) */
  readonly __msgSchema?: object
  /** discriminated-union schema of Effect */
  readonly __effectSchema?: object
  /** state shape schema */
  readonly __stateSchema?: object
  /** per-message JSDoc annotations (intent, affordability, …) */
  readonly __msgAnnotations?: Record<string, unknown>
  /** stable hash of the schemas, for hot-reload schema-change detection */
  readonly __schemaHash?: string
  /** dev-only source location */
  readonly __componentMeta?: { file: string; line: number }
}
```

### `SignalComponentHandle`

```typescript
export interface SignalComponentHandle<S, M> {
  send(msg: M): void
  /** Coalesce a burst of `send`s into ONE reconcile + commit. Every message's
   * reducer still runs in order (state advances message-by-message, effects fire
   * per message), but the DOM reconcile + subscriber notification are deferred to
   * a single pass against the FINAL state when the outermost `batch` returns.
   * For N synchronous sends this turns N reconciles into 1 — the streaming /
   * bulk-dispatch fast path (e.g. draining a websocket frame of ticks). State is
   * applied by the time `batch` returns, so the synchronous-`send` contract holds
   * at the batch boundary. Nested `batch` calls flush only at the outermost exit. */
  batch(fn: () => void): void
  getState(): S
  /** no-op: signal `send` applies updates synchronously (kept for harness/agent
   * parity with the legacy handle). */
  flush(): void
  /** run all pending effect cleanups (subscriptions etc.) */
  dispose(): void
  /** Register a listener called synchronously after every update cycle that
   * changes state, with the new state. Returns an unsubscribe. No-op after
   * dispose. Backs the agent protocol's state-update frames. */
  subscribe(listener: (state: S) => void): () => void
  /** Run the reducer in isolation against the current state — `{state, effects}`
   * with no commit/flush/effect dispatch. Backs the agent's `would_dispatch`. */
  runReducer(msg: M): { state: S; effects: unknown[] } | null
  /** Snapshot the Msg variants dispatchable from currently-rendered UI (live
   * `tagSend` registrations). Backs the agent's `list_actions`. */
  getBindingDescriptors(): Array<{ variant: string }>
  /** Hot-swap the reducer (and optionally onEffect) without rebuilding the DOM —
   * the HMR escape hatch for pure update.ts edits. State-type erased at this
   * boundary (`unknown`) so the handle stays assignable across state types. */
  swapUpdate(
    newUpdate: (state: unknown, msg: unknown) => [unknown, unknown[]] | unknown,
    newOnEffect?: unknown,
  ): void
  /** Install a hook called when a binding accessor throws during the update
   * cycle; the runtime leaves the binding's DOM at its prior value and continues
   * with siblings. Backs the agent's dispatch-envelope `drain.errors`. */
  setOnBindingError(hook: ((e: BindingError) => void) | null): void
}
```

### `SignalComponentSpec`

```typescript
export interface SignalComponentSpec<S, M, E = never> {
  /** optional component name (debug registry / agent identity) */
  name?: string
  init: () => S | [S, E[]]
  update: (state: S, msg: M) => [S, E[]] | S
  view: (bag: SignalViewBag<S, M>) => Renderable
  onEffect?: (
    effect: E,
    api: {
      send: Send<M>
      state: Signal<S>
      batch: (fn: () => void) => void
      /** This mount's lifecycle {@link AbortSignal} — aborted on dispose. */
      signal: AbortSignal
    },
  ) => void | (() => void)
}
```

### `SignalDebugHooks`

Everything the signal debug API needs from a mounted component. Supplied by
mountSignalComponent; keeps this module decoupled from the mount internals.

```typescript
export interface SignalDebugHooks {
  name: string
  getState: () => unknown
  /** replace state and re-render (restore / time-travel) */
  setState: (s: unknown) => void
  send: (msg: unknown) => void
  /** pure reducer, normalized to [state, effects] (for evalUpdate / dry-run) */
  pureUpdate: (s: unknown, msg: unknown) => [unknown, unknown[]]
  /** captured message log (newest last); installSignalDebug reads it live */
  history: readonly SignalMessageRecord[]
  clearHistory: () => void
  msgSchema?: object
  stateSchema?: object
  effectSchema?: object
  componentMeta?: { file: string; line: number }
}
```

### `SignalHandle`

A runtime `Signal`: the read surface PLUS the binding info needed to build a
reactive slot at runtime (view-helper composition).

```typescript
export interface SignalHandle<T> extends Signal<T> {
  readonly [SIGNAL]: true
  /** resolve the value from the binding's state (component or row ctx) */
  readonly produce: (state: unknown) => T
  /** dependency paths into the binding's state */
  readonly deps: readonly string[]
  /** Root discriminant for row rebasing. `true` ⇒ this handle reads the ROW ctx
   * (an `item`/`index` handle from `rowHandle`, or a row-aware `derived`); `false`
   * (or absent) ⇒ it reads the COMPONENT state and must be rebased to `ctx.state`
   * when placed inside an `each` row. Set at construction from the getter's origin,
   * so locality never depends on string-inferring a `state`/`item`/`index` field
   * name (which collides with a component field literally named that). */
  readonly rowLocal?: boolean
}
```

### `SignalLazyOptions`

```typescript
export interface SignalLazyOptions<LS = unknown, LM = unknown, LE = unknown> {
  /** async loader — typically `() => import('./Chart').then(m => m.default)`. The
   * loaded component's S/M/E are inferred, so `initialState` is typed and no cast
   * is needed at the call site. */
  loader: () => Promise<SignalComponentDef<LS, LM, LE>>
  /** nodes rendered (reactively, in the current build) while loading */
  fallback: () => Renderable
  /** nodes rendered if the loader rejects (nothing if omitted) */
  error?: (err: Error) => Renderable
  /** seed state for the loaded component, overriding its `init()` result */
  initialState?: LS
}
```

### `SignalMessageRecord`

```typescript
export interface SignalMessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
}
```

### `SignalMount`

```typescript
export interface SignalMount {
  /** apply a new state; only bindings whose deps changed re-run and commit. */
  update(next: unknown): void
  /** run teardowns (foreign unmount, subscriptions). */
  dispose(): void
  /** live agent-affordance variants (tagged-send handlers currently mounted). */
  getDescriptors(): Array<{ variant: string }>
}
```

### `SignalSpec`

A declared reactive input to `foreign`: an accessor + its dep paths.

```typescript
export interface SignalSpec<T> {
  produce: (state: unknown) => T
  deps: readonly string[]
}
```

### `SignalViewBag`

```typescript
export interface SignalViewBag<S, M> {
  state: Signal<S>
  send: Send<M>
  /** Coalesce a burst of `send`s into ONE reconcile (see the handle's `batch`). */
  batch: (fn: () => void) => void
}
```

### `StateDiff`

```typescript
export interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}
```

### `StyleAttrs`

Attributes accepted by {@link style} / {@link script}. A static `id` keys the
tag for dedup + SSR-hydration adoption; without one the tag is anonymous (no
dedup, keyed by stable construction order).

```typescript
export interface StyleAttrs {
  id?: string
  media?: HeadValue<string>
  [attr: string]: HeadValue<string> | undefined
}
```

### `TransitionOptions`

Enter/leave/cross transition hooks shared by the animation/transition
helpers (`@llui/transitions`) and the structural primitives that
accept them. Runtime-agnostic — operates on raw DOM `Node`s.

```typescript
export interface TransitionOptions {
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}
```

### `UpdateExplanation`

```typescript
export interface UpdateExplanation {
  bindingIndex: number
  bindingMask: number
  lastDirtyMask: number
  matched: boolean
  accessorResult: unknown
  lastValue: unknown
  changed: boolean
}
```

### `ValidationError`

```typescript
export interface ValidationError {
  path: string
  message: string
  /** Set by the legacy validator; the signal validator omits these. */
  expected?: string
  received?: string
  /**
   * A complete, valid example message — attached to the FIRST error so an LLM
   * can construct the corrected message in one shot instead of inferring the
   * shape from the schema. Built for the targeted variant (or a representative
   * variant when the variant is unknown/missing), reusing any valid fields the
   * caller already supplied.
   */
  example?: Record<string, unknown>
}
```

### `VirtualEachSpec`

```typescript
export interface VirtualEachSpec<T> extends EachSource<T> {
  key: (item: T) => string | number
  /** Row height in pixels. A `number` is a uniform fixed height (O(1) windowing);
   * a function returns a per-item height, letting rows vary — the window, spacer,
   * and row offsets are computed from cumulative heights (prefix sums, rebuilt when
   * `items` changes). Heights must be known from the data; measured/auto heights
   * are not supported. */
  itemHeight: number | ((item: T, index: number) => number)
  /** scroll-container height in pixels */
  containerHeight: number
  /** extra rows rendered above/below the viewport (default 3) */
  overscan?: number
  /** optional class on the scroll container */
  class?: string
  /** Additional COMPONENT-STATE dep paths the rows read, merged into the
   * structural binding's deps so a state-only change (items unchanged) still fires
   * the reconcile and refreshes visible rows. The authoring `virtualEach` passes
   * `['']` (whole state); a compiled tier could pass precise paths. Without it, a
   * row reading component state was frozen out of state-only changes (stale DOM). */
  extraDeps?: readonly string[]
  /** build a row; `getCtx` exposes the row's live `{ item, state, index }` ctx
   * (same shape as `signalEach`) for runtime item/index handles. */
  renderRow: (getCtx: () => RowCtx<T>) => Renderable
}
```

## Constants

### `a`

```typescript
const a
```

### `article`

```typescript
const article
```

### `aside`

```typescript
const aside
```

### `blockquote`

```typescript
const blockquote
```

### `br`

```typescript
const br
```

### `button`

```typescript
const button
```

### `canvas`

```typescript
const canvas
```

### `caption`

```typescript
const caption
```

### `circle`

```typescript
const circle
```

### `code`

```typescript
const code
```

### `dd`

```typescript
const dd
```

### `details`

```typescript
const details
```

### `div`

```typescript
const div
```

### `dl`

```typescript
const dl
```

### `dt`

```typescript
const dt
```

### `ellipse`

```typescript
const ellipse
```

### `em`

```typescript
const em
```

### `fieldset`

```typescript
const fieldset
```

### `figcaption`

```typescript
const figcaption
```

### `figure`

```typescript
const figure
```

### `footer`

```typescript
const footer
```

### `form`

```typescript
const form
```

### `g`

```typescript
const g
```

### `h1`

```typescript
const h1
```

### `h2`

```typescript
const h2
```

### `h3`

```typescript
const h3
```

### `h4`

```typescript
const h4
```

### `h5`

```typescript
const h5
```

### `h6`

```typescript
const h6
```

### `HEAD_SINK`

Context carrying the active sink. Default `null` → the client per-document
fallback; SSR / explicit coordination seed a sink here.

```typescript
const HEAD_SINK: Context<HeadSink | null>
```

### `header`

```typescript
const header
```

### `hr`

```typescript
const hr
```

### `img`

```typescript
const img
```

### `input`

```typescript
const input
```

### `label`

```typescript
const label
```

### `legend`

```typescript
const legend
```

### `li`

```typescript
const li
```

### `line`

```typescript
const line
```

### `main`

```typescript
const main
```

### `nav`

```typescript
const nav
```

### `ol`

```typescript
const ol
```

### `optgroup`

```typescript
const optgroup
```

### `option`

```typescript
const option
```

### `p`

```typescript
const p
```

### `path`

```typescript
const path
```

### `polygon`

```typescript
const polygon
```

### `polyline`

```typescript
const polyline
```

### `pre`

```typescript
const pre
```

### `rect`

```typescript
const rect
```

### `section`

```typescript
const section
```

### `select`

```typescript
const select
```

### `small`

```typescript
const small
```

### `span`

```typescript
const span
```

### `strong`

```typescript
const strong
```

### `summary`

```typescript
const summary
```

### `svg`

```typescript
const svg
```

### `svgText`

```typescript
const svgText
```

### `table`

```typescript
const table
```

### `tbody`

```typescript
const tbody
```

### `td`

```typescript
const td
```

### `textarea`

```typescript
const textarea
```

### `th`

```typescript
const th
```

### `thead`

```typescript
const thead
```

### `time`

```typescript
const time
```

### `tr`

```typescript
const tr
```

### `ul`

```typescript
const ul
```

<!-- auto-api:end -->
