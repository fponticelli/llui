import type { DebounceEntry, Deps, InternalSend, Runner } from '../core.js'
import type { DebounceEffect } from '../types.js'

function runDebounce(
  effect: DebounceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): void {
  const { debounces, cancelControllers } = deps.registry

  // A dead scope schedules nothing. `addEventListener('abort', …)` on an ALREADY
  // aborted signal never fires, so a one-shot armed here would stay armed with
  // nothing left to clear it — and it could never dispatch anyway.
  if (componentSignal.aborted) return

  // Supersede the pending debounce on this key — its timer AND its listener.
  debounces.get(effect.key)?.cancel()

  /** Give the mount back everything this debounce is holding. Idempotent. */
  const detach = (): void => {
    componentSignal.removeEventListener('abort', onAbort)
    // Only if the entry is still ours: a later keystroke on this key owns it.
    if (debounces.get(effect.key) === entry) debounces.delete(effect.key)
  }

  // Clear on abort rather than merely declining to dispatch when the one-shot
  // fires (issue #77): a timer left armed at `dispose()` pins this closure — and
  // through `deps`, the mount's whole registry — until it expires, and any
  // harness sweeping for live timers after teardown reports it. Same shape as
  // `timeout`/`retry`. Note `componentSignal` is the SCOPE's signal, not always
  // the mount's: a debounce nested in `race`/`cancel(token, inner)` is handed a
  // derived signal that can abort long before the component does.
  const onAbort = (): void => {
    clearTimeout(timer)
    detach()
  }

  const timer = setTimeout(() => {
    // Fired: nothing is left to clear, but the listener must go — a long-lived
    // component would otherwise accumulate one per debounce.
    detach()

    // Belt and braces: `onAbort` clears this timer, so a fired callback should
    // never see an aborted scope — but dispatching into a disposed mount is the
    // one outcome worth a redundant check.
    if (componentSignal.aborted) return

    // Register an abort controller under the debounce key so a later `cancel(key)`
    // can abort the now in-flight inner effect (e.g. the debounced http request),
    // not merely clear a timer that has already fired. Abort any prior in-flight
    // inner under the same key first.
    const prior = cancelControllers.get(effect.key)
    if (prior) prior.abort()
    const ctrl = new AbortController()
    cancelControllers.set(effect.key, ctrl)
    const innerSignal = AbortSignal.any([componentSignal, ctrl.signal])
    ctrl.signal.addEventListener(
      'abort',
      () => {
        if (cancelControllers.get(effect.key) === ctrl) cancelControllers.delete(effect.key)
      },
      { once: true },
    )
    deps.dispatch(effect.inner, send, innerSignal, deps)
  }, effect.ms)

  const entry: DebounceEntry = { cancel: onAbort }
  debounces.set(effect.key, entry)
  componentSignal.addEventListener('abort', onAbort, { once: true })
}

export const debounceRunner: Runner = {
  types: ['debounce'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runDebounce(effect as DebounceEffect, send, signal, deps)
  },
}
