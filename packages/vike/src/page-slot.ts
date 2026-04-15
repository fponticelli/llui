import type { Scope } from '@llui/dom'
import { getRenderContext, createScope } from '@llui/dom/internal'

// @llui/dom/internal is the adapter-layer surface: low-level primitives
// (render-context access, scope creation, disposer registration) that
// framework adapters like @llui/vike need to build structural primitives
// on top of. Not part of the public app-author API.

/**
 * Transient handoff between a layout layer's render pass and the vike
 * adapter that's mounting the chain. `pageSlot()` populates this during
 * the layout's view() call; `consumePendingSlot()` reads and clears it
 * immediately after the mount returns. One slot per mount pass — calling
 * `pageSlot()` twice in the same layout is a bug the primitive reports.
 */
interface PendingSlot {
  slotScope: Scope
  marker: HTMLElement
}

let pendingSlot: PendingSlot | null = null

/**
 * Declare where a persistent layout renders its nested content — either
 * a nested layout or the route's page component. The vike adapter's
 * client and server render paths walk the layout chain, and each layer's
 * `pageSlot()` call records the position where the next layer mounts.
 *
 * The slot is a real scope-tree node: the scope it creates is a child
 * of the current render scope, so contexts provided by the layout (via
 * `provide()`) above the slot are reachable from inside the nested
 * page. That's how patterns like a layout-owned toast dispatcher work —
 * the page does `useContext(ToastContext)` and walks up through the
 * slot into the layout's providers.
 *
 * Do NOT name the file `+Layout.ts` — Vike reserves the `+` prefix for
 * its own framework config conventions. Use `Layout.ts`, `app-layout.ts`,
 * or anywhere outside `/pages` that Vike won't scan.
 *
 * ```ts
 * // pages/Layout.ts    ← not +Layout.ts
 * import { component, div, main, header } from '@llui/dom'
 * import { pageSlot } from '@llui/vike/client'
 *
 * export const AppLayout = component<LayoutState, LayoutMsg>({
 *   name: 'AppLayout',
 *   init: () => [{  ...  }, []],
 *   update: layoutUpdate,
 *   view: (h) => [
 *     div({ class: 'app-shell' }, [
 *       header([... persistent chrome ...]),
 *       main([pageSlot()]),    // ← here the page goes
 *     ]),
 *   ],
 * })
 * ```
 *
 * Call exactly once per layout. Calling more than once in a single
 * view throws — a layout with two slots would be ambiguous about which
 * one receives the nested content.
 */
export function pageSlot(): Node[] {
  if (typeof document === 'undefined') {
    // Server path — @llui/dom's renderToString uses jsdom, so document
    // IS defined during SSR, but we guard anyway for safety.
    throw new Error(
      '[llui/vike] pageSlot() called without a DOM environment. ' +
        'Call from inside a component view() that runs during mount, hydrate, or SSR.',
    )
  }
  if (pendingSlot !== null) {
    throw new Error(
      '[llui/vike] pageSlot() was called more than once in the same layout. ' +
        'A layout has exactly one nested-content slot — if you need two independent ' +
        'regions that swap on navigation, build them as sibling nested layouts in ' +
        'the Vike routing tree and use context to share state between them.',
    )
  }
  const ctx = getRenderContext('pageSlot')
  const slotScope = createScope(ctx.rootScope)
  const marker = document.createElement('div')
  marker.dataset.lluiPageSlot = ''
  pendingSlot = { slotScope, marker }
  return [marker]
}

/**
 * @internal — vike adapter only. Read and clear the slot registered by
 * the most recent `pageSlot()` call. Returns null if the layer being
 * mounted didn't call `pageSlot()` (meaning it's the innermost layer
 * and owns no nested content).
 */
export function _consumePendingSlot(): PendingSlot | null {
  const slot = pendingSlot
  pendingSlot = null
  return slot
}

/**
 * @internal — vike adapter only. Reset the pending slot without reading
 * it. Used defensively in error paths to avoid leaking a pending slot
 * registration into a subsequent mount attempt.
 */
export function _resetPendingSlot(): void {
  pendingSlot = null
}
