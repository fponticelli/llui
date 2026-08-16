import { resolveElements, isInAnyElement, type ElementSource } from './dom.js'

/**
 * Registry of **nested layers** — portaled, interactive overlay surfaces that
 * are logically nested inside an active dismissable / focus-trap / aria-hidden
 * layer but are physically rendered as body-level *sibling* portals.
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
 * then treat a registered element as part of the asking layer:
 *   - {@link watchInteractOutside} does not dismiss on interaction within it;
 *   - {@link setAriaHiddenOutside} does not `inert` / `aria-hidden` it;
 *   - {@link pushFocusTrap} includes it as an additional focusable container.
 *
 * The resolver form is re-read on every lookup, so an overlay can register once
 * for its lifetime and surface its live root only while open.
 *
 * ## The registry is PER-LAYER: a lookup asks "nested inside ME?"
 *
 * It used to be FLAT — a lookup carried no notion of which layer was asking, so
 * every registered layer was exempt from every asking layer. That is the right
 * answer for a layer opened from inside the asker and the WRONG answer for an
 * unrelated sibling, and a flat lookup cannot tell them apart. It cost a real
 * a11y defect (#171): a modal `dialog` opened over an already-open `popover`
 * left that popover NOT `aria-hidden`, NOT `inert`, and Tab-reachable from
 * inside the modal — a fully interactive non-modal layer coexisting with a
 * modal, which is precisely what "modal" is supposed to preclude.
 *
 * So a registration now names its {@link NestedLayerOptions.owner}: the element
 * it is logically nested INSIDE — normally the trigger/anchor that opened it,
 * or the host element it belongs to. A lookup names the asking layer's own
 * boundary (`within`), and a registration is nested in it when its owner is
 * inside that boundary. Nesting is TRANSITIVE: a layer whose owner sits inside
 * another layer that is itself nested in the asker is nested in the asker too
 * (a `tooltip` opened from inside a `select` opened from inside a `dialog`).
 *
 * The DOM answers the question directly — a nested layer's trigger really is
 * rendered inside the layer it belongs to, even though its portal is not — which
 * is why owner containment is the discriminator and not registration order or a
 * dismissable-stack index. Those are timing facts about how the layers happened
 * to open; containment is a fact about what the layers ARE.
 *
 * A lookup that passes NO `within` keeps the flat answer. That is what an
 * unscoped caller (`getNestedLayers()` with no arguments) gets; every consumer
 * inside this package passes its own boundary.
 *
 * ## Why registration is per-ASPECT
 *
 * A registration names the {@link NestedLayerAspect}s it participates in, because
 * a registration that is right for one consumer can be wrong for another.
 * `@llui/components`' own portaled overlays register for `focus` + `hide` only:
 * outside-click cooperation between them is already handled — and handled BETTER,
 * because it is ORDERED — by the dismissable stack, whose `shouldDispatch` limits
 * outside-clicks to the topmost layer. Two sibling popovers are both open and
 * both nested in nothing; the stack still says which one a click belongs to. The
 * one exception is an overlay that pushes no dismissable layer at all (a
 * `tooltip` with `closeOnEscape: false`); it has nothing on the stack to speak
 * for it and therefore registers for `outside` too. A surface that pushes no
 * layer AND is not driven by the overlay engine — the `@llui/markdown-editor`
 * floating toolbar, the registry's original caller — wants all three, which is
 * why omitting `aspects` means all three.
 *
 * ## Ownership fails closed
 *
 * An unowned registration cannot be attributed to any asking layer, so a scoped
 * lookup excludes it. The same is true while a supplied owner resolver returns
 * no element. Development builds warn once per registration with the corrective
 * action. This is deliberately fail-closed: treating an unattributable portal
 * as nested in every modal leaves it visible to assistive technology, interactive
 * through `inert`, and reachable by the modal focus trap. It also puts the
 * provider's elements on the transitive frontier, globally exempting descendants
 * owned inside it. Unscoped lookups still expose every registration for registry
 * inspection; ownership governs only the claim that a layer belongs to an asker.
 *
 * **`hide` is weaker than `focus`.** {@link setAriaHiddenOutside} snapshots the
 * exempt set ONCE, when the sweep runs, and there is no `MutationObserver`
 * re-running it. So a registration only reaches the sweep if it is live BEFORE
 * the modal opens — in the common ordering (dialog opens, THEN a select inside
 * it) the select's portal content does not exist yet and the sweep never sees
 * it. {@link pushFocusTrap} has no such limit: it re-reads the registry on every
 * Tab, which is why `focus` is the load-bearing half of a non-modal overlay's
 * registration. Note the per-layer scoping makes the `hide` sweep STRONGER where
 * it matters most: a layer that IS live before the modal opens is, by that very
 * ordering, usually a sibling — and a sibling is now swept rather than exempted.
 */
