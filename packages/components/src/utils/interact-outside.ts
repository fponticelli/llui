import { resolveElements, isInAnyElement, type ElementSource } from './dom'

export interface InteractOutsideOptions {
  /** Element(s) that define the "inside" region. */
  element: ElementSource
  /** Additional elements whose interactions should not count as outside (e.g. triggers). */
  ignore?: ElementSource
  /** Called on pointerdown or focus outside the inside region. */
  onInteractOutside: (event: Event) => void
  /**
   * If provided, called first with the event. Return `false` to suppress the
   * outside callback (for an in-flight layer to claim the event).
   */
  shouldDispatch?: (event: Event) => boolean
}

/**
 * Watch for pointer or focus events outside a given element. Returns a
 * cleanup function. Uses the capture phase so upstream `stopPropagation`
 * calls cannot hide events.
 *
 * - pointerdown (or mousedown/touchstart fallback) triggers "outside" if the
 *   target is not contained by `element` or `ignore`.
 * - focusin triggers "outside" when focus moves outside the element, except
 *   when the new target is in `ignore`.
 */
export function watchInteractOutside(opts: InteractOutsideOptions): () => void {
  if (typeof document === 'undefined') return () => {}

  const handlePointer = (event: Event): void => {
    if (opts.shouldDispatch && !opts.shouldDispatch(event)) return
    const target = event.target as Node | null
    const inside = resolveElements(opts.element)
    if (isInAnyElement(target, inside)) return
    const ignore = opts.ignore ? resolveElements(opts.ignore) : []
    if (isInAnyElement(target, ignore)) return
    opts.onInteractOutside(event)
  }

  const handleFocus = (event: FocusEvent): void => {
    if (opts.shouldDispatch && !opts.shouldDispatch(event)) return
    const target = event.target as Node | null
    const inside = resolveElements(opts.element)
    if (isInAnyElement(target, inside)) return
    const ignore = opts.ignore ? resolveElements(opts.ignore) : []
    if (isInAnyElement(target, ignore)) return
    opts.onInteractOutside(event)
  }

  // Prefer pointerdown (unified); fall back already covered by pointer events.
  document.addEventListener('pointerdown', handlePointer, true)
  document.addEventListener('focusin', handleFocus, true)

  return () => {
    document.removeEventListener('pointerdown', handlePointer, true)
    document.removeEventListener('focusin', handleFocus, true)
  }
}
