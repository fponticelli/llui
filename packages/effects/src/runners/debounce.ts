import type { Deps, InternalSend, Runner } from '../core.js'
import type { DebounceEffect } from '../types.js'

function runDebounce(
  effect: DebounceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): void {
  const { debounceTimers, cancelControllers } = deps.registry
  const existing = debounceTimers.get(effect.key)
  if (existing !== undefined) clearTimeout(existing)

  const timer = setTimeout(() => {
    debounceTimers.delete(effect.key)
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

  debounceTimers.set(effect.key, timer)
}

export const debounceRunner: Runner = {
  types: ['debounce'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runDebounce(effect as DebounceEffect, send, signal, deps)
  },
}
