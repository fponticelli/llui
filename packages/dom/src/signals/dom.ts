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

function applyAttr(node: Element, name: string, value: unknown): void {
  if (value == null || value === false) node.removeAttribute(name)
  else node.setAttribute(name, value === true ? '' : String(value))
}

/** `onClick` -> `click`, `onInput` -> `input`. */
function eventName(prop: string): string {
  return prop.slice(2).toLowerCase()
}

/** Build an element. `on*` function props become event listeners; `react(...)`
 * props become reactive bindings; everything else is a static attribute. */
export function el(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly Node[] = [],
): Element {
  const c = requireCtx()
  const node = c.doc.createElement(tag)
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
  return node
}

export interface SignalMount {
  /** apply a new state; only bindings whose deps changed re-run and commit. */
  update(next: unknown): void
}

/** Run a build function with a fresh collecting context, returning the produced
 * nodes and the bindings created during it. Nests safely (restores the previous
 * context), so structural primitives can build rows mid-reconcile. */
function runBuild(
  doc: Document,
  build: () => readonly Node[],
): { nodes: readonly Node[]; specs: BindingSpec[]; host: { scope: SignalScope | null } } {
  const prev = ctx
  const specs: BindingSpec[] = []
  const host: { scope: SignalScope | null } = { scope: null }
  ctx = { specs, doc, host }
  let nodes: readonly Node[]
  try {
    nodes = build()
  } finally {
    ctx = prev
  }
  return { nodes, specs, host }
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

/** Items source for `signalEach`: an accessor for the array plus its dep paths. */
export interface EachItems<T> {
  produce: (state: unknown) => readonly T[]
  deps: readonly string[]
}

/**
 * Keyed list primitive. The items source is a structural binding on the array's
 * path; on change it reconciles by key. Each row is its OWN signal scope mounted
 * on the item value — so a change to one item re-runs only that row's bindings
 * (and only the ones whose item-relative deps changed). Kept rows are mutated in
 * place, never recreated.
 *
 * Index accessor and move-minimizing reorder are deferred (correct-but-simple
 * reorder: rows are re-inserted in order before the end anchor).
 */
export function signalEach<T>(
  items: EachItems<T>,
  key: (item: T) => string | number,
  renderRow: () => readonly Node[],
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
    item: T
  }
  const rows = new Map<string, Row>()

  const reconcile = (next: readonly T[]): void => {
    const parent = end.parentNode
    if (!parent) return
    const seen = new Set<string>()
    for (const item of next) {
      const k = String(key(item))
      seen.add(k)
      let row = rows.get(k)
      if (!row) {
        const built = runBuild(doc, renderRow)
        const scope = buildAndPublishScope(built)
        scope.mount(item) // row scope's "state" is the item value
        row = { scope, nodes: built.nodes, item }
        rows.set(k, row)
      } else {
        row.scope.update(row.item, item) // per-row gating
        row.item = item
      }
      for (const n of row.nodes) parent.insertBefore(n, end) // place/reorder
    }
    for (const [k, row] of rows) {
      if (!seen.has(k)) {
        for (const n of row.nodes) if (n.parentNode === parent) parent.removeChild(n)
        rows.delete(k)
      }
    }
  }

  c.specs.push({
    deps: items.deps,
    produce: items.produce,
    commit: (arr) => reconcile(arr as readonly T[]),
  })

  return frag
}

/** Condition source for `signalShow`: an accessor plus its dep paths. */
export interface ShowCond {
  produce: (state: unknown) => unknown
  deps: readonly string[]
}

/**
 * Conditional render. Mounts `render`'s content when the condition is truthy,
 * unmounts when falsy. The content is its OWN scope that reads the owning
 * component's state, registered as a child of the owning scope — so while shown
 * it receives state updates (its bindings re-run when THEIR deps change, not
 * just when the condition changes).
 */
export function signalShow(cond: ShowCond, render: () => readonly Node[]): Node {
  const c = requireCtx()
  const doc = c.doc
  const ownerHost = c.host
  const start = doc.createComment('show')
  const end = doc.createComment('/show')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  let mounted: { scope: SignalScope; nodes: readonly Node[] } | null = null

  const reconcile = (state: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const on = Boolean(cond.produce(state))
    if (on && !mounted) {
      const built = runBuild(doc, render)
      const scope = buildAndPublishScope(built)
      scope.mount(state) // content reads the component state
      for (const n of built.nodes) parent.insertBefore(n, end)
      ownerHost.scope?.addChild(scope) // receive future state updates while shown
      mounted = { scope, nodes: built.nodes }
    } else if (!on && mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const n of mounted.nodes) if (n.parentNode === parent) parent.removeChild(n)
      mounted = null
    }
  }

  // Gated by the condition's deps (reconcile only when the condition may change);
  // produce returns the state so reconcile can mount content against it.
  c.specs.push({ deps: cond.deps, produce: (s) => s, commit: (s) => reconcile(s) })

  return frag
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
  return {
    update(next: unknown): void {
      scope.update(cur, next)
      cur = next
    },
  }
}
