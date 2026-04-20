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
  /** @internal Compiler-injected; keyed by Msg discriminant → annotations. See agent spec §5.1. */
  __msgAnnotations?: Record<
    string,
    {
      intent: string | null
      alwaysAffordable: boolean
      requiresConfirm: boolean
      humanOnly: boolean
    }
  >
  /** @internal Compiler-emitted; one entry per send() call site in view(). See agent spec §5.2. */
  __bindingDescriptors?: Array<{ variant: string }>
  /** @internal Compiler-injected; 32-char hex SHA-256 of schemas + annotations. See agent spec §12.3. */
  __schemaHash?: string
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
  __msgAnnotations?: unknown
  __bindingDescriptors?: unknown
  __schemaHash?: unknown
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
  __msgAnnotations?: unknown
  __bindingDescriptors?: unknown
  __schemaHash?: unknown
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
  /**
   * Read the current state snapshot. Safe to call from anywhere —
   * event handlers, async callbacks, adapter `send` wrappers, or any
   * imperative context where the render context is not live.
   *
   * Unlike `sample()` (a view primitive that requires an active
   * render context and throws outside of `view()`), `getState` is
   * the sanctioned escape hatch for "I need to know the current
   * state to decide what to dispatch." Typical shape:
   *
   * ```ts
   * const handle = mountApp(root, MyApp)
   * container.addEventListener('drop', () => {
   *   const { mode } = handle.getState() as AppState
   *   if (mode === 'drag') handle.send({ type: 'commit' })
   * })
   * ```
   *
   * Throws after `dispose()` — stale reads are silent bugs; a thrown
   * error pinpoints the callsite that forgot to detach.
   *
   * The return type is `unknown` because `AppHandle` is state-type
   * erased at this boundary; cast to your app's state type at the
   * call site.
   */
  getState(): unknown
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
  _kind?: 'root' | 'show' | 'each' | 'branch' | 'scope' | 'child' | 'portal' | 'foreign'
}

export interface LifetimeNode {
  scopeId: string
  kind: 'root' | 'show' | 'each' | 'branch' | 'scope' | 'child' | 'portal' | 'foreign'
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

interface BranchOptionsBase extends TransitionOptions {
  /**
   * @internal Set by `show()` / `scope()` sugar when delegating to
   * `branch()`, so the dev-only disposer log can report `'show-hide'` /
   * `'scope-rebuild'` instead of the default `'branch-swap'` for the
   * leaving arm. User code should not set this directly.
   */
  __disposalCause?: DisposerEvent['cause']
  /** @internal Compiler-injected mask of paths read by `on`. */
  __mask?: number
}

/**
 * All cases covered by `cases` — no default allowed (would be dead code).
 */
type BranchOptionsExhaustive<S, M, K extends string> = BranchOptionsBase & {
  on: (s: S) => K
  cases: { [P in K]: (h: View<S, M>) => Node[] }
  default?: never
}

/**
 * `cases` may cover some but not all keys; `default` handles the rest.
 */
type BranchOptionsNonExhaustive<S, M, K extends string> = BranchOptionsBase & {
  on: (s: S) => K
  cases?: { [P in K]?: (h: View<S, M>) => Node[] }
  default: (h: View<S, M>) => Node[]
}

/**
 * `on` returns a wide `string` — exhaustiveness cannot be verified at
 * compile time (the key domain is infinite). Lenient: `default` is
 * optional so existing call sites that predate exhaustiveness typing
 * continue to compile. Authors who want the gate opt in by narrowing
 * `on`'s return type to a literal union.
 */
type BranchOptionsWide<S, M> = BranchOptionsBase & {
  on: (s: S) => string
  cases?: Record<string, (h: View<S, M>) => Node[]>
  default?: (h: View<S, M>) => Node[]
}

/**
 * Options for `branch()`.
 *
 * When `on` returns a literal string union (e.g. `'idle' | 'loading'
 * | 'done'`), TypeScript enforces exhaustiveness: either every union
 * member has a case (and `default` is disallowed as unreachable), or
 * `default` is required to cover the remainder. When `on` returns a
 * wide `string`, `default` stays optional — exhaustiveness isn't
 * meaningful for an unbounded domain.
 *
 * `cases` is optional when `default` is present; `branch({ on, default })`
 * is the canonical dynamic-rebuild shape — `scope()` sugar wraps
 * exactly this form.
 */
export type BranchOptions<S, M = unknown, K extends string = string> = string extends K
  ? BranchOptionsWide<S, M>
  : BranchOptionsExhaustive<S, M, K> | BranchOptionsNonExhaustive<S, M, K>

export interface ShowOptions<S, M = unknown> extends TransitionOptions {
  when: (s: S) => boolean
  render: (h: View<S, M>) => Node[]
  fallback?: (h: View<S, M>) => Node[]
}

/**
 * Options for `scope()` — rebuilds a subtree when `on(state)` changes.
 *
 * Sugar over `branch({ on, cases: {}, default: render, __disposalCause: 'scope-rebuild' })`.
 * Use when the key is dynamic (e.g. an epoch counter bumped from the
 * outside) and you want a fresh arm — fresh lifetime, fresh bindings —
 * each time it changes. Combine with `sample()` inside `render` for a
 * one-shot current-state read.
 */
export interface ScopeOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string
  render: (h: View<S, M>) => Node[]
  /** @internal Compiler-injected mask of paths read by `on`. */
  __mask?: number
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
    /**
     * The component's View bag (`h.text`, `h.show`, `h.branch`,
     * `h.scope`, `h.sample`, …). Each-render callers used to reach
     * for the top-level imports; the bag form is symmetric with how
     * `branch.cases[k]`, `show.render`, and `scope.render` receive it.
     * Both still work — destructure whichever is more convenient.
     */
    h: View<S, M>
    /** @internal Compiler-injected — entry reference for row factory */
    entry?: Record<string, unknown>
  }) => Node[]
}

export interface PortalOptions {
  target: HTMLElement | string
  render: () => Node[]
}

export interface ForeignOptions<S, M, T extends Record<string, unknown>, Instance> {
  /**
   * Construct the imperative instance. Can be async — return a
   * `Promise<Instance>` to defer construction until e.g. a dynamic
   * `import()` resolves. While the promise is pending:
   *
   *   - The container element is in the DOM immediately (so layout
   *     doesn't shift when the instance arrives).
   *   - `sync` is NOT called. State changes are tracked by the
   *     primitive and the latest props are applied as the initial
   *     sync right after the promise resolves.
   *   - If the owning scope disposes before the promise resolves,
   *     `destroy(instance)` runs on resolution — no matter how long
   *     the promise takes.
   */
  mount: (ctx: { container: HTMLElement; send: Send<M> }) => Instance | Promise<Instance>
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
