// `island` — mount a component instance with its OWN local state inside the current
// view: its own update loop, mask scope and DOM region, at an anchor. It is NOT
// registered as a child scope, so the host reconciler never walks it (and host state
// changes never invalidate it). Disposed with the host.
//
// This is the MIDDLE rung of the widget-state ladder, not an escape hatch:
//
//   T1 static  — no state after build   `connect(constant(v), noSend, opts)`
//   T2 local   — private and transient  `island({ def })`          ← here
//   T3 hoisted — app-level (URL, undo, persistence)  `connect(state.at('x'), send)`
//
// Reach for it when a widget's state is nobody else's business — a copy button's
// "copied!" flash, a disclosure's open flag — and you would otherwise be adding a
// thirteenth slice to the host's State just to keep it. Hoist to T3 the moment the
// state has to survive a route change, appear in a URL, be undoable, or be read by a
// sibling; an island's state is unreachable from the host except through `onHandle`.
//
// COST, MEASURED (N=500 leaves in jsdom; absolute numbers inflated, the ratio is the
// signal): islands cost ~2.4x at mount (22.0ms -> 53.3ms) and are ~2x CHEAPER over 50
// host updates (2.19ms -> 1.14ms), because an island is not a child scope so the host
// reconciler never walks it. Mount cost for update isolation — the good trade for
// many leaves under a host whose state churns, the wrong one for a handful of leaves
// under a host that never updates.
//
// Props come IN declaratively through `props`/`onProps` (a host signal, mapped to a
// message) and messages come OUT through `onHandle`. Both stay TEA-honest: nothing
// pokes the island's state.
//
// AN ISLAND IS NOT A VALID BARE `each` ROW ROOT — wrap it in an element
// (`li([island({ def })])`), the same rule `show`/`branch`/`each` already carry. It
// bites in two different ways depending on where you are, and the SERVER half bites
// first, so a page that looks fine locally 500s in production:
//
//   render: () => [island({ def: Leaf })]        // island as the row's only node
//   server  → THROWS from `each` ("a row cannot have … as its top-level node"),
//             because the SSR body is a multi-node DocumentFragment
//   client  → renders, then CORRUPTS on reorder: the row's only stable node is the
//             anchor comment, so a reorder migrates the anchors and leaves the
//             mounted bodies where they were
//
// The client half is not new (a bare anchor was never keyable either) and is not
// fixed here; the server half arrived with the SSR body. Both are cured by the same
// wrap, which is why the constraint is stated once, here, rather than patched on one
// side. `show`/`branch` ARMS are unaffected in both directions — only `each` rows.

import { requireCtx, mountable, runBuild, type BuildCtx, type Mountable } from './build-context.js'
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'
import { buildAndPublishScope } from './scope-build.js'
import { normalizeUpdateResult } from './tea-driver.js'
import { isSignalHandle, pathHandle } from './handle.js'
import { LluiFrameworkError } from './framework-error.js'
import type { SignalSpec } from './foreign.js'
import type { Signal } from './types.js'

/**
 * A declared reactive input to an island: a host `Signal` (the normal spelling —
 * `state.at('token')`, `state.map(...)`, `derived(...)`), or the `{ produce, deps }`
 * pair a `Signal` erases to. Same shape `foreign`'s declared `state` inputs take, so
 * the dependency paths are visible to the analyzer either way.
 */
export type IslandPropsSource<P> = Signal<P> | SignalSpec<P>

