import { hydrateApp, mountApp, mountAtAnchor, hydrateAtAnchor } from '@llui/dom'
import type { AnyComponentDef, AppHandle, TransitionOptions, Scope } from '@llui/dom'
import { _consumePendingSlot, _resetPendingSlot } from './page-slot.js'
import type { VikePageContextData } from './vike-namespace.js'

// Re-exported so `@llui/vike/client` is a one-stop-shop for everything
// a pages/+onRenderClient.ts / +Layout.ts file needs.
export { pageSlot } from './page-slot.js'

declare global {
  interface Window {
    __LLUI_STATE__?: unknown
  }
}

/**
 * Page context shape as seen by `@llui/vike`'s client-side hooks. The
 * `Page` and `data` fields come from whichever `+Page.ts` and `+data.ts`
 * Vike resolved for the current route.
 *
 * `data` is derived from the global `Vike.PageContext` namespace — the
 * convention users already know from Vike. Consumer augmentations of
 * `Vike.PageContext { interface PageContext { data?: MyData } }` flow
 * through to every callback here without a cast. Unaugmented projects
 * fall back to `unknown`.
 *
 * `lluiLayoutData` is optional and carries per-layer data for the layout
 * chain configured via `createOnRenderClient({ Layout })`. It's indexed
 * outermost-to-innermost, one entry per layout layer. Absent entries
 * mean the corresponding layout's `init()` receives `undefined`. Users
 * wire this from their Vike `+data.ts` files by merging layout-owned
 * data under the `lluiLayoutData` key.
 */
export interface ClientPageContext {
  Page: AnyComponentDef
  data?: VikePageContextData
  lluiLayoutData?: readonly unknown[]
  isHydration?: boolean
}

type LayoutChain = ReadonlyArray<AnyComponentDef>

/**
 * Resolves the layout chain for a given pageContext. A single layout
 * becomes a one-element chain; a function resolver gives callers full
 * control to return different chains for different routes (e.g. nested
 * layouts keyed on Vike's `pageContext.urlPathname`).
 */
function resolveLayoutChain(
  layoutOption: RenderClientOptions['Layout'],
  pageContext: ClientPageContext,
): LayoutChain {
  if (!layoutOption) return []
  if (typeof layoutOption === 'function') {
    return layoutOption(pageContext) ?? []
  }
  if (Array.isArray(layoutOption)) return layoutOption
  return [layoutOption as AnyComponentDef]
}

/**
 * Page-lifecycle hooks that fire around the dispose → mount cycle on
 * client navigation. With persistent layouts in play the cycle only
 * tears down the *divergent* suffix of the layout chain — any layers
 * shared between the old and new routes stay mounted.
 *
 * Navigation sequence for an already-mounted app:
 *
 * ```
 *   client nav triggered
 *     │
 *     ▼
 *   compare old chain to new chain → find first mismatch index K
 *     │
 *     ▼
 *   onLeave(leaveTarget)   ← awaited; leaveTarget is the slot element
 *     │                      at depth K-1 (or the root container if K=0)
 *     │                      whose contents are about to be replaced
 *     ▼
 *   dispose chainHandles[K..end] innermost first
 *     │
 *     ▼
 *   leaveTarget.textContent = ''
 *     │
 *     ▼
 *   mount newChain[K..end] into leaveTarget, outermost first
 *     │
 *     ▼
 *   onEnter(leaveTarget)   ← fire-and-forget; fresh DOM in place
 *     │
 *     ▼
 *   onMount()
 * ```
 *
 * On the initial hydration render, `onLeave` and `onEnter` are NOT
 * called — there's no outgoing page to leave and no animation to enter.
 * Use `onMount` for code that should run on every render including the
 * initial one.
 */
export interface RenderClientOptions {
  /** CSS selector for the mount container. Default: `'#app'`. */
  container?: string

