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
// `component.ts` imports `mountSignal` from THIS module — a benign cycle: ESM
// resolves it because `mountSignalComponent` is only ever CALLED (inside
// signalLazy's deferred resolve), never referenced during module eval. The loaded
// def's S/M/E are erased to `unknown` — the single documented type-erasure
// boundary for lazy.
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'

/** The minimal node-factory surface the signal build needs from its document.
 * Satisfied by a real `Document` (client) AND by a server `DomEnv` (SSR) — so a
 * single build path renders both in-browser and on the server without casts. */
export interface SignalDoc {
  createElement(tag: string): Element
  createElementNS(ns: string, tag: string): Element
  createTextNode(text: string): Text
  createComment(text: string): Comment
  createDocumentFragment(): DocumentFragment
  /** Present on a real client `Document`; absent on a server `DomEnv` (portals
   * default to it, so a portal with no explicit target is client-only). */
  readonly body?: HTMLElement | null
}

type Producer = (state: unknown) => unknown

interface BindingSpec {
  deps: readonly string[]
  produce: Producer
  commit: (value: unknown) => void
  // A structural primitive's spec (show/branch/each): its `produce` is identity
  // and `commit` reconciles arms/rows owning child scopes. Structural specs make
  // themselves row-aware at build time (see `c.inRow`), so the enclosing `each`'s
  // value-spec rebasing must SKIP them rather than rewrite their identity produce.
  structural?: boolean
}

interface BuildCtx {
  specs: BindingSpec[]
  doc: SignalDoc
  /** the scope that will own the bindings collected in this build — set after
   * buildScope. Structural primitives register their mounted child scopes here. */
  host: { scope: SignalScope | null }
  /** teardown callbacks (foreign unmount, subscription disposal) run on dispose. */
  teardowns: Array<() => void>
  /** onMount callbacks — run (with the mounted parent element) after the built
   * nodes are inserted; their returned cleanups join the teardown list. */
  mounts: Array<(root: Element) => void | (() => void)>
  /** context values in scope during this build (provide/useContext). Inherited
   * into nested builds (each rows, show/branch arms) by SHARING the parent's map
   * (no clone); `provide` copy-on-writes a private map before mutating, so a build
   * that never calls `provide` (the vast majority — every plain `each` row) pays no
   * clone. `ownContexts` tracks whether `contexts` is this build's private copy. */
  contexts: ReadonlyMap<symbol, unknown>
  ownContexts: boolean
  /** True when this build is INSIDE an `each` row's combined `{ item, state, index }`
   * ctx (set by `signalEach` for row builds, inherited by nested arm/row builds via
   * `runBuild`). Structural primitives use it to resolve component-state reads
   * against `ctx.state` and item/index against the row ctx, at every depth. */
  inRow: boolean
  /** live agent-affordance registry: tagged-send variant → refcount. SHARED by
   * reference across the whole component (root + every reactive row/arm build),
   * so `each`/`show`/`branch` registrations and their teardowns all affect the
   * one registry the handle's `getBindingDescriptors` reads. */
  descriptors: Map<string, number>
}
let ctx: BuildCtx | null = null

// Shared read-only sentinel for builds with no inherited/seeded contexts — avoids
// allocating an empty Map per build (provide() copy-on-writes before any mutation).
const EMPTY_CONTEXTS: ReadonlyMap<symbol, unknown> = new Map()

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

/** Adapter hook (`@llui/vike`): the build currently in progress, or null when
 * called outside a signal build. Exposes the build's `doc` (to create anchor
 * nodes that belong to the same document as the surrounding tree) and a SNAPSHOT
 * of the context values in scope at the call site (so an adapter that mounts a
 * NESTED build in a separate pass can replay them via `runBuild`'s `seedContexts`
 * / the `contexts` mount option). Returns a fresh snapshot map — safe to retain. */
export function __currentBuildInfo(): {
  doc: SignalDoc
  contexts: ReadonlyMap<symbol, unknown>
} | null {
  if (!ctx) return null
  return { doc: ctx.doc, contexts: new Map(ctx.contexts) }
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

/** A child slot: a built node, or a bare string/number that is coerced to a
 * static text node at append time (so `div(['hi', 42])` works without an
 * explicit `text(...)` — the same coercion every mainstream framework does). */
export type ChildNode = Node | string | number

const toKebab = (s: string): string => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())

// Curated set of names the DOM only honours as live IDL properties, NOT as
// content attributes: <textarea>/<select> have no `value` content attribute,
// and a control's `checked`/`selected` content attribute is its *default*,
// not its current state, so `setAttribute` silently leaves `.value`/`.checked`
// untouched. `indeterminate` has no attribute at all. This mirrors how Preact /
// Vue / lit route the same form-control props — the runtime owns DOM
// application, so this DOM quirk belongs here rather than in the compiler.
// Everything else (`disabled`, `hidden`, aria-*, data-*, SVG attrs, …) reflects
// correctly as an attribute and stays on the attribute path below.
// NOTE: scoped to the live-DOM client runtime. Server rendering serializes via
// the separate SSR renderer (a textarea's value → child text, a select's value
// → the matching option's `selected`); this set does not affect that path.
const DOM_PROPERTIES = new Set(['value', 'checked', 'selected', 'indeterminate'])