/** Spec for {@link signalIsland} — a component instance with its own local state. */
export interface IslandSpec<S, M, E = never, P = never> {
  /** The component to mount. */
  def: SignalComponentDef<S, M, E>
  /** OPTIONAL note on why this widget owns its state instead of the host. Documents
   * intent at the call site; never consulted at runtime. It was mandatory while this
   * was `subApp`, which is correct friction for a third-party 60fps layer and wrong
   * for the thirteenth copy button. */
  reason?: string
  /** Seed state, overriding `def.init()`'s state (init still runs for effects). For
   * a value that CHANGES, declare `props`/`onProps` instead — this is read once. */
  initialState?: S
  /** EXTRA context values for the isolated build, merged OVER the ones inherited
   * from the placing build (provide/useContext). A key present in both is taken
   * from here; every other ancestor-provided value still reaches the instance. */
  contexts?: ReadonlyMap<symbol, unknown>
  /** A host signal whose value is fed in as PROPS. It is read through a real binding
   * in the host's scope, so it is mask-gated like any other reactive read and its
   * dependency paths are the signal's own. Requires {@link IslandSpec.onProps}. */
  props?: IslandPropsSource<P>
  /** Map a prop value to the message that applies it. THE PROP CHANGE BECOMES A
   * MESSAGE — it is not a poke at the island's state — so the island's reducer stays
   * the single writer, its devtools log shows where the value came from, and the
   * `props` channel is nothing but sugar over the `onHandle` dance it replaces.
   *
   * Called once at mount with the initial value (the island's `init()` supplies the
   * defaults; the first prop arrives immediately after) and then on every change the
   * host's output-equality lets through. Requires {@link IslandSpec.props}. */
  onProps?: (value: P) => M
  /** Receive the mounted handle (send/subscribe/dispose) — the channel for messages
   * OUT, and for imperative drives that do not fit the `props` channel. The island
   * shares no state with the host. Not called under SSR (nothing is mounted there). */
  onHandle?: (handle: SignalComponentHandle<S, M>) => void
}

/**
 * Mount a component instance with its own local state at this point in the view: its
 * own update loop, mask scope and DOM region. It is NOT registered as a child scope,
 * so the host's reconciler never walks it — host state changes don't invalidate it
 * and vice versa. Mounted after the anchor attaches, disposed when the host unmounts.
 *
 * Feed props in with `props` + `onProps` (declarative, mask-gated, and each change
 * becomes a message); read messages out through `onHandle`'s handle.
 *
 * See the module header for where this sits on the state ladder and what it costs.
 */
export function signalIsland<S, M, E = never, P = never>(spec: IslandSpec<S, M, E, P>): Mountable {
  return mountable(() => buildSignalIsland(spec))
}

function buildSignalIsland<S, M, E = never, P = never>(spec: IslandSpec<S, M, E, P>): Node {
  const c = requireCtx()
  const anchor = c.doc.createComment('island')
  // SNAPSHOT the placing build's context map HERE, at placement — exactly as every
  // other structural primitive does (`show`/`branch`/`each`/`lazy` thread theirs
  // into the arm/row builds that happen later). It cannot be read from inside the
  // mount callback below for two independent reasons: `provide` is
  // immutable-by-swap, so by the time the mount lifecycle runs it has already
  // restored the parent map reference; and the isolated instance builds under a
  // FRESH `runBuild` with no parent build on the stack, so nothing would inherit it
  // anyway. This used to forward ONLY `spec.contexts`, so an isolated instance lost
  // every ancestor-provided value — silently. Notably `ComponentLocaleContext`,
  // through which `@llui/components` routes all i18n: every component mounted this
  // way fell back to default English, with no error and no warning.
  const contexts = mergeContexts(c.contexts, spec.contexts)
  const props = resolveProps(spec)
  // The mount LIFECYCLE is a client-DOM concern, so the instance is not *mounted* on
  // the server — but it is still RENDERED there (see `ssrBody`), so an island is not
  // a post-hydration pop-in and is not absent without JS.
  if (c.ssr) return ssrBody(spec, c, anchor, contexts)

  let handle: SignalComponentHandle<S, M> | null = null
  // The prop binding commits during the host's FIRST reconcile, which runs before
  // `runMounts` — so the initial value lands here with no instance to send it to.
  // Hold it and deliver on mount rather than dropping it: `init()` gives the island
  // its defaults and the first prop arrives immediately after, which is the same
  // sequence every later change follows.
  let owed: { value: P } | null = null
  let deliver = (): void => {}
  if (props) {
    const { onProps } = props
    deliver = (): void => {
      if (handle === null || owed === null) return
      const { value } = owed
      owed = null
      handle.send(onProps(value))
    }
    c.specs.push({
      deps: props.deps,
      produce: props.produce,
      // Output-equality is the host scope's, not ours: an unchanged prop does not
      // reach this commit, so it does not become a message.
      commit: (value) => {
        owed = { value: value as P }
        deliver()
      },
      componentRooted: props.componentRooted,
    })
  }

  c.mounts.push(() => {
    // Anchor is attached now; mount the instance as siblings after it.
    // Presence check mirrors mountSignalComponent: only forward `initialState`
    // when the spec actually carries one, so a def whose `init()` seeds a
    // legit falsy/null state isn't clobbered by an implicit `undefined` seed.
    handle = mountSignalComponent<S, M, E>(
      { anchor: anchor as Comment, mode: 'append' },
      spec.def,
      'initialState' in spec ? { initialState: spec.initialState, contexts } : { contexts },
    )
    spec.onHandle?.(handle)
    deliver()
    return () => {
      const h = handle
      handle = null
      h?.dispose()
    }
  })
  return anchor
}

