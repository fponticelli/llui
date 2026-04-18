// ── Component Definition ──────────────────────────────────────────

import type { View } from './view-helpers.js'
import type { StructuralBlock } from './structural.js'
import type { ComponentInstance } from './update-loop.js'
import type { DisposerEvent } from './tracking/disposer-log.js'

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

export type Send<M> = (msg: M) => void

/**
 * Type-erased component definition for use at module boundaries where
 * the consumer's `S`, `M`, `E` are internal and invisible to the caller.
 *
 * Why this exists: `ComponentDef<S, M, E, D>` uses property syntax for
 * its callable fields (`init: (data: D) => ...`), and TypeScript
 * checks property syntax with strict (contravariant) variance. That's
 * the right call for user-facing type safety when authoring a
 * component (a narrower `Msg` type can't accidentally satisfy the
 * `update`'s param), but it means `ComponentDef<MyState, MyMsg, MyEffect, MyData>`
 * is NOT structurally assignable to `ComponentDef<unknown, unknown, unknown, unknown>`
 * — the `init: (data: MyData) => ...` field is contravariant in `MyData`,
 * so widening to `unknown` is rejected.
 *
 * `AnyComponentDef` (and `LazyDef<D>` below) declare the same fields
 * using **method syntax** (`init(data: D): ...`), which TypeScript
 * checks bivariantly. Concrete `ComponentDef<S, M, E, D>` assigns into
 * these structurally without any `widenDef` helper at the callsite.
 *
 * Used by every API that accepts an opaque component definition at a
 * module boundary:
 *
 * - `child({ def })`
 * - `lazy({ loader })` — returns `LazyDef<D>` so the loader's `D` survives
 * - `createOnRenderClient({ Layout })` (from `@llui/vike`)
 * - `createOnRenderHtml({ Layout })` (from `@llui/vike`)
 *
 * The `D` parameter is `unknown` here — `child()` doesn't pass init
 * data through, and `Layout` callers pass route-supplied data whose
 * shape is unknown at the type-erased boundary. Use `LazyDef<D>` when
 * you need to preserve the init data shape (the lazy loader case).
 */
export interface AnyComponentDef {
  name: string
  init(data: unknown): [unknown, unknown[]]
  update(state: unknown, msg: unknown): [unknown, unknown[]]
  view(h: unknown): Node[]
  onEffect?: unknown
  propsMsg?: unknown
  receives?: unknown
  __dirty?: unknown
  __renderToString?: unknown
  __msgSchema?: unknown
  __maskLegend?: unknown
  __componentMeta?: unknown
  __stateSchema?: unknown
  __effectSchema?: unknown
  __update?: unknown
  __handlers?: unknown
}

/**
 * Type-erased component definition for use at module boundaries where the
 * loaded component's S, M, E are internal and invisible to the caller.
 * Only `D` (init data) survives because the caller provides it.
 *
 * `ComponentDef<S, M, E, D>` is structurally assignable to `LazyDef<D>`
 * for any S, M, E — `view: (h: unknown) => Node[]` accepts any View via
 * contravariance, and all other fields widen to `unknown` return types.
 *
 * Used by `lazy()` as the loader's return type. Use `AnyComponentDef`
 * (above) when D is also opaque — most other adapter-layer APIs.
 */
export interface LazyDef<D = void> {
  name: string
  // Method syntax — TypeScript checks methods bivariantly, so
  // ComponentDef<S, M, E, D>'s concrete (state: S, msg: M) => ...
  // assigns here even though S/M ≠ unknown. Property syntax would
  // be contravariant and reject the assignment.
  init(data: D): [unknown, unknown[]]
  update(state: unknown, msg: unknown): [unknown, unknown[]]
  view(h: unknown): Node[]
  onEffect?: unknown
  propsMsg?: unknown
  receives?: unknown
  __dirty?: unknown
  __renderToString?: unknown
  __msgSchema?: unknown
  __maskLegend?: unknown
  __componentMeta?: unknown
  __stateSchema?: unknown
  __effectSchema?: unknown
  __update?: unknown
  __handlers?: unknown
}

/**
 * Maps a value shape to a reactive-props shape: every field becomes an accessor
 * `(s: S) => V`. Use for Level-1 view function signatures.
 *
 * ```ts
 * type ToolbarData = { tools: Tool[]; theme: 'light' | 'dark' }
 *
 * export function toolbar<S>(props: Props<ToolbarData, S>, send: Send<Msg>) {
 *   return [div({ class: props.theme }, [each({ items: props.tools, ... })])]
 * }
 *
 * // Caller — TypeScript enforces per-field accessors; passing a raw value errors:
 * toolbar({ tools: (s: State) => s.tools, theme: (s) => s.theme }, send)
 * ```
 */
export type Props<T, S> = {
  [K in keyof T]: (s: S) => T[K]
}

// ── App Handle ────────────────────────────────────────────────────

