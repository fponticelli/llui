import type { Signal, Mountable, Renderable, ElProps } from '@llui/dom'
import { show, portal, onMount, div } from '@llui/dom'
import { pushDismissable } from './dismissable.js'
import { pushFocusTrap } from './focus-trap.js'
import { setAriaHiddenOutside } from './aria-hidden.js'
import { lockBodyScroll } from './remove-scroll.js'
import { attachFloating, type Placement } from './floating.js'
import { getElementByIdInScope } from './root-scope.js'
import type { TextDirection } from './direction.js'

/**
 * Shared overlay engine — the single state machine every component `overlay()`
 * declares against. It owns the structure that was previously copy-pasted a
 * dozen times:
 *
 *   `show(mountWhen)` (stay mounted through the exit animation)
 *     → SSR-safe portal to `host`
 *       → an optional persistent block (floating positioning that survives the
 *         exit animation, e.g. popover)
 *       → the interaction phase — either placed directly (single-phase) or
 *         wrapped in an inner `show(visibleWhen)` (two-phase) so interaction
 *         wiring unwinds at the close REQUEST while the node lingers for its
 *         exit animation
 *       → `div(positioner, content())`
 *
 * The interaction phase resolves the content / anchor / focus elements by id
 * (scoped so it still works inside a shadow root; `document`-scoped for the
 * dialog family) and assembles the feature set behind flags:
 * `attachFloating` → `lockBodyScroll` → `setAriaHiddenOutside` → `pushFocusTrap`
 * → `pushDismissable`, plus focus-on-open and focus-restore-on-teardown. Cleanups
 * always run in reverse (LIFO), and focus is restored to the anchor only when it
 * was still inside the overlay at teardown.
 *
 * Each component's `overlay()` is a thin declaration of its defaults over this.
 */

/** The live elements resolved for the interaction phase. */
export interface OverlayElements {
  /** The overlay content element (resolved by `contentId`). */
  content: HTMLElement
  /** The trigger/anchor element (resolved by `anchorId`), or `null` when absent. */
  anchor: HTMLElement | null
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
}

export interface OverlayFocusTrapConfig {
  initialFocus?: Element | (() => Element | null)
  restoreFocus?: boolean
}

export interface OverlayRestoreFocusConfig {
  /** Boundary used to decide whether focus is still "inside" the overlay at
   * teardown (default: `'content'`). */
  boundary?: 'content' | 'floating'
  /** Also treat the anchor itself being focused as "inside" (select). */
  allowAnchorActive?: boolean
}

export interface OverlayEngineOptions<S> {
  state: Signal<S>
  /** Resolved portal host (see `resolvePortalTarget`). */
  host: Element | undefined
  /** The positioner part props spread onto the wrapping `div`. */
  positioner: ElProps
  content: () => Renderable
  contentId: string
  /** Trigger/anchor element id (floating anchor, dismiss `ignore`, focus restore). */
  anchorId?: string
  /** Bail out of the interaction phase when the anchor can't be resolved. */
  requireAnchor?: boolean
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
  floating?: OverlayFloatingConfig
  dismiss?: OverlayDismissConfig
  focusTrap?: OverlayFocusTrapConfig
  lockScroll?: boolean
  hideSiblings?: boolean
  /** Element id to focus once the overlay opens. */
  focusOnOpenId?: string
  /** Select the focused input's existing value (searchable-select prefill). */
  focusOnOpenSelect?: boolean
  restoreFocus?: OverlayRestoreFocusConfig
}

export function createOverlay<S>(opts: OverlayEngineOptions<S>): Mountable {
  const resolveId = (root: Node, id: string): HTMLElement | null => {
    if (opts.idScope === 'document') {
      return typeof document === 'undefined' ? null : document.getElementById(id)
    }
    return getElementByIdInScope(root, id)
  }

  const resolveEls = (root: Node): OverlayElements | null => {
    const content = resolveId(root, opts.contentId)
    if (!content) return null
    const anchor = opts.anchorId ? resolveId(root, opts.anchorId) : null
    if (opts.requireAnchor && !anchor) return null
    const positioner = content.closest('[data-part="positioner"]') as HTMLElement | null
    const floating = positioner ?? content
    return { content, anchor, floating }
  }

  const attachFloatingFor = (els: OverlayElements): (() => void) => {
    const f = opts.floating!
    if (f.sameWidth && els.anchor) {
      els.floating.style.minWidth = `${els.anchor.offsetWidth}px`
    }
    const arrow = f.arrowSelector
      ? (els.content.querySelector(f.arrowSelector) as HTMLElement | null)
      : null
    const dir = typeof f.dir === 'function' ? f.dir() : f.dir
    return attachFloating({
      anchor: els.anchor ?? els.content,
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

      if (opts.floating && !opts.floating.persistent) {
        cleanups.push(attachFloatingFor(els))
      }
      if (opts.lockScroll) cleanups.push(lockBodyScroll())
      if (opts.hideSiblings) cleanups.push(setAriaHiddenOutside(els.content))
      if (opts.focusTrap) {
        cleanups.push(
          pushFocusTrap({
            container: els.content,
            initialFocus: opts.focusTrap.initialFocus,
            restoreFocus: opts.focusTrap.restoreFocus,
          }),
        )
      }
      if (opts.dismiss) {
        const d = opts.dismiss
        const boundaryEl = d.boundary === 'floating' ? els.floating : els.content
        cleanups.push(
          pushDismissable({
            element: boundaryEl,
            ignore: () => (els.anchor ? [els.anchor] : []),
            disableEscape: d.disableEscape,
            disableOutside: d.disableOutside,
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
          target.focus({ preventScroll: true })
          if (opts.focusOnOpenSelect && target instanceof HTMLInputElement) {
            const seed = target.value
            if (seed !== '') target.setSelectionRange(0, seed.length)
          }
        }
      }

      return () => {
        // Capture whether focus is still inside the overlay BEFORE teardown
        // (focus-trap etc. may move it). Only pull focus back to the anchor when
        // it lingered inside — if the user clicked elsewhere, respect that.
        let doRestore = false
        if (opts.restoreFocus) {
          const active = document.activeElement
          const boundaryEl = opts.restoreFocus.boundary === 'floating' ? els.floating : els.content
          doRestore =
            boundaryEl.contains(active) ||
            (opts.restoreFocus.allowAnchorActive === true && active === els.anchor) ||
            active === document.body ||
            active === null
        }
        for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]!()
        if (doRestore && els.anchor) els.anchor.focus()
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

  return show(opts.state.map(opts.mountWhen), () => [portal(() => buildInner(), opts.host)])
}
