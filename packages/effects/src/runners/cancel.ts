import type { Deps, InternalSend, Runner } from '../core.js'
import type { CancelEffect, CancelReplaceEffect } from '../types.js'

function runCancel(
  effect: CancelEffect | CancelReplaceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): boolean {
  const { cancelControllers, debounces, websockets } = deps.registry
  const existing = cancelControllers.get(effect.token)
  if (existing) {
    existing.abort()
    cancelControllers.delete(effect.token)
  }

  // `cancel()` clears the one-shot, detaches its abort listener and drops the
  // registry entry — the three moves are one operation by construction (#77).
  debounces.get(effect.token)?.cancel()

  // `close()` silences the socket (a programmatic cancel dispatches no app
  // `onClose`), closes it, detaches its abort listener and drops the registry
  // entry — the four moves are one operation by construction (#83).
  websockets.get(effect.token)?.close()

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