  /**
   * Persistent layout chain. One of:
   *
   * - A single `ComponentDef` — becomes a one-layout chain.
   * - An array of `ComponentDef`s — outermost layout first, innermost
   *   layout last. Every layer except the innermost must call
   *   `pageSlot()` in its view to declare where nested content renders.
   * - A function that returns a chain from the current `pageContext` —
   *   lets different routes use different chains, e.g. by reading
   *   Vike's `pageContext.urlPathname` or `pageContext.config.Layout`.
   *
   * Layers that are shared between the previous and next navigation
   * stay mounted. Only the divergent suffix is disposed and re-mounted.
   * Dialogs, focus traps, and effect subscriptions rooted in a surviving
   * layer are unaffected by the nav.
   */
  Layout?: AnyComponentDef | LayoutChain | ((pageContext: ClientPageContext) => LayoutChain)

  /**
   * Called on the slot element whose contents are about to be replaced,
   * BEFORE the divergent suffix is disposed and re-mounted. The slot's
   * current DOM is still attached when this runs — the only moment a
   * leave animation can read/write it. Return a promise to defer the
   * swap until the animation completes.
   *
   * For a plain no-layout setup, the slot element is the root container.
   * Not called on the initial hydration render.
   */
  onLeave?: (el: HTMLElement) => void | Promise<void>

  /**
   * Called after the new divergent suffix is mounted, on the same slot
   * element that was passed to `onLeave`. Use this to kick off an enter
   * animation. Fire-and-forget — promise returns are ignored.
   *
   * Not called on the initial hydration render.
   */
  onEnter?: (el: HTMLElement) => void

  /**
   * Called after mount or hydration completes. Fires on every render
   * including the initial hydration. Use for per-render side effects
   * that don't fit the animation hooks.
   */
  onMount?: () => void
}

/**
 * Adapt a `TransitionOptions` object (e.g. the output of
 * `routeTransition()` from `@llui/transitions`, or a preset like `fade`
 * / `slide`) into the `onLeave` / `onEnter` pair expected by
 * `createOnRenderClient`.
 *
 * ```ts
 * import { createOnRenderClient, fromTransition } from '@llui/vike/client'
 * import { routeTransition } from '@llui/transitions'
 *
 * export const onRenderClient = createOnRenderClient({
 *   Layout: AppLayout,
 *   ...fromTransition(routeTransition({ duration: 200 })),
 * })
 * ```
 *
 * The transition operates on the slot element — in a no-layout setup,
 * the root container; in a layout setup, the innermost surviving
 * layer's `pageSlot()` element. Opacity / transform fades apply to the
 * outgoing page content, then the new page fades in.
 */
export function fromTransition(
  t: TransitionOptions,
): Pick<RenderClientOptions, 'onLeave' | 'onEnter'> {
  return {
    onLeave: t.leave
      ? (el): void | Promise<void> => {
          const result = t.leave!([el])
          return result && typeof (result as Promise<void>).then === 'function'
            ? (result as Promise<void>)
            : undefined
        }
      : undefined,
    onEnter: t.enter
      ? (el): void => {
          t.enter!([el])
        }
      : undefined,
  }
}

/**
 * One element of the live chain the adapter keeps between navs.
 * `handle` is the AppHandle returned by mountApp/hydrateApp for this
 * layer. `slotAnchor` / `slotScope` are set when the layer called
 * `pageSlot()` during its view pass; they're null for the innermost
 * layer (typically the page component, which doesn't have a slot).
 */
interface ChainEntry {
  def: AnyComponentDef
  handle: AppHandle
  slotAnchor: Comment | null
  slotScope: Scope | null
  /**
   * The data slice this layer was most recently mounted or updated
   * with. Compared shallow-key against the next nav's `lluiLayoutData[i]`
   * to decide whether a surviving layer needs a `propsMsg` dispatch.
   * Layers that didn't receive any layout data carry `undefined` here.
   */
  data: unknown
}

// Live chain of mounted layers. Module-level state: there's exactly
// one chain per Vike-managed app per page load.
let chainHandles: ChainEntry[] = []

/**
 * @internal — test helper. Disposes every layer in the current chain
 * and clears the module state so subsequent calls behave as a first
 * mount. Not part of the public API; subject to change without notice.
 */
export function _resetChainForTest(): void {
  // Dispose innermost-first to match the normal teardown path.
  for (let i = chainHandles.length - 1; i >= 0; i--) {
    chainHandles[i]!.handle.dispose()
  }
  chainHandles = []
  _resetPendingSlot()
}

