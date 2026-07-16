import type { Deps, InternalSend, Runner } from '../core.js'
import type { ApiError, HttpEffect } from '../types.js'
import { buildRequest, httpStatusToApiError, parseResponse } from '../http-core.js'

function runHttp(effect: HttpEffect, send: InternalSend, signal: AbortSignal): void {
  const opts = buildRequest(effect)
  opts.signal = effect.timeout
    ? AbortSignal.any([signal, AbortSignal.timeout(effect.timeout)])
    : signal
  // Fire-and-forget; `httpRequest` guards every send on `signal.aborted`.
  void httpRequest(effect, opts, signal, send)
}

async function httpRequest(
  effect: HttpEffect,
  opts: RequestInit,
  signal: AbortSignal,
  send: InternalSend,
): Promise<void> {
  // GUARDED REGION: only fetch + body-parse + status mapping run here. The
  // success/error message is COMPUTED but the `onSuccess`/`onError` callback and
  // the `send` are deliberately kept OUT of this try, so a throw from the reducer
  // or a message factory is never miscaught and rebranded as a network error.
  let outcome: { ok: true; data: unknown; headers: Headers } | { ok: false; error: ApiError }
  try {
    const res = await fetch(effect.url, opts)
    if (res.ok) {
      const data = await parseResponse(res, effect.responseType)
      outcome = { ok: true, data, headers: res.headers }
    } else {
      outcome = { ok: false, error: await httpStatusToApiError(res) }
    }
  } catch (err: unknown) {
    if (signal.aborted) return
    if (err instanceof DOMException && err.name === 'AbortError') return
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      if (!signal.aborted) send(effect.onError({ kind: 'timeout' }))
      return
    }
    // A body-parse failure on an otherwise-OK response (e.g. a 2xx whose body is
    // not the declared JSON) surfaces as a distinct `parse` error, NOT `network` —
    // the request reached the server and returned 2xx; only decoding failed, so it
    // must not be retried as if the connection dropped.
    if (err instanceof SyntaxError) {
      if (!signal.aborted) send(effect.onError({ kind: 'parse', message: err.message }))
      return
    }
    // A genuine fetch transport failure (DNS/connection/CORS) is a `TypeError`.
    if (err instanceof TypeError) {
      if (!signal.aborted) send(effect.onError({ kind: 'network', message: err.message }))
      return
    }
    // Anything else is genuinely unexpected — surface it rather than swallow it.
    throw err
  }

  // Re-check abort AFTER the body await, immediately before dispatching.
  if (signal.aborted) return
  send(outcome.ok ? effect.onSuccess(outcome.data, outcome.headers) : effect.onError(outcome.error))
}

export const httpRunner: Runner = {
  types: ['http'],
  completesWithoutDispatch: false,
  run(effect, send, signal, _deps: Deps) {
    runHttp(effect as HttpEffect, send, signal)
  },
}
