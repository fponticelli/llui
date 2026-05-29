// Signal DOM layer — the lowered runtime form a signal-compiled `view` emits to.
//
// Element/text helpers build real DOM nodes and register their reactive bindings
// (a `produce` accessor + the absolute dependency paths) into the scope being
// built. `mountSignal` wires those bindings through `createSignalScope` (chunked
// mask gate + output-equality). There is no virtual DOM: `view` builds nodes
// once, updates mutate them in place.
//
// This is the target the compiler transform produces; authored signal syntax
// (`text(state.at('count'))`) is rewritten into these calls. Built ALONGSIDE the
// legacy element helpers (per-file-flip migration).

import { createSignalScope, type SignalBinding, type SignalScope } from './runtime.js'
import { buildPathTable, bindingMask } from './mask.js'
import type { LiveSignal } from './types.js'

type Producer = (state: unknown) => unknown

interface BindingSpec {
  deps: readonly string[]
  produce: Producer
  commit: (value: unknown) => void
}

interface BuildCtx {
  specs: BindingSpec[]
  doc: Document
  /** the scope that will own the bindings collected in this build — set after
   * buildScope. Structural primitives register their mounted child scopes here. */
  host: { scope: SignalScope | null }
  /** teardown callbacks (foreign unmount, subscription disposal) run on dispose. */
  teardowns: Array<() => void>
  /** onMount callbacks — run (with the mounted parent element) after the built
   * nodes are inserted; their returned cleanups join the teardown list. */
  mounts: Array<(root: Element) => void | (() => void)>
  /** context values in scope during this build (provide/useContext). Inherited
   * into nested builds (each rows, show/branch arms). */
  contexts: Map<symbol, unknown>
}
let ctx: BuildCtx | null = null

const REACT = Symbol('llui.react')

/** A reactive prop/child value: a `produce` accessor plus its dependency paths.
 * (The compiler emits these from signal expressions in reactive slots.) */
export interface Reactive {
  readonly [REACT]: true
  readonly produce: Producer
  readonly deps: readonly string[]
}
export function react(produce: Producer, deps: readonly string[]): Reactive {
  return { [REACT]: true, produce, deps }
}
function isReactive(v: unknown): v is Reactive {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[REACT] === true
}

function requireCtx(): BuildCtx {
  if (!ctx) throw new Error('signal DOM helper called outside a signal build (mountSignal)')
  return ctx
}

/** A reactive text node bound to a signal accessor. */
export function signalText(produce: Producer, deps: readonly string[]): Text {
  const c = requireCtx()
  const node = c.doc.createTextNode('')
  c.specs.push({
    deps,
    produce,
    commit: (v) => {
      node.data = v == null ? '' : String(v)
    },
  })
  return node
}

/** A static text node. */
export function staticText(value: string): Text {
  return requireCtx().doc.createTextNode(value)
}

export type EventHandler = (ev: Event) => void
export type PropValue = string | number | boolean | null | Reactive | EventHandler

const toKebab = (s: string): string => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())

function applyAttr(node: Element, name: string, value: unknown): void {
  // `style.transform` / `style.zIndex` -> individual style properties
  if (name.startsWith('style.')) {
    const style = (node as HTMLElement).style
    const prop = toKebab(name.slice(6))
    if (value == null || value === false) style.removeProperty(prop)
    else style.setProperty(prop, String(value))
    return
  }
  if (value == null || value === false) node.removeAttribute(name)
  else node.setAttribute(name, value === true ? '' : String(value))
}

/** `onClick` -> `click`, `onInput` -> `input`. */
function eventName(prop: string): string {
  return prop.slice(2).toLowerCase()
}

/** Apply props (reactive `react(...)` → binding; `on*` fn → listener; else attr)
 * and append children to an already-created element. */
function populate(
  node: Element,
  props: Readonly<Record<string, PropValue>>,
  children: readonly Node[],
): void {
  const c = requireCtx()
  for (const [name, value] of Object.entries(props)) {
    if (isReactive(value)) {
      c.specs.push({
        deps: value.deps,
        produce: value.produce,
        commit: (out) => applyAttr(node, name, out),
      })
    } else if (typeof value === 'function' && /^on[A-Z]/.test(name)) {
      node.addEventListener(eventName(name), value as EventListener)
    } else {
      applyAttr(node, name, value)
    }
  }
  for (const child of children) node.appendChild(child)
}

/** Build an element. `on*` function props become event listeners; `react(...)`
 * props become reactive bindings; everything else is a static attribute. */
