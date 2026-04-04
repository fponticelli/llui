import { watchInteractOutside } from './interact-outside'
import type { ElementSource } from './dom'

/**
 * Reason a dismissable layer was closed.
 */
export type DismissSource = 'escape' | 'outside'

export interface DismissableOptions {
  /** The layer element (e.g. a dialog content or popover). */
  element: ElementSource
  /** Trigger / anchor elements that should not count as outside interactions. */
  ignore?: ElementSource
  /** Called when the user dismisses the layer. */
  onDismiss: (source: DismissSource, event: Event) => void
  /** Disable outside-click dismissal (default: false). */
  disableOutside?: boolean
  /** Disable Escape-key dismissal (default: false). */
  disableEscape?: boolean
}

interface Layer {
  element: ElementSource
  handleEscape(event: KeyboardEvent): boolean
}

// Global stack — topmost layer gets to process events first. Only the
// topmost claims the escape key.
const stack: Layer[] = []
let keyListenerAttached = false

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (!top) return
  const claimed = top.handleEscape(event)
  if (claimed) event.stopPropagation()
}

function ensureKeyListener(): void {
  if (keyListenerAttached || typeof document === 'undefined') return
  document.addEventListener('keydown', handleKeydown, true)
  keyListenerAttached = true
}

function maybeRemoveKeyListener(): void {
  if (stack.length > 0 || !keyListenerAttached || typeof document === 'undefined') return
  document.removeEventListener('keydown', handleKeydown, true)
  keyListenerAttached = false
}

/**
 * Register a dismissable layer. Handles Escape (topmost only) and
 * outside-click. Returns a cleanup that removes the layer from the stack.
 */
export function pushDismissable(opts: DismissableOptions): () => void {
  ensureKeyListener()

  const layer: Layer = {
    element: opts.element,
    handleEscape(event) {
      if (opts.disableEscape) return false
      opts.onDismiss('escape', event)
      return true
    },
  }
  stack.push(layer)

  let cleanupOutside: (() => void) | null = null
  if (!opts.disableOutside) {
    cleanupOutside = watchInteractOutside({
      element: opts.element,
      ignore: opts.ignore,
      shouldDispatch: () => stack[stack.length - 1] === layer,
      onInteractOutside: (event) => opts.onDismiss('outside', event),
    })
  }

  return () => {
    const idx = stack.indexOf(layer)
    if (idx !== -1) stack.splice(idx, 1)
    if (cleanupOutside) cleanupOutside()
    maybeRemoveKeyListener()
  }
}

/** @internal — for tests */
export function _dismissableStackSize(): number {
  return stack.length
}
