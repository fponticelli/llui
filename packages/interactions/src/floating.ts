import {
  computePosition,
  autoUpdate,
  platform as domPlatform,
  offset as offsetMw,
  flip as flipMw,
  shift as shiftMw,
  size as sizeMw,
  arrow as arrowMw,
  type Placement,
  type Middleware,
} from '@floating-ui/dom'

/**
 * Thin wrapper around `@floating-ui/dom` for anchored positioning. Used by
 * popover, tooltip, menu, and any other component that attaches a floating
 * element to an anchor.
 *
 * Returns a cleanup function that removes scroll/resize listeners, suppresses
 * pending position writes, and restores every inline style/attribute this
 * attachment owns to its exact pre-attachment state.
 */

export type { Placement }

import type { TextDirection } from './direction.js'

type PhysicalSide = 'top' | 'right' | 'bottom' | 'left'

const PHYSICAL_SIDE_BY_PLACEMENT = {
  top: 'top',
  'top-start': 'top',
  'top-end': 'top',
  right: 'right',
  'right-start': 'right',
  'right-end': 'right',
  bottom: 'bottom',
  'bottom-start': 'bottom',
  'bottom-end': 'bottom',
  left: 'left',
  'left-start': 'left',
  'left-end': 'left',
} as const satisfies Record<Placement, PhysicalSide>

const ARROW_STATIC_SIDE_BY_PLACEMENT_SIDE = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
} as const satisfies Record<PhysicalSide, PhysicalSide>

/**
 * One inline style property's exact prior state (present or absent, value and
 * priority), so `restoreInlineStyles` can put it back byte-for-byte rather
 * than merely clearing whatever this attachment wrote. Exported so a caller
 * that imperatively sets a SINGLE inline style outside `attachFloating`
 * itself (`overlay-engine.ts`'s `sameWidth` handling) shares this snapshot
 * discipline instead of re-implementing it (#265 LOW).
 */
export type InlineStyleSnapshot = {
  property: string
  present: boolean
  value: string
  priority: string
}

export function snapshotInlineStyle(element: HTMLElement, property: string): InlineStyleSnapshot {
  let present = false
  for (let index = 0; index < element.style.length; index++) {
    if (element.style.item(index) === property) {
      present = true
      break
    }
  }
  return {
    property,
    present,
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  }
}

