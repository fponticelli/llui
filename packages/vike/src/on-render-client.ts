import { mountSignalComponent, hydrateSignalApp } from '@llui/dom/signals'
import type { SignalComponentDef, SignalComponentHandle, MountTarget } from '@llui/dom/signals'
import type { TransitionOptions } from '@llui/dom/signals'
import { _consumePendingSlot, _resetPendingSlot } from './page-slot.js'
import type { VikePageContextData } from './vike-namespace.js'

// Re-exported so `@llui/vike/client` is a one-stop-shop for everything
// a pages/+onRenderClient.ts / Layout.ts file needs.
export { pageSlot } from './page-slot.js'

/** A type-erased signal component as the adapter handles it (type params unused
 * at runtime). Layouts and pages are concrete `SignalComponentDef<S, M, E>`. */
export type AnyLayer = SignalComponentDef<unknown, unknown, unknown>
/** The live handle a mounted/hydrated layer exposes (send/getState/subscribe). */
export type LayerHandle = SignalComponentHandle<unknown, unknown>

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
 * convention users already know from Vike. Consumer augmentations flow
 * through to every callback here without a cast; unaugmented projects
 * fall back to `unknown`.
 *
 * In the signal runtime a component's `init()` takes no data argument, so
 * each layer's `data` slice is used directly as that layer's seed STATE
 * when present; when absent, the layer's own `init()` provides the seed.
 *
 * `lluiLayoutData` is optional and carries per-layer data for the layout
 * chain configured via `createOnRenderClient({ Layout })`. It's indexed
 * outermost-to-innermost, one entry per layout layer.
 */
export interface ClientPageContext {
  Page: AnyLayer
  data?: VikePageContextData
  lluiLayoutData?: readonly unknown[]
  isHydration?: boolean
}

type LayoutChain = ReadonlyArray<AnyLayer>

/**
 * Resolves the layout chain for a given pageContext. A single layout
 * becomes a one-element chain; a function resolver gives callers full
 * control to return different chains for different routes.
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
  return [layoutOption as AnyLayer]
}

/** Resolve a layer's seed state — a present data slice IS the seed state
 * (signal init() takes no data); an absent slice falls back to init(). */
function seedFor(data: unknown): unknown | undefined {
  return data === undefined ? undefined : data
}

/**
 * Page-lifecycle hooks that fire around the dispose → mount cycle on
 * client navigation. With persistent layouts in play the cycle only
 * tears down the *divergent* suffix of the layout chain — any layers
 * shared between the old and new routes stay mounted.
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
   * - A single `SignalComponentDef` — becomes a one-layout chain.
   * - An array of `SignalComponentDef`s — outermost layout first,
   *   innermost layout last. Every layer except the innermost must call
   *   `pageSlot()` in its view to declare where nested content renders.
   * - A function that returns a chain from the current `pageContext`.
   *
   * Layers shared between the previous and next navigation stay mounted.
   * Only the divergent suffix is disposed and re-mounted.
   */
  Layout?: AnyLayer | LayoutChain | ((pageContext: ClientPageContext) => LayoutChain)

  /**
   * Called on the slot element whose contents are about to be replaced,
   * BEFORE the divergent suffix is disposed and re-mounted. The slot's
   * current DOM is still attached when this runs. Return a promise to
   * defer the swap until the animation completes.
   *
   * For a plain no-layout setup, the slot element is the root container.
   * Not called on the initial hydration render.
   */
  onLeave?: (el: HTMLElement) => void | Promise<void>

  /**
   * Called after the new divergent suffix is mounted, on the same slot
   * element that was passed to `onLeave`. Fire-and-forget. Not called on
   * the initial hydration render.
   */
  onEnter?: (el: HTMLElement) => void

  /**
   * Called after mount or hydration completes. Fires on every render
   * including the initial hydration. Receives the live layout chain —
   * `[...layouts, page]`, outermost first — as `LayerHandle`s.
   */
  onMount?: (chain: readonly LayerHandle[]) => void

  /**
   * Called for each surviving layout layer whose `lluiLayoutData[i]`
   * slice changed across a client navigation. Surviving layers stay
   * mounted but need a fresh injection of nav-driven data. You decide how
   * to translate the new data into a message and dispatch it through
   * `handle.send(msg)`.
   *
   * Not called for unchanged slices, not on the initial hydration render,
   * and not for the page layer (it always disposes and remounts, so its
   * `init`/seed receives the fresh data directly).
   */
  onLayerDataChange?: (ctx: {
    def: AnyLayer
    handle: LayerHandle
    newData: unknown
    prevData: unknown
  }) => void

  /**
   * Forwarded to the signal hydrate path for every layer on initial
   * hydration. When `true`, effects returned by each component's `init()`
   * are dispatched post-swap on the client. When `false` (default), they
   * are skipped — the SSR pass already ran them.
   *
   * Subsequent client-side navigation always uses a fresh mount, which
   * always fires init effects regardless of this flag.
   */
  runInitEffectsOnHydrate?: boolean
}

