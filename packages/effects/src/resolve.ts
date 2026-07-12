/**
 * Server-side effect resolver — executes HTTP effects and returns
 * the final state with all data loaded.
 *
 * Used in SSR to pre-load data before rendering. Runs effects in
 * parallel, applies success/error messages to state via update(),
 * and recurses if the responses produce more effects (up to a depth limit).
 */
import { buildRequest, httpStatusToApiError, parseResponse } from './http-core.js'
import type {
  ApiError,
  CancelReplaceEffect,
  DebounceEffect,
  HttpEffect,
  RaceEffect,
  RetryEffect,
  SequenceEffect,
} from './types.js'

type UpdateFn<S, M, E> = (state: S, msg: M) => [S, E[]]

/**
 * Execute a single HTTP effect and return the message its `onSuccess`/`onError`
 * callback produces. Shares the live `http` runner's request/response core, so
 * SSR derives identical requests (headers, content-type, bodies, `responseType`)
 * and passes the response's real `Headers` to `onSuccess`. A rejected fetch
 * (network / timeout) is mapped through `onError` rather than dropped.
 */
async function resolveHttp(effect: HttpEffect): Promise<unknown> {
  const opts = buildRequest(effect)
  if (effect.timeout) opts.signal = AbortSignal.timeout(effect.timeout)

  try {
    const res = await fetch(effect.url, opts)
    if (!res.ok) return effect.onError(await httpStatusToApiError(res))
    const data = await parseResponse(res, effect.responseType)
    return effect.onSuccess(data, res.headers)
  } catch (err: unknown) {
    const error: ApiError =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? { kind: 'timeout' }
        : { kind: 'network', message: err instanceof Error ? err.message : String(err) }
    return effect.onError(error)
  }
}

/** True if the effect is, or transitively wraps, an http effect. */
function containsHttp(effect: { type: string }): boolean {
  switch (effect.type) {
    case 'http':
      return true
    case 'sequence':
    case 'race':
      return (effect as SequenceEffect | RaceEffect).effects.some(containsHttp)
    case 'retry':
      return containsHttp((effect as RetryEffect).inner)
    case 'debounce':
      return containsHttp((effect as DebounceEffect).inner)
    case 'cancel':
      return 'inner' in effect && containsHttp((effect as CancelReplaceEffect).inner)
    default:
      return false
  }
}

/**
 * Resolve one effect (possibly a composite) into the ordered list of messages it
 * would eventually dispatch on the server. Composite shapes are unwrapped
 * recursively so an http effect nested in `sequence`/`race`/`retry`/`cancel`/
 * `debounce` still pre-loads:
 *  - `sequence`  — resolve inner effects in order, concatenating their messages.
 *  - `race`      — resolve the http-bearing racers concurrently; take the first
 *                  to settle (matches the live `race` first-result semantics).
 *  - `retry`     — resolve the inner http once (a failure surfaces via onError).
 *  - `cancel(inner)` / `debounce(inner)` — resolve the wrapped inner effect.
 * Non-http leaf effects (timeouts, storage, log, …) contribute no messages.
 */
async function resolveToMessages(effect: { type: string }): Promise<unknown[]> {
  switch (effect.type) {
    case 'http':
      return [await resolveHttp(effect as unknown as HttpEffect)]
    case 'sequence': {
      const msgs: unknown[] = []
      for (const inner of (effect as SequenceEffect).effects) {
        msgs.push(...(await resolveToMessages(inner)))
      }
      return msgs
    }
    case 'race': {
      const racers = (effect as RaceEffect).effects.filter(containsHttp)
      if (racers.length === 0) return []
      // First racer to settle wins; the rest are ignored (as in the live runner).
      return Promise.race(racers.map((r) => resolveToMessages(r)))
    }
    case 'retry':
      return resolveToMessages((effect as RetryEffect).inner)
    case 'debounce':
      return resolveToMessages((effect as DebounceEffect).inner)
    case 'cancel':
      return 'inner' in effect ? resolveToMessages((effect as CancelReplaceEffect).inner) : []
    default:
      return []
  }
}

/**
 * Execute all HTTP effects reachable from the effect list, apply the resulting
 * messages to state via update(), and return the final loaded state.
 *
 * Http effects nested inside composite builtins (`sequence`/`race`/`retry`/
 * `cancel`/`debounce`) are unwrapped recursively — a `sequence([http(...)])`
 * pre-resolves on the server just like a bare `http(...)`. Top-level effects run
 * in parallel; a `sequence`'s inner effects run in order; messages are applied in
 * effect order. Recurses if the responses produce more effects (up to a depth limit).
 */
export async function resolveEffects<S, M extends { type: string }, E extends { type: string }>(
  state: S,
  effects: E[],
  update: UpdateFn<S, M, E>,
  maxDepth = 3,
): Promise<S> {
  if (maxDepth <= 0 || effects.length === 0) return state

  // Nothing reachable is an http effect — no server pre-loading to do.
  if (!effects.some(containsHttp)) return state

  // Resolve each top-level effect to its ordered messages (top-level in parallel).
  const messageLists = await Promise.all(effects.map((effect) => resolveToMessages(effect)))

  // Apply messages to state in effect order.
  let currentState = state
  const newEffects: E[] = []

  for (const messages of messageLists) {
    for (const msg of messages) {
      const [nextState, moreEffects] = update(currentState, msg as unknown as M)
      currentState = nextState
      newEffects.push(...moreEffects)
    }
  }

  // Recurse for any effects produced by the responses
  if (newEffects.length > 0) {
    return resolveEffects(currentState, newEffects, update, maxDepth - 1)
  }

  return currentState
}