const providers = new Set<Provider>()

/**
 * A consumer of the registry. A registration participates only in the aspects it
 * names, because a single answer is wrong for at least one consumer: engine
 * overlays leave `outside` to the ordered dismissable stack (see the module
 * comment).
 *
 * The dialog-with-an-inner-`select` case is NOT what the aspect list protects.
 * That one is covered by a modal never registering AT ALL, whatever aspects it
 * would have named.
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

/**
 * The asking layer's own boundary — what "nested inside ME" is measured against.
 * Omit it for the flat, layer-agnostic answer.
 */
export type NestedLayerScope = ElementSource

export interface NestedLayerOptions {
  /**
   * Consumers this registration participates in. Defaults to all of them, which
   * is what a surface with no dismissable layer of its own needs. Narrow it when
   * another mechanism already covers an aspect — see the module comment.
   */
  aspects?: readonly NestedLayerAspect[]
  /**
   * The element this layer is logically nested INSIDE — its trigger/anchor, or
   * the host element it belongs to. This is what makes the registry per-layer:
   * an asking layer exempts this registration only when the owner is inside the
   * asker's own boundary (transitively through other nested layers).
   *
   * The owner is NOT the layer's portal root — that is the `source` argument.
   * It is the thing in the main document tree that the portal speaks for.
   *
   * Resolver form is supported and re-read on every lookup, so an owner that
   * mounts and unmounts with its component can be named once.
   *
   * A missing or unresolved owner grants no scoped exemption and emits a
   * development warning. Even a registration used only through the unscoped
   * registry-wide view should name its logical owner to keep the contract
   * explicit.
   */
  owner?: ElementSource
}

interface Provider {
  resolve: () => Element[]
  aspects: readonly NestedLayerAspect[]
  owner: ElementSource | undefined
  warnedUnresolvedOwner: boolean
}

/**
 * Register `source` (an element, array of elements, or a resolver returning
 * either) as a nested layer. Returns a cleanup that removes the registration.
 *
 * Prefer the resolver form for a portaled overlay: register once on mount and
 * return the live root only while open (`[]` when closed), so a single
 * registration tracks the overlay's open/closed lifecycle without churn.
 *
 * Pass `opts.owner` when scoped consumers must exempt the layer. Missing or
 * unresolved ownership fails closed and warns in development.
 */
export function registerNestedLayer(source: ElementSource, opts?: NestedLayerOptions): () => void {
  const provider: Provider = {
    resolve: () => resolveElements(source),
    aspects: opts?.aspects ?? ALL_NESTED_LAYER_ASPECTS,
    owner: opts?.owner,
    warnedUnresolvedOwner: false,
  }
  providers.add(provider)
  if (provider.owner === undefined) warnUnresolvedOwner(provider, true)
  return () => {
    providers.delete(provider)
  }
}