/**
 * Adapt a `TransitionOptions` object into the `onLeave` / `onEnter` pair
 * expected by `createOnRenderClient`.
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
 * the root container; in a layout setup, the innermost surviving layer's
 * `pageSlot()` element.
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
 * `handle` is the SignalComponentHandle returned by mount/hydrate for
 * this layer. `slotAnchor` is set when the layer called `pageSlot()`
 * during its view pass; null for the innermost layer (the page, which
 * has no slot). `slotContexts` snapshots the context values in scope at
 * the slot, replayed into the nested layer's build.
 */
interface ChainEntry {
  def: AnyLayer
  handle: LayerHandle
  slotAnchor: Comment | null
  slotContexts: ReadonlyMap<symbol, unknown> | null
  /**
   * The data slice this layer was most recently mounted or updated with.
   * Compared shallow-key against the next nav's `lluiLayoutData[i]` to
   * decide whether a surviving layer needs `onLayerDataChange` to fire.
   */
  data: unknown
}

/**
 * Live chain of mounted layers — module-level singleton. Vike runs one
 * client-side adapter per browser tab; within one tab a single
 * `chainHandles` array holds the handle for every active layer, indexed
 * `[outermostLayout, ..., innerLayout, page]`. It mutates in place across
 * navigations: shared layout layers stay live, divergent suffix layers
 * dispose, new layers append.
 *
 * Module-level scope is correct for the browser (one consumer per page
 * load); a multi-tenant Node SSR worker importing the client adapter
 * would clobber it — that usage isn't supported.
 */
let chainHandles: ChainEntry[] = []

/**
 * @internal — test helper. Disposes every layer in the current chain and
 * clears the module state so subsequent calls behave as a first mount.
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
 * on first load, mounts fresh on subsequent navs.
 */
export async function onRenderClient(pageContext: ClientPageContext): Promise<void> {
  await renderClient(pageContext, {})
}

