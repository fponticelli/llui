// `lazy` — load a signal component asynchronously. Renders `fallback()` immediately
// (reactively, in the current build) as siblings of an anchor; when the loader
// resolves, the fallback region is removed and the loaded component is mounted via
// the anchor-mount infra. If the loader rejects, `error(err)` is swapped in — reusing
// the shared {@link ArmController} for that one-shot error arm.

import {
  __childHeadNamespace,
  requireCtx,
  mountable,
  materialize,
  type Mountable,
} from './build-context.js'
import { mountSignalComponent } from './component.js'
import type { SignalComponentDef, SignalComponentHandle } from './component.js'
import { mergeContexts } from './context.js'
import { markUnstableRowRoot } from './row-root.js'
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
  /** EXTRA context values for the loaded component's build, merged OVER the ones
   * inherited from the placing build (provide/useContext). A key present in both is
   * taken from here; every other ancestor-provided value still reaches the instance.
   * Same shape and same semantics as `island`'s `contexts`. */
  contexts?: ReadonlyMap<symbol, unknown>
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
 * The loaded component is an ISOLATED instance, so it inherits nothing implicitly:
 * the contexts its ancestors provided reach it only through the snapshot this
 * primitive takes at PLACEMENT (`opts.contexts` merged over it) — see the note at
 * that line. Its anonymous head entries take a namespace allocated at the same point.
 *
 * If the surrounding build is torn down before the loader settles, a cancelled
 * flag skips the deferred mount; any already-mounted child handle is disposed.
 * The flag is re-checked AFTER the deferred mount too, so a teardown raised from
 * inside the child's own `onMount` still disposes it rather than orphaning it.
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
  // MARKED for the same reason as `island`'s (#239), with the two sides swapped:
  // on the CLIENT this anchor ships inside a fragment (anchor + fallback + end
  // sentinel), which `each`'s `nodeType` check already rejects; on the SERVER it is
  // returned BARE, and the loaded instance would mount as its siblings on the
  // client. Marking it makes the two sides fail identically instead of the server
  // rendering a row the client then refuses.
  const anchor = markUnstableRowRoot(doc.createComment('lazy'))

  // ALLOCATE the anonymous-head namespace HERE, at placement, and BEFORE the SSR bail
  // below. `lazy` mounts an ISOLATED instance exactly as `island` does, so it had the
  // same #240 collision: unnamespaced, the loaded component's first anonymous `<style>`
  // minted `style:#1` and the host's entry was silently overwritten. Two halves, and
  // the ordering of this line against the `c.ssr` return is the second one: the server
  // renders NOTHING for a lazy, but the ordinal is POSITIONAL, so a server that skipped
  // the allocation would number every later island one lower than the client does and
  // hydration would adopt the wrong tag. Allocating unconditionally costs one unused
  // ordinal on the server and keeps the two sides in step.
  const headNamespace = __childHeadNamespace(c.headAnon)

  // SSR: the async loader can't settle within a synchronous server render, and
  // mounting the loaded (client) component is a client-DOM concern — mirror
  // `signalSubApp` and emit a BARE anchor. Running the loader here would leave a
  // dangling promise on the server and, worse, invoke `mountSignalComponent` in a
  // DOM-less env. The client mount/hydrate pass (atomic-swap rebuild) runs the
  // loader and paints fallback → component.
  if (c.ssr) return anchor

  // SNAPSHOT the placing build's context map HERE, at placement — exactly as `island`
  // does (#231). `lazy` forwarded NO contexts at all, so the loaded component lost every
  // ancestor-provided value, silently (#243). Placement is the only correct point: the
  // mount below is DEFERRED to a promise continuation, and `provide` is
  // immutable-by-swap — it restores the PARENT map reference when its synchronous
  // `render()` returns, so a read taken inside `onLoaded` sees no ancestor `provide` at
  // all. The loaded component also builds under a fresh `runBuild` with no parent build
  // on the stack, so nothing inherits it implicitly either. Two measured consequences of
  // the miss, both silent: every `@llui/components` widget mounted through `lazy` fell
  // back to default English (all of its i18n routes through `ComponentLocaleContext`),
  // and an `id`-keyed head entry from a lazy child resolved `HEAD_SINK` to `null` and
  // never reached an SSR/coordinated collector at all.
  //
  // The ERROR arm deliberately keeps `c.contexts` rather than this map: `opts.error(e)`
  // is HOST view code built as an arm in the host's own scope, not the isolated
  // instance, so the caller's `contexts` (documented as extras FOR the loaded component)
  // must not leak into it. Its `c.contexts` read is itself a placement snapshot.
  const contexts = mergeContexts(c.contexts, opts.contexts)

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
    // Assign to a LOCAL, then re-check `cancelled` before publishing it to the
    // field the teardown disposes. The loaded component's `onMount` callbacks run
    // SYNCHRONOUSLY inside this call, so one of them can tear the host down
    // (directly, or via an effect whose continuation is synchronous) while
    // `mounted` is still null — the teardown's `mounted?.dispose()` then no-ops,
    // and a plain `mounted = mountSignalComponent(...)` would install a live child
    // nothing can ever reach: its own update loop, timers, effects and DOM
    // subscriptions would outlive the host for the life of the page.
    const handle = mountSignalComponent<LS, LM, LE>(
      { anchor: anchor as Comment, mode: 'append' },
      def,
      opts.initialState !== undefined
        ? { initialState: opts.initialState, contexts, headNamespace }
        : { contexts, headNamespace },
    )
    if (cancelled) {
      // The host was disposed during the mount above — dispose the child here
      // instead (its handle is idempotent, so a later teardown is still safe) and
      // leave the field null, since nothing may reach a torn-down child.
      handle.dispose()
      return
    }
    mounted = handle
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
    // Same reentrancy hole as `onLoaded`: the arm's `onMount` callbacks run inside
    // `switchTo`, which records the mounted arm only AFTER they return — so a host
    // teardown raised from one of them calls `errorArm.dispose()` on a controller
    // that still holds nothing, and the arm's scope + onMount cleanups survive it.
    // Re-dispose on return; `ArmController.dispose` is idempotent (an already-torn-
    // down controller has no mounted arm), so the normal path is unaffected.
    if (cancelled) errorArm.dispose()
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