/**
 * Back-compat alias for the pre-layout test helper name.
 * @internal
 * @deprecated — use `_resetChainForTest` instead.
 */
export function _resetCurrentHandleForTest(): void {
  _resetChainForTest()
}

/**
 * Default onRenderClient hook — no layout, no animation hooks. Hydrates
 * on first load, mounts fresh on subsequent navs. Use `createOnRenderClient`
 * for the customizable factory form.
 */
export async function onRenderClient(pageContext: ClientPageContext): Promise<void> {
  await renderClient(pageContext, {})
}

/**
 * Factory to create a customized onRenderClient hook. See `RenderClientOptions`
 * for the full option surface — this is the entry point for persistent
 * layouts, route transitions, and lifecycle hooks.
 *
 * **Do not name your layout file `+Layout.ts`.** Vike reserves the `+`
 * prefix for its own framework config conventions, and `+Layout.ts` is
 * interpreted by `vike-react` / `vike-vue` / `vike-solid` framework
 * adapters as a native layout config. `@llui/vike` isn't a framework
 * adapter in that sense — it's a render adapter, and `createOnRenderClient`
 * consumes the layout component directly via the `Layout` option. Name
 * the file `Layout.ts`, `app-layout.ts`, or anywhere outside `/pages`
 * that Vike won't scan, and import it here by path.
 *
 * ```ts
 * // pages/+onRenderClient.ts
 * import { createOnRenderClient, fromTransition } from '@llui/vike/client'
 * import { routeTransition } from '@llui/transitions'
 * import { AppLayout } from './Layout' // ← NOT './+Layout'
 *
 * export const onRenderClient = createOnRenderClient({
 *   Layout: AppLayout,
 *   ...fromTransition(routeTransition({ duration: 200 })),
 *   onMount: () => console.log('page rendered'),
 * })
 * ```
 */
export function createOnRenderClient(
  options: RenderClientOptions,
): (pageContext: ClientPageContext) => Promise<void> {
  return (pageContext) => renderClient(pageContext, options)
}