export function el(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly Node[] = [],
): Element {
  const node = requireCtx().doc.createElement(tag)
  populate(node, props, children)
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Build an SVG-namespaced element (svg/path/g/circle/…). Same prop/child
 * semantics as `el`, via createElementNS. */
export function elNS(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly Node[] = [],
): Element {
  const node = requireCtx().doc.createElementNS(SVG_NS, tag)
  populate(node, props, children)
  return node
}

/** Run a build function with a fresh collecting context, returning the produced
 * nodes and the bindings created during it. Nests safely (restores the previous
 * context), so structural primitives can build rows mid-reconcile. */
function runBuild(
  doc: Document,
  build: () => readonly Node[],
): {
  nodes: readonly Node[]
  specs: BindingSpec[]
  host: { scope: SignalScope | null }
  teardowns: Array<() => void>
  mounts: Array<(root: Element) => void | (() => void)>
} {
  const prev = ctx
  const specs: BindingSpec[] = []
  const host: { scope: SignalScope | null } = { scope: null }
  const teardowns: Array<() => void> = []
  const mounts: Array<(root: Element) => void | (() => void)> = []
  // inherit in-scope context values so provide() above an each/show is visible
  // inside its rows/arms (which build in this nested context).
  const contexts = new Map(prev?.contexts)
  ctx = { specs, doc, host, teardowns, mounts, contexts }
  let nodes: readonly Node[]
  try {
    nodes = build()
  } finally {
    ctx = prev
  }
  return { nodes, specs, host, teardowns, mounts }
}

/** Run the onMount callbacks collected during a build, passing the mounted
 * parent element; push their returned cleanups onto `teardowns`. */
function runMounts(
  mounts: ReadonlyArray<(root: Element) => void | (() => void)>,
  root: Element,
  teardowns: Array<() => void>,
): void {
  for (const cb of mounts) {
    const cleanup = cb(root)
    if (typeof cleanup === 'function') teardowns.push(cleanup)
  }
}

/** Register a callback to run after the surrounding view's nodes are mounted,
 * receiving the mounted parent element. Returning a function registers a
 * teardown (run on unmount / dispose). Returns a marker node for the view array. */
export function onMount(cb: (root: Element) => void | (() => void)): Node {
  const c = requireCtx()
  c.mounts.push(cb)
  return c.doc.createComment('onMount')
}

/** Render `content` into `target` (default `document.body`) instead of inline —
 * for overlays (dialog/popover/toast). The content's bindings join the current
 * scope (so it stays reactive); a teardown removes the nodes on unmount/dispose.
 * Returns an inline placeholder comment. */
export function portal(content: () => readonly Node[], target?: Element): Node {
  const c = requireCtx()
  const host = target ?? c.doc.body
  const nodes = content() // specs collected into the current build → reactive
  for (const n of nodes) host.appendChild(n)
  c.teardowns.push(() => {
    for (const n of nodes) if (n.parentNode === host) host.removeChild(n)
  })
  return c.doc.createComment('portal')
}

// ── Context ─────────────────────────────────────────────────────────
// Build-time dependency injection: `provide` sets a value for the subtree it
// wraps; `useContext` reads the nearest provided value (or the default). Values
// may be plain or signals (a reactive context is just a Signal value).

export interface Context<T> {
  readonly id: symbol
  readonly default: T
}

export function createContext<T>(defaultValue: T, name = 'context'): Context<T> {
  return { id: Symbol(`llui.${name}`), default: defaultValue }
}

/** Provide `value` for `context` to everything `render` builds, then restore. */
export function provide<T>(context: Context<T>, value: T, render: () => readonly Node[]): Node {
  const c = requireCtx()
  const had = c.contexts.has(context.id)
  const prev = c.contexts.get(context.id)
  c.contexts.set(context.id, value)
  const frag = c.doc.createDocumentFragment()
  try {
    for (const n of render()) frag.appendChild(n)
  } finally {
    if (had) c.contexts.set(context.id, prev)
    else c.contexts.delete(context.id)
  }
  return frag
}

/** Read the nearest provided value for `context`, or its default. Outside a
 * signal build (e.g. a unit test calling `connect()` directly) no provider can
 * exist, so the default is returned rather than throwing. */
export function useContext<T>(context: Context<T>): T {
  if (!ctx) return context.default
  return ctx.contexts.has(context.id) ? (ctx.contexts.get(context.id) as T) : context.default
}

/** Build a scope from collected specs and publish it to its build host (so
 * structural primitives created in that build can register child scopes). */
function buildAndPublishScope(built: {
  specs: BindingSpec[]
  host: { scope: SignalScope | null }
}): SignalScope {
  const scope = buildScope(built.specs)
  built.host.scope = scope
  return scope
}

/** Build a chunked-mask reconciler scope over a set of collected bindings. */
function buildScope(specs: readonly BindingSpec[]): SignalScope {
  const table = buildPathTable(specs.flatMap((s) => [...s.deps]))
  const bindings: SignalBinding[] = specs.map((s) => ({
    mask: bindingMask(s.deps, table),
    produce: s.produce,
    commit: s.commit,
  }))
  return createSignalScope(table, bindings)
}

/** Items source for `signalEach`: an accessor reading the array out of the
 * component state, plus the dep paths the list depends on — the items path AND
 * any component-state paths the rows read (so the list reconciles on either). */
export interface EachSource<T> {
  items: (state: unknown) => readonly T[]
  deps: readonly string[]
}

/** The per-row context a row scope mounts on: its `item` plus the current
 * component `state`. Row bindings read `ctx.item.*` (dep `item.*`) and
 * `ctx.state.*` (dep `state.*`) — so a row can react to BOTH its own item and
 * the component state (e.g. a shared display mode). */
export interface RowCtx<T> {
  item: T
  state: unknown
  /** the row's current position (dep `index`) — for runtime `each` index handles */
  index: number
}

/**
 * Keyed list primitive. A structural binding gated on the list's deps (items
 * path + row-state paths); on change it reconciles by key. Each row is its OWN
 * signal scope mounted on a combined `{ item, state }` context — so a row reacts
 * to its item AND to component state, with per-row, per-binding gating (a shared
 * state change fans out only to the row bindings that read it; item changes hit
 * only that row). Kept rows are mutated in place, never recreated.
 *
 * Index accessor and move-minimizing reorder are deferred (correct-but-simple
 * reorder: rows are re-inserted in order before the end anchor).
 */
export function signalEach<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  // `getCtx` exposes the row's LIVE combined ctx so authoring `each` can build
  // item handles whose `.peek()` reads the current row. The transform emits
  // `() => [...]` which simply ignores the argument.
  renderRow: (getCtx: () => RowCtx<T>) => readonly Node[],
): Node {
  const c = requireCtx()
  const doc = c.doc
  const start = doc.createComment('each')
  const end = doc.createComment('/each')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  interface Row {
    scope: SignalScope
    nodes: readonly Node[]
    ctx: RowCtx<T> // current ctx (holds the last-applied item + state)
    spare: RowCtx<T> // scratch ctx, swapped in on the next update (no per-tick alloc)
    teardowns: Array<() => void> // onMount cleanups + foreign unmount for this row
    holder: { ctx: RowCtx<T> } // live-ctx box for runtime item handles (.peek)
  }
  const rows = new Map<string, Row>()

  const reconcile = (state: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const items = source.items(state)
    const seen = new Set<string>()
    // Minimal-move reconcile: walk the desired order keeping a cursor `pos` at
    // the DOM node the current row should start at. Rows already in position are
    // not touched (zero DOM moves for the common in-place-update case); only
    // displaced or new rows are inserted before `pos`. O(n) work, but DOM
    // mutations proportional to the number of MOVED rows, not total rows.
    let pos: Node = start.nextSibling ?? end
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!
      const k = String(key(item))
      seen.add(k)
      let row = rows.get(k)
      if (!row) {
        const ctx: RowCtx<T> = { item, state, index }
        const holder = { ctx }
        const built = runBuild(doc, () => renderRow(() => holder.ctx))
        const scope = buildAndPublishScope(built)
        scope.mount(ctx) // row scope's "state" is the combined ctx
        row = {
          scope,
          nodes: built.nodes,
          ctx,
          spare: { item, state, index },
          teardowns: built.teardowns,
          holder,
        }
        rows.set(k, row)
        for (const n of row.nodes) parent.insertBefore(n, pos) // new row, in order before pos
        runMounts(built.mounts, parent as Element, built.teardowns)
        continue
      }
      // existing row: re-run only the bindings whose part of the ctx changed.
      // Reuse the spare ctx buffer (no allocation); swap it in as the new
      // current. old (row.ctx) and new (next) stay distinct refs, so the diff
      // sees item/state changes correctly.
      const next = row.spare
      next.item = item
      next.state = state
      next.index = index
      row.scope.update(row.ctx, next)
      row.spare = row.ctx
      row.ctx = next
      row.holder.ctx = next // keep runtime item handles' .peek() current
      const first = row.nodes[0]
      if (first === pos) {
        // already in place — no DOM move; advance the cursor past this row
        pos = row.nodes[row.nodes.length - 1]!.nextSibling ?? end
      } else {
        // displaced — move this row's nodes before pos (pos stays)
        for (const n of row.nodes) parent.insertBefore(n, pos)
      }
    }
    for (const [k, row] of rows) {
      if (!seen.has(k)) {
        for (const t of row.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
        for (const n of row.nodes) if (n.parentNode === parent) parent.removeChild(n)
        rows.delete(k)
      }
    }
  }

  // structural binding: fires when the list deps change; produce returns the
  // whole component state so reconcile can build each row's combined ctx.
  c.specs.push({
    deps: source.deps,
    produce: (s) => s,
    commit: (s) => reconcile(s),
  })

  // On host dispose, tear down every live row (onMount cleanups, foreign
  // unmounts) — otherwise per-row side effects leak when the list unmounts.
  c.teardowns.push(() => {
    for (const [k, row] of rows) {
      for (const t of row.teardowns.splice(0)) t()
      rows.delete(k)
    }
  })

  return frag
}

