// Shared across the runner tests that assert a runner hands back what it took:
// an `'abort'` listener a runner registers for the LIFETIME of one resource must
// go when that resource is done, or a long-lived component accumulates one per
// debounce / per upload for as long as it lives (issue #77).

export type AbortListener = EventListenerOrEventListenerObject

/** The `'abort'` listeners added to / removed from one signal, in order. */
export interface AbortListenerLog {
  added: AbortListener[]
  removed: AbortListener[]
}

/**
 * Wraps ONE signal instance's `addEventListener`/`removeEventListener` so a test
 * can check that everything registered was also unregistered. Installed with
 * `defineProperty` (an own property shadowing the prototype method) so the
 * wrappers are plain values and no cast is needed to satisfy the DOM overload
 * set. Registration still reaches the real signal, so abort behaviour is
 * unchanged while a test observes it.
 */
export function trackAbortListeners(signal: AbortSignal): AbortListenerLog {
  const log: AbortListenerLog = { added: [], removed: [] }
  const add = signal.addEventListener.bind(signal)
  const remove = signal.removeEventListener.bind(signal)
  Object.defineProperty(signal, 'addEventListener', {
    configurable: true,
    value: (type: string, listener: AbortListener, options?: AddEventListenerOptions): void => {
      if (type === 'abort') log.added.push(listener)
      add(type, listener, options)
    },
  })
  Object.defineProperty(signal, 'removeEventListener', {
    configurable: true,
    value: (type: string, listener: AbortListener, options?: EventListenerOptions): void => {
      if (type === 'abort') log.removed.push(listener)
      remove(type, listener, options)
    },
  })
  return log
}