export function restoreInlineStyles(
  element: HTMLElement,
  snapshots: readonly InlineStyleSnapshot[],
  hadStyleAttribute: boolean,
): void {
  for (const snapshot of snapshots) {
    if (snapshot.present) {
      element.style.setProperty(snapshot.property, snapshot.value, snapshot.priority)
    } else {
      element.style.removeProperty(snapshot.property)
    }
  }
  if (!hadStyleAttribute && element.style.length === 0) element.removeAttribute('style')
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null): void {
  if (value === null) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

/**
 * The platform floating-ui positions against, with `isRTL` answered by the
 * caller's declared direction instead of the floating element's computed style.
 *
 * `@floating-ui/core` already negates the INLINE-axis alignment when `isRTL`
 * is true, so a `*-start` placement resolves to the inline-start edge on its
 * own. We used to rewrite `bottom-start` → `bottom-end` before handing the
 * placement over; under `<html dir="rtl">` a portaled overlay computes to rtl,
 * so BOTH negations applied and cancelled out, landing the overlay exactly
 * where LTR would (#128). Declaring the direction here keeps it to one
 * negation, and keeps it on the inline axis — the old rewrite also flipped
 * `left-start`/`right-start`, whose alignment runs down the BLOCK axis and is
 * not mirrored by reading direction at all.
 */
function directedPlatform(dir: TextDirection): typeof domPlatform {
  return { ...domPlatform, isRTL: () => dir === 'rtl' }
}

export interface FloatingOptions {
  /** The reference element (trigger/anchor). */
  anchor: Element
  /** The floating element (content). */
  floating: HTMLElement
  /**
   * Element that receives the resolved full `data-placement` and physical
   * `data-side`. Defaults to `floating`. Use a separate content element when
   * `floating` is a geometry-only positioner wrapper.
   */
  stateTarget?: HTMLElement
  /** Preferred placement (default: 'bottom'). */
  placement?: Placement
  /** Gap between anchor and floating, in px (default: 0). */
  offset?: number
  /** Flip to opposite side when there isn't enough room (default: true). */
  flip?: boolean
  /** Shift along axis to stay in view (default: padding 8 unless false). */
  shift?: boolean | { padding?: number }
  /**
   * Reading direction. Under `'rtl'`, logical `*-start`/`*-end` placements
   * track the inline-start/inline-end edges. When given it is AUTHORITATIVE —
   * it overrides the direction the floating element happens to compute to,
   * which for a portaled overlay is the direction of wherever it landed.
   * Omit it to leave that decision to the page, as floating-ui does by default.
   */
  dir?: TextDirection
  /** Optional arrow element to position. */
  arrow?: HTMLElement
  /** Notify after each position computation. */
  onUpdate?: (data: {
    x: number
    y: number
    placement: Placement
    arrow?: { x?: number; y?: number }
  }) => void
}

/** The px space left beside the anchor on the resolved side, published on the
 * floating element so a surface can cap itself with
 * `max-height: var(--llui-floating-available-height, …)` — the LLui
 * counterpart of Radix's `--radix-*-content-available-height`. */
export const FLOATING_AVAILABLE_HEIGHT = '--llui-floating-available-height'
export const FLOATING_AVAILABLE_WIDTH = '--llui-floating-available-width'

/**
 * Position `floating` relative to `anchor` with live updates on scroll/resize.
 * Owns `position`, `top`, `left`, `transform` and the two available-size
 * custom properties ({@link FLOATING_AVAILABLE_HEIGHT}) on `floating`; `position` and
 * all four physical inset properties on an optional arrow; and placement
 * attributes on `stateTarget`. The arrow's static-side inset is half its
 * untransformed layout size, so a square arrow straddles the resolved edge.
 * Cleanup is idempotent, suppresses pending writes/callbacks, and restores the
 * exact prior values (including priority) or absence of those properties.
 */
export function attachFloating(opts: FloatingOptions): () => void {
  const {
    anchor,
    floating,
    stateTarget = floating,
    placement = 'bottom',
    offset = 0,
    flip = true,
    shift = true,
    dir,
    arrow,
    onUpdate,
  } = opts

  const floatingStyles = [
    'position',
    'top',
    'left',
    'transform',
    FLOATING_AVAILABLE_HEIGHT,
    FLOATING_AVAILABLE_WIDTH,
  ].map((property) => snapshotInlineStyle(floating, property))
  const floatingHadStyleAttribute = floating.hasAttribute('style')
  const arrowStyles = arrow
    ? ['position', 'left', 'top', 'right', 'bottom'].map((property) =>
        snapshotInlineStyle(arrow, property),
      )
    : []
  const arrowHadStyleAttribute = arrow?.hasAttribute('style') ?? false
  const priorPlacement = stateTarget.getAttribute('data-placement')
  const priorSide = stateTarget.getAttribute('data-side')
  let disposed = false

  const restore = (): void => {
    restoreInlineStyles(floating, floatingStyles, floatingHadStyleAttribute)
    if (arrow) restoreInlineStyles(arrow, arrowStyles, arrowHadStyleAttribute)
    restoreAttribute(stateTarget, 'data-placement', priorPlacement)
    restoreAttribute(stateTarget, 'data-side', priorSide)
  }

  const platform = dir === undefined ? undefined : directedPlatform(dir)

  const padding = typeof shift === 'object' ? (shift.padding ?? 8) : 8
  /**
   * The middleware for ONE computation. `size` reports the available space
   * through a callback, so each computation gets its own `sink`: two
   * overlapping `autoUpdate` passes can never cross their sizes, and the
   * `.then` that writes a result writes that result's own measurement.
   */
  const middlewareFor = (sink: { width: number; height: number }[]): Middleware[] => {
    const list: Middleware[] = []
    if (offset > 0) list.push(offsetMw(offset))
    if (flip) list.push(flipMw())
    if (shift !== false) list.push(shiftMw({ padding }))
    // After flip/shift, so it measures the side the content actually lands on.
    list.push(
      sizeMw({
        padding,
        apply: ({ availableWidth, availableHeight }) => {
          sink[0] = { width: availableWidth, height: availableHeight }
        },
      }),
    )
    if (arrow) list.push(arrowMw({ element: arrow }))
    return list
  }

  floating.style.position = 'absolute'
  floating.style.top = '0'
  floating.style.left = '0'
  if (arrow) arrow.style.position = 'absolute'

  const update = (): void => {
    if (disposed) return
    const measured: { width: number; height: number }[] = []
    void computePosition(anchor, floating, {
      placement,
      middleware: middlewareFor(measured),
      ...(platform ? { platform } : {}),
    }).then(({ x, y, placement: actual, middlewareData }) => {
      if (disposed) return
      floating.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      const available = measured[0]
      if (available !== undefined) {
        const px = (value: number): string => `${Math.max(0, Math.floor(value))}px`
        floating.style.setProperty(FLOATING_AVAILABLE_HEIGHT, px(available.height))
        floating.style.setProperty(FLOATING_AVAILABLE_WIDTH, px(available.width))
      }
      const actualSide = PHYSICAL_SIDE_BY_PLACEMENT[actual]
      stateTarget.dataset.placement = actual
      stateTarget.dataset.side = actualSide
      if (arrow) {
        for (const property of ['left', 'top', 'right', 'bottom']) {
          arrow.style.removeProperty(property)
        }
        const { x: ax, y: ay } = middlewareData.arrow ?? {}
        if (ax != null) arrow.style.left = `${ax}px`
        if (ay != null) arrow.style.top = `${ay}px`
        const staticSide = ARROW_STATIC_SIDE_BY_PLACEMENT_SIDE[actualSide]
        const staticAxisSize =
          actualSide === 'top' || actualSide === 'bottom' ? arrow.offsetHeight : arrow.offsetWidth
        arrow.style.setProperty(staticSide, `${-staticAxisSize / 2}px`)
      }
      onUpdate?.({
        x,
        y,
        placement: actual,
        arrow: middlewareData.arrow
          ? { x: middlewareData.arrow.x, y: middlewareData.arrow.y }
          : undefined,
      })
    })
  }

  let stopUpdates: () => void
  try {
    stopUpdates = autoUpdate(anchor, floating, update)
  } catch (error) {
    disposed = true
    restore()
    throw error
  }

  return () => {
    if (disposed) return
    disposed = true
    try {
      stopUpdates()
    } finally {
      restore()
    }
  }
}
