import {
  computePosition,
  autoUpdate,
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
  /** Optional arrow element to position. */
  arrow?: HTMLElement
  /** Notify after each position computation. */
  onUpdate?: (data: { x: number; y: number; placement: Placement; arrow?: { x?: number; y?: number } }) => void
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
    arrow,
    onUpdate,
  } = opts

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
    void computePosition(anchor, floating, { placement, middleware }).then(
      ({ x, y, placement: actual, middlewareData }) => {
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
      },
    )
  }

  return autoUpdate(anchor, floating, update)
}
