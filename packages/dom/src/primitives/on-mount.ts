import { getRenderContext } from '../render-context.js'
import { addDisposer } from '../scope.js'

/**
 * Synchronous onMount queue.
 *
 * The render paths that call view() — mountApp, hydrateApp,
 * branch.reconcile, each.createItem — set this to a fresh array before
 * running view() and flush the array synchronously AFTER inserting the
 * rendered nodes into the DOM. This guarantees onMount callbacks run
 * within the same task as the triggering mount/re-render, eliminating
 * the race where a synchronous `document.dispatchEvent(...)` fired
 * immediately after mount would miss the listeners the callback was
 * about to attach.
 *
 * When no queue is active (e.g. `onMount` called from a lazy-loaded
 * component's mount path before the collection scope is in place), the
 * primitive falls back to `queueMicrotask`.
 */
let currentMountQueue: Array<() => void> | null = null

/**
 * Begin collecting onMount callbacks into a fresh queue. Returns the
 * previous queue (if any) so the caller can restore it after flushing —
 * supports nested render paths (e.g. branch.reconcile inside a lazy
 * load inside mountApp).
 */
export function pushMountQueue(): {
  queue: Array<() => void>
  prev: Array<() => void> | null
} {
  const prev = currentMountQueue
  const queue: Array<() => void> = []
  currentMountQueue = queue
  return { queue, prev }
}

/**
 * Restore the previous mount queue. Call after flushing your queue's
 * callbacks. Typically used in a finally block.
 */
export function popMountQueue(prev: Array<() => void> | null): void {
  currentMountQueue = prev
}

/**
 * Flush a queue synchronously. Any callbacks that are still cancelled
 * (because their owning scope was disposed in the meantime) are
 * silently skipped — the callbacks themselves check their cancelled
 * flag.
 */
export function flushMountQueue(queue: Array<() => void>): void {
  for (const fn of queue) fn()
}

export function onMount(callback: (el: Element) => (() => void) | void): void {
  // No-op on the server — event listeners and DOM callbacks are client-only
  if (typeof window === 'undefined') return

  const ctx = getRenderContext('onMount')
  const scope = ctx.rootScope
  const container = ctx.container ?? document.body
  let cancelled = false

  addDisposer(scope, () => {
    cancelled = true
  })

  const fn = (): void => {
    if (cancelled) return
    const cleanup = callback(container)
    if (typeof cleanup === 'function') {
      addDisposer(scope, cleanup)
    }
  }

  if (currentMountQueue) {
    currentMountQueue.push(fn)
  } else {
    // No active collection scope — fall back to the original microtask
    // behavior. Covers edge cases like lazy-loaded components invoking
    // onMount outside the standard mount paths.
    queueMicrotask(fn)
  }
}
