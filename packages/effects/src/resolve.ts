/**
 * Server-side effect resolver — executes HTTP effects and returns
 * the final state with all data loaded.
 *
 * Used in SSR to pre-load data before rendering. Runs effects in
 * parallel, applies success/error messages to state via update(),
 * and recurses if the responses produce more effects (up to a depth limit).
 */
import { httpStatusToApiError, type HttpEffect } from './index.js'

type UpdateFn<S, M, E> = (state: S, msg: M) => [S, E[]]

/**
 * Execute all HTTP effects from the effect list, apply responses
 * to state via update(), return the final loaded state.
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

  const results = await Promise.allSettled(
    httpEffects.map(async (effect) => {
      const opts: RequestInit = {}
      if (effect.method) opts.method = effect.method
      if (effect.body) opts.body = JSON.stringify(effect.body)
      if (effect.headers) opts.headers = effect.headers

      const res = await fetch(effect.url, opts)

      if (!res.ok) {
        const error = await httpStatusToApiError(res)
        return { effect, ok: false as const, error }
      }

      const ct = res.headers.get('content-type') ?? ''
      const data = ct.includes('application/json') ? await res.json() : await res.text()
      return { effect, ok: true as const, data }
    }),
  )

  // Apply results to state
  let currentState = state
  const newEffects: E[] = []

  for (const result of results) {
    if (result.status === 'rejected') continue

    const { effect, ok } = result.value
    // Use the typed callbacks to construct messages
    const msg = ok
      ? (effect.onSuccess(result.value.data, new Headers()) as unknown as M)
      : (effect.onError(result.value.error) as unknown as M)

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
