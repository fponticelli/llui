// `subApp` — mount an ISOLATED child component instance inside the current view at
// an anchor: its own update loop, mask scope, and DOM region, NOT registered as a
// child scope, so the parent reconciler never touches it. The escape hatch for
// genuine lifecycle isolation (third-party UI, a 60fps layer). Everyday
// decomposition uses plain view-helper functions over `Signal<T>` slices instead.

import { requireCtx, mountable, type Mountable } from './build-context.js'
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'

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
  // Like `onMount`, the isolated child is mounted via the mount lifecycle, which
  // is a client-DOM concern: skip it under SSR (the child would mount with its own
  // fresh — non-SSR — build and crash on any browser-global in its `onMount`). The
  // anchor still serializes; the client mount/hydrate pass brings the child up.
  if (c.ssr) return anchor
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