/**
 * Factory to create a customized onRenderClient hook. See
 * `RenderClientOptions` for the full option surface.
 *
 * **Do not name your layout file `+Layout.ts`.** Vike reserves the `+`
 * prefix for its own framework config conventions. Name the file
 * `Layout.ts`, `app-layout.ts`, or anywhere outside `/pages` that Vike
 * won't scan, and import it here by path.
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

  // Resolve the chain for this render. The page is always the innermost entry.
  const layoutChain = resolveLayoutChain(options.Layout, pageContext)
  const layoutData = pageContext.lluiLayoutData ?? []
  const newChain: LayoutChain = [...layoutChain, pageContext.Page]
  const newChainData: readonly unknown[] = [...layoutData, pageContext.data]

  if (pageContext.isHydration) {
    // First load — hydrate every layer against server-rendered HTML.
    mountChainSuffix(newChain, newChainData, 0, rootEl, undefined, {
      mode: 'hydrate',
      serverStateEnvelope: window.__LLUI_STATE__,
      runInitEffectsOnHydrate: options.runInitEffectsOnHydrate,
    })
    options.onMount?.(snapshotLayoutChain())
    return
  }

  // Subsequent nav — diff the layout chain to find the divergent suffix.
  //
  // The page (innermost entry) is NEVER a surviving layer: every client
  // navigation disposes the current page and mounts fresh, even when the
  // incoming Page resolves to the same def reference. The persistent-layout
  // feature is about keeping app chrome alive; the page is the thing that
  // changes per route.
  let firstMismatch = 0
  const prevLayoutLen = chainHandles.length === 0 ? 0 : chainHandles.length - 1
  const minLen = Math.min(prevLayoutLen, layoutChain.length)
  while (firstMismatch < minLen && chainHandles[firstMismatch]!.def === newChain[firstMismatch]) {
    firstMismatch++
  }

  // Push fresh data into surviving layers (the shared prefix). The
  // user-supplied `onLayerDataChange` receives the layer def, its handle,
  // and the new + previous data slices; it typically dispatches a message
  // through `handle.send`. Unchanged slices are skipped. Layouts-only by
  // construction (firstMismatch is bounded by layoutChain.length).
  for (let i = 0; i < firstMismatch; i++) {
    const entry = chainHandles[i]!
    const newData = newChainData[i]
    if (!hasDataChanged(entry.data, newData)) continue
    const prevData = entry.data
    entry.data = newData
    if (options.onLayerDataChange) {
      options.onLayerDataChange({ def: entry.def, handle: entry.handle, newData, prevData })
    }
  }

  // `firstMismatch === 0` means a root swap (no layouts, or all diverging);
  // otherwise the surviving layer at firstMismatch-1 owns the slot we mount into.
  const isRootSwap = firstMismatch === 0

  // onLeave runs BEFORE any teardown — outgoing DOM still mounted. Skip on the
  // very first mount (no outgoing page to leave).
  const isFirstMount = chainHandles.length === 0
  if (options.onLeave && !isFirstMount) {
    const leaveTargetEl = isRootSwap
      ? rootEl
      : (chainHandles[firstMismatch - 1]!.slotAnchor?.parentElement ?? rootEl)
    await options.onLeave(leaveTargetEl)
  }

  // Dispose the divergent suffix, innermost first. Each handle.dispose() runs
  // the layer's teardowns; anchor-mounted layers also remove their owned DOM
  // region (anchor → end sentinel). For a root swap the container is cleared
  // explicitly below since a container mount's dispose doesn't remove DOM.
  for (let i = chainHandles.length - 1; i >= firstMismatch; i--) {
    chainHandles[i]!.handle.dispose()
  }
  chainHandles = chainHandles.slice(0, firstMismatch)
  if (isRootSwap && !isFirstMount) rootEl.replaceChildren()

  // Mount the new suffix starting at firstMismatch.
  const mountTarget: HTMLElement | Comment =
    firstMismatch === 0 ? rootEl : chainHandles[firstMismatch - 1]!.slotAnchor!
  const mountContexts =
    firstMismatch === 0 ? undefined : (chainHandles[firstMismatch - 1]!.slotContexts ?? undefined)
  mountChainSuffix(newChain, newChainData, firstMismatch, mountTarget, mountContexts, {
    mode: 'mount',
  })

  // onEnter fires after the new suffix is in place. Fire-and-forget.
  if (options.onEnter) {
    const enterTargetEl = isRootSwap
      ? rootEl
      : (chainHandles[firstMismatch - 1]!.slotAnchor?.parentElement ?? rootEl)
    options.onEnter(enterTargetEl)
  }
  options.onMount?.(snapshotLayoutChain())
}

/**
 * Public read of the current layout chain — live `LayerHandle`s for
 * `[...layouts, page]`, outermost first. Empty before the first mount.
 */
export function getLayoutChain(): readonly LayerHandle[] {
  return snapshotLayoutChain()
}

function snapshotLayoutChain(): readonly LayerHandle[] {
  return chainHandles.map((entry) => entry.handle)
}

interface MountOpts {
  mode: 'mount' | 'hydrate'
  /** For hydration: the full `window.__LLUI_STATE__` envelope. */
  serverStateEnvelope?: unknown
  /** Forwarded to the signal hydrate path. Mount mode ignores. */
  runInitEffectsOnHydrate?: boolean
}

