// Build context — the collecting core the signal DOM layer builds against.
//
// A `view` (or a structural primitive's row/arm) is built by running its recipe
// under a live `BuildCtx`: element/text helpers build real DOM nodes and register
// their reactive bindings (a `produce` accessor + absolute dependency paths) into
// the active ctx's `specs`. `runBuild` runs one build with a fresh ctx (nesting
// safely), so structural primitives can build rows/arms mid-reconcile. The module
// owns the single `ctx` slot; every other signal-DOM module reaches it only through
// `requireCtx()` / `getBuildCtx()` / `runBuild()` — never the raw variable.
//
// The Mountable machinery lives here too: everything LLui builds (elements, text,
// and the structural primitives) is a lazy `Mountable` materialized where it is
// PLACED (see `element.ts`'s `populate` and `runBuild` below), which is what makes
// capture-and-reuse correct by construction.

import type { SignalBinding, SignalScope } from './runtime.js'
import { LluiFrameworkError } from './framework-error.js'

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

export type Producer = (state: unknown) => unknown

/** A reactive binding: the dependency paths it reads + an accessor (`produce`)
 * and a `commit` that applies the value. This is the compiler transform's output
 * target, and the contract a {@link DirectRow} (compiled `each` row) supplies.
 *
 * A spec IS a {@link SignalBinding} plus its build-time metadata — the scope
 * stores specs as-is (see `scopeFromSpecs`), so its intersection ADDS metadata to
 * the runtime contract rather than restating it; `produce`/`commit`/`structural`
 * have exactly one declaration, in `runtime.ts`. */
export type BindingSpec = SignalBinding & {
  deps: readonly string[]
  // Root discriminant for row rebasing — set from the ORIGIN handle, so row
  // locality never depends on string-inferring `item`/`index`/`state` prefixes
  // (which collide with a component-state field literally named that). `true` ⇒
  // the produce reads the COMPONENT state (rebase to `ctx.state` inside a row);
  // `false` ⇒ it already reads the row ctx (an item/index handle, or an
  // already-rebased spec — leave it). `undefined` ⇒ a compiler-emitted spec with
  // no handle origin: fall back to the legacy `isRowLocalDep` string inference
  // (compiled rows use the `item.*`/`state.*` ctx convention, so this is sound).
  componentRooted?: boolean
}

