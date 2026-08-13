// The HUD lifecycle registry — every timer, listener, subscription, nested
// app, and DOM node the HUD spins up registers a teardown here, so `destroy()`
// collapses to a single fold over the registered disposers instead of an
// ad-hoc, easy-to-drift teardown block.
//
// Two phases, because the HUD has two kinds of resource:
//   `add`     — peripherals (listeners, timers, subscriptions). Disposed FIFO,
//               in registration order.
//   `addCore` — the mounted component and the DOM it lives in: what every
//               peripheral was built on top of. Disposed after ALL peripherals
//               and in REVERSE registration order, so the component is torn
//               down before the nodes it mounted into (the nodes are appended
//               first and must be removed last).
// The core phase exists so those two can be registered at CREATION time
// instead of in a trailing block: a mount that throws partway can then unwind
// what it already built instead of orphaning it (#115), without disturbing the
// order `destroy()` has always run in.

/** A registry of teardown callbacks that `destroy()` folds over. */
export interface DisposerRegistry {
  /** Register a peripheral teardown. Runs once, in registration order, on
   *  `dispose()` — before every `addCore` teardown. */
  add(dispose: () => void): void
  /** Register a core teardown (the component, the HUD's DOM). Runs after every
   *  `add` teardown, in REVERSE registration order. */
  addCore(dispose: () => void): void
  /** Run every registered disposer once (peripherals in registration order,
   *  then core teardowns in reverse). Idempotent — a second call is a no-op.
   *  A throwing disposer doesn't abort the rest. */
  dispose(): void
}

export function createDisposerRegistry(): DisposerRegistry {
  const disposers: Array<() => void> = []
  const core: Array<() => void> = []
  let disposed = false
  const run = (d: () => void): void => {
    try {
      d()
    } catch {
      // A failing teardown must not strand the remaining disposers.
    }
  }
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
    addCore(dispose: () => void): void {
      if (disposed) {
        dispose()
        return
      }
      core.push(dispose)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const d of disposers) run(d)
      for (let i = core.length - 1; i >= 0; i--) run(core[i]!)
      disposers.length = 0
      core.length = 0
    },
  }
}
