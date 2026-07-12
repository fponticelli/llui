import type { Deps, InternalSend, Runner } from '../core.js'
import type { IntervalEffect } from '../types.js'

function runInterval(
  effect: IntervalEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): void {
  const { cancelControllers } = deps.registry
  // Clear any existing interval on the same key
  const existing = cancelControllers.get(effect.key)
  if (existing) existing.abort()

  const ctrl = new AbortController()
  cancelControllers.set(effect.key, ctrl)
  // Stop when EITHER the mount aborts or this interval's controller aborts, via a
  // single derived signal (no manual listener retained on `componentSignal`).
  const stopSignal = AbortSignal.any([componentSignal, ctrl.signal])

  const timer = setInterval(() => {
    if (stopSignal.aborted) {
      clearInterval(timer)
      return
    }
    send(effect.msg as Record<string, unknown>)
  }, effect.ms)

  stopSignal.addEventListener(
    'abort',
    () => {
      clearInterval(timer)
      if (cancelControllers.get(effect.key) === ctrl) cancelControllers.delete(effect.key)
    },
    { once: true },
  )
}

export const intervalRunner: Runner = {
  types: ['interval'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runInterval(effect as IntervalEffect, send, signal, deps)
  },
}
