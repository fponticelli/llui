---
title: '@llui/dom'
description: 'Runtime API: component, mount, view, primitives, element helpers'
---

# @llui/dom

Runtime for the [LLui](https://github.com/fponticelli/llui) web framework -- The Elm Architecture with compile-time bitmask optimization.

No virtual DOM. `view()` runs once at mount, building real DOM nodes with reactive bindings that update surgically when state changes.

## Install

```bash
pnpm add @llui/dom
```

## Quick Start

```typescript
import { component, mountApp, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: state.count - 1 }, []]
    }
  },
  view: ({ send, text }) => [
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
    text((s) => String(s.count)),
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ],
})

mountApp(document.getElementById('app')!, Counter)
```

## View<S, M> -- the helper bundle

`view` receives a single `View<S, M>` bag. Destructure what you need -- `send` plus any state-bound helpers. TypeScript infers `S` from the component definition, so no per-call generics:

```typescript
view: ({ send, text, show, each, branch, memo }) => [
  text(s => s.label),                    // s is State -- inferred
  ...show({ when: s => s.visible, render: () => [...] }),
  ...each({ items: s => s.items, key: i => i.id, render: ({ item }) => [...] }),
]
```

Element helpers (`div`, `button`, `span`, etc.) stay as imports -- they're stateless and don't need the `S` binding.

## API

### Core

| Export                | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `component(def)`      | Create a component definition                     |
| `mountApp(el, def)`   | Mount a component to a DOM element                |
| `hydrateApp(el, def)` | Hydrate server-rendered HTML                      |
| `flush()`             | Synchronously flush all pending updates           |
| `createView(send)`    | Create a full View bundle (for tests/dynamic use) |

### View Primitives

| Primitive                      | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `text(accessor)`               | Reactive text node                            |
| `show({ when, render })`       | Conditional rendering                         |
| `branch({ on, cases })`        | Multi-case switching                          |
| `each({ items, key, render })` | Keyed list rendering                          |
| `portal({ target, render })`   | Render into a different DOM location          |
| `child({ def, key, props })`   | Full component boundary (Level 2 composition) |
| `memo(accessor)`               | Memoized derived value                        |
| `selector(field)`              | O(1) one-of-N selection binding               |
| `onMount(callback)`            | Lifecycle hook (runs once after mount)        |
| `errorBoundary(opts)`          | Catch render errors                           |
| `foreign({ create, update })`  | Integrate non-LLui libraries                  |
| `slice(h, selector)`           | View over a sub-slice of state                |

### Composition

| Export                                    | Purpose                          |
| ----------------------------------------- | -------------------------------- |
| `mergeHandlers(...handlers)`              | Combine multiple update handlers |
| `sliceHandler({ get, set, narrow, sub })` | Route messages to a state slice  |

### Context

| Export                             | Purpose                  |
| ---------------------------------- | ------------------------ |
| `createContext(defaultValue)`      | Create a context         |
| `provide(ctx, accessor, children)` | Provide value to subtree |
| `useContext(ctx)`                  | Read context value       |

### Element Helpers

50+ typed element constructors: `div`, `span`, `button`, `input`, `a`, `h1`-`h6`, `table`, `tr`, `td`, `ul`, `li`, `img`, `form`, `label`, `select`, `textarea`, `canvas`, `video`, `nav`, `header`, `footer`, `section`, `article`, `p`, `pre`, `code`, and more.

### SSR

| Export                | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `renderToString(def)` | Render component to HTML string                 |
| `initSsrDom()`        | Initialize jsdom for SSR (from `@llui/dom/ssr`) |

## Sub-path Exports

```typescript
import { installDevTools } from '@llui/dom/devtools' // dev-only, tree-shaken
import { initSsrDom } from '@llui/dom/ssr' // server-only
import { replaceComponent } from '@llui/dom/hmr' // HMR support
```

## Performance

Competitive with Solid and Svelte on [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark). 5.8 KB gzipped.

<!-- auto-api:start -->

## Functions

### `component()`

```typescript
function component<S, M, E>(def: ComponentDef<S, M, E>): ComponentDef<S, M, E>
```

### `createView()`

Create a `View<S, M>` bundle for a component's `view` callback.
Delegates straight to the underlying primitives — zero per-call overhead.

```typescript
function createView<S, M>(send: Send<M>): View<S, M>
```

### `mountApp()`

```typescript
function mountApp<S, M, E>(container: HTMLElement, def: ComponentDef<S, M, E>, data?: unknown, _options?: MountOptions): AppHandle
```

### `hydrateApp()`

```typescript
function hydrateApp<S, M, E>(container: HTMLElement, def: ComponentDef<S, M, E>, serverState: S): AppHandle
```

### `flush()`

```typescript
function flush(): void
```

### `addressOf()`

Build a typed address builder from a component definition's `receives` map.

```typescript
function addressOf<S, M, E>(def: ComponentDef<S, M, E>, key: string | number): Record<string, (params?: unknown) => AddressedEffect>
```

### `renderToString()`

Render a component to an HTML string for SSR.
Evaluates view() against the initial state (or provided data),
serializes the DOM to HTML, and adds data-llui-hydrate markers
on nodes with reactive bindings.
Call initSsrDom() once before using this on the server.

```typescript
function renderToString<S, M, E>(def: ComponentDef<S, M, E>, initialState?: S): string
```

### `mergeHandlers()`

Compose multiple update handlers into one.
Each handler returns [newState, effects] if it handled the message, or null to pass through.
The first handler that returns non-null wins.

```typescript
function mergeHandlers<S, M, E>(...handlers: Array<(state: S, msg: M) => [S, E[]] | null>): (state: S, msg: M) => [S, E[]]
```

### `createContext()`

Create a typed context key. Pass a default value to make consumers without a
provider resolve to it; omit to make unprovided consumption throw.
```ts
const ThemeContext = createContext<'light' | 'dark'>('light')
```

```typescript
function createContext<T>(defaultValue?: T): Context<T>
```

### `provide()`

Provide a reactive value for `ctx` to every descendant rendered inside `children`.
The accessor `(s: S) => T` is evaluated lazily at binding read time, so providers
can thread state slices down without prop drilling.
```ts
view: ({ send }) => [
  provide(ThemeContext, (s: State) => s.theme, () => [
    header(send),
    main(send),
  ]),
]
```
Nested providers shadow outer ones within their subtree. The outer value is
restored after `children()` returns, so sibling subtrees aren't affected.

```typescript
function provide<S, T>(ctx: Context<T>, accessor: (s: S) => T, children: () => Node[]): Node[]
```

### `useContext()`

Read a context accessor within a view or view-function. Walks the scope chain
from the current render point to find the nearest provider. Returns an
`(s: S) => T` accessor that can be passed to bindings (text/class/etc.).
```ts
export function themedCard(): Node[] {
  const theme = useContext(ThemeContext)
  return div({ class: (s) => `card theme-${theme(s)}` }, [...])
}
```

```typescript
function useContext<S, T>(ctx: Context<T>): (s: S) => T
```

### `sliceHandler()`

Lens-style adapter that lifts a sub-component's `update` into a handler that
operates on a parent's full state and message type. Pairs with
`mergeHandlers` to compose sub-components into a parent component's reducer.
- `get` / `set` isolate the sub-component's state slice within the parent state.
- `narrow` takes the parent message and returns the sub-message if this slice
  handles it, or `null` to pass through.
- `sub` is the sub-component's pure reducer (operates on its own state + msg).
Example — embedding `dialog.update` into a parent reducer:
```ts
const update = mergeHandlers<State, Msg, Effect>(
  sliceHandler({
    get: (s) => s.confirm,
    set: (s, v) => ({ ...s, confirm: v }),
    narrow: (m) => m.type === 'confirm' ? m.msg : null,
    sub: dialog.update,
  }),
  appUpdate,
)
```

```typescript
function sliceHandler<S, M, E, SubS, SubM>(opts: {
  get: (state: S) => SubS
  set: (state: S, slice: SubS) => S
  narrow: (msg: M) => SubM | null
  sub: (slice: SubS, msg: SubM) => [SubS, E[]]
}): (state: S, msg: M) => [S, E[]] | null
```

### `text()`

```typescript
function text<S>(accessor: ((s: S) => string) | (() => string) | string, mask?: number): Text
```

### `branch()`

```typescript
function branch<S, M = unknown>(opts: BranchOptions<S, M>): Node[]
```

### `each()`

```typescript
function each<S, T, M = unknown>(opts: EachOptions<S, T, M>): Node[]
```

### `show()`

```typescript
function show<S, M = unknown>(opts: ShowOptions<S, M>): Node[]
```

### `slice()`

Build a `View<Sub, M>` that composes a selector into every state-bound
accessor. Used to write view-functions over a sub-slice of parent state:
```ts
import { slice } from '@llui/dom'
view: (h) => {
  const formView = slice(h, (s) => s.form)
  return [...formView.show({ when: f => f.valid, render: (h) => [...] })]
}
```
Kept as a standalone function rather than a method on the View bundle so
apps that don't use it don't pay for its bundle cost — tree-shaken when
unused.

```typescript
function slice<Root, Sub, M>(h: View<Root, M> | { send: Send<M> }, lift: (r: Root) => Sub): View<Sub, M>
```

### `portal()`

```typescript
function portal(opts: PortalOptions): Node[]
```

### `foreign()`

```typescript
function foreign<S, M, T extends Record<string, unknown>, Instance>(opts: ForeignOptions<S, M, T, Instance>): Node[]
```

### `child()`

```typescript
function child<S, ChildM>(opts: ChildOptions<S, ChildM>): Node[]
```

### `memo()`

```typescript
function memo<S, T>(accessor: (s: S) => T, mask?: number): (s: S) => T
```

### `selector()`

Optimized "one-of-N" reactive binding — O(1) updates instead of O(n).
Watches a state field and compares it against per-item keys. When the
field changes, only the old and new matching rows update their DOM.

```typescript
function selector<S, V>(field: (s: S) => V): SelectorInstance<V>
```

### `onMount()`

```typescript
function onMount(callback: (el: Element) => (() => void) | void): void
```

### `errorBoundary()`

```typescript
function errorBoundary(opts: {
  render: () => Node[]
  fallback: (error: Error) => Node[]
  onError?: (error: Error) => void
}): Node[]
```

### `applyField()`

Apply a field update to state immutably.
Returns a new state object with the specified field updated.
Usage in update():
  case 'setField':
    return [applyField(state, msg.field, msg.value), []]

```typescript
function applyField<S extends Record<string, unknown>, K extends keyof S>(state: S, field: K, value: S[K]): S
```

### `elSplit()`

```typescript
function elSplit(tag: string, staticFn: ((el: HTMLElement) => void) | null, events: Array<[string, EventListener]> | null, bindings: Array<[number, BindingKind, string, (state: never) => unknown]> | null, children: Node[] | null): HTMLElement
```

### `elTemplate()`

Clone a cached HTML template and apply a patch function.
The patch function receives the cloned root element and a `bind` helper
that registers reactive bindings in the current render context.
Per-item bindings (accessor.length === 0) are registered as direct
updaters on the scope — called by each() when item changes, bypassing
the Phase 2 binding scan entirely.
Fast path for each() rows — 1 cloneNode instead of N createElement.

```typescript
function elTemplate(html: string, patch: (root: Element, bind: TemplateBind) => void): Element
```

### `_handleMsg()`

Run a handler for a single message: call update(), reconcile blocks
with the given method, run Phase 2. Used by compiler-generated __handlers
to avoid duplicating boilerplate per message type.
@param method 0=reconcile, 1=reconcileItems, 2=reconcileClear, 3=reconcileRemove, -1=skip blocks
@public — used by compiler-generated `__handlers`

```typescript
function _handleMsg(inst: ComponentInstance, msg: unknown, dirty: number, method: number): [unknown, unknown[]]
```

### `_runPhase2()`

Phase 2: compact dead bindings + update live bindings.
Shared between genericUpdate and compiler-generated __update.
@public — used by compiler-generated `__update` functions

```typescript
function _runPhase2(state: unknown, dirty: number, bindings: Binding[], bindingsBeforePhase1: number, componentName?: string): void
```

## Types

### `Send`

```typescript
export type Send<M> = (msg: M) => void
```

### `Props`

Maps a value shape to a reactive-props shape: every field becomes an accessor
`(s: S) => V`. Use for Level-1 view function signatures.
```ts
type ToolbarData = { tools: Tool[]; theme: 'light' | 'dark' }
export function toolbar<S>(props: Props<ToolbarData, S>, send: Send<Msg>) {
  return [div({ class: props.theme }, [each({ items: props.tools, ... })])]
}
// Caller — TypeScript enforces per-field accessors; passing a raw value errors:
toolbar({ tools: (s: State) => s.tools, theme: (s) => s.theme }, send)
```

```typescript
export type Props<T, S> = {
  [K in keyof T]: (s: S) => T[K]
}
```

### `BindingKind`

```typescript
export type BindingKind = 'text' | 'prop' | 'attr' | 'class' | 'style'
```

### `ItemAccessor`

Per-item accessor. Two access forms:
- `item.field` — shorthand, returns accessor for `item.current[field]`
- `item(t => t.expr)` — computed expressions
In both cases the returned value is a `() => V` accessor.
Invoke it (`item.field()`) to read the current value imperatively.

```typescript
export type ItemAccessor<T> = {
  <R>(selector: (t: T) => R): () => R
} & {
  [K in keyof T]-?: () => T[K]
}
```

### `FieldMsg`

Type utility for form field messages.
Generates a discriminated union where each field gets its own typed variant,
avoiding the need to define one message type per field.
Usage:
  type Fields = { name: string; email: string; age: number }
  type Msg = FieldMsg<Fields> | { type: 'submit' }
  // Produces: { type: 'setField'; field: 'name'; value: string }
  //         | { type: 'setField'; field: 'email'; value: string }
  //         | { type: 'setField'; field: 'age'; value: number }
  //         | { type: 'submit' }

```typescript
export type FieldMsg<Fields extends Record<string, unknown>> = {
  [K in keyof Fields]: { type: 'setField'; field: K; value: Fields[K] }
}[keyof Fields]
```

## Interfaces

### `ComponentDef`

```typescript
export interface ComponentDef<S, M, E = never, D = void> {
  name: string
  init: (data: D) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (h: View<S, M>) => Node[]
  onEffect?: (ctx: { effect: E; send: Send<M>; signal: AbortSignal }) => void

  // Level 2 composition
  propsMsg?: (props: Record<string, unknown>) => M
  receives?: Record<string, (params: unknown) => M>

  /** @internal Compiler-injected */
  __dirty?: (oldState: S, newState: S) => number | [number, number]
  /** @internal Compiler-injected */
  __renderToString?: (state: S) => string
  /** @internal Compiler-injected */
  __msgSchema?: object
  /** @internal Compiler-injected — maps top-level state field → dirty-mask bit(s) */
  __maskLegend?: Record<string, number>
  /** @internal Compiler-injected — source-file location of the component() call */
  __componentMeta?: { file: string; line: number }
  /** @internal Compiler-injected — shape of the State type (for introspection) */
  __stateSchema?: object
  /** @internal Compiler-injected — Effect union schema (for introspection) */
  __effectSchema?: object
  /** @internal Compiler-injected — replaces generic Phase 1 + Phase 2 loop */
  __update?: (
    state: S,
    dirty: number,
    bindings: Binding[],
    blocks: StructuralBlock[],
    bindingsBeforePhase1: number,
  ) => void
  /** @internal Compiler-injected — per-message-type specialized handlers.
   *  Bypass the entire processMessages pipeline for single-message updates. */
  __handlers?: Record<string, (inst: object, msg: unknown) => [S, E[]]>
}
```

### `AppHandle`

```typescript
export interface AppHandle {
  dispose(): void
  flush(): void
}
```

### `Scope`

```typescript
export interface Scope {
  id: number
  parent: Scope | null
  children: Scope[]
  disposers: Array<() => void>
  bindings: Binding[]
  /** Per-item updaters — called directly by each() when item changes, bypassing Phase 2 */
  itemUpdaters: Array<() => void>
}
```

### `Binding`

```typescript
export interface Binding {
  mask: number
  accessor: (state: unknown) => unknown
  lastValue: unknown
  kind: BindingKind
  node: Node
  key?: string
  ownerScope: Scope
  perItem: boolean
  dead: boolean
}
```

### `TransitionOptions`

```typescript
export interface TransitionOptions {
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}
```

### `BranchOptions`

```typescript
export interface BranchOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string | number | boolean
  cases: Record<string | number, (h: View<S, M>) => Node[]>
}
```

### `ShowOptions`

```typescript
export interface ShowOptions<S, M = unknown> extends TransitionOptions {
  when: (s: S) => boolean
  render: (h: View<S, M>) => Node[]
  fallback?: (h: View<S, M>) => Node[]
}
```

### `EachOptions`

```typescript
export interface EachOptions<S, T, M = unknown> extends TransitionOptions {
  items: (s: S) => T[]
  key: (item: T) => string | number
  render: (opts: {
    send: Send<M>
    item: ItemAccessor<T>
    /**
     * Plain (non-Proxy) accessor factory. Compiler-output path; avoid in user code
     * (use `item.field` / `item(fn)` — more ergonomic and bypasses Proxy when compiled).
     */
    acc: <R>(selector: (t: T) => R) => () => R
    index: () => number
    /** @internal Compiler-injected — entry reference for row factory */
    entry?: Record<string, unknown>
  }) => Node[]
}
```

### `PortalOptions`

```typescript
export interface PortalOptions {
  target: HTMLElement | string
  render: () => Node[]
}
```

### `ForeignOptions`

```typescript
export interface ForeignOptions<S, M, T extends Record<string, unknown>, Instance> {
  mount: (ctx: { container: HTMLElement; send: Send<M> }) => Instance
  props: (s: S) => T
  sync:
    | ((ctx: { instance: Instance; props: T; prev: T | undefined }) => void)
    | {
        [K in keyof T]?: (ctx: { instance: Instance; value: T[K]; prev: T[K] | undefined }) => void
      }
  destroy: (instance: Instance) => void
  container?: { tag?: string; attrs?: Record<string, string> }
}
```

### `ChildOptions`

```typescript
export interface ChildOptions<S, ChildM> {
  def: ComponentDef<unknown, ChildM, unknown>
  key: string | number
  props: (s: S) => Record<string, unknown>
  onMsg?: (msg: ChildM) => unknown | null
}
```

### `View`

Typed view helpers bound to a component's `State` / `Msg`. The sole
argument to `view`, so every state-bound primitive infers `State` from
the component definition — no per-call `show<State>(...)` annotation.
```ts
view: ({ send, show, text }) => [
  ...show({ when: s => s.count > 0, render: () => [...] }),
  text(s => String(s.count)),
]
```
Tip: to view-function over a sub-slice of parent state, import `slice`
as a standalone helper:
```ts
import { slice } from '@llui/dom'
const form = slice(h, s => s.form)   // returns View<FormState, Msg>
```
The Vite plugin's mask-injection pass recognizes all three call forms
equivalently: `h.text(...)` (member expression), `text(...)` (destructured
alias), and `text(...)` (bare import from `@llui/dom`). No per-binding
gating is lost when calling through `h`.

```typescript
export interface View<S, M> {
  send: Send<M>
  show(opts: ShowOptions<S, M>): Node[]
  branch(opts: BranchOptions<S, M>): Node[]
  each<T>(opts: EachOptions<S, T, M>): Node[]
  text(accessor: ((s: S) => string) | string, mask?: number): Text
  memo<T>(accessor: (s: S) => T): (s: S) => T
  selector<V>(field: (s: S) => V): SelectorInstance<V>
  ctx<T>(c: Context<T>): (s: S) => T
}
```

### `MountOptions`

```typescript
export interface MountOptions {
  devTools?: boolean
}
```

### `LluiDebugAPI`

```typescript
export interface LluiDebugAPI {
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
  getBindings(): BindingDebugInfo[]
  whyDidUpdate(bindingIndex: number): UpdateExplanation
  searchState(query: string): unknown
  /** Returns the compiled Msg schema (discriminant + variant field types). */
  getMessageSchema(): MessageSchemaInfo | null
  /** Returns the bit→field map injected by the compiler. Lets tools decode dirty-mask values. */
  getMaskLegend(): Record<string, number> | null
  /** Given a dirty mask, return the list of top-level fields it represents. */
  decodeMask(mask: number): string[]
  /** Component name + source location (file/line from compiler-injected metadata). */
  getComponentInfo(): ComponentInfo
  /** Returns the compiled State type shape (from TypeScript `type State = { … }`). */
  getStateSchema(): object | null
  /** Returns the compiled Effect schema (from TypeScript `type Effect = { … }` union). */
  getEffectSchema(): object | null
  /** Deep-clone the current state. Pair with restoreState() to checkpoint before risky operations. */
  snapshotState(): unknown
  /** Overwrite the current state with a previously-captured snapshot. Triggers a full re-render. */
  restoreState(snap: unknown): void
  /** Find all bindings whose target node matches or is a child of the selector. */
  getBindingsFor(selector: string): BindingLocation[]
}
```

### `Context`

```typescript
export interface Context<T> {
  readonly _id: symbol
  readonly _default: T | undefined
}
```

## Constants

### `a`

```typescript
const a
```

### `abbr`

```typescript
const abbr
```

### `article`

```typescript
const article
```

### `aside`

```typescript
const aside
```

### `b`

```typescript
const b
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

### `dialog`

```typescript
const dialog
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

### `header`

```typescript
const header
```

### `hr`

```typescript
const hr
```

### `i`

```typescript
const i
```

### `iframe`

```typescript
const iframe
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

### `main`

```typescript
const main
```

### `mark`

```typescript
const mark
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

### `output`

```typescript
const output
```

### `p`

```typescript
const p
```

### `pre`

```typescript
const pre
```

### `progress`

```typescript
const progress
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

### `sub`

```typescript
const sub
```

### `summary`

```typescript
const summary
```

### `sup`

```typescript
const sup
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

### `tfoot`

```typescript
const tfoot
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

### `video`

```typescript
const video
```


<!-- auto-api:end -->