/** Condition source for `signalShow`: an accessor plus its dep paths. */
export interface ShowCond {
  produce: (state: unknown) => unknown
  deps: readonly string[]
}

/**
 * Conditional render. Mounts `render`'s content when the condition is truthy; if
 * an `orElse` arm is given, mounts it when falsy (otherwise nothing). The mounted
 * arm is its OWN scope that reads the owning component's state, registered as a
 * child of the owning scope — so while mounted it receives state updates (its
 * bindings re-run when THEIR deps change, not just when the condition flips).
 * Toggling the condition swaps arms; a same-truthiness update does NOT remount.
 */
export function signalShow(
  cond: ShowCond,
  render: () => readonly Node[],
  orElse?: () => readonly Node[],
): Node {
  const c = requireCtx()
  const doc = c.doc
  const ownerHost = c.host
  const start = doc.createComment('show')
  const end = doc.createComment('/show')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  let mounted: {
    on: boolean
    scope: SignalScope
    nodes: readonly Node[]
    teardowns: Array<() => void>
  } | null = null

  const reconcile = (state: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const on = Boolean(cond.produce(state))
    if (mounted && mounted.on === on) return // same arm — inner scope handles updates

    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
      for (const n of mounted.nodes) if (n.parentNode === parent) parent.removeChild(n)
      mounted = null
    }

    const arm = on ? render : orElse
    if (arm) {
      const built = runBuild(doc, arm)
      const scope = buildAndPublishScope(built)
      scope.mount(state) // content reads the component state
      for (const n of built.nodes) parent.insertBefore(n, end)
      ownerHost.scope?.addChild(scope) // receive future state updates while mounted
      runMounts(built.mounts, parent as Element, built.teardowns)
      mounted = { on, scope, nodes: built.nodes, teardowns: built.teardowns }
    }
  }

  // Gated by the condition's deps (reconcile only when the condition may change);
  // produce returns the state so reconcile can mount content against it.
  c.specs.push({ deps: cond.deps, produce: (s) => s, commit: (s) => reconcile(s) })

  // On host dispose, tear down the currently-mounted arm (onMount cleanups,
  // foreign unmounts) — otherwise reference-counted side effects (scroll lock,
  // focus trap, dismissable) leak when the component unmounts while open.
  c.teardowns.push(() => {
    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t()
      mounted = null
    }
  })

  return frag
}

