import { __currentBuildInfo } from '@llui/dom'

// `@llui/dom`'s `__currentBuildInfo()` is the adapter-layer hook a
// framework adapter like `@llui/vike` uses to participate in the signal build:
// it exposes the in-progress build's `doc` (to create anchor nodes that belong
// to the same document) plus a SNAPSHOT of the context values in scope at the
// call site (so contexts provided ABOVE the slot reach the nested page's
// separate build/mount pass). Not part of the public app-author API.

/**
 * Transient handoff between a layout layer's render pass and the vike
 * adapter that's mounting the chain. `pageSlot()` populates this during
 * the layout's view() call; `_consumePendingSlot()` reads and clears it
 * immediately after the mount returns. One slot per mount pass — calling
 * `pageSlot()` twice in the same layout is a bug the primitive reports.
 */
interface PendingSlot {
  /** the slot's insertion anchor (a `<!-- llui-page-slot -->` comment) */
  anchor: Comment
  /**
   * Snapshot of the context values in scope at the `pageSlot()` call site.
   * The adapter replays these into the NESTED layer's build (via the signal
   * `contexts` mount/render option) so a layout-provided context — e.g. a
   * toast dispatcher provided ABOVE the slot — is reachable from inside the
   * nested page, even though the page builds in a separate pass.
   */
  contexts: ReadonlyMap<symbol, unknown>
}

let pendingSlot: PendingSlot | null = null

/**
 * Declare where a persistent layout renders its nested content — either
 * a nested layout or the route's page component. The vike adapter's
 * client and server render paths walk the layout chain, and each layer's
 * `pageSlot()` call records the position where the next layer mounts.
 *
 * Emits a single `<!-- llui-page-slot -->` comment as an insertion
 * anchor. The nested layer's DOM lives as siblings of this comment
 * within the layout's own parent element; a synthesized end sentinel
 * (`<!-- llui-mount-end -->`) brackets the owned region.
 *
 * Contexts provided by the layout (via `provide()`) ABOVE the slot are
 * reachable from inside the nested page: `pageSlot()` snapshots the
 * in-scope context values and the adapter replays them into the nested
 * layer's build. That's how patterns like a layout-owned toast
 * dispatcher work — the page does `useContext(ToastContext)` and reads
 * the value the layout provided above the slot.
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
 *   init: () => ({  ...  }),
 *   update: layoutUpdate,
 *   view: ({ send }) => [
 *     div({ class: 'app-shell' }, [
 *       header([...]),
 *       main([pageSlot()]),    // ← here the page goes (no wrapper div)
 *     ]),
 *   ],
 * })
 * ```
 *
 * Returns the anchor comment as a single `Node` — drop it straight into
 * a children array (`main([pageSlot()])`); no spread needed.
 *
 * Call exactly once per layout. Calling more than once in a single
 * view throws.
 */
export function pageSlot(): Node {
  if (pendingSlot !== null) {
    throw new Error(
      '[llui/vike] pageSlot() was called more than once in the same layout. ' +
        'A layout has exactly one nested-content slot — if you need two independent ' +
        'regions that swap on navigation, build them as sibling nested layouts in ' +
        'the Vike routing tree and use context to share state between them.',
    )
  }
  const info = __currentBuildInfo()
  if (!info) {
    throw new Error(
      '[llui/vike] pageSlot() was called outside a signal build. It must run inside ' +
        'a layout component view rendered by the @llui/vike adapter.',
    )
  }
  const anchor = info.doc.createComment('llui-page-slot') as Comment
  pendingSlot = { anchor, contexts: info.contexts }
  return anchor
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
