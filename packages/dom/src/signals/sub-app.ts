// `subApp` — mount an ISOLATED child component instance inside the current view at
// an anchor: its own update loop, mask scope, and DOM region, NOT registered as a
// child scope, so the parent reconciler never touches it. The escape hatch for
// genuine lifecycle isolation (third-party UI, a 60fps layer). Everyday
// decomposition uses plain view-helper functions over `Signal<T>` slices instead.

import { requireCtx, mountable, runBuild, type BuildCtx, type Mountable } from './build-context.js'
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'
import { buildAndPublishScope } from './scope-build.js'
import { normalizeUpdateResult } from './tea-driver.js'
import { pathHandle } from './handle.js'

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
  /** EXTRA context values for the isolated build, merged OVER the ones inherited
   * from the placing build (provide/useContext). A key present in both is taken
   * from here; every other ancestor-provided value still reaches the instance. */
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
  // The mount LIFECYCLE is a client-DOM concern, so the isolated instance is not
  // *mounted* on the server — but it is still RENDERED there (see `ssrBody`), so an
  // island is not a post-hydration pop-in and is not absent without JS.
  if (c.ssr) return ssrBody(spec, c, anchor, contexts)
  c.mounts.push(() => {
    // Anchor is attached now; mount the isolated instance as siblings after it.
    // Presence check mirrors mountSignalComponent: only forward `initialState`
    // when the spec actually carries one, so a subApp def whose `init()` seeds a
    // legit falsy/null state isn't clobbered by an implicit `undefined` seed.
    const handle = mountSignalComponent<S, M, E>(
      { anchor: anchor as Comment, mode: 'append' },
      spec.def,
      'initialState' in spec ? { initialState: spec.initialState, contexts } : { contexts },
    )
    spec.onHandle?.(handle)
    return () => handle.dispose()
  })
  return anchor
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
 * nothing at every depth. A nested `subApp` inside this view reads that same flag
 * and renders its own body the same way.
 *
 * ISOLATION IS THE POINT, AND IT COSTS THE SYNTHETIC PARENT BELOW. `runBuild`
 * falls back to the build ON THE STACK when given no `inherit`, and this runs
 * DURING the host's build — so "pass no parent" is not available, and the obvious
 * spelling (`renderSignalTree`, which passes `inherit: undefined`) silently
 * inherits the host's ctx wholesale. Every field it would inherit is one the
 * CLIENT mount does not: `mountSignalComponent` runs from `runMounts`, after the
 * host build has restored `ctx` to null, so its build genuinely has no parent.
 * Server and client must agree, so the parent is synthesized to match what the
 * client gets — a fresh `headAnon` (or an anonymous `<style>` inside an island
 * takes an ordinal continuing the HOST's count on the server and its own count on
 * the client, so hydration duplicates the tag instead of adopting it), a fresh
 * descriptor registry (the island's affordances belong to the island's handle),
 * `inRow: false` (an island placed in an `each` row is NOT itself row-local — its
 * bindings read its OWN state, not the row ctx), and a `getState` reading the
 * island's seed rather than the host's state.
 *
 * No `llui-mount-end` sentinel is emitted beside the server body. Hydration does
 * not claim these nodes: the HOST's hydrate pass rebuilds its whole tree and swaps
 * it in atomically (`replaceChildren`, or the anchor path's region wipe), so the
 * server body is discarded wholesale and the real instance mounts against a fresh
 * anchor with no siblings. Both sides start from `init()`, so they agree by
 * construction; there is no per-island claim step to keep in sync.
 */
function ssrBody<S, M, E>(
  spec: SubAppSpec<S, M, E>,
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