function applyAttr(node: Element, name: string, value: unknown): void {
  // `style.transform` / `style.zIndex` -> individual style properties
  if (name.startsWith('style.')) {
    const style = (node as HTMLElement).style
    const prop = toKebab(name.slice(6))
    if (value == null || value === false) style.removeProperty(prop)
    else style.setProperty(prop, String(value))
    return
  }
  // Form-control live properties — assign the IDL property directly when the
  // element actually exposes it (`name in node` keeps an arbitrary `value`
  // attribute on a non-form element, e.g. <div value="…">, on the attr path).
  if (DOM_PROPERTIES.has(name) && name in node) {
    if (name === 'value') {
      ;(node as HTMLInputElement).value = value == null || value === false ? '' : String(value)
    } else if (name === 'selected') {
      ;(node as HTMLOptionElement).selected = value === '' ? true : Boolean(value)
    } else {
      // checked / indeterminate — boolean IDL properties on a form control.
      ;(node as HTMLInputElement)[name as 'checked' | 'indeterminate'] =
        value === '' ? true : Boolean(value)
    }
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
  children: readonly ChildNode[],
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
      // tagSend-tagged handler → register the agent-dispatchable variants live.
      const variants = (value as { __lluiVariants?: readonly string[] }).__lluiVariants
      if (variants) registerVariants(c, variants)
    } else {
      applyAttr(node, name, value)
    }
  }
  for (const child of children) {
    node.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? c.doc.createTextNode(String(child))
        : child,
    )
  }
}

/** Build an element. `on*` function props become event listeners; `react(...)`
 * props become reactive bindings; everything else is a static attribute. */
export function el(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
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
  children: readonly ChildNode[] = [],
): Element {
  const node = requireCtx().doc.createElementNS(SVG_NS, tag)
  populate(node, props, children)
  return node
}

/** Run a build function with a fresh collecting context, returning the produced
 * nodes and the bindings created during it. Nests safely (restores the previous
 * context), so structural primitives can build rows mid-reconcile. */
function runBuild(
  doc: SignalDoc,
  build: () => readonly Node[],
  // The structural primitives build rows/arms REACTIVELY (after mount, when the
  // module `ctx` is null), so they pass their captured build-time ctx here to
  // keep context values and the descriptor registry flowing into nested builds.
  inherit?: BuildCtx,
  // Adapter seed: context values to make visible at the ROOT of this build, even
  // though no parent build is on the stack. `@llui/vike` captures the layout's
  // in-scope contexts at a `pageSlot()` and replays them here so contexts
  // provided ABOVE a slot reach the nested page's SEPARATE build/mount pass.
  seedContexts?: ReadonlyMap<symbol, unknown>,
  // Force this build's `inRow` true (set by `signalEach` for its row builds).
  // Otherwise `inRow` is inherited from the parent build, so arm/nested builds
  // inside a row stay row-aware.
  forceInRow = false,
): {
  nodes: readonly Node[]
  specs: BindingSpec[]
  host: { scope: SignalScope | null }
  teardowns: Array<() => void>
  mounts: Array<(root: Element) => void | (() => void)>
  descriptors: Map<string, number>
} {
  const prev = ctx
  const parent = inherit ?? prev
  const specs: BindingSpec[] = []
  const host: { scope: SignalScope | null } = { scope: null }
  const teardowns: Array<() => void> = []
  const mounts: Array<(root: Element) => void | (() => void)> = []
  // inherit in-scope context values so provide() above an each/show is visible
  // inside its rows/arms (which build in this nested context). SHARE the parent's
  // (or seeded) map by reference — `provide` copy-on-writes before mutating, so a
  // build with no provide never clones. Seeded adapter contexts apply only when
  // there's no parent build to inherit from.
  const contexts: ReadonlyMap<symbol, unknown> = parent?.contexts ?? seedContexts ?? EMPTY_CONTEXTS
  // SHARE the descriptor registry by reference (root one if present) so row/arm
  // registrations and decrements land in the component's single registry.
  const descriptors = parent?.descriptors ?? new Map<string, number>()
  const inRow = forceInRow || parent?.inRow || false
  ctx = { specs, doc, host, teardowns, mounts, contexts, ownContexts: false, inRow, descriptors }
  let nodes: readonly Node[]
  try {
    nodes = build()
  } finally {
    ctx = prev
  }
  return { nodes, specs, host, teardowns, mounts, descriptors }
}

/** Register the agent-affordance variants a tagged event handler dispatches, into
 * the active build's descriptor registry, with a teardown that decrements. */
function registerVariants(c: BuildCtx, variants: readonly string[]): void {
  if (variants.length === 0) return
  for (const v of variants) c.descriptors.set(v, (c.descriptors.get(v) ?? 0) + 1)
  c.teardowns.push(() => {
    for (const v of variants) {
      const next = (c.descriptors.get(v) ?? 0) - 1
      if (next <= 0) c.descriptors.delete(v)
      else c.descriptors.set(v, next)
    }
  })
}

/** Compiler-emitted (signal connect-translator path) + library helper: register
 * the variants for the active build scope. No-op outside a build. */
