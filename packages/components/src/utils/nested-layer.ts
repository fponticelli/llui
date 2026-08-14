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
 *
 * ## Why registration is per-ASPECT
 *
 * A lookup is GLOBAL — it has no notion of which layer asked — so a registration
 * that is right for one consumer can be wrong for another. Concretely, for the
 * `outside` consumer: two sibling popovers open at once, and a click inside the
 * lower one is an outside interaction for the upper one, which must dismiss. If
 * the lower one were registered for `outside`, the upper one's watcher would read
 * that click as "inside a nested layer" and stay open — a flat answer cannot
 * distinguish "nested inside the layer that is asking" from "inside some other
 * open layer". Both popovers still need `focus` + `hide`, where the flat answer
 * IS what is wanted.
 *
 * So a registration names the {@link NestedLayerAspect}s it participates in.
 * `@llui/components`' own portaled overlays register for `focus` + `hide` only:
 * outside-click cooperation between them is already handled — and handled BETTER,
 * because it is ordered — by the dismissable stack, whose `shouldDispatch` limits
 * outside-clicks to the topmost layer. The one exception is an overlay that
 * pushes no dismissable layer at all (a `tooltip` with `closeOnEscape: false`);
 * it has nothing on the stack to speak for it and therefore registers for
 * `outside` too. A surface that pushes no layer AND is not driven by the overlay
 * engine — the `@llui/markdown-editor` floating toolbar, the registry's original
 * caller — wants all three, which is why omitting `aspects` means all three.
 *
 * ## Two limits of a flat registry, both deliberate
 *
 * **An `outside` registration leaks page-wide.** Because the lookup carries no
 * nesting information, ANY live `outside` registration makes an interaction
 * inside it invisible to EVERY open layer, not just to the one it is nested in.
 * Reachable today: an unrelated `tooltip({ closeOnEscape: false })` — the one
 * engine config that reaches the `outside` aspect — open anywhere on the page
 * suppresses an open `select`'s outside-dismissal for clicks inside that
 * tooltip, even though the two have nothing to do with each other. That is the
 * accepted price of covering the layerless overlay at all (without it a click
 * inside such a tooltip dismisses the layer beneath it). It is narrow — it needs
 * a non-default config AND a simultaneously-open layer — but it is real. A
 * per-layer registry, where a layer asks "is this nested inside ME?", is the
 * shape that removes it.
 *
 * **`hide` is weaker than `focus`.** {@link setAriaHiddenOutside} snapshots the
 * exempt set ONCE, when the sweep runs, and there is no `MutationObserver`
 * re-running it. So a registration only reaches the sweep if it is live BEFORE
 * the modal opens — in the common ordering (dialog opens, THEN a select inside
 * it) the select's portal content does not exist yet and the sweep never sees
 * it. {@link pushFocusTrap} has no such limit: it re-reads the registry on every
 * Tab, which is why `focus` is the load-bearing half of a non-modal overlay's
 * registration.
 */
const providers = new Set<Provider>()

/**
 * A consumer of the registry. A registration participates only in the aspects it
 * names, because a single global "is this nested?" answer is wrong for at least
 * one consumer in the dialog-with-an-inner-select case (see the module comment).
 *
 * - `outside` — {@link watchInteractOutside} does not treat interactions inside
 *   the layer as outside interactions.
 * - `focus` — {@link pushFocusTrap} includes the layer as an extra focusable
 *   container, so Tab/Shift+Tab can reach it.
 * - `hide` — {@link setAriaHiddenOutside} hides AROUND the layer rather than
 *   hiding it.
 */
export type NestedLayerAspect = 'outside' | 'focus' | 'hide'

/** Every aspect — the default for a registration that names none. */
export const ALL_NESTED_LAYER_ASPECTS: readonly NestedLayerAspect[] = ['outside', 'focus', 'hide']

export interface NestedLayerOptions {
  /**
   * Consumers this registration participates in. Defaults to all of them, which
   * is what a surface with no dismissable layer of its own needs. Narrow it when
   * another mechanism already covers an aspect — see the module comment.
   */
  aspects?: readonly NestedLayerAspect[]
}

interface Provider {
  resolve: () => Element[]
  aspects: readonly NestedLayerAspect[]
}

/**
 * Register `source` (an element, array of elements, or a resolver returning
 * either) as a nested layer. Returns a cleanup that removes the registration.
 *
 * Prefer the resolver form for a portaled overlay: register once on mount and
 * return the live root only while open (`[]` when closed), so a single
 * registration tracks the overlay's open/closed lifecycle without churn.
 */
export function registerNestedLayer(source: ElementSource, opts?: NestedLayerOptions): () => void {
  const provider: Provider = {
    resolve: () => resolveElements(source),
    aspects: opts?.aspects ?? ALL_NESTED_LAYER_ASPECTS,
  }
  providers.add(provider)
  return () => {
    providers.delete(provider)
  }
}

/**
 * Currently-registered nested-layer elements (resolvers re-read live). With an
 * `aspect`, only registrations that participate in it; without one, all of them.
 */
export function getNestedLayers(aspect?: NestedLayerAspect): Element[] {
  if (providers.size === 0) return []
  const out: Element[] = []
  for (const provider of providers) {
    if (aspect !== undefined && !provider.aspects.includes(aspect)) continue
    out.push(...provider.resolve())
  }
  return out
}

/**
 * Whether `target` is inside (or equal to) a registered nested layer that
 * participates in `aspect` (any layer when `aspect` is omitted).
 */
export function isInNestedLayer(target: Node | null, aspect?: NestedLayerAspect): boolean {
  if (!target || providers.size === 0) return false
  return isInAnyElement(target, getNestedLayers(aspect))
}

/** @internal — tests only */
export function _nestedLayerCount(): number {
  return providers.size
}
