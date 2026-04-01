// ── Component Definition ──────────────────────────────────────────

export interface ComponentDef<S, M, E> {
  name: string
  init: (data?: unknown) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (state: S, send: Send<M>) => Node[]
  onEffect?: (effect: E, send: Send<M>, signal: AbortSignal) => void

  // Level 2 composition
  propsMsg?: (props: Record<string, unknown>) => M
  receives?: Record<string, (params: unknown) => M>

  // Compiler-injected
  __dirty?: (oldState: S, newState: S) => number | [number, number]
  __renderToString?: (state: S) => string
  __msgSchema?: object
}

export type Send<M> = (msg: M) => void

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
  eachItemStable: boolean
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
}

// ── Structural Primitives ─────────────────────────────────────────

export interface TransitionOptions {
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}

export interface BranchOptions<S> extends TransitionOptions {
  on: (s: S) => string | number | boolean
  cases: Record<string | number, () => Node[]>
}

export interface ShowOptions<S> extends TransitionOptions {
  when: (s: S) => boolean
  render: () => Node[]
}

export interface EachOptions<S, T> extends TransitionOptions {
  items: (s: S) => T[]
  key: (item: T) => string | number
  render: (item: <R>(selector: (t: T) => R) => R, index: () => number) => Node[]
}

export interface PortalOptions {
  target: HTMLElement | string
  render: () => Node[]
}

export interface ForeignOptions<S, T extends Record<string, unknown>, Instance> {
  mount: (container: HTMLElement, send: Send<unknown>) => Instance
  props: (s: S) => T
  sync:
    | ((instance: Instance, props: T, prev: T | undefined) => void)
    | {
        [K in keyof T]?: (instance: Instance, value: T[K], prev: T[K] | undefined) => void
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
