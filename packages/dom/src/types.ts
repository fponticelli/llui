// ── Component Definition ──────────────────────────────────────────

import type { View } from './view-helpers'

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
}

export type Send<M> = (msg: M) => void

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
}

// ── Scope ─────────────────────────────────────────────────────────

export interface Scope {
  id: number
  parent: Scope | null
  children: Scope[]
  disposers: Array<() => void>
  bindings: Binding[]
  /** Per-item updaters — called directly by each() when item changes, bypassing Phase 2 */
  itemUpdaters: Array<() => void>
}

// ── Binding ───────────────────────────────────────────────────────

export type BindingKind = 'text' | 'prop' | 'attr' | 'class' | 'style'

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

// ── Structural Primitives ─────────────────────────────────────────

export interface TransitionOptions {
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}

export interface BranchOptions<S, M = unknown> extends TransitionOptions {
  on: (s: S) => string | number | boolean
  cases: Record<string | number, (h: View<S, M>) => Node[]>
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
  def: ComponentDef<unknown, ChildM, unknown>
  key: string | number
  props: (s: S) => Record<string, unknown>
  onMsg?: (msg: ChildM) => unknown | null
}