/** The declared prop channel, normalized — or `null` when the spec declares none.
 * Both halves are required together: `props` with no `onProps` has nowhere to go,
 * and `onProps` with no `props` never fires. Either alone is an authoring mistake
 * that would otherwise be a silently inert channel, so it fails the build's mount. */
function resolveProps<S, M, E, P>(
  spec: IslandSpec<S, M, E, P>,
): {
  produce: (state: unknown) => unknown
  deps: readonly string[]
  componentRooted?: boolean
  onProps: (value: P) => M
} | null {
  const src = spec.props
  if (src === undefined) {
    if (spec.onProps !== undefined)
      throw new LluiFrameworkError(
        'island(): `onProps` was given without `props`, so nothing would ever call it',
      )
    return null
  }
  if (spec.onProps === undefined)
    throw new LluiFrameworkError(
      'island(): `props` was given without `onProps`, so the value has no message to become',
    )
  const onProps = spec.onProps
  if (isSignalHandle(src)) {
    // `componentRooted` mirrors `each`'s: a handle rooted at the COMPONENT state must
    // be rebased to `ctx.state` when this binding lands inside an `each` row, and a
    // row-local handle (`row.at('id')`) must not be. Taken from the handle's own
    // brand, never inferred from the dep strings.
    return {
      produce: src.produce as (state: unknown) => unknown,
      deps: src.deps,
      componentRooted: src.rowLocal !== true,
      onProps,
    }
  }
  const raw = src as SignalSpec<P>
  if (typeof raw?.produce !== 'function' || !Array.isArray(raw?.deps))
    throw new LluiFrameworkError(
      'island(): `props` must be a signal (state.at(…)/.map(…)/derived(…)) or a { produce, deps } spec',
    )
  return { produce: raw.produce as (state: unknown) => unknown, deps: raw.deps, onProps }
}

