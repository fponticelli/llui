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
 * that is right for one consumer can be wrong for another. Concretely: a `select`
 * open inside a dialog must still dismiss when the user clicks the dialog's own
 * background, but it must also stay Tab-reachable from the dialog's focus trap.
 * Registering the select's content for every consumer at once gets the second and
 * loses the first (the dialog background reads as "inside a nested layer").
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