async function renderClient(
  pageContext: ClientPageContext,
  options: RenderClientOptions,
): Promise<void> {
  const selector = options.container ?? '#app'
  const container = document.querySelector(selector)
  if (!container) {
    throw new Error(`@llui/vike: container "${selector}" not found in DOM`)
  }
  const rootEl = container as HTMLElement

  // Resolve the chain for this render. The page component is always
  // the innermost entry, regardless of layout configuration.
  const layoutChain = resolveLayoutChain(options.Layout, pageContext)
  const layoutData = pageContext.lluiLayoutData ?? []
  const newChain: LayoutChain = [...layoutChain, pageContext.Page]
  const newChainData: readonly unknown[] = [...layoutData, pageContext.data]

  if (pageContext.isHydration) {
    // First load — the chain starts empty and we hydrate every layer
    // against server-rendered HTML. No onLeave/onEnter on hydration.
    await mountOrHydrateChain(newChain, newChainData, rootEl, {
      mode: 'hydrate',
      serverStateEnvelope: window.__LLUI_STATE__,
    })
    options.onMount?.()
    return
  }

  // Subsequent nav — diff the chain to find the divergent suffix.
  let firstMismatch = 0
  const minLen = Math.min(chainHandles.length, newChain.length)
  while (firstMismatch < minLen && chainHandles[firstMismatch]!.def === newChain[firstMismatch]) {
    firstMismatch++
  }

  // Push fresh data into surviving layers (layers in the shared prefix).
  // Without this, persistent layouts can't react to nav-driven data
  // changes — pathname, breadcrumbs, session, nav-highlight state all
  // belong to the layout but change on every client navigation. Each
  // surviving layer's def can opt in via `propsMsg(data) => Msg`; we
  // dispatch the resulting message through the handle's `send` so the
  // layout's update loop processes it like any other state change.
  //
  // Diff is shallow-key Object.is on record-shaped data, falling back
  // to whole-value Object.is for primitives / non-records. This matches
  // child()'s prop-diff behavior, which is what the report asked us to
  // mirror. Layers without `propsMsg` are skipped silently — opt-in.
  for (let i = 0; i < firstMismatch; i++) {
    const entry = chainHandles[i]!
    const newData = newChainData[i]
    if (!hasDataChanged(entry.data, newData)) continue
    entry.data = newData
    const propsMsg = (entry.def as { propsMsg?: (data: unknown) => unknown }).propsMsg
    if (typeof propsMsg !== 'function') continue
    const msg = propsMsg(newData)
    if (msg !== null && msg !== undefined) {
      entry.handle.send(msg)
    }
  }

  // Determine whether this nav replaces the entire root or only a suffix.
  // For the root swap, the outermost layer mounts/hydrates via mountApp/
  // hydrateApp on rootEl. For a deeper swap, the mount target is an
  // anchor comment owned by the surviving layer's slot.
  const isRootSwap = firstMismatch === 0

  // If everything matches (same chain end-to-end with same defs), this
  // is effectively a no-op nav — the page def hasn't changed. We still
  // fire onMount so callers can run per-render side effects, and the
  // surviving-layer data updates above already ran. But there's nothing
  // to dispose or mount, so skip the rest of the work.
  const isNoOp = firstMismatch === chainHandles.length && firstMismatch === newChain.length
  if (isNoOp) {
    options.onMount?.()
    return
  }

  // onLeave runs BEFORE any teardown. Outgoing DOM still mounted here.
  // Skip on the very first mount — there's no outgoing page to leave.
  const isFirstMount = chainHandles.length === 0
  if (options.onLeave && !isFirstMount) {
    const leaveTargetEl = isRootSwap
      ? rootEl
      : (chainHandles[firstMismatch - 1]!.slotAnchor?.parentElement ?? rootEl)
    await options.onLeave(leaveTargetEl)
  }

  // Dispose the divergent suffix, innermost first. Each handle.dispose()
  // calls disposeScope on that layer's rootScope, which cascades through
  // every child scope the layer owned (bindings, portals, onMount
  // cleanups, dialog focus traps, etc.). The surviving layers are
  // untouched because their scopes live above the disposal roots.
  // For anchor-based mounts, dispose() also removes the owned DOM region
  // between the anchor and end sentinel — no additional textContent clear needed.
  for (let i = chainHandles.length - 1; i >= firstMismatch; i--) {
    chainHandles[i]!.handle.dispose()
  }
  chainHandles = chainHandles.slice(0, firstMismatch)

  // Mount the new suffix starting at firstMismatch.
  // For a root swap, the target is the container HTMLElement.
  // For a deeper swap, the target is the surviving layer's slot anchor (Comment).
  const parentScope =
    firstMismatch === 0 ? undefined : (chainHandles[firstMismatch - 1]!.slotScope ?? undefined)
  const mountTargetArg: HTMLElement | Comment =
    firstMismatch === 0 ? rootEl : chainHandles[firstMismatch - 1]!.slotAnchor!
  mountChainSuffix(newChain, newChainData, firstMismatch, mountTargetArg, parentScope, {
    mode: 'mount',
  })

  // onEnter fires after the new suffix is in place. Fire-and-forget.
  if (options.onEnter) {
    const enterTargetEl = isRootSwap
      ? rootEl
      : (chainHandles[firstMismatch - 1]!.slotAnchor?.parentElement ?? rootEl)
    options.onEnter(enterTargetEl)
  }
  options.onMount?.()
}

/**
 * Walk the full chain for the first mount or hydration. Starts from
 * depth 0 at the root container, threads each layer's slot into the
 * next layer's mount target + parentScope.
 */
async function mountOrHydrateChain(
  chain: LayoutChain,
  chainData: readonly unknown[],
  rootEl: HTMLElement,
  opts: MountOpts,
): Promise<void> {
  mountChainSuffix(chain, chainData, 0, rootEl, undefined, opts)
}

interface MountOpts {
  mode: 'mount' | 'hydrate'
  /** For hydration: the full `window.__LLUI_STATE__` envelope. */
  serverStateEnvelope?: unknown
}

