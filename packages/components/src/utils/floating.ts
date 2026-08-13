import {
  computePosition,
  autoUpdate,
  platform as domPlatform,
  offset as offsetMw,
  flip as flipMw,
  shift as shiftMw,
  arrow as arrowMw,
  type Placement,
  type Middleware,
} from '@floating-ui/dom'

/**
 * Thin wrapper around `@floating-ui/dom` for anchored positioning. Used by
 * popover, tooltip, menu, and any other component that attaches a floating
 * element to an anchor.
 *
 * Returns a cleanup function that removes scroll/resize listeners and stops
 * position updates.
 */

export type { Placement }

import type { TextDirection } from './direction.js'

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

/**
 * Position `floating` relative to `anchor` with live updates on scroll/resize.
 * Applies `left` + `top` styles to the floating element. Returns a cleanup.
 */
export function attachFloating(opts: FloatingOptions): () => void {
  const {
    anchor,
    floating,
    placement = 'bottom',
    offset = 0,
    flip = true,
    shift = true,
    dir,
    arrow,
    onUpdate,
  } = opts

  const platform = dir === undefined ? undefined : directedPlatform(dir)

  const middleware: Middleware[] = []
  if (offset > 0) middleware.push(offsetMw(offset))
  if (flip) middleware.push(flipMw())
  if (shift !== false) {
    const padding = typeof shift === 'object' ? (shift.padding ?? 8) : 8
    middleware.push(shiftMw({ padding }))
  }
  if (arrow) middleware.push(arrowMw({ element: arrow }))

  floating.style.position = 'absolute'
  floating.style.top = '0'
  floating.style.left = '0'

  const update = (): void => {
    void computePosition(anchor, floating, {
      placement,
      middleware,
      ...(platform ? { platform } : {}),
    }).then(({ x, y, placement: actual, middlewareData }) => {
      floating.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
      floating.dataset.placement = actual
      if (arrow && middlewareData.arrow) {
        const { x: ax, y: ay } = middlewareData.arrow
        if (ax != null) arrow.style.left = `${ax}px`
        if (ay != null) arrow.style.top = `${ay}px`
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

  return autoUpdate(anchor, floating, update)
}
