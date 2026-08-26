import type { Signal, Mountable, Renderable, ElProps, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { pushDismissable } from './dismissable.js'
import { pushFocusTrap } from './focus-trap.js'
import { setAriaHiddenOutside } from './aria-hidden.js'
import { registerNestedLayer, type NestedLayerAspect } from './nested-layer.js'
import { lockBodyScroll } from './remove-scroll.js'
import { attachFloating, type Placement } from './floating.js'
import { getElementByIdInScope } from './root-scope.js'
import { engineFocus } from './engine-focus.js'
import { focusLingeredInside } from './focus-restore.js'
import type { TextDirection } from './direction.js'

/**
 * Shared overlay engine — the single state machine every component `overlay()`
 * declares against. It owns the structure that was previously copy-pasted a
 * dozen times:
 *
 *   SSR-safe portal to `host` (the outer shell — mounted for the component's
 *   lifetime so the mountWhen `show` below lives INSIDE the host)
 *     → `show(mountWhen)` (stay mounted through the exit animation; carries the
 *       optional `transition`, whose `enter`/`leave` therefore receive the REAL
 *       popup content nodes — they sit between this show's anchors in the host,
 *       not the inline portal placeholder)
 *       → an optional persistent block (floating positioning that survives the
 *         exit animation, e.g. popover)
 *       → the interaction phase — either placed directly (single-phase) or
 *         wrapped in an inner `show(visibleWhen)` (two-phase) so interaction
 *         wiring unwinds at the close REQUEST while the node lingers for its
 *         exit animation
 *       → `div(positioner, content())`
 *
 * The interaction phase resolves content and each declared relationship
 * independently
 * (scoped so it still works inside a shadow root; `document`-scoped for the
 * dialog family) and assembles the feature set behind flags:
 * `attachFloating` → `lockBodyScroll` → `setAriaHiddenOutside` → `pushFocusTrap`
 * → `pushDismissable`, plus focus-on-open and focus-restore-on-teardown. Cleanups
 * run LIFO except that modal isolation releases before the focus trap restores,
 * and focus is restored to the declared return target only when it was still
 * inside the overlay
 * at teardown.
 *
 * Each component's `overlay()` is a thin declaration of its defaults over this.
 */

/** The live elements resolved for the interaction phase. */
export interface OverlayElements {
  /** The overlay content element (resolved by `contentId`). */
  content: HTMLElement
  /** Element used only for floating placement. */
  placementAnchor: HTMLElement | null
  /** Elements ignored only by outside-dismissal detection. */
  dismissIgnore: Element[]
  /** Element used only as the explicit focus-return target. */
  focusReturnTarget: HTMLElement | null
  /** The floating element — the nearest `[data-part="positioner"]` ancestor of
   * `content`, or `content` itself when there is no positioner. */
  floating: HTMLElement
}

export interface OverlayFloatingConfig {
  placement: Placement
  offset: number
  flip: boolean
  shift: boolean
  /** CSS selector (within content) for the arrow element to position. */
  arrowSelector?: string
  /** Match the floating element's min-width to the anchor's width. */
  sameWidth?: boolean
  /** Reading direction — a function so it can be peeked at mount time (menu). */
  dir?: TextDirection | (() => TextDirection | undefined)
  /** Attach positioning in the MOUNT phase (survives the exit animation) rather
   * than the interaction phase. Used by popover, whose content stays anchored
   * while the close transition plays. */
  persistent?: boolean
}

export interface OverlayDismissConfig {
  disableEscape?: boolean
  disableOutside?: boolean
  /** Dismiss boundary element (default: `'content'`). `'floating'` extends the
   * boundary to the whole popup (searchable-select's filter input is a sibling
   * of content inside the popup). */
  boundary?: 'content' | 'floating'
  /** Extra side effect after the standard `onDismiss()` — popover refocuses the
   * trigger on dismiss. */
  extra?: (els: OverlayElements) => void
  /**
   * Custom Escape router. When provided it runs for the Escape key instead of
   * the standard `onDismiss()`, letting the component unwind an internal level
   * first — e.g. a menu closes its open submenu before closing the whole menu.
   * Return `false` to let Escape propagate (decline); any other return claims it.
   */
  onEscape?: (els: OverlayElements, event: KeyboardEvent) => boolean | void
}

export interface OverlayFocusTrapConfig {
  initialFocus?: Element | (() => Element | null)
  restoreFocus?: boolean
}

export interface OverlayFocusReturnConfig {
  target: OverlayElementReference
  /** Boundary used to decide whether focus is still "inside" the overlay at
   * teardown (default: `'content'`). */
  boundary?: 'content' | 'floating'
  /** Also treat the return target itself being focused as "inside" (select). */
  allowTargetActive?: boolean
  /** Restore during interaction teardown (default true). Popover opts out and
   * performs its conditional dismissal-time return in `dismiss.extra`. */
  restoreOnTeardown?: boolean
}

/** A live DOM relationship resolved when an overlay's interaction phase mounts. */
export type OverlayElementReference = { id: string } | { resolve: () => Element | null }

/**
 * Independent DOM relationships for an overlay. A declaration must opt into
 * each behavior separately: naming a placement anchor never also changes layer
 * ownership, dismissal, or focus return.
 */
export interface OverlayRelationships {
  placementAnchor?: OverlayElementReference
  nestedLayerOwner?: OverlayElementReference
  dismissIgnore?: readonly OverlayElementReference[]
  focusReturn?: OverlayFocusReturnConfig
}

export interface OverlayEngineOptions<S> {
  state: Signal<S>
  /** Resolved portal host (see `resolvePortalTarget`). */
  host: Element | undefined
  /** The positioner part props spread onto the wrapping `div`. */
  positioner: ElProps
  content: () => Renderable
  contentId: string
  /** Explicit, independent DOM relationships used by this overlay. */
  relationships: OverlayRelationships
  /** Id resolution strategy. `'scope'` (default) resolves within the node's root
   * (shadow-DOM safe); `'document'` uses the global `document` (dialog family). */
  idScope?: 'scope' | 'document'
  /** Keep the node mounted while this holds (through the exit animation). */
  mountWhen: (s: S) => boolean
  /** When provided, the interaction phase is wrapped in an inner `show` gated on
   * this so it unwinds at the close request while the node lingers. */
  visibleWhen?: (s: S) => boolean
  /** Fired when the overlay is dismissed (Escape / outside click). */
  onDismiss: () => void
  /** Fired after the interaction phase has fully unwound, including on dispose. */
  onInteractionEnd?: () => void
  floating?: OverlayFloatingConfig
  dismiss?: OverlayDismissConfig
  focusTrap?: OverlayFocusTrapConfig
  lockScroll?: boolean
  hideSiblings?: boolean
  /**
   * Whether this overlay registers its live content as a NESTED LAYER while the
   * interaction phase is up (see `registerNestedLayer`). Defaults to "this
   * overlay is not modal" — `!(focusTrap || hideSiblings)`.
   *
   * WHY non-modal only. Every one of these overlays portals to a body-level
   * sibling, so an overlay opened from inside an open dialog lands OUTSIDE the
   * dialog's focus trap and its `inert` sweep. Registering makes Tab reach it and
   * keeps it out of the sweep. A MODAL surface must NOT register: it is the layer
   * everything else is nested in, and registering it would let a trap on the
   * layer beneath Tab into it and would make its own CONTENT read as "inside a
   * nested layer" for an overlay open on top of it — so a click anywhere in the
   * dialog's panel would stop dismissing an inner `select`. (`content` is the
   * element registered below, and it is only the panel: `dialog` renders
   * `backdrop`, `positioner` and `content` as three separate parts, so a click
   * on the dialog's BACKGROUND is outside the registered element either way.)
   *
   * The aspects are narrowed further (see below): outside-click cooperation
   * between engine overlays comes from the dismissable STACK, not the registry.
   */
  nestedLayer?: boolean
  /** Element id to focus once the overlay opens. */
  focusOnOpenId?: string
  /** Select the focused input's existing value (searchable-select prefill). */
  focusOnOpenSelect?: boolean
  /**
   * Optional element-level enter/leave transition (from `@llui/transitions` —
   * e.g. `fade({ duration: 150 })`). Threaded onto the OUTER `show(mountWhen)`
   * gate — the single show that keeps the popup content in the DOM — so `enter`
   * animates the content in when the overlay opens and `leave` defers the final
   * unmount until its promise resolves (giving raw-open overlays an exit
   * animation for free).
   *
   * Coordination with the presence (`data-state`) machinery: the JS transition
   * and the CSS presence exit are two mechanisms for the SAME job (defer unmount
   * for the exit animation), gated on mutually-exclusive status transitions — the
   * CSS exit plays on `status: 'closing'`, the JS `leave` fires only when the
   * outer gate finally goes false (`status: 'closed'`). With the components'
   * default `skipAnimations: true` there is no `'closing'` phase, so a supplied
   * transition is the SOLE exit driver — no double-animation, no hang. Supplying
   * BOTH a JS transition AND `skipAnimations: false` would run them in sequence
   * (CSS then JS); keep `skipAnimations` at its default when driving exits with a
   * JS transition.
   */
  transition?: TransitionOptions
}

export function createOverlay<S>(opts: OverlayEngineOptions<S>): Mountable {
  // A modal surface owns the layer everything else nests INSIDE, so it never
  // registers as a nested layer of something else.
  const isModal = opts.focusTrap !== undefined || opts.hideSiblings === true
  const registersNestedLayer = opts.nestedLayer ?? !isModal
  // `focus` + `hide` always: those two consumers have no other mechanism, and
  // they are the ones the dismissable stack says nothing about.
  //
  // `outside` ONLY when this overlay pushes no dismissable layer. With a layer,
  // `shouldDispatch` already limits outside-clicks to the topmost one, which is
  // ORDERED — information the registry does not have and cannot derive from
  // containment. Two SIBLING popovers are open, neither nested in the other: a
  // click inside the lower one is an outside interaction for the upper one and
  // must dismiss it, and only the stack's ordering says so. (Pinned by
  // `overlay-nested-layer.integration.test.ts` — "a pointerdown inside the lower
  // sibling popover dismisses the upper one".) The dialog-with-an-inner-`select`
  // case is NOT what this narrowing protects: that one is covered by `isModal`
  // above, since a modal never registers at all whatever aspects it would have
  // named.
  //
  // Without a layer — a `tooltip` with `closeOnEscape: false` — nothing speaks
  // for the overlay at all, so a click inside it would dismiss the layer beneath.
  const nestedLayerAspects: NestedLayerAspect[] = opts.dismiss
    ? ['focus', 'hide']
    : ['focus', 'hide', 'outside']

  const resolveId = (root: Node, id: string): HTMLElement | null => {
    if (opts.idScope === 'document') {
      return typeof document === 'undefined' ? null : document.getElementById(id)
    }
    return getElementByIdInScope(root, id)
  }

  const resolveReference = (root: Node, ref: OverlayElementReference): Element | null =>
    'id' in ref ? resolveId(root, ref.id) : ref.resolve()

  const warnOwnerBeforePlacementBailout = (root: Node): void => {
    if (!registersNestedLayer || import.meta.env?.DEV !== true) return
    const ownerRef = opts.relationships.nestedLayerOwner
    const owner = ownerRef ? resolveReference(root, ownerRef) : null
    if (owner) return
    const ownerDescription = ownerRef
      ? 'id' in ownerRef
        ? `id "${ownerRef.id}"`
        : 'resolver'
      : 'missing declaration'
    console.warn(
      `[llui/components] Overlay "${opts.contentId}" could not resolve its nested-layer owner (${ownerDescription}). ` +
        'Its placement anchor is also unresolved, so interaction setup is stopping before nested-layer registration. ' +
        'Render the owner for the full overlay interaction lifetime or supply a live owner resolver.',
    )
  }

  const resolveEls = (root: Node): OverlayElements | null => {
    const content = resolveId(root, opts.contentId)
    if (!content) return null
    const placement = opts.relationships.placementAnchor
      ? resolveReference(root, opts.relationships.placementAnchor)
      : null
    const placementAnchor = placement instanceof HTMLElement ? placement : null
    // A declared placement relationship is required. Silently positioning
    // against the content hides a broken trigger/anchor contract.
    if (opts.relationships.placementAnchor && !placementAnchor) {
      warnOwnerBeforePlacementBailout(root)
      return null
    }
    const dismissIgnore = (opts.relationships.dismissIgnore ?? []).flatMap((ref) => {
      const element = resolveReference(root, ref)
      return element ? [element] : []
    })
    const focusReturn = opts.relationships.focusReturn
      ? resolveReference(root, opts.relationships.focusReturn.target)
      : null
    const focusReturnTarget = focusReturn instanceof HTMLElement ? focusReturn : null
    const positioner = content.closest('[data-part="positioner"]') as HTMLElement | null
    const floating = positioner ?? content
    return { content, placementAnchor, dismissIgnore, focusReturnTarget, floating }
  }

  const attachFloatingFor = (els: OverlayElements): (() => void) => {
    const f = opts.floating!
    if (f.sameWidth && els.placementAnchor) {
      els.floating.style.minWidth = `${els.placementAnchor.offsetWidth}px`
    }
    const arrow = f.arrowSelector
      ? (els.content.querySelector(f.arrowSelector) as HTMLElement | null)
      : null
    const dir = typeof f.dir === 'function' ? f.dir() : f.dir
    return attachFloating({
      anchor: els.placementAnchor ?? els.content,
      floating: els.floating,
      placement: f.placement,
      offset: f.offset,
      flip: f.flip,
      shift: f.shift,
      dir,
      arrow: arrow ?? undefined,
    })
  }

  const interactionMount = (): Mountable =>
    onMount((root) => {
      const els = resolveEls(root)
      if (!els) return

      const cleanups: Array<() => void> = []

      // Registered FIRST so it unwinds LAST (cleanups run LIFO): the trap and
      // sweep teardowns below may consult the registry on their way out.
      if (registersNestedLayer) {
        const owner = opts.relationships.nestedLayerOwner
        cleanups.push(
          registerNestedLayer(els.content, {
            aspects: nestedLayerAspects,
            owner: owner ? () => resolveReference(root, owner) : undefined,
          }),
        )
      }
      if (opts.floating && !opts.floating.persistent) {
        cleanups.push(attachFloatingFor(els))
      }
      if (opts.lockScroll) cleanups.push(lockBodyScroll())
      // Apply modal isolation before activating the trap, but register its
      // cleanup after the trap's cleanup. The cleanup list runs LIFO, so this
      // releases an outer dialog from `inert` before the inner trap tries to
      // restore focus into it (#209).
      const releaseModalIsolation = opts.hideSiblings
        ? setAriaHiddenOutside(els.content)
        : undefined
      if (opts.focusTrap) {
        cleanups.push(
          pushFocusTrap({
            container: els.content,
            initialFocus: opts.focusTrap.initialFocus,
            restoreFocus: opts.focusTrap.restoreFocus,
          }),
        )
      }
      if (releaseModalIsolation) cleanups.push(releaseModalIsolation)
      if (opts.dismiss) {
        const d = opts.dismiss
        const boundaryEl = d.boundary === 'floating' ? els.floating : els.content
        cleanups.push(
          pushDismissable({
            element: boundaryEl,
            ignore: () => els.dismissIgnore,
            disableEscape: d.disableEscape,
            disableOutside: d.disableOutside,
            onEscape: d.onEscape ? (event) => d.onEscape!(els, event) : undefined,
            onDismiss: () => {
              opts.onDismiss()
              d.extra?.(els)
            },
          }),
        )
      }

      if (opts.focusOnOpenId) {
        const target = resolveId(root, opts.focusOnOpenId)
        if (target) {
          // Engine-initiated like the restore below, and routed through the same
          // guard for the same reason (#155) — but note this one is DEFENSIVE:
          // no configuration of this engine can observe it today. The reason is
          // the dismissable stack, and ONLY that: every shipped caller of
          // `focusOnOpenId` (`select`, `searchable-select`, `menu`,
          // `context-menu`, `menubar`) also passes `dismiss`, so the layer was
          // pushed a few lines above and is topmost — every OTHER watcher is
          // gated off by `shouldDispatch` before it ever looks at the target.
          //
          // Do NOT extend that argument to the layerless case via the `outside`
          // nested-layer aspect. A `dismiss`-less overlay does register
          // `els.content` for `outside`, but `focusOnOpenId` is free to name an
          // element that is not inside `els.content` — `select` passes
          // `parts.trigger.id`, which is the ANCHOR — and then the registration
          // says nothing about the focus target. That branch is simply not
          // exercised: no shipped overlay combines "no dismissable layer" with
          // `focusOnOpenId`.
          //
          // Narrow the stack argument and this line is what keeps opening a
          // layer from dismissing the one beneath it. Consequently it has no
          // mutation coverage — there is no shipped shape that fails without it.
          engineFocus(target, { preventScroll: true })
          if (opts.focusOnOpenSelect && target instanceof HTMLInputElement) {
            const seed = target.value
            if (seed !== '') target.setSelectionRange(0, seed.length)
          }
        }
      }

      return () => {
        try {
          // Capture whether focus is still inside the overlay BEFORE teardown
          // (focus-trap etc. may move it). Only pull focus back to the declared
          // target when it lingered inside — if the user clicked elsewhere,
          // respect that.
          let doRestore = false
          if (
            opts.relationships.focusReturn &&
            opts.relationships.focusReturn.restoreOnTeardown !== false
          ) {
            doRestore = focusLingeredInside({
              boundary:
                opts.relationships.focusReturn.boundary === 'floating' ? els.floating : els.content,
              anchor: els.focusReturnTarget,
              allowAnchorActive: opts.relationships.focusReturn.allowTargetActive,
            })
          }
          for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
          // `engineFocus`, not a bare `.focus()`: this move is the engine's own
          // bookkeeping and must not read as an outside interaction to a SIBLING
          // layer still open (#155) — the return target is outside every one of them.
          if (doRestore && els.focusReturnTarget) engineFocus(els.focusReturnTarget)
        } finally {
          opts.onInteractionEnd?.()
        }
      }
    })

  const buildInner = (): Renderable => {
    const children: Mountable[] = []
    // Persistent floating (popover): lives with the mounted node so the content
    // stays anchored while the exit animation plays.
    if (opts.floating?.persistent) {
      children.push(
        onMount((root) => {
          const els = resolveEls(root)
          if (!els) return
          return attachFloatingFor(els)
        }),
      )
    }
    if (opts.visibleWhen) {
      children.push(show(opts.state.map(opts.visibleWhen), () => [interactionMount()]))
    } else {
      children.push(interactionMount())
    }
    children.push(div(opts.positioner, opts.content()))
    return children
  }

  // Portal is the OUTER shell (mounted for the component's lifetime); the
  // mountWhen-gated `show` lives INSIDE it so its arm nodes — the real popup
  // content — sit in the portal host. That placement is what lets a supplied
  // `transition` animate (and defer the unmount of) the ACTUAL content: the arm
  // controller hands `enter`/`leave` the content nodes between the show's
  // anchors, not the inline portal placeholder (which a leave would treat as an
  // empty element set, animating and deferring nothing). With no transition the
  // gated swap is synchronous — content mounts on open and is removed on close
  // exactly as before.
  return portal(
    () => [show(opts.state.map(opts.mountWhen), () => buildInner(), undefined, opts.transition)],
    opts.host,
  )
}

/**
 * Merge a consumer-supplied class into a positioner part bag.
 *
 * `createOverlay` BUILDS the positioner `div` itself (`div(opts.positioner,
 * opts.content())`), so a consumer styling an overlay had no way to reach it —
 * the one node in the tree they could not class. That is fine while the opt-in
 * baseline stylesheet is doing the work (it targets
 * `[data-scope][data-part='positioner']` directly), and a real gap for anyone
 * styling with utilities instead, who could not put a `z-index` on the floating
 * wrapper at all.
 *
 * Returns `base` UNCHANGED when no class is supplied, so every existing call
 * site keeps its exact props object and allocates nothing extra on the overlay
 * mount path.
 */
export function positionerProps(base: ElProps, className: string | undefined): ElProps {
  return className === undefined ? base : { ...base, class: className }
}