/**
 * One lookup's resolved view of the registry.
 *
 * A provider's `source` is resolved AT MOST ONCE per lookup — the fixpoint below
 * re-reads the frontier repeatedly, and a resolver is consumer code.
 *
 * Its `owner` is NOT memoized: `nestedIn` calls `resolveElements(provider.owner)`
 * on every pass for every provider not yet included, so a lookup makes up to
 * ~N²/2 owner-resolver calls for N registrations. That is deliberate — realistic
 * N is ≤5 (≤0.1 ms) and `getNestedLayers` runs on every Tab / pointerdown /
 * focusin, so a second Map costs more than it saves. It does NOT scale: measured
 * on a worst-order chain, N=32 → 528 calls / 2.0 ms, N=64 → 2080 / 1499 ms,
 * N=200 → 12.9 s. If the registry ever holds tens of live layers, memoize the
 * owner the same way — do not discover this from a frame-time regression.
 */
class Lookup {
  private readonly elements = new Map<Provider, Element[]>()

  elementsOf(provider: Provider): Element[] {
    let els = this.elements.get(provider)
    if (els === undefined) {
      els = provider.resolve()
      this.elements.set(provider, els)
    }
    return els
  }

  /**
   * The providers nested inside `within`, to a fixpoint.
   *
   * The frontier starts at the asking layer's own boundary and grows with every
   * layer proved nested inside it, so nesting composes: a `tooltip` whose owner
   * lives inside a `select`'s portal is nested in the `dialog` the select was
   * opened from. The loop runs until nothing new is added, which is why a
   * registration order that puts the inner layer first still resolves.
   */
  nestedIn(within: Element[]): Set<Provider> {
    const included = new Set<Provider>()
    const frontier: Element[] = [...within]
    let grew = true
    while (grew) {
      grew = false
      for (const provider of providers) {
        if (included.has(provider)) continue
        const owners = provider.owner === undefined ? [] : resolveElements(provider.owner)
        if (owners.length === 0) {
          warnUnresolvedOwner(provider, provider.owner === undefined)
          continue
        }
        const nested = owners.some((owner) => isInAnyElement(owner, frontier))
        if (!nested) continue
        included.add(provider)
        frontier.push(...this.elementsOf(provider))
        grew = true
      }
    }
    return included
  }
}

function warnUnresolvedOwner(provider: Provider, missing: boolean): void {
  if (provider.warnedUnresolvedOwner || import.meta.env?.DEV !== true) return
  provider.warnedUnresolvedOwner = true
  console.warn(
    missing
      ? '[llui/interactions] A nested layer was registered without an owner. It receives no focus, modal-isolation, or outside-interaction exemption. Pass `owner` to registerNestedLayer().'
      : '[llui/interactions] A nested layer owner did not resolve. It receives no focus, modal-isolation, or outside-interaction exemption. Keep the owner mounted for the layer interaction lifetime.',
  )
}

/**
 * Currently-registered nested-layer elements (resolvers re-read live).
 *
 * With an `aspect`, only registrations that participate in it; without one, all
 * of them. With a `within` boundary, only registrations nested inside it (see
 * the module comment); without one, the flat, layer-agnostic answer.
 */
export function getNestedLayers(aspect?: NestedLayerAspect, within?: NestedLayerScope): Element[] {
  if (providers.size === 0) return []
  const lookup = new Lookup()
  const scoped = within === undefined ? null : lookup.nestedIn(resolveElements(within))
  const out: Element[] = []
  for (const provider of providers) {
    if (aspect !== undefined && !provider.aspects.includes(aspect)) continue
    if (scoped !== null && !scoped.has(provider)) continue
    out.push(...lookup.elementsOf(provider))
  }
  return out
}

/**
 * Whether `target` is inside (or equal to) a registered nested layer that
 * participates in `aspect` (any layer when `aspect` is omitted) and is nested
 * inside `within` (any layer when `within` is omitted).
 */
export function isInNestedLayer(
  target: Node | null,
  aspect?: NestedLayerAspect,
  within?: NestedLayerScope,
): boolean {
  if (!target || providers.size === 0) return false
  return isInAnyElement(target, getNestedLayers(aspect, within))
}

/** @internal — tests only */
export function _nestedLayerCount(): number {
  return providers.size
}