/**
 * Render the isolated instance's view on the SERVER: build it, then mount ONCE
 * against the seed state to bake initial values in, and splice the nodes in after
 * the anchor. Build-then-mount-once is exactly `renderNodes`' shape for a nested
 * def, and `scope.mount(state)` on a detached tree is the same "bake the values,
 * never update" step it takes.
 *
 * There is no update loop, no effect dispatch (`init()`'s effects are DISCARDED —
 * the server does not run them) and no mount lifecycle: nothing calls `runMounts`,
 * and the build carries `ssr: true`, so `onMount` emits its marker and registers
 * nothing at every depth. A nested island inside this view reads that same flag and
 * renders its own body the same way.
 *
 * KNOWN LIMIT — the server body reflects `init()`/`initialState`, NOT the first
 * `props` value. The prop channel is a binding in the HOST's scope, and a binding's
 * value is only resolvable when that scope reconciles — which is after this build
 * has already produced its nodes. Resolving it here instead would have to guess the
 * state to resolve against, and inside an `each` row the row ctx it needs does not
 * exist yet, so the guess would be wrong exactly where lists are (silently, against
 * a correct client tree). A props-driven island therefore still paints its default
 * server-side and takes its first prop on mount. Closing it properly means building
 * the body from the binding's commit, i.e. making this a real structural primitive
 * with an anchored region — a design step, not a patch.
 *
 * ISOLATION IS THE POINT, AND IT COSTS THE SYNTHETIC PARENT BELOW. `runBuild`
 * falls back to the build ON THE STACK when given no `inherit`, and this runs
 * DURING the host's build — so "pass no parent" is not available, and the obvious
 * spelling (`renderSignalTree`, which passes `inherit: undefined`) silently
 * inherits the host's ctx wholesale. Every field it would inherit is one the
 * CLIENT mount does not: `mountSignalComponent` runs from `runMounts`, after the
 * host build has restored `ctx` to null, so its build genuinely has no parent.
 * Server and client must agree, so the parent is synthesized to match what the
 * client gets. Two of the six are real, measured divergences: `inRow` (an island in
 * an `each` row is NOT itself row-local — its bindings read its OWN state, not the
 * row ctx; inherited, `derived` rebases to `ctx.state` and the row renders
 * `undefined`), and `headAnon` (an anonymous `<style>` inside an island takes an
 * ordinal continuing the HOST's count on the server and its own count on the
 * client, so hydration duplicates the tag instead of adopting it). `getState` is a
 * third, latent one — `signalLazy`'s error arm would snapshot the HOST's state. The
 * fresh descriptor registry is HYGIENE, not a divergence: `renderNodes` returns
 * only `{ nodes, dispose }`, so nothing on the server ever reads descriptors — it is
 * separate because the island's affordances belong to the island's own handle, not
 * because a shared one would be observable here.
 *
 * No `llui-mount-end` sentinel is emitted beside the server body. Hydration does
 * not claim these nodes: the HOST's hydrate pass rebuilds its whole tree and swaps
 * it in atomically (`replaceChildren`, or the anchor path's region wipe), so the
 * server body is discarded wholesale and the real instance mounts against a fresh
 * anchor with no siblings. Both sides start from `init()`, so they agree by
 * construction; there is no per-island claim step to keep in sync.
 */
function ssrBody<S, M, E, P>(
  spec: IslandSpec<S, M, E, P>,
  c: BuildCtx,
  anchor: Comment,
  contexts: ReadonlyMap<symbol, unknown>,
): Node {
  const [seed] = normalizeUpdateResult<S, E>(spec.def.init())
  // Presence check, not `??` — see the mount path: a legitimately falsy/null seed
  // must not be silently discarded in favour of `init()`'s state.
  const state = 'initialState' in spec ? (spec.initialState as S) : seed
  const handle = pathHandle<S>(() => state, '')
  const noopSend = (): void => {}
  // Sends are inert on the server, so `batch` is just its body — matching `renderNodes`.
  const noopBatch = (fn: () => void): void => fn()
  // The synthetic parent: what a client mount's build would inherit from, which is
  // nothing but the contexts the caller replays. Its own collecting fields are
  // unused (`runBuild` reads only contexts/descriptors/inRow/ssr/headAnon/getState
  // off a parent) but are given real values rather than casts.
  const isolated: BuildCtx = {
    specs: [],
    doc: c.doc,
    host: { scope: null },
    teardowns: [],
    mounts: [],
    contexts,
    inRow: false,
    descriptors: new Map(),
    headAnon: { n: 0 },
    ssr: true,
    getState: () => state,
  }
  const built = runBuild(
    c.doc,
    () => spec.def.view({ state: handle, send: noopSend, batch: noopBatch }),
    isolated,
  )
  buildAndPublishScope(built).mount(state)
  // The instance has no handle to dispose (it was never mounted), but its BUILD
  // collected teardowns; run them when the host build is disposed, as `renderNodes`
  // does at the end of a server render.
  c.teardowns.push(() => {
    for (const t of built.teardowns.splice(0)) t()
  })
  const frag = c.doc.createDocumentFragment()
  frag.appendChild(anchor)
  for (const n of built.nodes) frag.appendChild(n)
  return frag
}

/** Context values for an isolated build: the placing build's map with the caller's
 * explicit entries laid OVER it. Returns one side by reference when the other
 * contributes nothing, so the common case (no explicit map) allocates nothing. */
function mergeContexts(
  inherited: ReadonlyMap<symbol, unknown>,
  explicit: ReadonlyMap<symbol, unknown> | undefined,
): ReadonlyMap<symbol, unknown> {
  if (!explicit || explicit.size === 0) return inherited
  if (inherited.size === 0) return explicit
  const merged = new Map(inherited)
  for (const [k, v] of explicit) merged.set(k, v)
  return merged
}