/**
 * Mount (or hydrate) `chain[startAt..end]` into `initialTarget`, with
 * the initial layer's rootScope parented at `initialParentScope`.
 * Threads slot → next-target → next-parentScope through the chain.
 *
 * `initialTarget` is `HTMLElement` for the outermost layer (container-
 * based mount/hydrate) and `Comment` for inner layers that mount relative
 * to a `pageSlot()` anchor.
 *
 * Fails loudly if a non-innermost layer forgot to call `pageSlot()`,
 * or if the innermost layer called `pageSlot()` unnecessarily.
 *
 * @internal — test helper. Exported so `client-page-slot.test.ts` can
 * test anchor-mount/dispose contracts directly with hand-built DOM.
 * Not part of the public API.
 */
export function _mountChainSuffix(
  chain: LayoutChain,
  chainData: readonly unknown[],
  startAt: number,
  initialTarget: HTMLElement | Comment,
  initialParentScope: Scope | undefined,
  opts: MountOpts,
): void {
  let mountTarget: HTMLElement | Comment = initialTarget
  let parentScope: Scope | undefined = initialParentScope

  for (let i = startAt; i < chain.length; i++) {
    const def = chain[i]!
    const layerData = chainData[i]
    const isInnermost = i === chain.length - 1

    // Defensive: clear any stale slot from a prior failed mount.
    _resetPendingSlot()

    let handle: AppHandle
    if (opts.mode === 'hydrate') {
      // Hydration envelope: each layer pulls its own state slice. The
      // envelope shape is `{ layouts: [...], page: {...} }` with each
      // entry carrying `{ name, state }`. We match by name so a server/
      // client mismatch throws with a clear error instead of silently
      // hydrating the wrong state into the wrong instance.
      const layerState = extractHydrationState(opts.serverStateEnvelope, i, chain.length, def)
      if (mountTarget.nodeType === 1) {
        // HTMLElement — outermost layer, use hydrateApp (container-based).
        // Cross from the type-erased AnyComponentDef back into a concrete
        // ComponentDef<unknown, unknown, unknown, unknown> for the mount
        // primitive's signature. The cast is safe — mountApp / hydrateApp
        // don't use the type parameters at runtime.
        handle = hydrateApp(
          mountTarget as HTMLElement,
          def as unknown as Parameters<typeof hydrateApp>[1],
          layerState,
          { parentScope },
        )
      } else {
        // Comment anchor — inner layer, use hydrateAtAnchor.
        handle = hydrateAtAnchor(
          mountTarget as Comment,
          def as unknown as Parameters<typeof hydrateAtAnchor>[1],
          layerState as never,
          { parentScope },
        )
      }
    } else {
      if (mountTarget.nodeType === 1) {
        // HTMLElement — outermost layer, use mountApp (container-based).
        handle = mountApp(
          mountTarget as HTMLElement,
          def as unknown as Parameters<typeof mountApp>[1],
          layerData,
          { parentScope },
        )
      } else {
        // Comment anchor — inner layer, use mountAtAnchor.
        handle = mountAtAnchor(
          mountTarget as Comment,
          def as unknown as Parameters<typeof mountAtAnchor>[1],
          layerData,
          { parentScope },
        )
      }
    }

    const slot = _consumePendingSlot()

    if (isInnermost && slot !== null) {
      // Innermost layer declared a slot with nothing to fill it —
      // probably a misuse of pageSlot() in the page component itself.
      handle.dispose()
      throw new Error(
        `[llui/vike] <${def.name}> is the innermost component in the chain ` +
          `but called pageSlot(). pageSlot() only belongs in layout components ` +
          `that wrap a nested page or layout — not in the page itself.`,
      )
    }
    if (!isInnermost && slot === null) {
      // Non-innermost layer didn't declare a slot — there's nowhere to
      // mount the remaining chain.
      handle.dispose()
      throw new Error(
        `[llui/vike] <${def.name}> is a layout layer at depth ${i} but did not ` +
          `call pageSlot() in its view(). There are ${chain.length - i - 1} more ` +
          `layer(s) to mount and no slot to mount them into. Add pageSlot() from ` +
          `@llui/vike/client to the view at the position where nested content renders.`,
      )
    }

    chainHandles.push({
      def,
      handle,
      slotAnchor: slot?.anchor ?? null,
      slotScope: slot?.slotScope ?? null,
      data: layerData,
    })

    if (slot !== null) {
      // Next layer mounts relative to the slot's comment anchor.
      mountTarget = slot.anchor
      parentScope = slot.slotScope
    }
  }
}

