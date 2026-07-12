import type { InternalSend, Runner } from '../core.js'
import type { TimeoutEffect } from '../types.js'

function runTimeout(effect: TimeoutEffect, send: InternalSend, signal: AbortSignal): void {
  const onAbort = (): void => clearTimeout(timer)
  const timer = setTimeout(() => {
    // Drop the abort listener now that the timer has fired — it would otherwise
    // linger on the mount signal until unmount, accumulating per delay().
    signal.removeEventListener('abort', onAbort)
    if (!signal.aborted) send(effect.msg as Record<string, unknown>)
  }, effect.ms)
  signal.addEventListener('abort', onAbort, { once: true })
}

export const timeoutRunner: Runner = {
  types: ['timeout'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runTimeout(effect as TimeoutEffect, send, signal)
  },
}