/**
 * Discriminated-union render. Mounts the arm matching the discriminant's current
 * value; swaps arms when it changes (the old arm unmounts, the new one mounts as
 * a child scope). Same-value updates do NOT remount — the mounted arm's child
 * scope handles its own inner reactivity. An absent arm renders nothing.
 */
export function signalBranch(
  disc: ShowCond,
  arms: Readonly<Record<string, () => readonly Node[]>>,
): Node {
  const c = requireCtx()
  const doc = c.doc
  const ownerHost = c.host
  const start = doc.createComment('branch')
  const end = doc.createComment('/branch')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  let mounted: {
    key: string
    scope: SignalScope
    nodes: readonly Node[]
    teardowns: Array<() => void>
  } | null = null

  const reconcile = (state: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const key = String(disc.produce(state))
    if (mounted && mounted.key === key) return // same arm — inner scope handles updates

    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
      for (const n of mounted.nodes) if (n.parentNode === parent) parent.removeChild(n)
      mounted = null
    }

    const render = arms[key]
    if (render) {
      const built = runBuild(doc, render)
      const scope = buildAndPublishScope(built)
      scope.mount(state)
      for (const n of built.nodes) parent.insertBefore(n, end)
      ownerHost.scope?.addChild(scope)
      runMounts(built.mounts, parent as Element, built.teardowns)
      mounted = { key, scope, nodes: built.nodes, teardowns: built.teardowns }
    }
  }

  c.specs.push({ deps: disc.deps, produce: (s) => s, commit: (s) => reconcile(s) })

  // On host dispose, tear down the mounted arm (see signalShow for rationale).
  c.teardowns.push(() => {
    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t()
      mounted = null
    }
  })

  return frag
}