// Internal alias used by renderClient and mountOrHydrateChain.
// The public-named export above carries the @internal doc.
const mountChainSuffix = _mountChainSuffix

/**
 * Pull the per-layer state from the hydration envelope. Supports both
 * the new chain-aware shape (`{ layouts: [...], page: {...} }`) and the
 * legacy flat shape (`window.__LLUI_STATE__` is the state object itself)
 * for backward compatibility with pages written against 0.0.15 or earlier.
 *
 * Throws on envelope shape mismatch — missing entries, wrong component
 * name at a given index — so server/client drift fails loud instead of
 * silently binding the wrong state to the wrong instance.
 */
/**
 * Shallow-key data diff for the persistent-layer prop-update path.
 * Returns true when `next` differs from `prev` enough to warrant
 * dispatching a `propsMsg`. Mirrors `child()`'s prop-diff semantics:
 *
 * - `Object.is(prev, next)` short-circuits identical references.
 * - For two plain-object records, walks the union of keys and returns
 *   true on the first `Object.is` mismatch.
 * - For anything else (primitives, arrays, class instances), falls
 *   back to the top-level `Object.is` result — covers the cases where
 *   the host populates `lluiLayoutData[i]` with a primitive or a
 *   referentially-stable object.
 */
function hasDataChanged(prev: unknown, next: unknown): boolean {
  if (Object.is(prev, next)) return false
  // Both must be plain object records to do a key walk; otherwise the
  // Object.is above is the only signal.
  if (
    prev === null ||
    next === null ||
    typeof prev !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(prev) ||
    Array.isArray(next)
  ) {
    return true
  }
  const prevRec = prev as Record<string, unknown>
  const nextRec = next as Record<string, unknown>
  const seen = new Set<string>()
  for (const k of Object.keys(prevRec)) {
    seen.add(k)
    if (!Object.is(prevRec[k], nextRec[k])) return true
  }
  for (const k of Object.keys(nextRec)) {
    if (!seen.has(k)) return true
  }
  return false
}

function extractHydrationState(
  envelope: unknown,
  layerIndex: number,
  chainLength: number,
  def: AnyComponentDef,
): unknown {
  // Legacy flat envelope — no layout chain at render time. Only valid
  // when the chain has a single layer (the page).
  const isLegacyFlat =
    envelope !== null &&
    typeof envelope === 'object' &&
    !('layouts' in (envelope as object)) &&
    !('page' in (envelope as object))

  if (isLegacyFlat) {
    if (chainLength !== 1) {
      throw new Error(
        `[llui/vike] Hydration envelope is in the legacy flat shape but the ` +
          `current render has ${chainLength} chain layers. The server must emit ` +
          `the chain-aware shape ({ layouts, page }) when rendering with a layout.`,
      )
    }
    return envelope
  }

  const chainEnvelope = envelope as
    | { layouts?: Array<{ name: string; state: unknown }>; page?: { name: string; state: unknown } }
    | undefined
  if (!chainEnvelope) {
    throw new Error(
      `[llui/vike] Hydration envelope is missing. Server-side onRenderHtml must ` +
        `populate window.__LLUI_STATE__ with the full chain before client hydration.`,
    )
  }

  const isPageLayer = layerIndex === chainLength - 1
  const layoutEntries = chainEnvelope.layouts ?? []
  const expected = isPageLayer ? chainEnvelope.page : layoutEntries[layerIndex]

  if (!expected) {
    throw new Error(
      `[llui/vike] Hydration envelope has no entry for chain layer ${layerIndex} ` +
        `(<${def.name}>). Server rendered ${layoutEntries.length} layouts + ${
          chainEnvelope.page ? 'a page' : 'no page'
        }, client expected ${chainLength} total entries.`,
    )
  }

  if (expected.name !== def.name) {
    throw new Error(
      `[llui/vike] Hydration mismatch at chain layer ${layerIndex}: server ` +
        `rendered <${expected.name}> but client is trying to hydrate <${def.name}>. ` +
        `This usually means the layout chain resolver returns different layouts ` +
        `on the server and the client for the same route.`,
    )
  }

  return expected.state
}