export interface BuildCtx {
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
   * (no clone); `provide` builds a NEW map for the duration of its `render()` and
   * restores the previous map REFERENCE afterwards (immutable-by-swap) — it never
   * mutates a published map. A build that never calls `provide` (every plain `each`
   * row) shares the parent's map by reference and pays no clone. Structural
   * primitives SNAPSHOT this reference at their placement/build time and thread it
   * into their later row/arm builds (via `runBuild`'s `seedContexts`), so a value
   * provided ABOVE a lazily-built arm/row stays visible even though `provide`'s
   * synchronous `render()` has long returned and restored the parent map. */
  contexts: ReadonlyMap<symbol, unknown>
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
  /** Ordinal source for ANONYMOUS head entries (a `style`/`script`/`meta`/… with no
   * static identity), NAMESPACED per owning instance — see {@link HeadAnonScope}.
   * SHARED by reference across every nested build of ONE instance (root + arms +
   * rows), so the Nth anonymous head entry gets the same ordinal on the server
   * render AND the client hydrate of the same view — which is what lets hydration
   * ADOPT the server tag by its `data-llui-head` key instead of accumulating a
   * duplicate. A module-global counter drifted across renders in one process and
   * broke that match. */
  headAnon: HeadAnonScope
  /** True when this build is part of a server render (`renderNodes`/`renderToString`).
   * Inherited into every nested build (each rows, show/branch arms). The mount
   * lifecycle is a client-DOM concern, so `onMount` skips REGISTERING its callback
   * under SSR (it still emits the marker comment) — the callback runs only on the
   * client mount/hydrate pass. Without this, an `onMount` body touching a browser
   * global (`window`, `HTMLElement`, …) throws during a DOM-less server render. */
  ssr: boolean
}

let ctx: BuildCtx | null = null

/** The build in progress, or null when no build is active. Prefer {@link requireCtx}
 * at sites that must be inside a build; this is for the accessors that tolerate
 * being called outside one (useContext / __inRowBuild / __nextHeadAnon / …). */
export function getBuildCtx(): BuildCtx | null {
  return ctx
}

// Shared read-only sentinel for builds with no inherited/seeded contexts — avoids
// allocating an empty Map per build (provide() copy-on-writes before any mutation).
const EMPTY_CONTEXTS: ReadonlyMap<symbol, unknown> = Object.freeze(new Map())

const REACT = Symbol('llui.react')

/** A reactive prop/child value: a `produce` accessor plus its dependency paths.
 * (The compiler emits these from signal expressions in reactive slots.) */
export interface Reactive {
  readonly [REACT]: true
  readonly produce: Producer
  readonly deps: readonly string[]
  /** See {@link BindingSpec.componentRooted}: `true` when this reactive reads the
   * component state (set from the origin handle by the authoring layer). */
  readonly componentRooted?: boolean
}
export function react(
  produce: Producer,
  deps: readonly string[],
  componentRooted?: boolean,
): Reactive {
  return { [REACT]: true, produce, deps, componentRooted }
}
export function isReactive(v: unknown): v is Reactive {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[REACT] === true
}

export function requireCtx(): BuildCtx {
  if (!ctx)
    throw new LluiFrameworkError('signal DOM helper called outside a signal build (mountSignal)')
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
export abstract class MountableNode implements Mountable {
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
export function materialize(node: Node | Mountable): Node {
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

/** Run a build function with a fresh collecting context, returning the produced
 * nodes and the bindings created during it. Nests safely (restores the previous
 * context), so structural primitives can build rows mid-reconcile. */
export function runBuild(
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
  // Anonymous-head-key namespace for this build's OWNING INSTANCE (see
  // `HeadAnonScope`). Only a ROOT build seeds it — an isolated instance (`island`,
  // or an adapter mounting a nested layer in its own pass) passes the scope it was
  // allocated at placement; nested arm/row builds inherit their parent's. With none,
  // a root build gets the unprefixed namespace.
  rootHeadAnon?: HeadAnonScope,
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
  // Context values for this build. An EXPLICIT `seedContexts` wins over the parent's
  // live map: structural primitives snapshot `c.contexts` at their PLACEMENT (when a
  // `provide` above them still has its value in the map) and pass it here, so the
  // value survives even though `provide`'s synchronous `render()` already restored
  // the parent map by the time the row/arm builds. With no explicit snapshot, SHARE
  // the parent's map by reference (no clone). Adapter seeds (`@llui/vike`) also flow
  // through `seedContexts` when there's no parent build to inherit from.
  const contexts: ReadonlyMap<symbol, unknown> = seedContexts ?? parent?.contexts ?? EMPTY_CONTEXTS
  // SHARE the descriptor registry by reference (root one if present) so row/arm
  // registrations and decrements land in the component's single registry.
  const descriptors = parent?.descriptors ?? new Map<string, number>()
  const inRow = forceInRow || parent?.inRow || false
  // Inherit SSR from the parent build; the root build seeds it from `rootSsr`.
  const ssr = parent?.ssr ?? rootSsr
  // Share the OWNING INSTANCE's anon-head ordinal by reference (a root build seeds a
  // fresh scope, namespaced when the caller was handed one at placement), so head
  // anon keys are stable across a server render and its client hydrate.
  const headAnon = parent?.headAnon ?? rootHeadAnon ?? headAnonScope()
  // Inherit the state getter from the parent build; the root build seeds it.
  const getState = parent?.getState ?? rootGetState
  ctx = {
    specs,
    doc,
    host,
    teardowns,
    mounts,
    contexts,
    inRow,
    descriptors,
    headAnon,
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
export function registerVariants(c: BuildCtx, variants: readonly string[]): void {
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

/** Run the onMount callbacks collected during a build, passing that BUILD's
 * root container — not each callback's own parent element; push their returned
 * cleanups onto `teardowns`. */
export function runMounts(
  mounts: ReadonlyArray<(root: Element) => void | (() => void)>,
  root: Element,
  teardowns: Array<() => void>,
): void {
  for (const cb of mounts) {
    const cleanup = cb(root)
    if (typeof cleanup === 'function') teardowns.push(cleanup)
  }
}

/**
 * Register a callback to run after the surrounding view's nodes are mounted.
 *
 * IT RECEIVES THE BUILD'S ROOT CONTAINER, NOT THE ELEMENT THE CALL SITS INSIDE.
 * Mounts are collected per BUILD — a component's view, an arm, an `each` row —
 * and `runMounts` passes that build's container to every callback in it. So an
 * `onMount` written inside `svg({...}, [ … ])` is handed the component's mount
 * container, and a callback that assumed its immediate parent silently does
 * nothing (an `instanceof` guard fails, a `querySelector` scoped to the wrong
 * subtree finds nothing). Reach for the element you want with a query from the
 * root, or key it with an attribute of your own.
 *
 * Returning a function registers a teardown (run on unmount / dispose).
 * Returns a marker node for the view array — it must be PLACED in the array or
 * nothing is registered.
 */
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

/** True while the build in progress is an `each` row body (or a nested arm/row
 * inheriting that). `derived` reads this to rebase its component-state inputs to
 * `ctx.state` so a mixed `derived([state, item], …)` resolves each input against
 * the right part of the combined row ctx. */
export function __inRowBuild(): boolean {
  return ctx?.inRow ?? false
}

// Module fallback for anon-head ordinals requested OUTSIDE a build (a head helper
// called eagerly, no live render context). Best-effort only — such usage can't be
// hydration-matched anyway; the in-build path (the norm) uses the owning instance's
// namespaced scope, so the fallback is also the ONE path that can still collide.
let anonHeadFallback = 0

/**
 * Ordinal source for ANONYMOUS head entries, scoped to ONE owning instance.
 *
 * An anonymous entry (`style('…')` with no `id`, `script`, a `meta` with no
 * identity attr, `noscript`) has nothing to dedup on, so it is keyed by ordinal.
 * That ordinal used to be per BUILD, which made every ISOLATED instance start again
 * at 1 — an `island`'s first anonymous `<style>` and its host's minted one key and
 * one silently overwrote the other (#240). The ordinal is therefore namespaced by
 * the instance that owns it: the root mints `1`, `2`, …; the first island placed in
 * that build mints `i1/1`, `i1/2`, …; an island inside THAT one mints `i1/i1/1`.
 *
 * The namespace is allocated at PLACEMENT — inside the placing build, in document
 * order — which is the one moment the server render and the client mount agree on
 * (the client mounts an island from `runMounts`, long after the host build has
 * finished, so nothing later in the sequence lines up). That is what keeps the two
 * sides producing the same key set, which hydration's `data-llui-head` adoption
 * rests on.
 */
export interface HeadAnonScope {
  /** Prefix identifying the owning instance: `''` for a root mount, `i1/` for the
   * first island placed in its build, `i1/i2/` for that island's second island.
   * Non-empty values always end in the `/` separator, so two sibling namespaces
   * can never run together into one ambiguous key (`app` + `1` vs `app1`). */
  readonly path: string
  /** Ordinal source for the anonymous head entries THIS instance mints. */
  n: number
  /** Ordinal source for the isolated child instances placed in this build. */
  children: number
}

/** A fresh scope for a root mount/render. `namespace` (no trailing separator) is
 * the adapter seam: an adapter that mounts several instances into ONE document —
 * `@llui/vike`'s layout chain, where each layer is its own build — gives each a
 * distinct one so their anonymous entries cannot collide. Empty ⇒ the unprefixed
 * root namespace (`style:#1`, …), which is what a lone `mountApp` uses. */
export function headAnonScope(namespace = ''): HeadAnonScope {
  return { path: namespace === '' ? '' : `${namespace}/`, n: 0, children: 0 }
}

/** Allocate the namespace for an ISOLATED CHILD instance placed in `parent`'s
 * build (an `island`). Mutates `parent.children`, so call it exactly once per
 * placement, at placement — the ordinal is positional and both the server render
 * and the client mount must reach it in the same order. */
export function __childHeadNamespace(parent: HeadAnonScope): string {
  return `${parent.path}i${++parent.children}`
}

/** Next key suffix for an ANONYMOUS head entry, from the CURRENT instance's
 * namespaced counter (see {@link HeadAnonScope}). Stable across a server render
 * and its client hydrate of the same view, so anon `<style>`/`<script>`/… keys
 * match and hydration adopts rather than duplicating. Public for the head module. */
export function __nextHeadAnon(): string {
  return ctx ? `${ctx.headAnon.path}${++ctx.headAnon.n}` : String(++anonHeadFallback)
}
