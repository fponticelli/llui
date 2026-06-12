import { resolveElements, isInAnyElement, type ElementSource } from './dom.js'

/**
 * Shared registry of **nested layers** — portaled, interactive overlay surfaces
 * that are logically nested inside an active dismissable / focus-trap /
 * aria-hidden layer but are physically rendered as body-level *sibling* portals.
 *
 * The motivating case: a `@llui/markdown-editor` floating toolbar (or typeahead,
 * context menu, table tools) opened from inside a `dialog.overlay()`. The dialog
 * defines "inside" as its single content element, so an interaction in the
 * sibling portal is mis-classified as "outside" — the dialog dismisses, the
 * portal gets `inert`, and Tab can never reach it. Any component that portals an
 * interactive layer while a dialog is open hits the same trap.
 *
 * An overlay opts out of that misclassification by registering its portal root
 * here on mount (and removing it on unmount). The three outside-aware utilities
 * then treat any registered element as part of the active layer:
 *   - {@link watchInteractOutside} does not dismiss on interaction within it;
 *   - {@link setAriaHiddenOutside} does not `inert` / `aria-hidden` it;
 *   - {@link pushFocusTrap} includes it as an additional focusable container.
 *
 * This mirrors the established `getPersistentElements` pattern (Zag/Ark): a flat
 * global registry rather than per-layer bookkeeping. Registered-but-unconsulted
 * entries are harmless — the registry is only read while an outside-aware layer
 * is active. The resolver form is re-read on every lookup, so an overlay can
 * register once for its lifetime and surface its live root only while open.
 */
const providers = new Set<() => Element[]>()

/**
 * Register `source` (an element, array of elements, or a resolver returning
 * either) as a nested layer. Returns a cleanup that removes the registration.
 *
 * Prefer the resolver form for a portaled overlay: register once on mount and
 * return the live root only while open (`[]` when closed), so a single
 * registration tracks the overlay's open/closed lifecycle without churn.
 */
export function registerNestedLayer(source: ElementSource): () => void {
  const provider = (): Element[] => resolveElements(source)
  providers.add(provider)
  return () => {
    providers.delete(provider)
  }
}

/** All currently-registered nested-layer elements (resolvers re-read live). */
export function getNestedLayers(): Element[] {
  if (providers.size === 0) return []
  const out: Element[] = []
  for (const provider of providers) out.push(...provider())
  return out
}

/** Whether `target` is inside (or equal to) any registered nested layer. */
export function isInNestedLayer(target: Node | null): boolean {
  if (!target || providers.size === 0) return false
  return isInAnyElement(target, getNestedLayers())
}

/** @internal — tests only */
export function _nestedLayerCount(): number {
  return providers.size
}
