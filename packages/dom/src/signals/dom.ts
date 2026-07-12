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

import { createSignalScope, type SignalScope } from './runtime.js'
import {
  buildPathTable,
  bindingMask,
  resolvePath,
  type PathTable,
  type SparseMask,
} from './mask.js'
import type { LiveSignal } from './types.js'
// `component.ts` imports `mountSignal` from THIS module — a benign cycle: ESM
// resolves it because `mountSignalComponent` is only ever CALLED (inside
// signalLazy's deferred resolve), never referenced during module eval. The loaded
// def's S/M/E are erased to `unknown` — the single documented type-erasure
// boundary for lazy.
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'
import { isSignalHandle } from './handle.js'

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
  /** Present on a real client `Document`; absent on a server `DomEnv`. The
   * head-management primitives commit here on the client (and skip when absent,
   * deferring to the SSR collector seeded via context). */
  readonly head?: HTMLHeadElement | null
  /** Present on a real client `Document`; the `<html>` root for `htmlAttr`. */
  readonly documentElement?: HTMLElement | null
  /** Present on a server `DomEnv` (and `browserEnv`): parse an HTML string into a
   * fragment. Absent on a raw client `Document` (the runtime falls back to a
   * `<template>` parse there — see `parseFragment`). Used by `unsafeHtml`. */
  parseHtmlFragment?(html: string): DocumentFragment
}

type Producer = (state: unknown) => unknown

/** A reactive binding: the dependency paths it reads + an accessor (`produce`)
 * and a `commit` that applies the value. This is the compiler transform's output
 * target, and the contract a {@link DirectRow} (compiled `each` row) supplies. */
