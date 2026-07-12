// The HUD lifecycle registry — every timer, listener, subscription, nested
// app, and DOM node the HUD spins up registers a teardown here, so `destroy()`
// collapses to a single fold over the registered disposers instead of an
// ad-hoc, easy-to-drift teardown block. Registration order is preserved: the
// registry disposes FIFO (setup order), so callers place the component/DOM
// teardown last simply by registering it last.

/** A registry of teardown callbacks that `destroy()` folds over. */
export interface DisposerRegistry {
  /** Register a teardown callback. Runs once, in registration order, on
   *  `dispose()`. */
  add(dispose: () => void): void
  /** Run every registered disposer once (in registration order). Idempotent —
   *  a second call is a no-op. A throwing disposer doesn't abort the rest. */
  dispose(): void
}

export function createDisposerRegistry(): DisposerRegistry {
  const disposers: Array<() => void> = []
  let disposed = false
  return {
    add(dispose: () => void): void {
      // If teardown already ran, a late registration is disposed immediately so
      // nothing it owns can leak past destroy().
      if (disposed) {
        dispose()
        return
      }
      disposers.push(dispose)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const d of disposers) {
        try {
          d()
        } catch {
          // A failing teardown must not strand the remaining disposers.
        }
      }
      disposers.length = 0
    },
  }
}
