import type { Deps, InternalSend, Runner } from '../core.js'
import type { CancelEffect, CancelReplaceEffect } from '../types.js'

function runCancel(
  effect: CancelEffect | CancelReplaceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): boolean {
  const { cancelControllers, debounceTimers, websockets } = deps.registry
  const existing = cancelControllers.get(effect.token)
  if (existing) {
    existing.abort()
    cancelControllers.delete(effect.token)
  }

  const timer = debounceTimers.get(effect.token)
  if (timer !== undefined) {
    clearTimeout(timer)
    debounceTimers.delete(effect.token)
  }

  const ws = websockets.get(effect.token)
  if (ws) {
    ws.onclose = null // programmatic cancel — don't dispatch app onClose
    ws.close()
    websockets.delete(effect.token)
  }

  if ('inner' in effect && effect.inner) {
    const ctrl = new AbortController()
    cancelControllers.set(effect.token, ctrl)
    // `AbortSignal.any` ties the inner's lifetime to BOTH the mount and this
    // token's controller without hanging a growing listener off `componentSignal`.
    const innerSignal = AbortSignal.any([componentSignal, ctrl.signal])
    deps.dispatch(effect.inner, send, innerSignal, deps)
    return false // the inner effect may dispatch
  }
  return true // bare cancel completes without dispatching
}

export const cancelRunner: Runner = {
  types: ['cancel'],
  // Overridden per-call by `run` (bare cancel → true, cancel-with-inner → false).
  completesWithoutDispatch: true,
  run(effect, send, signal, deps) {
    return runCancel(effect as CancelEffect | CancelReplaceEffect, send, signal, deps)
  },
}