export interface AppHandle {
  dispose(): void
  flush(): void
  /**
   * Dispatch a message into the mounted instance from outside its
   * normal view-bound `send` channel. Useful for adapter layers that
   * need to push updates into a long-lived instance — e.g.
   * `@llui/vike`'s persistent-layout chain pushes layout-data updates
   * into surviving layer instances on client navigation when their
   * `propsMsg` translates the new data into a state-update message.
   *
   * Messages are queued through the same path as `view`-side `send`
   * calls — they batch into the next microtask and process via the
   * normal update loop. Calling `send` after `dispose` is a no-op.
   */
  send(msg: unknown): void
}

// ── Lifetime ─────────────────────────────────────────────────────────

export interface Lifetime {
  id: number
  parent: Lifetime | null
  children: Lifetime[]
  disposers: Array<() => void>
  bindings: Binding[]
  /** Per-item updaters — called directly by each() when item changes, bypassing Phase 2 */
  itemUpdaters: Array<() => void>
  /**
   * @internal dev-only back-reference to the owning ComponentInstance.
   * Populated on the root scope by `installDevTools` so `disposeLifetime`
   * can walk up the scope chain and emit DisposerEvents into the
   * instance's `_disposerLog`. Undefined in production.
   */
  instance?: ComponentInstance
  /**
   * @internal dev-only cause hint. Structural primitives (branch, each,
   * child, mountApp teardown) set this field immediately before calling
   * `disposeLifetime`; the dispose path reads it once to stamp the emitted
   * DisposerEvent. Left undefined, `disposeLifetime` falls back to
   * `'component-unmount'`. Undefined in production.
   */
  disposalCause?: DisposerEvent['cause']
  /** @internal dev-only — populated by structural primitives for scope-tree classification */
  _kind?: 'root' | 'show' | 'each' | 'branch' | 'child' | 'portal' | 'foreign'
}

export interface LifetimeNode {
  scopeId: string
  kind: 'root' | 'show' | 'each' | 'branch' | 'child' | 'portal' | 'foreign'
  active: boolean
  children: LifetimeNode[]
}

// ── Binding ───────────────────────────────────────────────────────

/**
 * Binding output kinds.
 *
 * `'text' | 'prop' | 'attr' | 'class' | 'style'` write their accessor's
 * return value to the DOM. `'effect'` is a side-effect-only watcher:
 * the accessor is invoked every Phase 2 tick its mask is hit, but its
 * return value is discarded and `applyBinding` is a no-op. Used by
 * `child()` to fire the prop-diff/propsMsg cascade on parent updates
 * without the cost of stringifying the returned props bag onto a
 * detached anchor node every render.
 */
export type BindingKind = 'text' | 'prop' | 'attr' | 'class' | 'style' | 'effect'

export interface Binding {
  mask: number
  accessor: (state: unknown) => unknown
  lastValue: unknown
  kind: BindingKind
  node: Node
  key?: string
  ownerLifetime: Lifetime
  perItem: boolean
  dead: boolean
}

// ── Structural Primitives ─────────────────────────────────────────

export interface TransitionOptions {
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}

export interface BranchOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string | number | boolean
  cases: Record<string | number, (h: View<S, M>) => Node[]>
  /**
   * @internal Set by `show()` when it delegates to `branch()`, so the
   * dev-only disposer log can report `'show-hide'` instead of the
   * default `'branch-swap'` for the leaving arm. User code should not
   * set this directly.
   */
  __disposalCause?: DisposerEvent['cause']
}

export interface ShowOptions<S, M = unknown> extends TransitionOptions {
  when: (s: S) => boolean
  render: (h: View<S, M>) => Node[]
  fallback?: (h: View<S, M>) => Node[]
}

/**
 * Options for `each()`. The inherited `enter` / `leave` callbacks fire **per item**:
 * `enter(nodes)` runs after an item's DOM is inserted (including initial mount);
 * `leave(nodes)` runs before an item's DOM is removed and may return a Promise
 * to hold the DOM until the animation resolves. Setting `leave` disables the
 * bulk-clear / full-replace fast paths.
 */
/**
 * Per-item accessor. Two access forms:
 * - `item.field` — shorthand, returns accessor for `item.current[field]`
 * - `item(t => t.expr)` — computed expressions
 *
 * In both cases the returned value is a `() => V` accessor.
 * Invoke it (`item.field()`) to read the current value imperatively.
 */
export type ItemAccessor<T> = {
  <R>(selector: (t: T) => R): () => R
} & {
  [K in keyof T]-?: () => T[K]
} & {
  /**
   * Read the whole current item. Needed when T is a primitive (where the
   * field-map branch collapses to method names like `toString`) or when
   * you want to sample the entire record rather than a single field.
   *
   * Shadows any literal `current` field on T — if T has such a field,
   * use `item(r => r.current)` to disambiguate.
   */
  current(): T
}

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

export interface PortalOptions {
  target: HTMLElement | string
  render: () => Node[]
}

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

export interface ChildOptions<S, ChildM> {
  // Type-erased via AnyComponentDef so callers can pass any concrete
  // ComponentDef<S, M, E, D> without a widening helper. The runtime
  // narrows the message shape via the user-supplied `onMsg` callback,
  // which keeps `ChildM` typed at this boundary even though the def
  // itself is opaque.
  def: AnyComponentDef
  key: string | number
  props: (s: S) => Record<string, unknown>
  onMsg?: (msg: ChildM) => unknown | null
}
