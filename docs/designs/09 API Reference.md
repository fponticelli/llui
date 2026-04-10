# API Reference

This document provides the authoritative type signatures for every public export in the LLui framework and its companion packages. For design rationale and usage patterns, see the document referenced in each section.

---

## Core Runtime (`llui`)

### `component<S, M, E, D>(def)`

Creates a component definition. This is the entry point for every LLui component.

```typescript
function component<S, M, E = never, D = void>(
  def: ComponentDef<S, M, E, D>,
): ComponentDef<S, M, E, D>

interface ComponentDef<S, M, E = never, D = void> {
  name: string
  init: (data: D) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (h: View<S, M>) => Node[]
  onEffect?: (bag: { effect: E; send: (msg: M) => void; signal: AbortSignal }) => void

  // Level 2 composition only:
  propsMsg?: (props: any) => M
  receives?: Record<string, (params: any) => M>

  // @internal — compiler-injected, not part of the public API:
  // __dirty, __renderToString, __msgSchema
}
```

**Constraints:**

- `S` must be JSON-serializable (no `Map`, `Set`, `Date`, class instances, functions).
- `M` should be a discriminated union with a `type` field.
- `E` should be a discriminated union with a `type` field.
- `update()` must be pure — no side effects, no DOM access, no async.
- `view()` runs once at mount time. Do not call view primitives outside this context.
- `h` is a `View<S, M>` bundle of state-bound helpers — see [`View<S, M>`](#views-m) below. Using `h.show(...)` / `h.text(...)` / `h.each(...)` removes the need for per-call generic annotations because `S` is pinned by the enclosing `component<S, M, _>` call.

See: 01 Architecture.md, 07 LLM Friendliness.md

---

### `View<S, M>`

A bundle of state-bound view helpers passed as the second argument to `view`. Every method is typed over the component's `S` and `M`, so callbacks like `when: s => ...` and `items: s => ...` infer `s: S` without explicit generics at each call site.

```typescript
interface View<S, M> {
  send: (msg: M) => void
  show(opts: ShowOptions<S, M>): Node[]
  branch(opts: BranchOptions<S, M>): Node[]
  each<T>(opts: EachOptions<S, T, M>): Node[]
  text(accessor: ((s: S) => string) | string, mask?: number): Text
  memo<T>(accessor: (s: S) => T): (s: S) => T
  selector<V>(field: (s: S) => V): SelectorInstance<V>
  ctx<T>(c: Context<T>): (s: S) => T
}
```

**`slice(h, selector)`** (standalone export from `@llui/dom`) returns a narrower `View<Sub, M>` for view-functions that read a sub-slice of the parent state. All state-bound accessors written against the sub view are composed with `selector` under the hood:

```typescript
import { slice } from '@llui/dom'

view: ({ send, branch }) => {
  const routeView = slice({ send }, s => s.route)
  return routeView.branch({
    on: r => r.data.type === 'loading' ? 'loading' : 'ready',
    cases: { ... },
  })
}
```

`slice` is a standalone function (not a View method) so apps that don't use it don't pay its bundle cost.

**Compiler integration.** The Vite plugin treats destructured aliases (`{ text, show }`) and member-expression calls (`h.text(...)`, `h.show(...)`) identically to bare imports for mask injection. Destructured names are tracked through the first parameter of `view: ({ send, text }) => ...` arrows and `(h: View<S, M>)` parameter annotations on extracted helpers.

**Destructuring vs. `h.`:** destructure view helpers in `view: ({ send, text, show }) => ...`. For extracted view-functions, accept `h: View<S, M>` and destructure from it. The compiler handles both forms equivalently.

See: 01 Architecture.md, 07 LLM Friendliness.md

---

### `mountApp(container, def, data?)`

Mounts a component into the DOM. Runs `init(data)`, then `view()`, then Phase 2.

```typescript
function mountApp<S, M, E, D>(
  container: HTMLElement,
  def: ComponentDef<S, M, E, D>,
  data: D,
): AppHandle

interface AppHandle {
  dispose(): void // Disposes the root scope, removes all DOM, cancels all effects.
  flush(): void // Alias for the global flush() scoped to this app.
}
```

The returned `AppHandle` is the only way to tear down a mounted app — required for SPA page transitions, test cleanup, and HMR. Calling `dispose()` is idempotent; calling it twice is a no-op.

See: 08 Ecosystem Integration.md

---

### `hydrateApp(container, def, serverState)`

Hydrates server-rendered HTML. Walks existing DOM, attaches bindings to `data-llui-hydrate` markers, and registers structural blocks without creating new DOM nodes.

```typescript
function hydrateApp<S, M, E, D>(
  container: HTMLElement,
  def: ComponentDef<S, M, E, D>,
  serverState: S,
): AppHandle
```

Returns the same `AppHandle` as `mountApp`. On mismatch between server HTML and client state, falls back to full client render for the affected subtree with a development-mode console warning.

See: 08 Ecosystem Integration.md

---

### `send(msg)`

Enqueues a message for the next update cycle. Available as the second argument to `view()` and to `onEffect`. Multiple `send()` calls within the same synchronous execution coalesce into one update cycle.

```typescript
type Send<M> = (msg: M) => void
```

See: 01 Architecture.md, 03 Runtime DOM.md

---

### `flush()`

Forces the pending update cycle to execute synchronously. After `flush()` returns, the DOM reflects all queued messages. No-op if no messages are pending.

```typescript
function flush(): void
```

Use for: (1) imperative DOM measurement after `send()`, (2) test harnesses needing synchronous assertions.

**Reentrancy:** If `flush()` is called while an update cycle is already in progress (e.g., from inside an effect handler), it is a no-op — the current cycle will already process all pending messages. Messages enqueued by effects during the cycle are picked up in the next microtask drain, not in the current `flush()`.

See: 03 Runtime DOM.md

---

### `onMount(callback)`

Registers a callback that fires via `queueMicrotask` after DOM insertion. The callback receives the element's root DOM node. Must be called during `view()` execution. The callback is silently dropped if the owning scope is disposed before the microtask fires.

```typescript
function onMount(callback: (el: Element) => (() => void) | void): void
```

The optional return value is a cleanup function registered as a disposer on the current scope.

See: 01 Architecture.md

---

### Event Listeners

Event handlers are the second argument category in element props (keys matching `/^on[A-Z]/`). The `send` function is captured from the enclosing `view(send)` closure — handlers call `send()` to dispatch messages.

```typescript
button({ onClick: () => send({ type: 'increment' }) }, [text('+')])
input({ onInput: (e) => send({ type: 'typed', value: e.target.value }) })
```

Handlers are registered via `addEventListener` at mount time and removed when the owning scope is disposed. **Handlers are not reactive** — the handler identity is captured once at mount. If a handler needs to read current state, capture the needed values via reactive accessors or dispatch a message and read state in `update()`.

---

### Addressed Effects

Components can declare named command handlers via `receives` in `ComponentDef`. This enables typed cross-component communication through the effect system.

```typescript
// Child declares what it receives:
const DataTable = component({
  receives: {
    scrollToRow: (params: { id: string }) => ({ type: 'scrollToRow', id: params.id }),
    resetSort: () => ({ type: 'resetSort' }),
  },
  // ...
})

// Parent sends addressed effects:
import { toDataTable } from './data-table'
return [state, [toDataTable.scrollToRow({ id: msg.id })]]
```

**Component registry:** Each `child()` instance registers itself in a per-app component registry keyed by `child.key`. `dispatchEffect` resolves the `__targetKey` field on addressed effects against this registry at dispatch time. If the target component is not mounted, the effect is dropped with a development-mode warning. If multiple children share a key, the last-mounted instance wins (this is a bug — keys must be unique).

The `component()` call auto-generates a typed `address` builder (exported as `toComponentName`) from the `receives` map. Invalid handler names or mismatched parameter types are caught at compile time.

---

## View Primitives

### `text(accessor)`

Creates a reactive text node. The accessor is re-evaluated on state changes matching its bitmask.

```typescript
function text<S>(accessor: (s: S) => string): Text
function text(staticValue: string): Text
```

The compiler injects a mask as a second argument: `text(accessor, mask)`.

See: 01 Architecture.md, 03 Runtime DOM.md

---

### Element Helpers (`div`, `span`, `button`, etc.)

Approximately 50 functions, one per HTML element. All share the same signature pattern:

```typescript
function div<S>(props?: ElementProps<S>, children?: Node[]): HTMLDivElement
function button<S>(props?: ElementProps<S>, children?: Node[]): HTMLButtonElement
function input<S>(props?: ElementProps<S>): HTMLInputElement
// ... etc for all HTML elements
```

**Props are classified by the compiler into three categories:**

- **Static** — literal values applied once at mount: `{ class: 'container', id: 'root' }`
- **Event handlers** — keys matching `/^on[A-Z]/`: `{ onClick: () => send({ type: 'click' }) }`
- **Reactive bindings** — arrow functions re-evaluated on state changes: `{ class: s => s.active ? 'on' : 'off' }`

After compilation, all element helper calls are rewritten to `elSplit()` and the helpers are tree-shaken from the bundle.

See: 02 Compiler.md, 06 Bundle Size.md

### SVG Element Helpers

55 SVG elements created via `document.createElementNS('http://www.w3.org/2000/svg', tag)`. Same prop/binding API as HTML elements — reactive attributes, event handlers, static props all work identically.

```typescript
import {
  svg,
  circle,
  rect,
  path,
  g,
  defs,
  linearGradient,
  stop,
  svgText,
  filter,
  feGaussianBlur,
} from '@llui/dom'

// Container/structural: svg, g, defs, symbol, use
// Shapes: circle, ellipse, line, path, polygon, polyline, rect
// Text: svgText (aliased to avoid conflict with text()), tspan, textPath
// Paint: clipPath, linearGradient, radialGradient, stop, mask, pattern, marker
// Filters: filter, feBlend, feColorMatrix, feComposite, feGaussianBlur, feFlood, feOffset, feMerge, feMergeNode, + 12 more
// Embedded: image, foreignObject
// Animation: animate, animateMotion, animateTransform, set, mpath
// Descriptive: desc, svgTitle (aliased), metadata
```

Note: SVG `text` is exported as `svgText` and SVG `title` as `svgTitle` to avoid conflicts with the `text()` primitive and HTML `title` element.

### MathML Element Helpers

31 MathML elements created via `document.createElementNS('http://www.w3.org/1998/Math/MathML', tag)`.

```typescript
import {
  math,
  mi,
  mn,
  mo,
  mfrac,
  msqrt,
  mroot,
  msup,
  msub,
  mrow,
  mtable,
  mtr,
  mtd,
} from '@llui/dom'

// Top-level: math
// Tokens: mi, mn, mo, ms, mtext
// Layout: mrow, mfrac, msqrt, mroot, msup, msub, msubsup, munder, mover, munderover, mmultiscripts, mprescripts, mnone
// Table: mtable, mtr, mtd
// Spacing/visual: mspace, mpadded, mphantom, menclose, merror
// Interactive: maction
// Semantics: semantics, annotation, annotationXml
```

---

## Structural Primitives

### `branch(opts)`

Conditional rendering keyed on a discriminant. When the discriminant changes, the old arm's scope is disposed depth-first (removing all bindings, listeners, and nested structural blocks) and the new arm's builder runs from scratch.

```typescript
function branch<S, M>(opts: {
  on: (s: S) => string | number | boolean
  cases: Record<string | number, (h: View<S, M>) => Node[]>
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}): Node[]
```

The `leave` callback fires before node removal; if it returns a Promise, removal is deferred until the promise resolves. `enter` fires after insertion. `onTransition` fires first when both are specified (for FLIP animations), then `enter`/`leave` fire for their respective elements.

See: 03 Runtime DOM.md, 01 Architecture.md

---

### `each(opts)`

Reactive keyed list rendering with reconciliation.

```typescript
function each<S, T, M>(opts: {
  items: (s: S) => T[]
  key: (item: T) => string | number
  render: (bag: { send: Send<M>; item: ItemAccessor<T>; index: () => number }) => Node[]
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}): Node[]

// ItemAccessor is a proxy-function: callable for computed expressions,
// with per-field shorthand properties.
type ItemAccessor<T> = (<R>(selector: (t: T) => R) => () => R) & {
  [K in keyof T]: () => T[K]
}
```

**Parameter types differ intentionally:**

- `key` receives the **raw item value** `T` — it is a pure identity function evaluated during Phase 1.
- `render` receives a **scoped accessor** `item` and an `index` getter. Use `item.field()` for a direct field read (the shorthand for `item(t => t.field)()`), or `item(t => expr)` for computed expressions that produce a reactive binding.

See: 03 Runtime DOM.md, 01 Architecture.md

---

### `show(opts)`

Boolean conditional rendering. Implemented as a two-case `branch` — the scope is disposed when the condition becomes false and rebuilt when it becomes true.

```typescript
function show<S, M>(opts: {
  when: (s: S) => boolean
  render: (h: View<S, M>) => Node[]
  fallback?: (h: View<S, M>) => Node[]
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}): Node[]
```

See: 03 Runtime DOM.md

---

### `portal(opts)`

Renders a subtree outside the component's natural DOM position (e.g., to `document.body` for modals). Bindings participate in the same update cycle. The portal's scope is a child of the originating scope — disposal removes portal nodes from the target.

```typescript
function portal(opts: { target: HTMLElement | string; render: () => Node[] }): Node[]
```

When `target` is a `string`, it is resolved via `document.querySelector(target)` at mount time. If the target element is not found, a development-mode warning is emitted and the portal renders nothing. If the target element is removed from the DOM after mount, portal nodes are removed with it — the scope's disposers still fire on the next parent scope disposal.

Bindings inside the portal participate in the same update cycle as the rest of the component. The portal's scope is a child of the originating scope — disposing the parent disposes the portal.

See: 01 Architecture.md

---

### `foreign(opts)`

Opaque container for imperative third-party libraries. LLui owns the container element; the library owns everything inside it.

```typescript
function foreign<S, M, T extends Record<string, unknown>, Instance>(opts: {
  mount: (bag: { container: HTMLElement; send: (msg: M) => void }) => Instance
  props: (s: S) => T
  sync:
    | ((bag: { instance: Instance; props: T; prev: T | undefined }) => void)
    | {
        [K in keyof T]?: (bag: { instance: Instance; value: T[K]; prev: T[K] | undefined }) => void
      }
  destroy: (instance: Instance) => void
  container?: { tag?: string; attrs?: Record<string, string> }
}): Node[]
```

All four generic parameters (`S`, `M`, `T`, `Instance`) are inferred by TypeScript. The `sync` record form diffs per-field and dispatches only changed fields.

See: 01 Architecture.md

---

### `child(opts)`

Level 2 composition — creates a full component boundary with its own bitmask, update cycle, and scope tree. Use only when the child has 30+ state paths, encapsulated internals, or an independent effect lifecycle.

```typescript
function child<S, ChildS, ChildM, ChildE>(opts: {
  def: ComponentDef<ChildS, ChildM, ChildE>
  key: string | number
  props: (s: S) => Record<string, unknown>
  onMsg?: (msg: ChildM) => ParentMsg | null
}): Node[]
```

The props accessor has a bitmask derived from its parent state dependencies. The runtime: (1) checks the bitmask first — if no relevant parent state paths changed, the props accessor is not called at all; (2) when the bitmask matches, calls the accessor and compares each field of the returned object via `Object.is` with the previous props; (3) only if at least one field changed, calls `def.propsMsg(newProps)` and enqueues the result into the child's message queue. `onMsg` maps child messages selectively to parent messages — return `null` for messages the parent should ignore.

See: 01 Architecture.md

---

### `lazy(opts)`

Asynchronously load a component on demand. Renders `fallback` immediately, then swaps in the loaded component when the loader's Promise resolves. On rejection, renders `error` (or nothing if no error handler is provided). If the parent scope is disposed before the loader resolves, the load is cancelled — the loaded component is never mounted.

```typescript
function lazy<S, M, E = never, D = undefined>(opts: {
  loader: () => Promise<ComponentDef<unknown, M, E, D>>
  fallback: (h: View<S, M>) => Node[]
  error?: (err: Error, h: View<S, M>) => Node[]
  data?: (s: S) => D
}): Node[]
```

Typical use:

```typescript
view: ({ text }) => [
  ...lazy({
    loader: () => import('./Chart').then((m) => m.default),
    fallback: ({ text }) => [div([text('Loading...')])],
    error: (err, { text }) => [div([text(`Failed: ${err.message}`)])],
    data: (s) => ({ points: s.chartData }),
  }),
]
```

The loader is called once per `lazy()` instance. Integrates with Vite's dynamic `import()` for code splitting.

See: 06 Bundle Size.md

---

### `memo(accessor)`

Memoizes an accessor using a two-level cache: (1) the bitmask check skips re-evaluation when no relevant state paths changed, and (2) `Object.is` comparison on the return value prevents downstream updates when the computation produces the same result despite input changes.

```typescript
function memo<S, T>(accessor: (s: S) => T): (s: S) => T
```

Use for expensive derived computations referenced by multiple bindings.

See: 01 Architecture.md

---

### `errorBoundary(opts)`

Wraps a scoped builder in a try/catch. Renders fallback subtree on error. Independently tree-shakeable.

```typescript
function errorBoundary(opts: {
  render: () => Node[]
  fallback: (error: Error) => Node[]
  onError?: (error: Error) => void
}): Node[]
```

Protects three zones: (1) view construction errors, (2) binding evaluation errors in Phase 2, (3) effect handler errors. Does NOT wrap `update()` — a throwing `update()` is a bug.

See: 01 Architecture.md

---

## `@llui/effects`

Composable effect description builders and a runtime chain for interpreting them in `onEffect`.

### Effect Builders

```typescript
function http(opts: {
  url: string
  method?: string
  body?: any
  headers?: Record<string, string>
  onSuccess: string // tag name: runtime wraps response into { type: tag, payload: responseData }
  onError: string // tag name: runtime wraps error into { type: tag, error: errorData }
}): HttpEffect

function cancel(token: string): CancelEffect
function cancel(token: string, inner: Effect): CancelReplaceEffect

function debounce(key: string, ms: number, inner: Effect): DebounceEffect

function sequence(effects: Effect[]): SequenceEffect

function race(effects: Effect[]): RaceEffect
```

All builders return plain data objects (JSON-serializable). They are returned from `update()`, not executed directly.

### `handleEffects<E>()`

```typescript
function handleEffects<E extends { type: string }>(): {
  else<R extends E>(
    handler: (bag: { effect: R; send: Send<Msg>; signal: AbortSignal }) => void,
  ): OnEffectHandler<E>
}
```

Canonical `onEffect` handler. Consumes `http`, `cancel`, `debounce`, `sequence`, `race` effects. The `.else()` callback receives only the remaining custom effect types (TypeScript narrows automatically). The chain tracks cancellation tokens and debounce timers in a per-component closure and uses the `AbortSignal` for cleanup on unmount.

See: 01 Architecture.md

---

## `@llui/test`

All exports are devDependencies — zero production bundle cost.

### `testComponent(def, initialData?)`

Zero-DOM component harness. Runs in Node, no browser needed.

```typescript
function testComponent<S, M, E, D>(
  def: ComponentDef<S, M, E, D>,
  initialData: D,
): {
  state: S
  effects: E[]
  allEffects: E[]
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send: (msg: M) => void
  sendAll: (msgs: M[]) => S
}
```

### `testView(def, state)`

Runs `view()` once against a lightweight DOM shim.

```typescript
function testView<S, M, E, D>(
  def: ComponentDef<S, M, E, D>,
  state: S,
): {
  query: (selector: string) => Element | null
  queryAll: (selector: string) => Element[]
}
```

The shim supports `querySelector`, `querySelectorAll`, `textContent`, `getAttribute`, `children`. No layout, CSS, focus, or events.

### `assertEffects(actual, expected)`

Partial deep matching — extra fields in actual effects are ignored.

```typescript
function assertEffects<E>(actual: E[], expected: Partial<E>[]): void
```

### `propertyTest(def, config)`

Generative invariant testing via random message sequences.

```typescript
function propertyTest<S, M, E, D>(
  def: ComponentDef<S, M, E, D>,
  config: {
    invariants: Array<(state: S, effects: E[]) => boolean>
    messageGenerators: Record<string, ((state: S) => M) | (() => M)>
    runs?: number // default: 1000
    maxSequenceLength?: number // default: 50
  },
): void
```

On failure, shrinks to minimal reproduction.

### `replayTrace(def, trace)`

Regression testing from recorded sessions. Canonical import from `@llui/test`; implementation lives in `llui/trace`.

```typescript
function replayTrace<S, M, E, D>(def: ComponentDef<S, M, E, D>, trace: LluiTrace<S, M, E>): void

interface LluiTrace<S, M, E> {
  lluiTrace: 1
  component: string
  generatedBy: string
  timestamp: string
  entries: Array<{
    msg: M
    expectedState: S
    expectedEffects: E[]
  }>
}
```

See: 04 Test Strategy.md

---

## `@llui/components` — Styles

### CSS Theme

```typescript
import '@llui/components/styles/theme.css' // light theme + all component styles
import '@llui/components/styles/theme-dark.css' // dark mode overrides (separate file)
```

`theme.css` declares design tokens in a `@theme` block and styles all 54 components via `[data-scope][data-part]` attribute selectors. `theme-dark.css` overrides color/shadow tokens for dark mode via `prefers-color-scheme: dark` and `[data-theme="dark"]`.

### Variant Engine

```typescript
import { createVariants, cx } from '@llui/components/styles'

function createVariants<V extends VariantRecord>(
  config: VariantConfig<V>,
): (props?: VariantProps<V>) => string
function cx(...classes: ClassValue[]): string

type ClassValue = string | false | null | undefined
```

### Class Helpers

Each component exports a class helper from `@llui/components/styles/<name>`:

```typescript
import { tabsClasses } from '@llui/components/styles/tabs'

const cls = tabsClasses({ size: 'sm', variant: 'pill' })
// Returns: { root: string, list: string, trigger: string, panel: string, indicator: string }
```

All 54 components have class helpers. Each returns an object mapping part names to Tailwind utility class strings. Most accept optional `size` and `variant`/`colorScheme` props with defaults.

---

## Internal Types

### `Scope`

```typescript
interface Scope {
  id: number
  parent: Scope | null
  children: Scope[]
  disposers: Array<() => void>
  bindings: Binding[]
  eachItemStable: boolean
}
```

See: 03 Runtime DOM.md

### `Binding`

```typescript
interface Binding {
  mask: number // paths 0–30 get their own bit; 32+ overflow to FULL_MASK (-1)
  accessor: (state: any) => any
  lastValue: any
  kind: 'text' | 'prop' | 'attr' | 'class' | 'style'
  node: Node
  key?: string // for prop, attr, style kinds
  ownerScope: Scope
  perItem: boolean
}
```

See: 03 Runtime DOM.md

---

## `@llui/components` — Locale & i18n

### `LocaleContext`

Context for component label translations. English defaults built-in — apps that don't call `provide()` get English for free.

```typescript
import { en, LocaleContext, type Locale } from '@llui/components'
import { provide } from '@llui/dom'

// Non-English app: provide locale at the root
provide(LocaleContext, (s) => s.locale, () => [...])

// Per-instance override still works:
dialog.connect(get, send, { id: 'x', closeLabel: 'Cerrar' })
```

### RTL Support

Components with directional keyboard navigation (tabs, slider, radio-group, tree-view, etc.) automatically flip ArrowLeft↔ArrowRight when inside a `dir="rtl"` context. Vertical arrows are never flipped.

```typescript
import { resolveDir, flipArrow } from '@llui/components'

resolveDir(element) // 'ltr' | 'rtl' — walks up to nearest [dir] ancestor
flipArrow(key, element) // swaps ArrowLeft↔ArrowRight in RTL, passes others through
```

---

## `@llui/components` — Format Utilities

Locale-aware wrappers for `Intl.*` APIs. Formatter instances are LRU-cached (max 64). Locale defaults to `navigator.language` in browsers, `'en'` in SSR. All accept an optional `locale` string in the options bag.

```typescript
import {
  formatNumber,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  formatList,
  formatPlural,
  formatDisplayName,
  formatFileSize,
  resolvePluralCategory,
} from '@llui/components'

formatNumber(1234.5, { style: 'currency', currency: 'USD', locale: 'en-US' }) // '$1,234.50'
formatDate(new Date(), { dateStyle: 'full' })
formatTime(new Date(), { timeStyle: 'short', hour12: true })
formatDateTime(new Date(), { dateStyle: 'medium', timeStyle: 'short' })
formatRelativeTime(-2, 'day', { numeric: 'auto' }) // '2 days ago'
formatList(['a', 'b', 'c'], { type: 'conjunction' }) // 'a, b, and c'
formatPlural(5, { one: '{count} item', other: '{count} items' }) // '5 items'
formatDisplayName('USD', 'currency') // 'US Dollar'
formatFileSize(2.5 * 1024 * 1024) // '2.5 MB'
resolvePluralCategory(1, { locale: 'en' }) // 'one'
```

Date values accept `Date`, ISO string, or Unix timestamp (ms).

---

## `@llui/components` — In View

IntersectionObserver state machine for scroll-triggered behavior.

```typescript
import { inView } from '@llui/components'

// State machine
const state = inView.init() // { visible: false }
const [s1] = inView.update(state, { type: 'enter' }) // { visible: true }
const [s2] = inView.update(s1, { type: 'leave' }) // { visible: false }

// Connect for ARIA attributes
const parts = inView.connect<S>(get, send, { id: 'hero' })
// parts.root: { 'data-scope': 'in-view', 'data-part': 'root', 'data-state': 'visible' | 'hidden' }

// Observer setup (call in onMount)
const cleanup = inView.createObserver(element, send, {
  threshold: 0.5, // 0-1, default 0
  rootMargin: '0px', // default '0px'
  once: true, // disconnect after first enter, default false
})
```