/** A declared reactive input to `foreign`: an accessor + its dep paths. */
export interface SignalSpec<T> {
  produce: (state: unknown) => T
  deps: readonly string[]
}

/** Create a LiveSignal plus a `push` to feed it new values (fires subscribers on
 * change). `bind` fires immediately with the current value, then on every change;
 * returns an unsubscribe. */
function makeLive<T>(): { live: LiveSignal<T>; push: (v: T) => void; clear: () => void } {
  const subs = new Set<(v: T) => void>()
  let last: T
  let has = false
  const live: LiveSignal<T> = {
    peek: () => last,
    bind: (cb) => {
      subs.add(cb)
      if (has) cb(last) // immediate
      return () => subs.delete(cb)
    },
  }
  return {
    live,
    push: (v) => {
      if (has && Object.is(v, last)) return
      last = v
      has = true
      for (const cb of subs) cb(v)
    },
    clear: () => subs.clear(),
  }
}

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

/**
 * Imperative-subtree boundary. Declared `state` signals are materialized to
 * LiveSignals (peek + bind) and handed to `mount`, which builds a third-party
 * instance into the host element. The signals stay reactive: when a declared
 * input changes, its LiveSignal fires bound callbacks. `unmount` runs on the
 * owning component's dispose. Communicate OUT via `send` (closed over from the
 * view bag). The analyzer sees the declared deps; the imperative body is opaque.
 */
export function signalForeign<Inst, State extends Record<string, SignalSpec<unknown>>>(
  spec: ForeignSpec<Inst, State>,
): Node {
  const c = requireCtx()
  const host = c.doc.createElement(spec.tag ?? 'div')

  const entries = Object.entries(spec.state ?? {}) as Array<[string, SignalSpec<unknown>]>
  const lives: Record<string, LiveSignal<unknown>> = {}
  const controllers: Array<{ clear: () => void }> = []

  for (const [key, sig] of entries) {
    const { live, push, clear } = makeLive<unknown>()
    lives[key] = live
    controllers.push({ clear })
    // per-input binding: push new value when this input's deps change
    c.specs.push({ deps: sig.deps, produce: (s) => sig.produce(s), commit: (v) => push(v) })
  }

  let instance: Inst | undefined
  // boot binding (no deps -> runs once at mount, never on update): builds the
  // instance after the inputs have their initial values.
  c.specs.push({
    deps: [],
    produce: () => 0,
    commit: () => {
      if (instance === undefined) {
        instance = spec.mount({
          el: host,
          state: lives as never,
        })
      }
    },
  })

  c.teardowns.push(() => {
    for (const ctrl of controllers) ctrl.clear()
    if (instance !== undefined) spec.unmount?.(instance)
  })

  return host
}

export interface SignalMount {
  /** apply a new state; only bindings whose deps changed re-run and commit. */
  update(next: unknown): void
  /** run teardowns (foreign unmount, subscriptions). */
  dispose(): void
}

/**
 * Mount a signal view into `container`: build the nodes (collecting bindings),
 * append them, and wire a chunked-mask reconciler over the collected bindings.
 */
export function mountSignal(
  container: Element,
  initial: unknown,
  build: () => readonly Node[],
): SignalMount {
  const built = runBuild(container.ownerDocument, build)
  for (const n of built.nodes) container.appendChild(n)

  const scope = buildAndPublishScope(built)
  let cur = initial
  scope.mount(cur)
  runMounts(built.mounts, container, built.teardowns) // onMount(root) after insert
  return {
    update(next: unknown): void {
      scope.update(cur, next)
      cur = next
    },
    dispose(): void {
      for (const t of built.teardowns.splice(0)) t()
    },
  }
}
