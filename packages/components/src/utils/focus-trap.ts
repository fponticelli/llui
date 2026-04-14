import { resolveElements, type ElementSource } from './dom.js'
import { getFocusables } from './focusables.js'

export interface FocusTrapOptions {
  /** The container whose focusable descendants form the trap. */
  container: ElementSource
  /** Element to focus when the trap activates. Defaults to first focusable. */
  initialFocus?: Element | (() => Element | null)
  /** Restore focus to the previously active element on release (default: true). */
  restoreFocus?: boolean
}

interface Trap {
  container: ElementSource
}

const stack: Trap[] = []
let keyListenerAttached = false

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const top = stack[stack.length - 1]
  if (!top) return
  const containers = resolveElements(top.container)
  if (containers.length === 0) return

  // Combine focusables from all container elements.
  const focusables: HTMLElement[] = []
  for (const c of containers) focusables.push(...getFocusables(c))
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusables[0]!
  const last = focusables[focusables.length - 1]!
  const active = document.activeElement as HTMLElement | null
  const isInside = active ? containers.some((c) => c.contains(active)) : false

  if (event.shiftKey) {
    if (!isInside || active === first) {
      event.preventDefault()
      last.focus()
    }
  } else {
    if (!isInside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

function ensureListener(): void {
  if (keyListenerAttached || typeof document === 'undefined') return
  document.addEventListener('keydown', handleKeydown, true)
  keyListenerAttached = true
}

function maybeRemoveListener(): void {
  if (stack.length > 0 || !keyListenerAttached || typeof document === 'undefined') return
  document.removeEventListener('keydown', handleKeydown, true)
  keyListenerAttached = false
}

/**
 * Push a focus trap onto the stack. Tab/Shift+Tab will cycle within the
 * container's focusable descendants. Returns a cleanup that removes the
 * trap and (optionally) restores focus to the element active before push.
 */
export function pushFocusTrap(opts: FocusTrapOptions): () => void {
  const restoreFocus = opts.restoreFocus !== false
  const previouslyFocused = restoreFocus ? (document.activeElement as HTMLElement | null) : null
  ensureListener()

  const trap: Trap = { container: opts.container }
  stack.push(trap)

  // Move focus inside the trap
  const containers = resolveElements(opts.container)
  const initial =
    typeof opts.initialFocus === 'function' ? opts.initialFocus() : (opts.initialFocus ?? null)
  if (initial && initial instanceof HTMLElement) {
    initial.focus()
  } else if (containers.length > 0) {
    const focusables = getFocusables(containers[0]!)
    focusables[0]?.focus()
  }

  return () => {
    const idx = stack.indexOf(trap)
    if (idx !== -1) stack.splice(idx, 1)
    maybeRemoveListener()
    if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus()
    }
  }
}

/** @internal — tests only */
export function _focusTrapStackSize(): number {
  return stack.length
}
