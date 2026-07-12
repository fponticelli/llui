import type { Deps, InternalSend, Runner } from '../core.js'
import type { ApiError, HttpEffect, RetryEffect } from '../types.js'

function runRetry(effect: RetryEffect, send: InternalSend, signal: AbortSignal, deps: Deps): void {
  // `RetryEffect.inner` is typed as `HttpEffect` — retry re-issues the request.
  const httpEffect = effect.inner
  let attempt = 0

  function tryOnce(): void {
    if (signal.aborted) return

    // Wrap the http effect with an intercepted onError
    const wrapped: HttpEffect = {
      ...httpEffect,
      onError: (error: ApiError) => {
        attempt++
        if (attempt < effect.maxAttempts) {
          const delay = effect.delayMs * Math.pow(2, attempt - 1)
          const onAbort = (): void => clearTimeout(timer)
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort) // fired — drop the listener
            if (!signal.aborted) tryOnce()
          }, delay)
          signal.addEventListener('abort', onAbort, { once: true })
          return undefined as unknown // message is suppressed
        }
        return httpEffect.onError(error)
      },
    }

    // Use a custom send that suppresses undefined messages (from retry interception)
    const retrySend: InternalSend = (msg: unknown) => {
      if (msg !== undefined) send(msg)
    }

    deps.dispatch(wrapped, retrySend, signal, deps)
  }

  tryOnce()
}

export const retryRunner: Runner = {
  types: ['retry'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runRetry(effect as RetryEffect, send, signal, deps)
  },
}
