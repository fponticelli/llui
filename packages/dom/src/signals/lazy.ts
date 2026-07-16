// `lazy` — load a signal component asynchronously. Renders `fallback()` immediately
// (reactively, in the current build) as siblings of an anchor; when the loader
// resolves, the fallback region is removed and the loaded component is mounted via
// the anchor-mount infra. If the loader rejects, `error(err)` is swapped in — reusing
// the shared {@link ArmController} for that one-shot error arm.

import { requireCtx, mountable, materialize, type Mountable } from './build-context.js'
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'
import { ArmController } from './arm-controller.js'
import type { Renderable } from './element.js'

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

  // SSR: the async loader can't settle within a synchronous server render, and
  // mounting the loaded (client) component is a client-DOM concern — mirror
  // `signalSubApp` and emit a BARE anchor. Running the loader here would leave a
  // dangling promise on the server and, worse, invoke `mountSignalComponent` in a
  // DOM-less env. The client mount/hydrate pass (atomic-swap rebuild) runs the
  // loader and paints fallback → component.
  if (c.ssr) return anchor

  // Build the fallback in the CURRENT build so its bindings join the surrounding
  // scope and stay reactive. Bracket it with an end sentinel so the region can be
  // removed wholesale on swap.
  const fallbackEnd = doc.createComment('/lazy-fallback')
  const fallbackNodes = opts.fallback().map(materialize)

  let cancelled = false
  let mounted: SignalComponentHandle<LS, LM> | null = null
  // The error arm is a one-shot mounted arm — the shared machine handles its build,
  // insert-against-anchor, mount (against the host's snapshotted state), child
  // registration, and teardown. `inRow: false` — lazy is not row-aware, so error
  // specs are NOT rebased. The arm inserts right after the anchor and clears by
  // removing its own nodes (there is no trailing bracket for the error region).
  const errorArm = new ArmController<'error'>({
    doc,
    buildCtx: c,
    contexts: c.contexts,
    ownerHost: c.host,
    inRow: false,
    parent: () => anchor.parentNode,
    insertBefore: () => anchor.nextSibling,
    clear: (nodes) => {
      const parent = anchor.parentNode
      if (parent) for (const n of nodes) if (n.parentNode === parent) parent.removeChild(n)
    },
  })

  const removeFallback = (): void => {
    const parent = anchor.parentNode
    if (!parent) return
    for (const n of fallbackNodes) if (n.parentNode === parent) parent.removeChild(n)
    if (fallbackEnd.parentNode === parent) parent.removeChild(fallbackEnd)
  }

  // Use `.then(onLoaded, onLoadError)` — NOT `.then(onLoaded).catch(...)`. The
  // two-arg form only routes a LOADER rejection to the error arm; a throw from
  // inside `onLoaded` (a mount-time error building the loaded component's view)
  // propagates as an unhandled rejection instead of being swallowed and silently
  // rendered as the "load failed" arm — which would mask a real component bug.
  const onLoaded = (def: SignalComponentDef<LS, LM, LE>): void => {
    if (cancelled) return
    removeFallback()
    mounted = mountSignalComponent<LS, LM, LE>(
      { anchor: anchor as Comment, mode: 'append' },
      def,
      opts.initialState !== undefined ? { initialState: opts.initialState } : undefined,
    )
  }
  const onLoadError = (err: unknown): void => {
    if (cancelled) return
    removeFallback()
    if (!opts.error) return
    const e = err instanceof Error ? err : new Error(String(err))
    // Mount against the host's CURRENT state (snapshotted via the threaded getter),
    // and register the arm as a child of the host scope so component state changes
    // propagate to it — the error arm may read component state (e.g. a localized
    // message or a retry button reading `state`), not just the captured `err`.
    // Falls back to null outside a component mount.
    errorArm.switchTo('error', () => opts.error!(e), c.getState ? c.getState() : null)
  }
  void opts.loader().then(onLoaded, onLoadError)

  // On host dispose: cancel any in-flight load, dispose a mounted child, tear
  // down an error arm.
  c.teardowns.push(() => {
    cancelled = true
    mounted?.dispose()
    mounted = null
    errorArm.dispose()
  })

  const frag = doc.createDocumentFragment()
  frag.appendChild(anchor)
  for (const n of fallbackNodes) frag.appendChild(n)
  frag.appendChild(fallbackEnd)
  return frag
}
