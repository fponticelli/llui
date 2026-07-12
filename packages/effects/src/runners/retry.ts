import type { Deps, InternalSend, Runner } from '../core.js'
import type { ApiError, HttpEffect, RetryEffect } from '../types.js'

/**
 * Default retry predicate: only transient failures are worth re-issuing. A
 * `network`/`timeout`/`ratelimit`/5xx `server` error is retried; an auth
 * (`401`/`403`), `404`, or `validation` (`400`/`422`) error fails fast — retrying
 * it would only hammer the server with a request that can never succeed.
 */
function defaultRetryOn(error: ApiError): boolean {
  return (
    error.kind === 'network' ||
    error.kind === 'timeout' ||
    error.kind === 'ratelimit' ||
    error.kind === 'server'
  )
}

function runRetry(effect: RetryEffect, send: InternalSend, signal: AbortSignal, deps: Deps): void {
  // `RetryEffect.inner` is typed as `HttpEffect` — retry re-issues the request.
  const httpEffect = effect.inner
  const shouldRetry = effect.retryOn ?? defaultRetryOn
  let attempt = 0

  function tryOnce(): void {
    if (signal.aborted) return

    // Wrap the http effect with an intercepted onError
    const wrapped: HttpEffect = {
      ...httpEffect,
      onError: (error: ApiError) => {
        attempt++
        if (attempt < effect.maxAttempts && shouldRetry(error, attempt)) {
          const backoff = effect.delayMs * Math.pow(2, attempt - 1)
          // On a rate-limit error, honor `Retry-After` (seconds): wait at least
          // that long, but never less than the exponential backoff.
          const retryAfterMs =
            error.kind === 'ratelimit' && error.retryAfter ? error.retryAfter * 1000 : 0
          const delay = Math.max(retryAfterMs, backoff)
          const onAbort = (): void => clearTimeout(timer)
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort) // fired — drop the listener
            if (!signal.aborted) tryOnce()
          }, delay)
          signal.addEventListener('abort', onAbort, { once: true })
          return undefined as unknown // message is suppressed
        }
        // Out of attempts, or a non-retriable error — surface the failure.
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