export interface BindingSpec {
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
  /** Live getter for the component's current state, threaded from the root mount.
   * Structural primitives that mount a child scope ASYNCHRONOUSLY (outside a
   * reconcile that would hand them the state) — notably `signalLazy`'s error arm —
   * snapshot the current state here to mount correctly. Undefined only outside a
   * component mount (raw `renderNodes`/SSR of a fragment). */
  getState?: () => unknown
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
  /** True when this build is part of a server render (`renderNodes`/`renderToString`).
   * Inherited into every nested build (each rows, show/branch arms). The mount
   * lifecycle is a client-DOM concern, so `onMount` skips REGISTERING its callback
   * under SSR (it still emits the marker comment) — the callback runs only on the
   * client mount/hydrate pass. Without this, an `onMount` body touching a browser
   * global (`window`, `HTMLElement`, …) throws during a DOM-less server render. */
  ssr: boolean
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

// ── Mountable: a lazy structural description ────────────────────────
//
// A scope-owning structural primitive (each/show/branch/unsafeHtml/lazy/virtualEach/
// foreign/portal/provide) does NOT build eagerly. Instead it returns a `Mountable` —
// a recipe that builds its live nodes (and registers its reactive spec / child scope /
// teardowns) only when `mount()` is called, AT PLACEMENT, under whatever build context
// is then active. The runtime calls `mount()` at the two seams where authoring values
// become inserted nodes — `populate` (element children) and `runBuild` (a build's
// returned array) — both of which always run with a live `ctx`.
//
// This makes capture-and-reuse correct by construction: a `Mountable` captured in a
// variable and placed inside a `show`/`branch` arm materializes FRESH on every remount,
// registering its spec into the CURRENT arm scope. There is no drained-fragment reuse
// and no spec stranded in the construction-time scope. Placing one Mountable twice in a
// single build yields two independent live instances.
const MOUNTABLE = Symbol('llui.mountable')

/** A lazy node description: `mount()` builds the live node (and registers its
 * bindings into the active build) at placement time. Everything LLui builds —
 * elements, text, and structural primitives — is a `Mountable`, materialized
 * where it is placed (see `populate`/`runBuild`). */
export interface Mountable {
  readonly [MOUNTABLE]: true
  mount(): Node
}

/** Base for every Mountable. The brand lives on the PROTOTYPE (shared, zero
 * per-instance cost), so `isMountable` stays a cheap brand check that survives
 * the subclasses below — which give a MONOMORPHIC `.mount()` call site. The
 * per-node hot path (`el`/`text`) builds via a dedicated subclass holding its
 * construction args as fields, with no captured closure — replacing the prior
 * `{ [MOUNTABLE]: true, mount: () => … }` literal, which cost two allocations
 * (object + closure) and made every `child.mount()` in `populate` megamorphic. */
abstract class MountableNode implements Mountable {
  declare readonly [MOUNTABLE]: true
  abstract mount(): Node
}
;(MountableNode.prototype as { [MOUNTABLE]: boolean })[MOUNTABLE] = true

/** Generic closure-backed Mountable: used by the structural primitives,
 * adapters (`@llui/vike`'s `pageSlot`), and raw-DOM interop via `mountable()`.
 * These are one-per-placement-site, not per-node, so the extra closure is
 * immaterial — the hot path uses the dedicated subclasses instead. */
class ClosureMountable extends MountableNode {
  constructor(private readonly build: () => Node) {
    super()
  }
  mount(): Node {
    return this.build()
  }
}

/** Wrap a build closure as a `Mountable`. `build` runs (with a live `ctx`) when the
 * Mountable is placed — see `populate`/`runBuild`. Public so adapter packages
 * (`@llui/vike`'s `pageSlot`) and raw-DOM interop can produce placeable view content:
 * `mountable(() => someRawNode)`. Note the build runs once per placement, so a build
 * that returns a captured node (rather than creating a fresh one) reintroduces the
 * single-parent footgun — create the node inside the closure. */
export function mountable(build: () => Node): Mountable {
  return new ClosureMountable(build)
}

export function isMountable(v: unknown): v is Mountable {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[MOUNTABLE] === true
}

/** Materialize a child slot to a real node: a Mountable builds its node now (live
 * `ctx`); a bare node passes through. (String/number coercion is handled separately
 * at the few sites that allow it.) */
function materialize(node: Node | Mountable): Node {
  return isMountable(node) ? node.mount() : node
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
class SignalTextMountable extends MountableNode {
  constructor(
    private readonly produce: Producer,
    private readonly deps: readonly string[],
  ) {
    super()
  }
  mount(): Node {
    const c = requireCtx()
    const node = c.doc.createTextNode('')
    c.specs.push({
      deps: this.deps,
      produce: this.produce,
      commit: (v) => {
        node.data = v == null ? '' : String(v)
      },
    })
    return node
  }
}

/** A static text node. */
class StaticTextMountable extends MountableNode {
  constructor(private readonly value: string) {
    super()
  }
  mount(): Node {
    return requireCtx().doc.createTextNode(this.value)
  }
}

/** A reactive text node bound to a signal accessor. Returns a `Mountable` that
 * builds the text node and registers its binding when placed. */
export function signalText(produce: Producer, deps: readonly string[]): Mountable {
  return new SignalTextMountable(produce, deps)
}

/** A static text node. */
export function staticText(value: string): Mountable {
  return new StaticTextMountable(value)
}

export type EventHandler = (ev: Event) => void
export type PropValue = string | number | boolean | null | Reactive | EventHandler

/** A child slot: a lazy `Mountable` (everything LLui builds — elements, text, and
 * structural primitives — is a Mountable, materialized at placement), or a bare
 * string/number coerced to a static text node at append time (so `div(['hi', 42])`
 * works without an explicit `text(...)` — the same coercion every mainstream framework
 * does). There is no bare `Node` here: a node lives in one place, so exposing one would
 * reintroduce the silent double-placement footgun. Wrap raw DOM via `foreign`. */
export type ChildNode = Mountable | string | number

/** The result of a render callback / view: lazy `Mountable`s, materialized at
 * placement by `populate`/`runBuild`. */
export type Renderable = readonly Mountable[]

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

/** Apply a single non-reactive prop VALUE to `node`: `style.*` → individual style
 * property, form-control IDL props (`value`/`checked`/`selected`/`indeterminate`)
 * → live property assignment, everything else → content attribute (null/false
 * removes, true sets empty). Exported so a compiler-emitted {@link RowFactory}'s
 * reactive-prop `commit` routes through the same DOM-application logic the
 * authoring path uses (rather than re-inlining the IDL/style quirks). */
export function applyAttr(node: Element, name: string, value: unknown): void {
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

/** Apply one prop: reactive `react(...)` / signal handle → binding spec; `on*` fn →
 * listener; else a static attr applied immediately. */
function applyProp(c: BuildCtx, node: Element, name: string, value: PropValue): void {
  if (isReactive(value)) {
    c.specs.push({
      deps: value.deps,
      produce: value.produce,
      commit: (out) => applyAttr(node, name, out),
    })
  } else if (isSignalHandle(value)) {
    // A raw signal handle reached a prop slot: the compiler lowers INLINE
    // `state.map(...)` props to `react(...)`, but a signal stored in a variable
    // (a local const, a spread, a helper return) is opaque to it and passes
    // through verbatim. Bind it reactively here — same as the authoring element
    // helpers do — rather than stringifying the handle into the attribute
    // ("[object Object]", a silently-stuck value).
    c.specs.push({
      deps: value.deps,
      produce: value.produce as (s: unknown) => unknown,
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

/** Append children, THEN apply props — and apply form-control SELECTION props
 * (`value`/`checked`/`selected`/`indeterminate`) AFTER all other props.
 *
 * Two ordering rules, both because a browser resolves form-control selection
 * against the element's current shape and silently drops what doesn't fit yet,
 * with no re-commit afterwards (output-equality holds the stale value):
 *
 *  1. Children first → a child's structural binding (an `each`/`show` spec) is
 *     registered, hence COMMITTED at `scope.mount`, before the element's own prop
 *     bindings. So `<select value=…>` whose `<option>`s come from `each()` sees its
 *     options before its `value` commits — otherwise the assignment hits an empty
 *     <select> and falls back to the first/auto-selected option.
 *  2. Selection props last → `<input type=range value=… min=… max=…>` clamps
 *     `.value` to whatever `min`/`max` are set at assignment time, so `value` must
 *     commit after them REGARDLESS of author key order (an LLM may emit props in
 *     any order; behavior must not depend on it).
 *
 * (Per-`<option selected>` ordering relative to the controlling <select> is handled
 * one level up, by `each` mounting a new row only after inserting it — see there.) */
function populate(
  node: Element,
  props: Readonly<Record<string, PropValue>>,
  children: readonly ChildNode[],
): void {
  const c = requireCtx()
  for (const child of children) {
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(c.doc.createTextNode(String(child)))
    } else {
      // A Mountable (structural primitive) builds its live node here, under the
      // current build — so its spec lands in THIS scope and re-placement rebuilds fresh.
      node.appendChild(materialize(child))
    }
  }
  const entries = Object.entries(props)
  for (const [name, value] of entries)
    if (!DOM_PROPERTIES.has(name)) applyProp(c, node, name, value)
  for (const [name, value] of entries) if (DOM_PROPERTIES.has(name)) applyProp(c, node, name, value)
}

/** An element node. `ns === null` → `createElement`; otherwise `createElementNS`.
 * Holds its construction args as fields (no captured closure) and builds with a
 * monomorphic `mount()` — this is the per-node hot path for list rendering. */
class ElementMountable extends MountableNode {
  constructor(
    private readonly tag: string,
    private readonly props: Readonly<Record<string, PropValue>>,
    private readonly children: readonly ChildNode[],
    private readonly ns: string | null,
  ) {
    super()
  }
  mount(): Node {
    const c = requireCtx()
    const node =
      this.ns === null ? c.doc.createElement(this.tag) : c.doc.createElementNS(this.ns, this.tag)
    populate(node, this.props, this.children)
    return node
  }
}

/** Build an element. `on*` function props become event listeners; `react(...)`
 * props become reactive bindings; everything else is a static attribute. Returns a
 * `Mountable` that creates the element and materializes its children when placed. */
export function el(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
): Mountable {
  return new ElementMountable(tag, props, children, null)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Build an SVG-namespaced element (svg/path/g/circle/…). Same prop/child
 * semantics as `el`, via createElementNS. */
export function elNS(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
): Mountable {
  return new ElementMountable(tag, props, children, SVG_NS)
}

/** Run a build function with a fresh collecting context, returning the produced
 * nodes and the bindings created during it. Nests safely (restores the previous
 * context), so structural primitives can build rows mid-reconcile. */
function runBuild(
  doc: SignalDoc,
  build: () => readonly (Node | Mountable)[],
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
  // Mark this build (and every nested build it inherits into) as a server render.
  // Only the ROOT build sets it (`renderSignalTree`'s `ssr` arg); nested structural
  // builds inherit it from their parent ctx, so it never needs re-passing.
  rootSsr = false,
  // Live component-state getter, seeded by the ROOT build (`mountSignal`) and
  // inherited into every nested build so async-mounting primitives can snapshot it.
  rootGetState?: () => unknown,
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
  // Inherit SSR from the parent build; the root build seeds it from `rootSsr`.
  const ssr = parent?.ssr ?? rootSsr
  // Inherit the state getter from the parent build; the root build seeds it.
  const getState = parent?.getState ?? rootGetState
  ctx = {
    specs,
    doc,
    host,
    teardowns,
    mounts,
    contexts,
    ownContexts: false,
    inRow,
    descriptors,
    ssr,
    getState,
  }
  let nodes: readonly Node[]
  try {
    // Materialize any Mountable returned DIRECTLY (a structural primitive not wrapped
    // in an element, e.g. an arm/row/view returning `[show(...)]`) while `ctx` is still
    // this build — element children are already materialized by `populate` during build().
    nodes = build().map(materialize)
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
export function onMount(cb: (root: Element) => void | (() => void)): Mountable {
  return mountable(() => {
    const c = requireCtx()
    // The mount lifecycle is a client-DOM concern: under SSR (`renderNodes`) there
    // is no live DOM, the returned cleanup would never run, and a callback body
    // touching a browser global (`window`/`HTMLElement`/…) would throw and 500 a
    // DOM-less server render. So DON'T register the callback server-side — still
    // emit the marker comment (the client mount/hydrate rebuild runs the callback).
    if (!c.ssr) c.mounts.push(cb)
    return c.doc.createComment('onMount')
  })
}

/** Register a reactive binding into the ACTIVE build whose `commit` applies the
 * value to a custom target (not an inline element). Public so sibling modules
 * (e.g. head/metadata management) can build bindings with non-element commit
 * targets that still ride the component's one chunked-mask reconciler — `produce`
 * runs on mount and whenever `deps` chunks go dirty; `commit` gets the new value.
 * Must be called during a build (inside a `mountable(...)` recipe). */
export function registerBinding(
  deps: readonly string[],
  produce: (state: unknown) => unknown,
  commit: (value: unknown) => void,
): void {
  requireCtx().specs.push({ deps, produce, commit })
}

/** Register a teardown to run when the owning scope is disposed (unmount). Public
 * companion to {@link registerBinding} for sibling modules. Must be called during
 * a build. */
export function onTeardown(fn: () => void): void {
  requireCtx().teardowns.push(fn)
}

/** The document of the ACTIVE build — a live client `Document` on the client, a
 * server `DomEnv` under SSR. Public so sibling modules can create nodes / read
 * `head`/`documentElement`/`body` in the same environment the runtime builds in.
 * Must be called during a build. */
export function currentDoc(): SignalDoc {
  return requireCtx().doc
}

/** Render `content` into `target` (default `document.body`) instead of inline —
 * for overlays (dialog/popover/toast). The content's bindings join the current
 * scope (so it stays reactive); a teardown removes the nodes on unmount/dispose.
 * Returns an inline placeholder comment. */
export function portal(content: () => Renderable, target?: Element): Mountable {
  return mountable(() => buildPortal(content, target))
}

function buildPortal(content: () => Renderable, target?: Element): Node {
  const c = requireCtx()
  const host = target ?? c.doc.body
  if (!host) {
    // SSR / no document.body: portals are client-only. Render nothing here rather
    // than throw — overlays (dialogs/popovers/toasts) are gated behind
    // `show(state.open)`, and even an open one is reconstructed by the client
    // hydrate pass (atomic-swap rebuild), which collects this content's bindings +
    // onMounts and appends them to the real `document.body`. SSR-rendering an
    // overlay into the page flow would be wrong anyway (it lives at body level).
    return c.doc.createComment('portal-ssr-skip')
  }
  const nodes = content().map(materialize) // specs collected into the current build → reactive
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
export function provide<T>(context: Context<T>, value: T, render: () => Renderable): Mountable {
  return mountable(() => buildProvide(context, value, render))
}

function buildProvide<T>(context: Context<T>, value: T, render: () => Renderable): Node {
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
    for (const n of render()) frag.appendChild(materialize(n))
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
  // Snapshot the doomed nodes BEFORE removing any. Removing a node that holds
  // focus (e.g. an input in a swapped-out branch arm) dispatches `blur`
  // SYNCHRONOUSLY, which can re-enter the update/reconcile cycle and mutate the
  // sibling chain mid-walk — a live `nextSibling` walk then steps onto a node
  // whose parent has already changed and `removeChild` throws NotFoundError.
  // Collecting first makes the iteration immune to that reentrancy; each removal
  // is still guarded by the node's own current parent (a reentrant teardown may
  // have already detached it).
  const doomed: Node[] = []
  for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) doomed.push(n)
  for (const n of doomed) n.parentNode?.removeChild(n)
}

/** Rebase every VALUE spec in a row/arm build to read `ctx.state`, leaving
 * STRUCTURAL specs (show/branch/each) untouched — they make themselves row-aware
 * at build time (`c.inRow`), so rewriting their identity produce would break the
 * arm/row mount. */
function rebaseRowSpecs(specs: readonly BindingSpec[]): BindingSpec[] {
  return specs.map((s) => (s.structural ? s : rebaseRowSpec(s)))
}

/** A reusable scope shape: the `PathTable` + per-binding masks for one binding
 * structure. `each` rows from a {@link RowFactory} share the template, so their
 * specs carry identical `deps` (hence identical, immutable table + masks) — built
 * ONCE from the first row and reused, skipping per-row `buildPathTable`/`bindingMask`. */
interface ScopeShape {
  table: PathTable
  masks: readonly SparseMask[]
}

/** Build a scope from specs. With `pre` (a cached {@link ScopeShape} from an
 * earlier row of the same template), the per-row `buildPathTable` + `bindingMask`
 * work is skipped — only the row's own produce/commit closures bind to the shared
 * masks. Returns the scope plus its shape (to seed the cache). */
function scopeFromSpecs(
  specs: readonly BindingSpec[],
  pre?: ScopeShape,
): { scope: SignalScope; shape: ScopeShape } {
  const table = pre ? pre.table : buildPathTable(specs.flatMap((s) => [...s.deps]))
  const masks = pre ? pre.masks : specs.map((s) => bindingMask(s.deps, table))
  // The specs ARE the bindings (produce/commit) — the scope takes them as-is
  // with the parallel masks array, so no per-binding wrapper object is
  // allocated (`each` builds one scope per ROW; the wrappers were 2 extra
  // objects per jfb row, 20k on a create-10k).
  return { scope: createSignalScope(table, specs, masks), shape: pre ?? { table, masks } }
}

/** Build a chunked-mask reconciler scope over a set of collected bindings. */
function buildScope(specs: readonly BindingSpec[]): SignalScope {
  return scopeFromSpecs(specs).scope
}

/** Do these specs have the SAME dep structure (count + per-binding dep paths, in
 * order) as a cached signature? When true, a previously-built {@link ScopeShape}
 * (PathTable + masks, derived purely from deps) applies unchanged — so an authoring
 * `each` row can reuse it instead of rebuilding. A cheap array compare (no string
 * alloc) that returns false for data-conditional rows, which then build fresh. */
function depsSignatureMatches(
  specs: readonly BindingSpec[],
  cached: ReadonlyArray<readonly string[]>,
): boolean {
  if (specs.length !== cached.length) return false
  for (let i = 0; i < specs.length; i++) {
    const a = specs[i]!.deps
    const b = cached[i]!
    if (a.length !== b.length) return false
    for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return false
  }
  return true
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

/** A compiler-emitted (or hand-written) direct `each` row: real DOM nodes built
 * with direct ops + binding specs wired by DIRECT node reference — bypassing the
 * authoring-helper / `Mountable` / `populate` / `pathHandle` machinery the
 * generic row path runs per row. The factory runs per row under the build ctx;
 * each spec's `produce(ctx)` reads the row ctx (`{ item, state, index }`) and its
 * `commit` writes straight to the located node. See
 * `docs/proposals/v2-compiler/compiled-row-construction.md`. */
export interface DirectRow {
  nodes: Node[]
  bindings: readonly BindingSpec[]
}

/** Builds a fresh {@link DirectRow} (new nodes + binding closures) per row.
 * `getCtx` exposes the row's LIVE `{ item, state, index }` ctx (the same box the
 * binding `produce(ctx)` reads), so a row's event-handler closures can read the
 * current row item at event time — `onClick: () => send({ type: 'toggle', id:
 * getCtx().item.id })` — the direct-path analogue of the render path's
 * `pathHandle(getCtx, 'item')`. Rows with no item-referencing handlers ignore it. */
export type RowFactory = (doc: SignalDoc, getCtx: () => RowCtx<unknown>) => DirectRow

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
  renderRow: (getCtx: () => RowCtx<T>) => Renderable,
  extraDeps?: readonly string[],
): Mountable {
  return mountable(() => buildSignalEach(source, key, renderRow, undefined, extraDeps))
}

/** Direct-construction keyed list: same keyed reconcile as {@link signalEach},
 * but each row is built by a {@link RowFactory} (direct DOM + direct binding
 * wiring) instead of running authoring helpers per row. The compiler-emitted fast
 * path for lowerable rows; also usable hand-written. */
export function signalEachDirect<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  rowFactory: RowFactory,
  extraDeps?: readonly string[],
): Mountable {
  return mountable(() => buildSignalEach(source, key, undefined, rowFactory, extraDeps))
}

// Shared build-pending / direct-row placeholders. A DIRECT row (RowFactory)
// never registers teardowns or onMount callbacks, so every direct row shares
// these empties instead of allocating two arrays per row (20k on a create-10k;
// the old buildDirectRow wrapper added an object + host box on top). They are
// never mutated: nothing pushes into an empty mounts list's teardowns, and
// splicing an empty array is a no-op. Render-path rows get the real arrays
// from runBuild.
const EMPTY_ROW_NODES: readonly Node[] = []
const EMPTY_ROW_TEARDOWNS: Array<() => void> = []
const EMPTY_ROW_MOUNTS: ReadonlyArray<(root: Element) => void | (() => void)> = []

function buildSignalEach<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  // `getCtx` exposes the row's LIVE combined ctx so authoring `each` can build
  // item handles whose `.peek()` reads the current row. The transform emits
  // `() => [...]` which simply ignores the argument. Undefined when `rowFactory`
  // is supplied (the direct-construction path).
  renderRow: ((getCtx: () => RowCtx<T>) => Renderable) | undefined,
  // Direct-construction row builder (compiled fast path); when set, rows are built
  // by this instead of running `renderRow` through the authoring helpers.
  rowFactory?: RowFactory,
  // Additional COMPONENT-STATE dep paths the rows read, appended to the
  // structural binding's deps ONLY (the items-source resolution is unaffected).
  // The compiled pass-1 path merges its collected row state-deps into
  // `source.deps` instead; this parameter serves the handle-sourced tiers, whose
  // items deps say nothing about what the rows read: the authoring `each` and
  // `eachArm` pass `['']` (any state change may matter — rows can read state
  // through parts/arms invisible at runtime), and compiled `eachDirect` passes
  // the precise collected paths. Without it, a row-nested arm reading an
  // unrelated state path was frozen out of state-only changes (stale DOM).
  extraDeps?: readonly string[],
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

  // The Row IS the live-ctx box: factories/render closures capture the row and
  // read `row.ctx` (`getCtx = () => row.ctx`) — the former separate `holder`
  // wrapper was one extra allocation per row plus a duplicate pointer write on
  // every row update. Fields are assigned in two steps (the row must exist
  // before its build runs so closures can capture it): `scope` is null only
  // during that build, `spare` is allocated lazily on the row's FIRST update
  // (a created-and-never-updated row — the whole create-10k — never pays it),
  // and direct rows share frozen empty teardowns/mounts (they never register
  // any; mutation sites are length-guarded).
  interface Row {
    scope: SignalScope | null
    nodes: readonly Node[]
    ctx: RowCtx<T> // current ctx (holds the last-applied item + state)
    spare: RowCtx<T> | null // scratch ctx, swapped in on updates (no per-tick alloc)
    teardowns: Array<() => void> // onMount cleanups + foreign unmount for this row
    // onMount callbacks, run once after the row's nodes are first inserted (phase 3).
    mounts: ReadonlyArray<(root: Element) => void | (() => void)>
    mounted: boolean
  }
  const rows = new Map<string, Row>()
  // Keys in current DOM order — the previous reconcile's desired order. Drives the
  // LIS move-minimization (old position of each surviving key).
  let order: string[] = []
  // Rows in current DOM order, lockstep with `order` — so the same-structure
  // fast path indexes rows directly instead of a Map.get per row per send
  // (200k map lookups on a 1k-send burst against a 200-row table).
  let rowsInOrder: Row[] = []
  // The previous reconcile's items array — for the same-structure fast path: when
  // the new array has the same length and every CHANGED position keeps its key
  // (the streaming in-place update case), only the changed rows need updating and
  // we skip the O(n) keyed scan (String(key)+Set+Map + per-reconcile allocations).
  let prevItems: readonly T[] | null = null
  // State-fanout gating (B): when a row template reads component state ONLY via
  // known value paths, capture them so a reconcile can skip the all-row update
  // sweep when none of those paths changed (the ticker tick that bumps tickCount
  // but not displayMode). `stateGatable` is false when the row has a structural
  // child / a rebased connect-part / a whole-`state` read — then we sweep always.
  let stateGatable = false
  let rowStatePaths: string[] = []
  let prevStateVals: unknown[] | null = null
  // State-fanout gating stays viable only while every state-reading row is cheaply
  // gatable (no structural child, no rebased connect-part, no whole-`state` read).
  // A data-conditional render can make rows heterogeneous — a divergent row flips
  // this off permanently and we fall back to sweeping all rows on any state change.
  let gatingViable = true
  const statePathSet = new Set<string>()
  // Whether ANY built row template reads component state (`state` / `state.*` deps,
  // after rebasing). Accumulated MONOTONICALLY across every row built — a
  // data-conditional render may have the first row read no state and a later row
  // read it, so we can never latch this false from one row. When it stays false
  // (no row reads component state), a row whose `item` + `index` are unchanged
  // needs no re-evaluation even though the component-state ref changed, so we skip
  // its `scope.update` — turning an N-row in-place update into work proportional to
  // the rows that actually changed. `templateSeen` guards one-time setup below;
  // the correctness-affecting flags accumulate per row and are NOT latched.
  let templateReadsState = false
  let templateSeen = false

  // When this each is nested in an enclosing row, the scope hands `reconcile`
  // the COMBINED row ctx (`{ item, state, index }`). Rows must always mount with
  // the COMPONENT state, but the items source reads whatever its deps name: a
  // row-local source (`item.map(…)` / `item.at(…)`, deps all row-local) reads
  // the combined ctx so `item`/`index` resolve; a component-state source
  // (`state.map(…)`) reads `ctx.state`. For a top-level each the input IS the
  // component state and both coincide.
  const itemsRowLocal = source.deps.length > 0 && source.deps.every(isRowLocalDep)
  // Direct-construction rows from a `rowFactory` share one template, so every
  // row's specs carry identical deps → identical PathTable + masks. Build that
  // shape once (from the first row) and reuse it for all rows, skipping per-row
  // buildPathTable + bindingMask.
  let directShape: ScopeShape | null = null
  // Authoring rows (the render-callback path) ALSO usually share a template, so
  // their specs carry identical deps too — but a render MAY be data-conditional
  // (e.g. a block body that branches on `item.peek()`), producing different specs
  // per row. So we memoize the shape AND its dep signature, reuse it only when a
  // row's specs match (cheap array compare, no PathTable/mask rebuild), and fall
  // back to a fresh shape otherwise. Mirrors `directShape` for the verbatim path.
  let authorShape: ScopeShape | null = null
  let authorDeps: ReadonlyArray<readonly string[]> | null = null
  const reconcile = (input: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const rowState = inRow ? (input as { state: unknown }).state : input
    const itemsState = inRow && !itemsRowLocal ? (input as { state: unknown }).state : input
    const items = source.items(itemsState)
    const n = items.length

    // State-fanout gating (B): does this reconcile have to re-evaluate EVERY row
    // (a component-state path the rows read changed → fan out), or only the rows
    // whose item changed? When the row's state reads are gatable, compare the
    // captured paths against the previous reconcile; otherwise sweep (conservative
    // / pre-probe). `sweepAll` replaces the coarse always-on `templateReadsState`
    // at the per-row update sites below.
    let sweepAll = templateReadsState
    if (stateGatable) {
      if (prevStateVals !== null) {
        sweepAll = false
        for (let j = 0; j < rowStatePaths.length; j++) {
          if (!Object.is(resolvePath(rowState, rowStatePaths[j]!), prevStateVals[j])) {
            sweepAll = true
            break
          }
        }
      }
      prevStateVals = rowStatePaths.map((p) => resolvePath(rowState, p))
    }

    // ── Same-structure fast path ──────────────────────────────────────────
    // The streaming in-place update case (e.g. a ticker tick replacing a few
    // rows' values): same length, and every position whose item REF changed
    // keeps its key — so no create/remove/move. Update only the changed rows
    // (or all rows when the template reads component state, which any state
    // change may fan out to) and skip the O(n) keyed scan entirely — no
    // `String(key)` per row, no `Set`/`Array(n)` allocations, no LIS. Falls
    // through to the full keyed reconcile the moment a key moves or n changes.
    const prev = prevItems
    prevItems = items // set once here — covers every return path below
    if (prev !== null && n === prev.length && rows.size === n) {
      let structural = false
      for (let i = 0; i < n; i++) {
        if (items[i] !== prev[i] && String(key(items[i]!)) !== order[i]) {
          structural = true // a key moved / row replaced → need the full reconcile
          break
        }
      }
      if (!structural) {
        for (let i = 0; i < n; i++) {
          const item = items[i]!
          const row = rowsInOrder[i]!
          if (sweepAll || item !== row.ctx.item || i !== row.ctx.index) {
            // lazy spare: allocated on the row's first update, reused after
            const next = row.spare ?? { item, state: rowState, index: i }
            next.item = item
            next.state = rowState
            next.index = i
            row.scope!.update(row.ctx, next)
            row.spare = row.ctx
            row.ctx = next
          }
        }
        return
      }
    }

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
        // Create the row FIRST so the factory/render closures can capture it as
        // the live-ctx box (`getCtx = () => created.ctx`); build-pending fields
        // are assigned right below. Direct rows keep the shared empty
        // teardowns/mounts (they never register any — and splicing an empty
        // array is harmless, so sharing is safe).
        const created: Row = {
          scope: null,
          nodes: EMPTY_ROW_NODES,
          ctx: { item, state: rowState, index },
          spare: null,
          teardowns: EMPTY_ROW_TEARDOWNS,
          mounts: EMPTY_ROW_MOUNTS,
          mounted: false,
        }
        // forceInRow: the row build (and every nested arm/row build) operates on
        // the combined ctx, so structural primitives inside it become row-aware.
        let builtSpecs: readonly BindingSpec[]
        let renderHost: { scope: SignalScope | null } | null = null
        if (rowFactory) {
          const dr = rowFactory(doc, () => created.ctx)
          created.nodes = dr.nodes
          builtSpecs = dr.bindings
        } else {
          const b = runBuild(doc, () => renderRow!(() => created.ctx), c, undefined, true)
          created.nodes = b.nodes
          builtSpecs = b.specs
          created.teardowns = b.teardowns
          created.mounts = b.mounts
          renderHost = b.host
        }
        // A keyed row must be one or more STABLE nodes. A structural primitive
        // (show/branch/each) returns a DocumentFragment that empties on insertion —
        // as a bare row root it leaves the row with no stable handle to move or
        // remove, so reorder/removal corrupts the DOM (NotFoundError). Require it to
        // be wrapped in an element, which becomes the row's stable boundary. Checked
        // once (the template shape governs the root node type).
        if (
          !templateSeen &&
          created.nodes.some((nd) => nd.nodeType === 11 /* DocumentFragment */)
        ) {
          throw new Error(
            'each: a row cannot have a `show`/`branch`/`each` as its top-level node — ' +
              'wrap the conditional body in an element (e.g. `li([show(...)])`) so the ' +
              'row has a stable node to key, move, and remove. ' +
              `(each items deps: ${JSON.stringify(source.deps)})`,
          )
        }
        templateSeen = true

        // Per-row probe — accumulated across EVERY row built, never latched from
        // one row, because a data-conditional render can make rows heterogeneous
        // (the first row row-local, a later row reading component state).
        //
        // `rowNeedsRebase`: does THIS row have a VALUE spec with a non-row-local dep
        // (a bare component-state read that must be re-rooted to `ctx.state`)? Used
        // locally below to decide whether to rebase this row's specs. Structural
        // specs make themselves row-aware, so they're excluded.
        const rowNeedsRebase = builtSpecs.some(
          (s) => !s.structural && s.deps.some((d) => !isRowLocalDep(d)),
        )
        const rowStructural = builtSpecs.some((s) => s.structural)
        // A row reads component state if any binding has a `state.*`/`state` dep,
        // needs rebasing, OR has a STRUCTURAL child (show/branch/each) whose arms are
        // built lazily and may read state from inside (e.g. a folder/file show whose
        // file arm nests a `state.editingId` rename show) — we can't see those arm
        // specs here, so a structural child forces per-state-change row re-eval.
        const rowReadsState =
          rowNeedsRebase ||
          rowStructural ||
          builtSpecs.some((s) => s.deps.some((d) => d === 'state' || d.startsWith('state.')))
        // Monotonic: once ANY row reads component state, every state change must
        // re-evaluate the affected rows (see `sweepAll`).
        if (rowReadsState) templateReadsState = true
        // State-fanout gating (B): capture the component-state value paths rows read
        // so a reconcile can skip the all-row sweep when none changed (the ticker
        // tick that bumps tickCount but not displayMode). Gating stays viable only
        // while every state-reading row is cheaply gatable — a structural child
        // (unseen arm reads), a rebased connect-part, or a whole-`state` read can't
        // be gated, and flips it off for the whole `each`.
        if (rowReadsState && gatingViable) {
          const rowGatable =
            !rowStructural &&
            !rowNeedsRebase &&
            !builtSpecs.some((s) => s.deps.some((d) => d === 'state'))
          if (!rowGatable) {
            gatingViable = false
            stateGatable = false
          } else {
            const before = statePathSet.size
            for (const s of builtSpecs) {
              for (const d of s.deps) if (d.startsWith('state.')) statePathSet.add(d.slice(6))
            }
            stateGatable = true
            // A newly-seen path invalidates the captured baseline (sized for the old
            // path set); force one conservative sweep + recapture next reconcile.
            if (statePathSet.size !== before) {
              rowStatePaths = [...statePathSet]
              prevStateVals = null
            }
          }
        }
        // Re-root component-state-rooted VALUE bindings (e.g. connect() parts placed
        // in the row by an uncompiled each) to read ctx.state — only when this row
        // needs it. Local so the direct row hands `dr.bindings` through as-is.
        const rowSpecs: readonly BindingSpec[] = rowNeedsRebase
          ? rebaseRowSpecs(builtSpecs)
          : builtSpecs
        if (rowFactory) {
          // Direct path: reuse the shared per-each-site shape (built once).
          // Direct rows own no nested scope, so there is no host to wire.
          const r = scopeFromSpecs(rowSpecs, directShape ?? undefined)
          directShape ??= r.shape
          created.scope = r.scope
        } else if (authorShape && depsSignatureMatches(rowSpecs, authorDeps!)) {
          // Authoring row whose spec structure matches the cached template: reuse
          // the shared shape, skipping per-row buildPathTable + bindingMask.
          const r = scopeFromSpecs(rowSpecs, authorShape)
          renderHost!.scope = r.scope
          created.scope = r.scope
        } else {
          // First authoring row, or a data-conditional row that diverged: build a
          // fresh shape and (re)seed the cache for subsequent matching rows.
          const r = scopeFromSpecs(rowSpecs)
          authorShape = r.shape
          authorDeps = rowSpecs.map((s) => s.deps)
          renderHost!.scope = r.scope
          created.scope = r.scope
        }
        // NOTE: the row scope is NOT mounted here. Its bindings commit in phase 3,
        // AFTER the row's nodes are inserted into the parent (see the `mounted`
        // gate below) — so a binding that depends on the node being connected to
        // its controlling parent resolves correctly. The canonical case is
        // `<option selected>`: a single `<select>` coordinates selection across its
        // options, so `option.selected = true` only takes effect once the option is
        // a child of the select; committing it on the still-detached row would be
        // silently dropped, with no re-commit (output-equality). This mirrors the
        // top-level mount contract ("insert FIRST, then mount") that `each` is the
        // last structural primitive to honor.
        row = created
        rows.set(k, row)
      } else if (sweepAll || item !== row.ctx.item || index !== row.ctx.index) {
        // existing row that may have changed: re-run only the bindings whose part
        // of the ctx changed. Reuse the spare ctx buffer (no allocation); swap it
        // in as the new current. old (row.ctx) and new (next) stay distinct refs,
        // so the diff sees item/state changes correctly.
        // lazy spare: allocated on the row's first update, reused after. The
        // row itself is the live-ctx box, so swapping row.ctx keeps runtime
        // item handles' .peek() current — no separate holder write.
        const next = row.spare ?? { item, state: rowState, index }
        next.item = item
        next.state = rowState
        next.index = index
        row.scope!.update(row.ctx, next)
        row.spare = row.ctx
        row.ctx = next
        // No else: item + index unchanged and no binding reads component state, so
        // the row's output can't have changed — skip the diff + binding re-eval.
      }
      newRows[index] = row
    }

    // Fast path: identical key sequence → no creates, removes, or moves. The DOM
    // is already in the right order; rows were updated in place above.
    if (sameOrder) {
      order = newKeys
      rowsInOrder = newRows
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
      rowsInOrder = newRows // empty
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
          // Commit the row's bindings now that its nodes are connected to the
          // parent (e.g. options to their <select>); then run onMount. Both fire
          // exactly once, on first insertion.
          row.scope!.mount(row.ctx)
          runMounts(row.mounts, parent as Element, row.teardowns)
        }
      } else if (!keep.has(i)) {
        for (const node of row.nodes) parent.insertBefore(node, anchor)
      }
      // anchor for the next (leftward) row is this row's first node
      anchor = row.nodes[0] ?? anchor
    }

    order = newKeys
    rowsInOrder = newRows
  }

  // structural binding: fires when the list deps change; produce returns the
  // component state so reconcile can build each row's combined ctx. Nested in an
  // enclosing row, it reads `ctx.state` and its deps rebase onto that combined ctx.
  const specDeps = extraDeps && extraDeps.length > 0 ? [...source.deps, ...extraDeps] : source.deps
  c.specs.push({
    deps: inRow ? specDeps.map(rebaseRowDep) : specDeps,
    // Pass the scope state straight through: the combined row ctx when nested in
    // a row, the component state at top level. `reconcile` derives the items
    // source's state (row-local vs component) and the rows' mount state from it.
    produce: (s) => s,
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
  render: () => Renderable,
  orElse?: () => Renderable,
): Mountable {
  return mountable(() => buildSignalShow(cond, render, orElse))
}

function buildSignalShow(
  cond: ShowCond,
  render: () => Renderable,
  orElse?: () => Renderable,
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

/** Parse an HTML string to a fragment, cross-env: a server `DomEnv` (and
 * `browserEnv`) exposes `parseHtmlFragment`; a raw client `Document` does not, so
 * fall back to the standard `<template>.innerHTML` parse there. */
function parseFragment(doc: SignalDoc, html: string): DocumentFragment {
  if (typeof doc.parseHtmlFragment === 'function') return doc.parseHtmlFragment(html)
  const template = doc.createElement('template') as HTMLTemplateElement
  template.innerHTML = html
  return template.content
}

/**
 * Render a raw HTML string as live DOM nodes, inline between anchor comments (no
 * wrapper element). Reactive: when the bound string changes, the previously
 * inserted fragment is removed and the new HTML parsed in. The parsed nodes carry
 * NO reactive bindings — `unsafeHtml` is an escape hatch for pre-rendered markup
 * (markdown, syntax highlighting). The caller is responsible for trust/sanitization.
 */
export function signalUnsafeHtml(produce: Producer, deps: readonly string[]): Mountable {
  return mountable(() => buildSignalUnsafeHtml(produce, deps))
}

function buildSignalUnsafeHtml(produce: Producer, deps: readonly string[]): Node {
  const c = requireCtx()
  const doc = c.doc
  const start = doc.createComment('unsafe-html')
  const end = doc.createComment('/unsafe-html')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  c.specs.push({
    deps,
    produce,
    commit: (value) => {
      const parent = end.parentNode
      if (!parent) return
      removeBetween(start, end)
      const html = value == null ? '' : String(value)
      if (html === '') return
      const parsed = parseFragment(doc, html)
      // Snapshot childNodes before insertion (insertBefore drains the fragment).
      for (const n of Array.from(parsed.childNodes)) parent.insertBefore(n, end)
    },
  })

  // On host dispose, clear the inserted region (mirrors signalShow) so an enclosing
  // arm's teardown doesn't orphan these nodes between now-removed anchors.
  c.teardowns.push(() => removeBetween(start, end))

  return frag
}

/** Spec for {@link signalSubApp} — an isolated child component boundary. */
export interface SubAppSpec<S, M, E = never> {
  /** Why a separate update loop / mask scope is warranted (third-party UI, a
   * long-lived loop with no reactive props, a 60fps layer). Documents intent at
   * the call site; not consulted at runtime. */
  reason: string
  /** The component to mount in isolation. */
  def: SignalComponentDef<S, M, E>
  /** Seed state, overriding `def.init()`'s state (init still runs for effects).
   * The bridge for "props in": the host pushes fresh data via the handle's `send`. */
  initialState?: S
  /** Context values to replay into the isolated build (provide/useContext). */
  contexts?: ReadonlyMap<symbol, unknown>
  /** Receive the mounted handle (send/subscribe/dispose) — the channel for pushing
   * props in and bubbling messages out, since the sub-app shares no state with the host. */
  onHandle?: (handle: SignalComponentHandle<S, M>) => void
}

/**
 * Mount an ISOLATED component instance inside the current view at an anchor: its
 * own update loop, mask scope, and DOM region. The parent's reconciler never
 * touches it (it is NOT registered as a child scope), so parent state changes
 * don't invalidate it and vice-versa. The sub-app is mounted after the anchor
 * attaches and disposed when the host unmounts. Drive it via `onHandle`'s handle.
 *
 * This is the escape hatch for genuine isolation — everyday decomposition uses
 * plain view-helper functions over `Signal<T>` slices, which chunked masks make
 * cheap (no `child()`/boundary needed). Reach for `subApp` only when a subtree
 * truly needs its own lifecycle.
 */
export function signalSubApp<S, M, E = never>(spec: SubAppSpec<S, M, E>): Mountable {
  return mountable(() => buildSignalSubApp(spec))
}

function buildSignalSubApp<S, M, E = never>(spec: SubAppSpec<S, M, E>): Node {
  const c = requireCtx()
  const anchor = c.doc.createComment('subApp')
  // Like `onMount`, the isolated child is mounted via the mount lifecycle, which
  // is a client-DOM concern: skip it under SSR (the child would mount with its own
  // fresh — non-SSR — build and crash on any browser-global in its `onMount`). The
  // anchor still serializes; the client mount/hydrate pass brings the child up.
  if (c.ssr) return anchor
  c.mounts.push(() => {
    // Anchor is attached now; mount the isolated instance as siblings after it.
    const handle = mountSignalComponent<S, M, E>(
      { anchor: anchor as Comment, mode: 'append' },
      spec.def,
      { initialState: spec.initialState, contexts: spec.contexts },
    )
    spec.onHandle?.(handle)
    return () => handle.dispose()
  })
  return anchor
}

/**
 * Discriminated-union render. Mounts the arm matching the discriminant's current
 * value; swaps arms when it changes (the old arm unmounts, the new one mounts as
 * a child scope). Same-value updates do NOT remount — the mounted arm's child
 * scope handles its own inner reactivity. An absent arm renders nothing.
 */
export function signalBranch(
  disc: ShowCond,
  arms: Readonly<Record<string, () => Renderable>>,
): Mountable {
  return mountable(() => buildSignalBranch(disc, arms))
}

function buildSignalBranch(disc: ShowCond, arms: Readonly<Record<string, () => Renderable>>): Node {
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
): Mountable {
  return mountable(() => buildSignalForeign(spec))
}

function buildSignalForeign<Inst, State extends Record<string, SignalSpec<unknown>>>(
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
  build: () => Renderable,
  modeOrSeed?: 'append' | 'replace' | ReadonlyMap<symbol, unknown>,
  seedContexts?: ReadonlyMap<symbol, unknown>,
  // Live component-state getter (see `BuildCtx.getState`). Passed by
  // `mountSignalComponent` so async-mounting primitives (signalLazy's error arm)
  // can snapshot current state; absent for raw `mountSignal` fragment mounts.
  getState?: () => unknown,
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
    const built = renderSignalTree(doc, build, seed, false, getState)
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
  const built = renderSignalTree(container.ownerDocument, build, seed, false, getState)
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
  build: () => Renderable,
  // Adapter seed (see `runBuild`): context values to expose at the root of this
  // build when no surrounding build provides them (`@llui/vike` slot replay).
  seedContexts?: ReadonlyMap<symbol, unknown>,
  // Server render: marks the build (and every nested arm/row) as SSR so the mount
  // lifecycle is skipped (see `BuildCtx.ssr` / `onMount`). The client mount and
  // hydrate paths leave this false — they own the real DOM and run onMount.
  ssr = false,
  // Live component-state getter (see `BuildCtx.getState`), threaded to the root build.
  getState?: () => unknown,
): {
  nodes: readonly Node[]
  scope: SignalScope
  mount: (state: unknown) => void
  teardowns: Array<() => void>
  mounts: Array<(root: Element) => void | (() => void)>
  getDescriptors: () => Array<{ variant: string }>
} {
  const built = runBuild(doc, build, undefined, seedContexts, false, ssr, getState)
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
  fallback: () => Renderable
  /** nodes rendered if the loader rejects (nothing if omitted) */
  error?: (err: Error) => Renderable
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
): Mountable {
  return mountable(() => buildSignalLazy(opts))
}

function buildSignalLazy<LS = unknown, LM = unknown, LE = unknown>(
  opts: SignalLazyOptions<LS, LM, LE>,
): Node {
  const c = requireCtx()
  const doc = c.doc
  const anchor = doc.createComment('lazy')

  // Build the fallback in the CURRENT build so its bindings join the surrounding
  // scope and stay reactive. Bracket it with an end sentinel so the region can be
  // removed wholesale on swap.
  const fallbackEnd = doc.createComment('/lazy-fallback')
  const fallbackNodes = opts.fallback().map(materialize)

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
      // Mount against the host's CURRENT state (snapshotted via the threaded
      // getter), and register the arm as a child of the host scope so component
      // state changes propagate to it — the error arm may read component state
      // (e.g. a localized message or a retry button reading `state`), not just the
      // captured `err`. Falls back to null outside a component mount.
      errorScope.mount(c.getState ? c.getState() : null)
      c.host.scope?.addChild(errorScope)
      runMounts(built.mounts, parent as Element, built.teardowns)
    })

  // On host dispose: cancel any in-flight load, dispose a mounted child, tear
  // down an error arm.
  c.teardowns.push(() => {
    cancelled = true
    mounted?.dispose()
    mounted = null
    if (errorScope) {
      c.host.scope?.removeChild(errorScope)
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
  /** build a row; `getCtx` exposes the row's live `{ item, state, index }` ctx
   * (same shape as `signalEach`) for runtime item/index handles. */
  renderRow: (getCtx: () => RowCtx<T>) => Renderable
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
export function signalVirtualEach<T>(spec: VirtualEachSpec<T>): Mountable {
  return mountable(() => buildSignalVirtualEach(spec))
}

function buildSignalVirtualEach<T>(spec: VirtualEachSpec<T>): Node {
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

  // Same slimming as signalEach's Row: the row object IS the live-ctx box
  // (no separate `holder` allocation/write), and `spare` is allocated lazily
  // on the row's first update.
  interface Row {
    scope: SignalScope | null // null only between creation and the build below
    nodes: readonly Node[]
    wrapper: HTMLElement
    ctx: RowCtx<T>
    spare: RowCtx<T> | null
    index: number
    teardowns: Array<() => void>
  }
  const rows = new Map<string, Row>()

  let lastState: unknown = null
  let scrollTop = 0

  // Height metrics. Fixed height → O(1) formulas. Per-item height → a prefix-sum
  // array (`prefix[i]` = cumulative top of row i, `prefix[n]` = total height),
  // rebuilt only when the `items` array reference changes (so a pure scroll reuses
  // it). All windowing/positioning goes through the helpers so both modes share
  // the reconcile loop.
  const fixedHeight = typeof spec.itemHeight === 'number' ? spec.itemHeight : null
  const heightFn = typeof spec.itemHeight === 'function' ? spec.itemHeight : null
  let metricsItems: readonly T[] | null = null
  let prefix: number[] = [0]

  const ensureMetrics = (items: readonly T[]): void => {
    if (fixedHeight !== null || items === metricsItems) return
    metricsItems = items
    const p = new Array<number>(items.length + 1)
    p[0] = 0
    for (let i = 0; i < items.length; i++) p[i + 1] = p[i]! + heightFn!(items[i]!, i)
    prefix = p
  }

  const totalHeight = (n: number): number => (fixedHeight !== null ? n * fixedHeight : prefix[n]!)
  const offsetOf = (i: number): number => (fixedHeight !== null ? i * fixedHeight : prefix[i]!)
  const heightOf = (i: number): number =>
    fixedHeight !== null ? fixedHeight : prefix[i + 1]! - prefix[i]!
  // Largest index in [0, n] whose top offset is ≤ px (the row containing px).
  const rowAtOffset = (px: number, n: number): number => {
    if (fixedHeight !== null) return Math.floor(px / fixedHeight)
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (prefix[mid]! <= px) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  // Smallest index in [0, n] whose top offset is ≥ px (first row starting at/after).
  const rowStartingAtOrAfter = (px: number, n: number): number => {
    if (fixedHeight !== null) return Math.ceil(px / fixedHeight)
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (prefix[mid]! >= px) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  const computeRange = (length: number): [number, number] => {
    if (length === 0) return [0, 0]
    const start = Math.max(0, rowAtOffset(scrollTop, length) - overscan)
    const end = Math.min(
      length,
      rowStartingAtOrAfter(scrollTop + spec.containerHeight, length) + overscan,
    )
    return [start, end]
  }

  const positionWrapper = (wrapper: HTMLElement, index: number): void => {
    wrapper.style.setProperty('position', 'absolute')
    wrapper.style.setProperty('top', '0')
    wrapper.style.setProperty('left', '0')
    wrapper.style.setProperty('right', '0')
    wrapper.style.setProperty('height', `${heightOf(index)}px`)
    wrapper.style.setProperty('transform', `translateY(${offsetOf(index)}px)`)
  }

  const disposeRow = (row: Row): void => {
    for (const t of row.teardowns.splice(0)) t()
    if (row.wrapper.parentNode === spacer) spacer.removeChild(row.wrapper)
  }

  const reconcile = (state: unknown): void => {
    lastState = state
    const items = spec.items(state)
    ensureMetrics(items)
    spacer.style.setProperty('height', `${totalHeight(items.length)}px`)

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
        // The row record is created first so the render closure can capture it
        // as the live-ctx box (same pattern as signalEach).
        const created: Row = {
          scope: null,
          nodes: EMPTY_ROW_NODES,
          wrapper,
          ctx: rowCtx,
          spare: null,
          index,
          teardowns: EMPTY_ROW_TEARDOWNS,
        }
        // forceInRow + rebase the row's value specs to read ctx.state (same as
        // signalEach), so component-state reads in a virtual row resolve correctly.
        const built = runBuild(doc, () => spec.renderRow(() => created.ctx), c, undefined, true)
        built.specs = rebaseRowSpecs(built.specs)
        const scope = buildAndPublishScope(built)
        scope.mount(rowCtx)
        for (const n of built.nodes) wrapper.appendChild(n)
        spacer.appendChild(wrapper)
        runMounts(built.mounts, wrapper, built.teardowns)
        created.scope = scope
        created.nodes = built.nodes
        created.teardowns = built.teardowns
        rows.set(k, created)
        continue
      }
      // existing row: re-run only the bindings whose part of the ctx changed.
      // lazy spare (first update allocates; reused after); the row is the
      // live-ctx box, so swapping row.ctx keeps handles' .peek() current.
      const next = row.spare ?? { item, state, index }
      next.item = item
      next.state = state
      next.index = index
      row.scope!.update(row.ctx, next)
      row.spare = row.ctx
      row.ctx = next
      // Reposition on index change; in variable-height mode also reposition every
      // pass, since an earlier item's height change shifts this row's offset even
      // when its own index is unchanged.
      if (row.index !== index || fixedHeight === null) {
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