export function __registerScopeVariants(variants: readonly string[]): void {
  if (ctx) registerVariants(ctx, variants)
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
  if (!host) {
    throw new Error(
      'portal() needs an explicit target during SSR — the server DomEnv has no document.body',
    )
  }
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
  // Copy-on-write: the build shares its parent's contexts map by reference until
  // the first provide, which clones a private copy so the mutation doesn't leak to
  // the parent or sibling builds.
  if (!c.ownContexts) {
    c.contexts = new Map(c.contexts)
    c.ownContexts = true
  }
  const m = c.contexts as Map<symbol, unknown>
  const had = m.has(context.id)
  const prev = m.get(context.id)
  m.set(context.id, value)
  const frag = c.doc.createDocumentFragment()
  try {
    for (const n of render()) frag.appendChild(n)
  } finally {
    if (had) m.set(context.id, prev)
    else m.delete(context.id)
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

/** A row binding is "row-local" when every dep is rooted in the row ctx — its own
 * `item`/`index`, or the component `state` (compiled rows pre-namespace component
 * reads as `state.*`). Anything else is a handle from the ENCLOSING view (e.g. a
 * `connect()` part rooted at the bare component state) that was placed inside a
 * row by an UNCOMPILED `each`; its produce expects the component state, not the
 * combined row ctx. */
export function isRowLocalDep(d: string): boolean {
  return (
    d === 'item' ||
    d.startsWith('item.') ||
    d === 'index' ||
    d === 'state' ||
    d.startsWith('state.')
  )
}

/** True while the build in progress is an `each` row body (or a nested arm/row
 * inheriting that). `derived` reads this to rebase its component-state inputs to
 * `ctx.state` so a mixed `derived([state, item], …)` resolves each input against
 * the right part of the combined row ctx. */
export function __inRowBuild(): boolean {
  return ctx?.inRow ?? false
}

/** Re-root a single dependency path from the component state onto the combined
 * row ctx: a non-row-local component path `p` becomes `state.p` (and the whole
 * state `''` becomes `state`); row-local paths (`item`/`index`/`state.*`) keep. */
export const rebaseRowDep = (d: string): string =>
  isRowLocalDep(d) ? d : d === '' ? 'state' : `state.${d}`

/** Re-root a component-state-rooted VALUE row spec so it reads `ctx.state` (the
 * component state) instead of the combined row ctx — the fix that lets a
 * `connect()` part (or any enclosing-view signal) compose inside an authoring
 * `each` row. Row-local specs (and all compiled rows) pass through untouched. */
function rebaseRowSpec(spec: BindingSpec): BindingSpec {
  if (spec.deps.every(isRowLocalDep)) return spec
  return {
    deps: spec.deps.map(rebaseRowDep),
    produce: (ctx) => spec.produce((ctx as { state: unknown }).state),
    commit: spec.commit,
  }
}

/** Remove every node strictly between the `start` and `end` anchors. Used to tear
 * down a show/branch arm: it clears the arm's nodes AND any content a NESTED
 * structural primitive mounted between its own anchors (which is a sibling here,
 * not captured in the arm's `built.nodes`), so swapping/disposing an arm never
 * leaks inner content. The anchors themselves are left in place. */
function removeBetween(start: Node, end: Node): void {
  let n = start.nextSibling
  while (n && n !== end) {
    const next = n.nextSibling
    n.parentNode?.removeChild(n)
    n = next
  }
}

/** Rebase every VALUE spec in a row/arm build to read `ctx.state`, leaving
 * STRUCTURAL specs (show/branch/each) untouched — they make themselves row-aware
 * at build time (`c.inRow`), so rewriting their identity produce would break the
 * arm/row mount. */
function rebaseRowSpecs(specs: readonly BindingSpec[]): BindingSpec[] {
  return specs.map((s) => (s.structural ? s : rebaseRowSpec(s)))
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
 * Indices into `a` that form a longest strictly-increasing subsequence, skipping
 * entries `< 0` (used for keyed reorder: entries are old DOM positions and `-1`
 * marks a freshly-created row). Patience-sorting with parent links, O(n log n).
 * The returned set marks the rows that are ALREADY in correct relative order and
 * therefore need no DOM move — every other row is inserted/moved.
 */
function lisIndices(a: readonly number[]): Set<number> {
  const piles: number[] = [] // piles[l] = index in `a` of the smallest tail of a length-(l+1) subseq
  const prev = new Array<number>(a.length).fill(-1)
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (v < 0) continue // new row — never part of the kept (LIS) set
    let lo = 0
    let hi = piles.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (a[piles[mid]!]! < v) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = piles[lo - 1]!
    piles[lo] = i
  }
  const keep = new Set<number>()
  let k = piles.length > 0 ? piles[piles.length - 1]! : -1
  while (k >= 0) {
    keep.add(k)
    k = prev[k]!
  }
  return keep
}

/**
 * Keyed list primitive. A structural binding gated on the list's deps (items
 * path + row-state paths); on change it reconciles by key. Each row is its OWN
 * signal scope mounted on a combined `{ item, state }` context — so a row reacts
 * to its item AND to component state, with per-row, per-binding gating (a shared
 * state change fans out only to the row bindings that read it; item changes hit
 * only that row). Kept rows are mutated in place, never recreated.
 *
 * Reorder is move-minimizing via a longest-increasing-subsequence pass over the
 * rows' previous DOM positions: only `n − |LIS|` rows move, so a 2-row swap is 2
 * DOM moves and a single removal is 0 — not the O(n) re-insert the naive cursor
 * walk degraded to (swap/remove were ~6×/4× slower than peer frameworks).
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
  // When this each is itself nested in an enclosing row, its reconcile must
  // receive the component state (`ctx.state`), so its own rows mount with
  // `ctx.state` = the component state (not the enclosing row ctx).
  const inRow = c.inRow
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
    // onMount callbacks, run once after the row's nodes are first inserted (phase 3).
    mounts: ReadonlyArray<(root: Element) => void | (() => void)>
    mounted: boolean
  }
  const rows = new Map<string, Row>()
  // Keys in current DOM order — the previous reconcile's desired order. Drives the
  // LIS move-minimization (old position of each surviving key).
  let order: string[] = []
  // Whether the row template has ANY binding that reads component state (`state` /
  // `state.*` deps, after rebasing). Probed once from the first built row — every
  // row shares the template, so it's a property of the `each`, not the row. When
  // false, a row whose `item` + `index` are unchanged needs no re-evaluation even
  // though the component-state ref changed (its bindings can't depend on it), so we
  // skip its `scope.update` — turning an N-row in-place update into work
  // proportional to the rows that actually changed.
  let templateReadsState = true
  // Whether any row spec has a non-row-local dep (a bare component-state path from
  // an uncompiled connect-part) needing rebasing to `state.*`. Probed once — when
  // false (compiled rows / item-only rows) the per-row `rebaseRowSpec` map is pure
  // overhead, so it's skipped.
  let needsRebase = true
  let templateProbed = false

  const reconcile = (state: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const items = source.items(state)
    const n = items.length
    const newKeys = new Array<string>(n)
    const newRows = new Array<Row>(n)
    const seen = new Set<string>()
    // Track whether the key sequence is positionally identical to the previous
    // DOM order. If so this is a pure in-place update (no create/remove/move) and
    // we can skip the ordering bookkeeping (old-position map + LIS) entirely — the
    // hot path for `update`/`replace`-in-place, which must not pay reorder cost.
    let sameOrder = order.length === n

    // ── Phase 1: create-or-update every desired row (NO DOM moves yet) ──
    for (let index = 0; index < n; index++) {
      const item = items[index]!
      const k = String(key(item))
      newKeys[index] = k
      if (sameOrder && order[index] !== k) sameOrder = false
      seen.add(k)
      let row = rows.get(k)
      if (!row) {
        const ctx: RowCtx<T> = { item, state, index }
        const holder = { ctx }
        // forceInRow: the row build (and every nested arm/row build) operates on
        // the combined ctx, so structural primitives inside it become row-aware.
        const built = runBuild(doc, () => renderRow(() => holder.ctx), c, undefined, true)
        // Probe the template once (all rows share it): does any VALUE spec need
        // rebasing (non-row-local dep), and does any binding read component state?
        // Structural specs make themselves row-aware, so they're excluded here.
        if (!templateProbed) {
          templateProbed = true
          // A keyed row must be one or more STABLE nodes. A structural primitive
          // (show/branch/each) returns a DocumentFragment that empties on insertion
          // — as a bare row root it leaves the row with no stable handle to move or
          // remove, so reorder/removal corrupts the DOM (NotFoundError). Require it
          // to be wrapped in an element, which becomes the row's stable boundary.
          if (built.nodes.some((nd) => nd.nodeType === 11 /* DocumentFragment */)) {
            throw new Error(
              'each: a row cannot have a `show`/`branch`/`each` as its top-level node — ' +
                'wrap the conditional body in an element (e.g. `li([show(...)])`) so the ' +
                'row has a stable node to key, move, and remove.',
            )
          }
          needsRebase = built.specs.some(
            (s) => !s.structural && s.deps.some((d) => !isRowLocalDep(d)),
          )
          // A row reads component state if any binding has a `state.*`/`state` dep,
          // OR if it has a STRUCTURAL child (show/branch/each): that child's arms are
          // built lazily and may read state from inside (e.g. a folder/file show
          // whose file arm nests a `state.editingId` rename show). We can't see those
          // arm specs here, so any structural child forces per-state-change row
          // re-evaluation — which propagates the update down to the arm scopes.
          templateReadsState =
            needsRebase ||
            built.specs.some(
              (s) => s.structural || s.deps.some((d) => d === 'state' || d.startsWith('state.')),
            )
        }
        // Re-root component-state-rooted VALUE bindings (e.g. connect() parts placed
        // in the row by an uncompiled each) to read ctx.state — only when needed.
        if (needsRebase) built.specs = rebaseRowSpecs(built.specs)
        const scope = buildAndPublishScope(built)
        scope.mount(ctx) // row scope's "state" is the combined ctx
        row = {
          scope,
          nodes: built.nodes,
          ctx,
          spare: { item, state, index },
          teardowns: built.teardowns,
          holder,
          mounts: built.mounts,
          mounted: false,
        }
        rows.set(k, row)
      } else if (templateReadsState || item !== row.ctx.item || index !== row.ctx.index) {
        // existing row that may have changed: re-run only the bindings whose part
        // of the ctx changed. Reuse the spare ctx buffer (no allocation); swap it
        // in as the new current. old (row.ctx) and new (next) stay distinct refs,
        // so the diff sees item/state changes correctly.
        const next = row.spare
        next.item = item
        next.state = state
        next.index = index
        row.scope.update(row.ctx, next)
        row.spare = row.ctx
        row.ctx = next
        row.holder.ctx = next // keep runtime item handles' .peek() current
        // No else: item + index unchanged and no binding reads component state, so
        // the row's output can't have changed — skip the diff + binding re-eval.
      }
      newRows[index] = row
    }

    // Fast path: identical key sequence → no creates, removes, or moves. The DOM
    // is already in the right order; rows were updated in place above.
    if (sameOrder) {
      order = newKeys
      return
    }

    // Full clear: drop all rows' teardowns, then remove every row node between the
    // anchors in ONE Range op (where supported) instead of N removeChild calls.
    if (n === 0 && rows.size > 0) {
      for (const row of rows.values()) for (const t of row.teardowns.splice(0)) t()
      const ownerDoc = (parent as Node).ownerDocument
      const range = typeof ownerDoc?.createRange === 'function' ? ownerDoc.createRange() : null
      if (range) {
        range.setStartAfter(start)
        range.setEndBefore(end)
        range.deleteContents()
      } else {
        for (const row of rows.values())
          for (const node of row.nodes) if (node.parentNode === parent) parent.removeChild(node)
      }
      rows.clear()
      order = newKeys // empty
      return
    }

    // ── Phase 2: remove rows no longer present ──
    if (rows.size > n || seen.size < rows.size) {
      for (const [k, row] of rows) {
        if (!seen.has(k)) {
          for (const t of row.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
          for (const node of row.nodes) if (node.parentNode === parent) parent.removeChild(node)
          rows.delete(k)
        }
      }
    }

    // ── Phase 3: order the DOM with minimal moves (LIS over old positions) ──
    // sources[i] = the old DOM position of the row now wanted at i, or -1 if it
    // was created this pass. Rows in the LIS are already correctly ordered and
    // stay put; every other row (and every new row) is inserted before the anchor
    // as we walk right-to-left. Moves = n − |LIS|.
    const oldPos = new Map<string, number>()
    for (let i = 0; i < order.length; i++) oldPos.set(order[i]!, i)
    const sources = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const p = oldPos.get(newKeys[i]!)
      sources[i] = p === undefined ? -1 : p
    }
    const keep = lisIndices(sources)
    let anchor: Node = end
    for (let i = n - 1; i >= 0; i--) {
      const row = newRows[i]!
      if (sources[i] === -1) {
        for (const node of row.nodes) parent.insertBefore(node, anchor)
        if (!row.mounted) {
          row.mounted = true
          runMounts(row.mounts, parent as Element, row.teardowns)
        }
      } else if (!keep.has(i)) {
        for (const node of row.nodes) parent.insertBefore(node, anchor)
      }
      // anchor for the next (leftward) row is this row's first node
      anchor = row.nodes[0] ?? anchor
    }

    order = newKeys
  }

  // structural binding: fires when the list deps change; produce returns the
  // component state so reconcile can build each row's combined ctx. Nested in an
  // enclosing row, it reads `ctx.state` and its deps rebase onto that combined ctx.
  c.specs.push({
    deps: inRow ? source.deps.map(rebaseRowDep) : source.deps,
    produce: inRow ? (s) => (s as { state: unknown }).state : (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
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
  // Inside an each row the scope state is the combined ctx `{ item, state }`. The
  // arm is child-propagated that full ctx, so it must MOUNT on it (not on the
  // component state); the arm's value specs are rebased to read `ctx.state`.
  //
  // The CONDITION is rooted per its deps (mirroring `rebaseRowSpec`): a cond whose
  // deps are all row-local — a compiled row pre-namespaces reads as `ctx.item` /
  // `ctx.state`, and an `item`/`index` handle resolves its path against the given
  // object — is evaluated against the FULL combined ctx. A cond with a non-row-local
  // dep is an enclosing-view handle rooted at the bare component state, so it is fed
  // `ctx.state`. (A mixed `derived([state, item], …)` cond is rebased per-input in
  // the authoring layer so its deps are all row-local by the time it reaches here.)
  const inRow = c.inRow
  const condReadsCtx = !inRow || cond.deps.every(isRowLocalDep)
  const evalCond = (s: unknown): unknown =>
    cond.produce(condReadsCtx ? s : (s as { state: unknown }).state)
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
    const on = Boolean(evalCond(state))
    if (mounted && mounted.on === on) return // same arm — inner scope handles updates

    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
      removeBetween(start, end) // arm nodes + any nested-structural content
      mounted = null
    }

    const arm = on ? render : orElse
    if (arm) {
      const built = runBuild(doc, arm, c)
      if (inRow) built.specs = rebaseRowSpecs(built.specs) // value reads → ctx.state
      const scope = buildAndPublishScope(built)
      scope.mount(state) // mount on the same (combined-ctx) state child-prop will feed
      for (const n of built.nodes) parent.insertBefore(n, end)
      ownerHost.scope?.addChild(scope) // receive future state updates while mounted
      runMounts(built.mounts, parent as Element, built.teardowns)
      mounted = { on, scope, nodes: built.nodes, teardowns: built.teardowns }
    }
  }

  // Gated by the condition's deps (reconcile only when the condition may change);
  // produce returns the full state so reconcile can mount the arm against it. In a
  // row, the deps are rebased onto the combined ctx so gating fires on `ctx.state`
  // changes; `structural: true` keeps the enclosing each from rewriting `produce`.
  c.specs.push({
    deps: inRow ? cond.deps.map(rebaseRowDep) : cond.deps,
    produce: (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose, tear down the currently-mounted arm (onMount cleanups,
  // foreign unmounts) — otherwise reference-counted side effects (scroll lock,
  // focus trap, dismissable) leak when the component unmounts while open. Also
  // remove the arm's nodes (incl. nested-structural content) so that disposing an
  // OUTER arm — which runs this teardown for an inner show/branch — clears the
  // inner content rather than orphaning it between the (now-removed) anchors.
  c.teardowns.push(() => {
    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t()
      removeBetween(start, end)
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
  // See signalShow: in an each row the arm mounts on the full combined ctx and its
  // value specs are rebased to read `ctx.state`. The discriminant is rooted per its
  // deps — all-row-local (compiled `ctx.*`, or an item/index handle) reads the full
  // ctx; a non-row-local enclosing-view handle reads `ctx.state`.
  const inRow = c.inRow
  const discReadsCtx = !inRow || disc.deps.every(isRowLocalDep)
  const evalDisc = (s: unknown): unknown =>
    disc.produce(discReadsCtx ? s : (s as { state: unknown }).state)
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
    const key = String(evalDisc(state))
    if (mounted && mounted.key === key) return // same arm — inner scope handles updates

    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
      removeBetween(start, end) // arm nodes + any nested-structural content
      mounted = null
    }

    const render = arms[key]
    if (render) {
      const built = runBuild(doc, render, c)
      if (inRow) built.specs = rebaseRowSpecs(built.specs)
      const scope = buildAndPublishScope(built)
      scope.mount(state)
      for (const n of built.nodes) parent.insertBefore(n, end)
      ownerHost.scope?.addChild(scope)
      runMounts(built.mounts, parent as Element, built.teardowns)
      mounted = { key, scope, nodes: built.nodes, teardowns: built.teardowns }
    }
  }

  c.specs.push({
    deps: inRow ? disc.deps.map(rebaseRowDep) : disc.deps,
    produce: (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose, tear down the mounted arm (see signalShow for rationale).
  c.teardowns.push(() => {
    if (mounted) {
      ownerHost.scope?.removeChild(mounted.scope)
      for (const t of mounted.teardowns.splice(0)) t()
      removeBetween(start, end)
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
  /** live agent-affordance variants (tagged-send handlers currently mounted). */
  getDescriptors(): Array<{ variant: string }>
}

/** Where a `mountSignal` call attaches its built nodes. A `container` element
 * (the common case — append, or replace its children on hydration) OR an
 * `anchor` comment, for adapters like `@llui/vike` that mount a nested layer as
 * siblings of a slot anchor without owning the parent element. The owned region
 * is bracketed by the anchor and a synthesized end sentinel; `dispose()` removes
 * exactly that region (leaving the anchor + outer siblings intact). */
export type MountTarget =
  | { container: Element; mode?: 'append' | 'replace' }
  // `mode: 'replace'` (hydration) first removes any existing server region
  // between the anchor and the next `llui-mount-end` sentinel, then mounts fresh
  // — mirroring container hydration's atomic swap (no claim of server nodes).
  | { anchor: Comment; mode?: 'append' | 'replace' }

/**
 * Mount a signal view: build the nodes (collecting bindings), attach them at the
 * target, and wire a chunked-mask reconciler over the collected bindings.
 *
 * For a `container` target, 'append' (fresh mount) leaves existing children and
 * 'replace' swaps server HTML out atomically (hydration). For an `anchor` target,
 * the nodes are inserted immediately after the anchor comment and bracketed by a
 * synthesized end sentinel — `dispose()` removes that bracketed region.
 *
 * `seedContexts` seeds the build's root context values (see `runBuild`); used by
 * adapters mounting a nested build whose providers live in a different pass.
 */
export function mountSignal(
  target: Element | MountTarget,
  initial: unknown,
  build: () => readonly Node[],
  modeOrSeed?: 'append' | 'replace' | ReadonlyMap<symbol, unknown>,
  seedContexts?: ReadonlyMap<symbol, unknown>,
): SignalMount {
  // Back-compat positional form: mountSignal(container, initial, build, mode).
  const t: MountTarget =
    target instanceof Object && 'container' in target
      ? target
      : target instanceof Object && 'anchor' in target
        ? target
        : { container: target as Element, mode: (modeOrSeed as 'append' | 'replace') ?? 'append' }
  const seed = modeOrSeed instanceof Map ? modeOrSeed : seedContexts

  if ('anchor' in t) {
    const anchor = t.anchor
    const doc = anchor.ownerDocument as unknown as SignalDoc
    const built = renderSignalTree(doc, build, seed)
    const parent = anchor.parentNode
    if (!parent) throw new Error('mountSignal: anchor comment is not attached to a parent')
    // Hydration: drop the server-rendered region (anchor → existing end sentinel)
    // before inserting the fresh client tree — same no-claim swap as containers.
    if (t.mode === 'replace') {
      let n = anchor.nextSibling
      while (n && !(n.nodeType === 8 && (n as Comment).data === 'llui-mount-end')) {
        const next = n.nextSibling
        parent.removeChild(n)
        n = next
      }
      if (n) parent.removeChild(n) // the stale end sentinel
    }
    const end = doc.createComment('llui-mount-end')
    const insertPoint = anchor.nextSibling
    for (const n of built.nodes) parent.insertBefore(n, insertPoint)
    parent.insertBefore(end, insertPoint)
    // Insert FIRST, then mount (structural reconcile + binding commits) so onMount
    // / portal / focus work see attached nodes; then run onMount callbacks.
    built.mount(initial)
    runMounts(built.mounts, parent as Element, built.teardowns)
    let cur = initial
    return {
      update(next: unknown): void {
        built.scope.update(cur, next)
        cur = next
      },
      dispose(): void {
        for (const tdn of built.teardowns.splice(0)) tdn()
        // remove the owned region: every node between anchor and end (exclusive).
        let n = anchor.nextSibling
        while (n && n !== end) {
          const next = n.nextSibling
          parent.removeChild(n)
          n = next
        }
        if (end.parentNode === parent) parent.removeChild(end)
      },
      getDescriptors: built.getDescriptors,
    }
  }

  const container = t.container
  const built = renderSignalTree(container.ownerDocument, build, seed)
  if (t.mode === 'replace') container.replaceChildren(...built.nodes)
  else for (const n of built.nodes) container.appendChild(n)

  // Insert FIRST, then mount (binding commits + first structural reconcile) so
  // show/each content + onMount focus/portal see attached nodes; then onMount.
  built.mount(initial)
  runMounts(built.mounts, container, built.teardowns) // onMount(root) after insert
  let cur = initial
  return {
    update(next: unknown): void {
      built.scope.update(cur, next)
      cur = next
    },
    dispose(): void {
      for (const tdn of built.teardowns.splice(0)) tdn()
    },
    getDescriptors: built.getDescriptors,
  }
}

/** The shared build core: run the view build against `doc` and wire the scope —
 * WITHOUT attaching to any container or applying the initial state. The returned
 * `mount(state)` runs the binding commits (and the first structural reconcile,
 * which inserts `show`/`each` content and registers onMount work); callers MUST
 * insert `nodes` into the live document BEFORE calling `mount` so onMount focus /
 * portal / dismissable behavior sees attached nodes — except SSR, which mounts a
 * detached tree purely to bake initial values into the serialized HTML. */
export function renderSignalTree(
  doc: SignalDoc,
  build: () => readonly Node[],
  // Adapter seed (see `runBuild`): context values to expose at the root of this
  // build when no surrounding build provides them (`@llui/vike` slot replay).
  seedContexts?: ReadonlyMap<symbol, unknown>,
): {
  nodes: readonly Node[]
  scope: SignalScope
  mount: (state: unknown) => void
  teardowns: Array<() => void>
  mounts: Array<(root: Element) => void | (() => void)>
  getDescriptors: () => Array<{ variant: string }>
} {
  const built = runBuild(doc, build, undefined, seedContexts)
  const scope = buildAndPublishScope(built)
  return {
    nodes: built.nodes,
    scope,
    mount: (state: unknown) => scope.mount(state),
    teardowns: built.teardowns,
    mounts: built.mounts,
    getDescriptors: () => {
      const out: Array<{ variant: string }> = []
      for (const variant of built.descriptors.keys()) out.push({ variant })
      return out
    },
  }
}

// ── lazy (async component loading) ──────────────────────────────────
export interface SignalLazyOptions<LS = unknown, LM = unknown, LE = unknown> {
  /** async loader — typically `() => import('./Chart').then(m => m.default)`. The
   * loaded component's S/M/E are inferred, so `initialState` is typed and no cast
   * is needed at the call site. */
  loader: () => Promise<SignalComponentDef<LS, LM, LE>>
  /** nodes rendered (reactively, in the current build) while loading */
  fallback: () => readonly Node[]
  /** nodes rendered if the loader rejects (nothing if omitted) */
  error?: (err: Error) => readonly Node[]
  /** seed state for the loaded component, overriding its `init()` result */
  initialState?: LS
}

/**
 * Load a signal component asynchronously. Renders `fallback()` immediately as
 * siblings of an anchor comment (built in the CURRENT build, so the fallback is
 * reactive). When `loader()` resolves, the fallback region is removed and the
 * loaded component is mounted via `mountSignalComponent({ anchor, mode:'append' })`
 * — reusing the anchor-mount infra (nodes inserted after the anchor, bracketed by
 * an `llui-mount-end` sentinel; its handle owns that region's update loop and
 * dispose). If the loader rejects, `error(err)` is swapped in (or nothing).
 *
 * If the surrounding build is torn down before the loader settles, a cancelled
 * flag skips the deferred mount; any already-mounted child handle is disposed.
 */
export function signalLazy<LS = unknown, LM = unknown, LE = unknown>(
  opts: SignalLazyOptions<LS, LM, LE>,
): Node {
  const c = requireCtx()
  const doc = c.doc
  const anchor = doc.createComment('lazy')

  // Build the fallback in the CURRENT build so its bindings join the surrounding
  // scope and stay reactive. Bracket it with an end sentinel so the region can be
  // removed wholesale on swap.
  const fallbackEnd = doc.createComment('/lazy-fallback')
  const fallbackNodes = opts.fallback()

  let cancelled = false
  let mounted: SignalComponentHandle<LS, LM> | null = null
  // error-arm nodes (built in a nested build inheriting this ctx) + their scope,
  // so an error swap is reactive and torn down on dispose.
  let errorScope: SignalScope | null = null
  let errorNodes: readonly Node[] = []
  let errorTeardowns: Array<() => void> = []

  const removeFallback = (): void => {
    const parent = anchor.parentNode
    if (!parent) return
    for (const n of fallbackNodes) if (n.parentNode === parent) parent.removeChild(n)
    if (fallbackEnd.parentNode === parent) parent.removeChild(fallbackEnd)
  }

  void opts
    .loader()
    .then((def) => {
      if (cancelled) return
      removeFallback()
      mounted = mountSignalComponent<LS, LM, LE>(
        { anchor: anchor as Comment, mode: 'append' },
        def,
        opts.initialState !== undefined ? { initialState: opts.initialState } : undefined,
      )
    })
    .catch((err: unknown) => {
      if (cancelled) return
      removeFallback()
      if (!opts.error) return
      const e = err instanceof Error ? err : new Error(String(err))
      const parent = anchor.parentNode
      if (!parent) return
      const built = runBuild(doc, () => opts.error!(e), c)
      errorScope = buildAndPublishScope(built)
      errorNodes = built.nodes
      errorTeardowns = built.teardowns
      const insertPoint = anchor.nextSibling
      for (const n of errorNodes) parent.insertBefore(n, insertPoint)
      // mount against the host's current state is unknown here; the error arm
      // typically reads only the captured `err` (deps []), so mount with null.
      errorScope.mount(null)
      runMounts(built.mounts, parent as Element, built.teardowns)
    })

  // On host dispose: cancel any in-flight load, dispose a mounted child, tear
  // down an error arm.
  c.teardowns.push(() => {
    cancelled = true
    mounted?.dispose()
    mounted = null
    if (errorScope) {
      for (const t of errorTeardowns.splice(0)) t()
      const parent = anchor.parentNode
      if (parent) for (const n of errorNodes) if (n.parentNode === parent) parent.removeChild(n)
      errorScope = null
    }
  })

  const frag = doc.createDocumentFragment()
  frag.appendChild(anchor)
  for (const n of fallbackNodes) frag.appendChild(n)
  frag.appendChild(fallbackEnd)
  return frag
}

// ── virtualEach (windowed list) ─────────────────────────────────────
export interface VirtualEachSpec<T> extends EachSource<T> {
  key: (item: T) => string | number
  /** fixed pixel height per row (dynamic heights unsupported) */
  itemHeight: number
  /** scroll-container height in pixels */
  containerHeight: number
  /** extra rows rendered above/below the viewport (default 3) */
  overscan?: number
  /** optional class on the scroll container */
  class?: string
  /** build a row; `getCtx` exposes the row's live `{ item, state, index }` ctx
   * (same shape as `signalEach`) for runtime item/index handles. */
  renderRow: (getCtx: () => RowCtx<T>) => readonly Node[]
}

/**
 * Virtualized keyed list — only the rows in the scroll viewport (+overscan) exist
 * in the DOM. A scroll container (fixed `containerHeight`, `data-virtual-container`)
 * holds an inner spacer (`data-virtual-spacer`) sized to `items.length*itemHeight`;
 * each visible row is absolutely positioned (`translateY`) at `index*itemHeight`.
 *
 * On scroll the visible window is recomputed and rows are reconciled BY KEY using
 * the same per-row machinery as `signalEach` (per-row sub-build via `runBuild`
 * with `inherit`, a row scope mounted on a `{ item, state, index }` ctx, teardowns
 * on removal). Rows scrolled out are disposed; rows scrolled in are built. The
 * window also recomputes when `items` changes (a spec gated on `items.deps`).
 *
 * Limitation: FIXED row height only — `itemHeight` must be uniform.
 */
export function signalVirtualEach<T>(spec: VirtualEachSpec<T>): Node {
  const c = requireCtx()
  const doc = c.doc
  // Nested in an enclosing row, reconcile reads the component state from the
  // combined ctx (so rows window/mount against it, not the enclosing row ctx).
  const inRow = c.inRow
  const overscan = spec.overscan ?? 3

  const scroll = doc.createElement('div') as HTMLElement
  scroll.setAttribute('data-virtual-container', '')
  scroll.style.setProperty('overflow', 'auto')
  scroll.style.setProperty('position', 'relative')
  scroll.style.setProperty('height', `${spec.containerHeight}px`)
  if (spec.class) scroll.setAttribute('class', spec.class)

  const spacer = doc.createElement('div') as HTMLElement
  spacer.setAttribute('data-virtual-spacer', '')
  spacer.style.setProperty('position', 'relative')
  spacer.style.setProperty('width', '100%')
  scroll.appendChild(spacer)

  interface Row {
    scope: SignalScope
    nodes: readonly Node[]
    wrapper: HTMLElement
    ctx: RowCtx<T>
    spare: RowCtx<T>
    index: number
    teardowns: Array<() => void>
    holder: { ctx: RowCtx<T> }
  }
  const rows = new Map<string, Row>()

  let lastState: unknown = null
  let scrollTop = 0

  const computeRange = (length: number): [number, number] => {
    if (length === 0) return [0, 0]
    const start = Math.max(0, Math.floor(scrollTop / spec.itemHeight) - overscan)
    const end = Math.min(
      length,
      Math.ceil((scrollTop + spec.containerHeight) / spec.itemHeight) + overscan,
    )
    return [start, end]
  }

  const positionWrapper = (wrapper: HTMLElement, index: number): void => {
    wrapper.style.setProperty('position', 'absolute')
    wrapper.style.setProperty('top', '0')
    wrapper.style.setProperty('left', '0')
    wrapper.style.setProperty('right', '0')
    wrapper.style.setProperty('height', `${spec.itemHeight}px`)
    wrapper.style.setProperty('transform', `translateY(${index * spec.itemHeight}px)`)
  }

  const disposeRow = (row: Row): void => {
    for (const t of row.teardowns.splice(0)) t()
    if (row.wrapper.parentNode === spacer) spacer.removeChild(row.wrapper)
  }

  const reconcile = (state: unknown): void => {
    lastState = state
    const items = spec.items(state)
    spacer.style.setProperty('height', `${items.length * spec.itemHeight}px`)

    const [start, end] = computeRange(items.length)
    const seen = new Set<string>()

    for (let index = start; index < end; index++) {
      const item = items[index]!
      const k = String(spec.key(item))
      seen.add(k)
      const row = rows.get(k)
      if (!row) {
        const wrapper = doc.createElement('div') as HTMLElement
        wrapper.setAttribute('data-virtual-item', '')
        wrapper.setAttribute('data-virtual-key', k)
        positionWrapper(wrapper, index)
        const rowCtx: RowCtx<T> = { item, state, index }
        const holder = { ctx: rowCtx }
        // forceInRow + rebase the row's value specs to read ctx.state (same as
        // signalEach), so component-state reads in a virtual row resolve correctly.
        const built = runBuild(doc, () => spec.renderRow(() => holder.ctx), c, undefined, true)
        built.specs = rebaseRowSpecs(built.specs)
        const scope = buildAndPublishScope(built)
        scope.mount(rowCtx)
        for (const n of built.nodes) wrapper.appendChild(n)
        spacer.appendChild(wrapper)
        runMounts(built.mounts, wrapper, built.teardowns)
        rows.set(k, {
          scope,
          nodes: built.nodes,
          wrapper,
          ctx: rowCtx,
          spare: { item, state, index },
          index,
          teardowns: built.teardowns,
          holder,
        })
        continue
      }
      // existing row: re-run only the bindings whose part of the ctx changed.
      const next = row.spare
      next.item = item
      next.state = state
      next.index = index
      row.scope.update(row.ctx, next)
      row.spare = row.ctx
      row.ctx = next
      row.holder.ctx = next
      if (row.index !== index) {
        row.index = index
        positionWrapper(row.wrapper, index)
      }
    }

    for (const [k, row] of rows) {
      if (!seen.has(k)) {
        disposeRow(row)
        rows.delete(k)
      }
    }
  }

  // Recompute the window on scroll WITHOUT a component-state change.
  const onScroll = (): void => {
    scrollTop = scroll.scrollTop
    reconcile(lastState)
  }
  scroll.addEventListener('scroll', onScroll, { passive: true } as AddEventListenerOptions)

  // Structural binding gated on the list deps: re-window + resize when items
  // change. produce returns the whole state so reconcile can build row ctxs.
  c.specs.push({
    deps: inRow ? spec.deps.map(rebaseRowDep) : spec.deps,
    produce: inRow ? (s) => (s as { state: unknown }).state : (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose: detach the scroll listener and tear down every live row.
  c.teardowns.push(() => {
    scroll.removeEventListener('scroll', onScroll)
    for (const [k, row] of rows) {
      disposeRow(row)
      rows.delete(k)
    }
  })

  return scroll
}
