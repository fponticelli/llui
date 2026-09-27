import type { Signal, Mountable, Renderable, ElProps, TransitionOptions } from '@llui/dom'
import { show, portal, onMount, div, LluiFrameworkError } from '@llui/dom'
import { pushDismissable } from './dismissable.js'
import { pushFocusTrap } from './focus-trap.js'
import { setAriaHiddenOutside } from './aria-hidden.js'
import { registerNestedLayer, type NestedLayerAspect } from './nested-layer.js'
import { lockBodyScroll } from './remove-scroll.js'
import {
  attachFloating,
  snapshotInlineStyle,
  restoreInlineStyles,
  type Placement,
} from './floating.js'
import { getElementByIdInScope } from './root-scope.js'
import { engineFocus } from './engine-focus.js'
import { focusLingeredInside } from './focus-restore.js'
import { resolveDir, watchDirection, type TextDirection } from './direction.js'

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

/** Floating elements whose `dir` the engine itself wrote, so a later read
 * can tell its own write from a consumer's. */
const engineWrittenDir = new WeakSet<Element>()

/** The `ltr`/`rtl` the CONSUMER wrote on an overlay's content, if any. */
function consumerContentDir(content: Element): TextDirection | undefined {
  if (engineWrittenDir.has(content)) return undefined
  const dir = content.getAttribute('dir')
  return dir === 'ltr' || dir === 'rtl' ? dir : undefined
}

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
  /**
   * Preferred placement. A function so it can be resolved AT ATTACH TIME
   * (#265 A4) — a per-level submenu chooses its physical side (`right-start`
   * under 'ltr', `left-start` under 'rtl') from the reading direction in
   * effect when the level opens, the same way `dir` below is already
   * resolved lazily rather than captured at declaration time.
   */
  placement: Placement | (() => Placement)
  offset: number
  flip: boolean
  shift: boolean
  /** CSS selector (within content) for the arrow element to position. */
  arrowSelector?: string
  /** Match the floating element's min-width to the anchor's width. */
  sameWidth?: boolean
  /**
   * An EXPLICIT reading direction — a function so it can be peeked at attach
   * time (menu). Return `undefined` (or omit it) while direction is automatic:
   * the engine then resolves it from the placement ANCHOR, never from where
   * the portal landed (#265 finding 6). Whichever wins is handed to
   * `attachFloating` and written as `dir` on the floating element, so the
   * whole portaled subtree — CSS logical properties, key handlers resolving
   * from `e.currentTarget`, and nested overlays anchored inside it — reads
   * the same direction as the trigger it belongs to.
   */
  dir?: TextDirection | (() => TextDirection | undefined)
  /** Attach positioning in the MOUNT phase (survives the exit animation) rather
   * than the interaction phase. Required when `visibleWhen` unwinds interactions
   * before `mountWhen` releases retained exit content; the engine rejects that
   * two-phase lifetime unless placement persists with the mounted node. */
  persistent?: boolean
  /**
   * Re-run floating attachment (detach then reattach, re-evaluating the
   * `placement`/`dir` thunks fresh) whenever this key's value CHANGES while
   * mounted. Needed because `placement`/`dir` are otherwise resolved ONCE at
   * attach and `autoUpdate` never re-polls them — a physical `placement`
   * string (`'right-start'`) encodes a reading-direction decision that a
   * later `computePosition` pass with the same closed-over string cannot
   * correct (#265 A4: a submenu whose menu tree flips direction while the
   * level stays open must re-place, not just re-run the same geometry). A DOM
   * direction change needs no key — the engine watches the anchor's
   * direction itself; this is for STATE the DOM does not show (an explicit
   * `setDir`).
   *
   * There is no public imperative signal-subscribe seam for framework-internal
   * code running inside a mount callback (`@llui/dom`'s reactivity is
   * binding-driven, not subscription-driven) — a caller declares this key by
   * binding it reactively as a `data-llui-reattach-key` attribute on the
   * content element or an ancestor it controls (`subOverlay` puts it on the
   * positioner it builds), and the engine watches that ATTRIBUTE with a
   * `MutationObserver`, the same declarative-binding-to-DOM-observation idiom
   * `direction.ts:watchDirection` uses in the other direction. The marker is
   * found with `content.closest('[data-llui-reattach-key]')`; supplying
   * `reattachKey` without one is an authoring error (`LluiFrameworkError`).
   */
  reattachKey?: () => string | number
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
  if (opts.floating && opts.visibleWhen && opts.floating.persistent !== true) {
    // An authoring invariant, not a data surprise — a two-phase overlay
    // wired without `persistent: true` cannot be reconciled correctly (the
    // floating attachment would tear down and reattach mid-exit-animation),
    // so this is `LluiFrameworkError` rather than a plain `Error`: it must
    // stay FATAL rather than being contained by any mount error boundary
    // (#265 A5, matching `@llui/dom`'s framework-error taxonomy — see
    // `packages/dom/src/signals/framework-error.ts`).
    throw new LluiFrameworkError(
      '[llui/components] A two-phase overlay requires persistent floating. ' +
        'Mount-scoped positioning preserves resolved geometry while the node is retained for exit; ' +
        'visibility-scoped interaction wiring still unwinds at the close request.',
    )
  }
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

  /**
   * The direction a floating attachment runs under, most specific first: a
   * `dir` the consumer wrote on the CONTENT, the component's EXPLICIT
   * direction, then the placement anchor's resolved one. `undefined` only
   * without any of them, where the floating element's own computed direction
   * is the best there is. The engine owns `dir` on a positioner WRAPPER while
   * attached (its prior value is restored on detach); it never writes over the
   * content's own `dir`.
   */
  const effectiveDir = (els: OverlayElements): TextDirection | undefined => {
    const consumer = consumerContentDir(els.content)
    if (consumer !== undefined) return consumer
    const f = opts.floating!
    const explicit = typeof f.dir === 'function' ? f.dir() : f.dir
    if (explicit !== undefined) return explicit
    return els.placementAnchor ? resolveDir(els.placementAnchor) : undefined
  }

  /** One floating attachment under `dir`; returns its detach. */
  const attachFloatingFor = (
    els: OverlayElements,
    dir: TextDirection | undefined,
  ): (() => void) => {
    const f = opts.floating!
    let restoreSameWidth: (() => void) | undefined
    if (f.sameWidth && els.placementAnchor) {
      const minWidthSnapshot = snapshotInlineStyle(els.floating, 'min-width')
      const hadStyleAttribute = els.floating.hasAttribute('style')
      els.floating.style.minWidth = `${els.placementAnchor.offsetWidth}px`
      restoreSameWidth = () => {
        restoreInlineStyles(els.floating, [minWidthSnapshot], hadStyleAttribute)
      }
    }
    const arrow = f.arrowSelector
      ? (els.content.querySelector(f.arrowSelector) as HTMLElement | null)
      : null
    // Snapshot BEFORE writing: a reattach first restores, so this always
    // reads what the element carried before the engine touched it.
    const priorDir = els.floating.getAttribute('dir')
    // The content's own `dir` is the consumer's: never overwritten, even when
    // the content IS the floating element (no positioner wrapper).
    const writes =
      dir !== undefined && !(els.floating === els.content && consumerContentDir(els.content))
    if (writes) {
      els.floating.setAttribute('dir', dir)
      engineWrittenDir.add(els.floating)
    }
    const restoreDir = (): void => {
      if (!writes) return
      engineWrittenDir.delete(els.floating)
      if (priorDir === null) els.floating.removeAttribute('dir')
      else els.floating.setAttribute('dir', priorDir)
    }
    const placement = typeof f.placement === 'function' ? f.placement() : f.placement
    let stopFloating: () => void
    try {
      stopFloating = attachFloating({
        anchor: els.placementAnchor ?? els.content,
        floating: els.floating,
        stateTarget: els.content,
        placement,
        offset: f.offset,
        flip: f.flip,
        shift: f.shift,
        dir,
        arrow: arrow ?? undefined,
      })
    } catch (error) {
      restoreDir()
      restoreSameWidth?.()
      throw error
    }

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      try {
        stopFloating()
      } finally {
        restoreDir()
        restoreSameWidth?.()
      }
    }
  }

  /**
   * `attachFloatingFor`, re-run (detach, then reattach with fresh
   * `placement`/`dir` thunk calls) whenever what it was resolved from changes
   * while mounted:
   *  - the caller's `reattachKey`, via a `MutationObserver` on the rendered
   *    `[data-llui-reattach-key]` marker (see `OverlayFloatingConfig.reattachKey`);
   *  - the anchor's own direction (`watchDirection` on its ancestor chain), so
   *    an automatic direction follows the app container live. Nested overlays
   *    cascade: rewriting this floating element's `dir` is itself a change on
   *    the ancestor chain of any anchor inside it.
   */
  const attachFloatingWithReattach = (els: OverlayElements): (() => void) => {
    // Resolved ONCE per attach, and the value compared later is the value
    // that was applied.
    let appliedDir = effectiveDir(els)
    let stop = attachFloatingFor(els, appliedDir)
    const reattach = (dir: TextDirection | undefined): void => {
      stop()
      appliedDir = dir
      stop = attachFloatingFor(els, appliedDir)
    }
    const stopWatchingDirection = els.placementAnchor
      ? watchDirection(
          () => els.placementAnchor,
          () => {
            const next = effectiveDir(els)
            if (next !== appliedDir) reattach(next)
          },
        )
      : () => {}
    const reattachKey = opts.floating!.reattachKey
    let mo: MutationObserver | undefined
    if (reattachKey) {
      let lastKey = reattachKey()
      // `closest` (ancestor-or-self), not `querySelector` (descendant): the
      // marker attribute is expected on `content` itself or on an ANCESTOR a
      // caller controls directly (e.g. its own `positioner` override) — a
      // submenu's `contentId` div is built by the CALLER, so `subOverlay`
      // cannot inject a child into it and instead carries the marker on the
      // positioner it does control.
      const marker = els.content.closest<HTMLElement>('[data-llui-reattach-key]')
      if (marker === null) {
        stopWatchingDirection()
        stop()
        throw new LluiFrameworkError(
          `[llui/components] Overlay "${opts.contentId}" declares floating.reattachKey but renders no ` +
            '[data-llui-reattach-key] marker on its content or an ancestor, so the key could never ' +
            'trigger a reattach. Bind the key as a data-llui-reattach-key attribute there.',
        )
      }
      if (typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(() => {
          const nextKey = reattachKey()
          if (nextKey === lastKey) return
          lastKey = nextKey
          reattach(effectiveDir(els))
        })
        mo.observe(marker, { attributes: true, attributeFilter: ['data-llui-reattach-key'] })
      }
    }
    return () => {
      mo?.disconnect()
      stopWatchingDirection()
      stop()
    }
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
        cleanups.push(attachFloatingWithReattach(els))
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
    // Persistent floating lives with the mounted node so the content stays
    // anchored while the exit animation plays. The invariant at the top of
    // `createOverlay` makes this mandatory for every two-phase floating overlay.
    // Same reattach triggers (reattachKey, anchor direction) as the
    // interaction-phase path: persistence changes WHEN it attaches, not what
    // keeps it current.
    if (opts.floating?.persistent) {
      children.push(
        onMount((root) => {
          const els = resolveEls(root)
          if (!els) return
          return attachFloatingWithReattach(els)
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