/**
 * Mount (or hydrate) `chain[startAt..end]` into `initialTarget`, replaying
 * `initialContexts` into the first layer's build. Threads each layer's slot
 * (anchor + captured contexts) into the next layer's target + contexts.
 *
 * `initialTarget` is an `HTMLElement` for the outermost layer (container mount/
 * hydrate) and a `Comment` for inner layers mounting relative to a `pageSlot()`
 * anchor.
 *
 * Fails loudly if a non-innermost layer forgot to call `pageSlot()`, or if the
 * innermost layer called `pageSlot()` unnecessarily.
 *
 * @internal — test helper. Exported so `client-page-slot.test.ts` can exercise
 * anchor-mount/dispose contracts directly with hand-built DOM.
 */
export function _mountChainSuffix(
  chain: LayoutChain,
  chainData: readonly unknown[],
  startAt: number,
  initialTarget: HTMLElement | Comment,
  initialContexts: ReadonlyMap<symbol, unknown> | undefined,
  opts: MountOpts,
): void {
  let mountTarget: HTMLElement | Comment = initialTarget
  let contexts: ReadonlyMap<symbol, unknown> | undefined = initialContexts

  for (let i = startAt; i < chain.length; i++) {
    const def = chain[i]!
    const layerData = chainData[i]
    const isInnermost = i === chain.length - 1

    // Defensive: clear any stale slot from a prior failed mount.
    _resetPendingSlot()

    const isContainer = mountTarget.nodeType === 1
    const target: Element | MountTarget = isContainer
      ? (mountTarget as HTMLElement)
      : { anchor: mountTarget as Comment, mode: opts.mode === 'hydrate' ? 'replace' : 'append' }

    let handle: LayerHandle
    if (opts.mode === 'hydrate') {
      // Each layer pulls its own state slice from the envelope, matched by name
      // so a server/client mismatch throws clearly instead of binding wrong state.
      const layerState = extractHydrationState(opts.serverStateEnvelope, i, chain.length, def)
      handle = hydrateSignalApp(target, def, layerState, {
        runInitEffects: opts.runInitEffectsOnHydrate,
        contexts,
      })
    } else {
      handle = mountSignalComponent(target, def, {
        initialState: seedFor(layerData),
        contexts,
      })
    }

    const slot = _consumePendingSlot()

    if (isInnermost && slot !== null) {
      handle.dispose()
      throw new Error(
        `[llui/vike] <${def.name}> is the innermost component in the chain ` +
          `but called pageSlot(). pageSlot() only belongs in layout components ` +
          `that wrap a nested page or layout — not in the page itself.`,
      )
    }
    if (!isInnermost && slot === null) {
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
      slotContexts: slot?.contexts ?? null,
      data: layerData,
    })

    if (slot !== null) {
      // Next layer mounts relative to this slot's anchor, replaying the
      // contexts captured at the slot so providers above it stay reachable.
      mountTarget = slot.anchor
      contexts = slot.contexts
    }
  }
}

// Internal alias used by renderClient. The public-named export above carries
// the @internal doc.
const mountChainSuffix = _mountChainSuffix

/**
 * Shallow-key data diff for the surviving-layer prop-update path. Returns true
 * when `next` differs from `prev` enough to warrant dispatching the user's
 * `onLayerDataChange` hook.
 */
function hasDataChanged(prev: unknown, next: unknown): boolean {
  if (Object.is(prev, next)) return false
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

/**
 * Pull the per-layer state from the hydration envelope. Supports the chain-aware
 * shape (`{ layouts: [...], page: {...} }`) and the legacy flat shape (the state
 * object itself) for a single-layer page-only render.
 *
 * Throws on envelope shape mismatch — missing entries, wrong component name at a
 * given index — so server/client drift fails loud.
 */
function extractHydrationState(
  envelope: unknown,
  layerIndex: number,
  chainLength: number,
  def: AnyLayer,
): unknown {
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
