import { watchInteractOutside } from './interact-outside.js'
import type { ElementSource } from './dom.js'

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
  /**
   * Custom Escape router. When provided it runs for the Escape key INSTEAD of
   * `onDismiss('escape', …)`, letting the layer unwind an internal level first
   * (e.g. a menu closes its open submenu before closing the whole menu). Return
   * `false` to decline — the event is not claimed and propagates as if this
   * layer had `disableEscape`. Any other return (incl. `undefined`) claims it.
   */
  onEscape?: (event: KeyboardEvent) => boolean | void
  /** Disable outside-click dismissal (default: false). */
  disableOutside?: boolean
  /** Disable Escape-key dismissal (default: false). */
  disableEscape?: boolean
}

interface Layer {
  element: ElementSource
  handleEscape(event: KeyboardEvent): boolean
}

// Global stack — topmost layer gets to process events first. Exactly one layer
// CLAIMS the escape key; a layer that declines passes it down.
const stack: Layer[] = []
let keyListenerAttached = false

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  // Walk DOWN from the top until a layer claims the key. Offering it to the top
  // layer alone black-holed Escape whenever that layer declined (`disableEscape`,
  // or an `onEscape` router returning false) — the documented meaning of
  // declining is "propagates", and the layer beneath never saw it (#123).
  // Iterate a SNAPSHOT and re-check membership: a handler runs arbitrary
  // consumer code that may pop layers (its own included) mid-walk.
  const snapshot = stack.slice()
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const layer = snapshot[i]!
    if (!stack.includes(layer)) continue
    if (layer.handleEscape(event)) {
      event.stopPropagation()
      return
    }
  }
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
      if (opts.onEscape) {
        // A router returning `false` declines the key (propagates); anything
        // else (incl. undefined) claims it.
        return opts.onEscape(event) !== false
      }
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
