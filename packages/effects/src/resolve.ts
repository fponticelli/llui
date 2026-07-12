/**
 * Server-side effect resolver — executes HTTP effects and returns
 * the final state with all data loaded.
 *
 * Used in SSR to pre-load data before rendering. Runs effects in
 * parallel, applies success/error messages to state via update(),
 * and recurses if the responses produce more effects (up to a depth limit).
 */
import { buildRequest, httpStatusToApiError, parseResponse } from './http-core.js'
import type { ApiError, HttpEffect } from './types.js'

type UpdateFn<S, M, E> = (state: S, msg: M) => [S, E[]]

/**
 * Execute all HTTP effects from the effect list, apply responses
 * to state via update(), return the final loaded state.
 *
 * Requests are built with the SAME `buildRequest`/`parseResponse` core the live
 * `http` runner uses, so SSR pre-loading derives identical requests (real headers,
 * content-type, pass-through bodies, `responseType`) and passes the response's real
 * `Headers` to `onSuccess`. A rejected fetch (network failure / timeout) is mapped
 * through the effect's `onError` rather than silently dropped, so SSR and the client
 * converge on the same failure state.
 */
export async function resolveEffects<S, M extends { type: string }, E extends { type: string }>(
  state: S,
  effects: E[],
  update: UpdateFn<S, M, E>,
  maxDepth = 3,
): Promise<S> {
  if (maxDepth <= 0 || effects.length === 0) return state

  // Execute HTTP effects in parallel
  const httpEffects = effects.filter((e): e is E & HttpEffect => e.type === 'http')
  if (httpEffects.length === 0) return state

  const results = await Promise.all(
    httpEffects.map(async (effect) => {
      const opts = buildRequest(effect)
      if (effect.timeout) opts.signal = AbortSignal.timeout(effect.timeout)

      try {
        const res = await fetch(effect.url, opts)
        if (!res.ok) {
          return { effect, ok: false as const, error: await httpStatusToApiError(res) }
        }
        const data = await parseResponse(res, effect.responseType)
        return { effect, ok: true as const, data, headers: res.headers }
      } catch (err: unknown) {
        const error: ApiError =
          err instanceof DOMException && err.name === 'TimeoutError'
            ? { kind: 'timeout' }
            : { kind: 'network', message: err instanceof Error ? err.message : String(err) }
        return { effect, ok: false as const, error }
      }
    }),
  )

  // Apply results to state
  let currentState = state
  const newEffects: E[] = []

  for (const result of results) {
    // Use the typed callbacks to construct messages
    const msg = result.ok
      ? (result.effect.onSuccess(result.data, result.headers) as unknown as M)
      : (result.effect.onError(result.error) as unknown as M)

    const [nextState, moreEffects] = update(currentState, msg)
    currentState = nextState
    newEffects.push(...moreEffects)
  }

  // Recurse for any effects produced by the responses
  if (newEffects.length > 0) {
    return resolveEffects(currentState, newEffects, update, maxDepth - 1)
  }

  return currentState
}
