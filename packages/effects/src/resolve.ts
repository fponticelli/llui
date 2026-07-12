/**
 * Server-side effect resolver — executes HTTP effects and returns
 * the final state with all data loaded.
 *
 * Used in SSR to pre-load data before rendering. Runs effects in
 * parallel, applies success/error messages to state via update(),
 * and recurses if the responses produce more effects (up to a depth limit).
 */
import { buildRequest, httpStatusToApiError, parseResponse } from './http-core.js'
import type { ApiError, BuiltinEffect, HttpEffect } from './types.js'

type UpdateFn<S, M, E> = (state: S, msg: M) => [S, E[]]

/**
 * Execute a single HTTP effect and return the message its `onSuccess`/`onError`
 * callback produces. Shares the live `http` runner's request/response core, so
 * SSR derives identical requests (headers, content-type, bodies, `responseType`)
 * and passes the response's real `Headers` to `onSuccess`. A rejected fetch
 * (network / timeout) is mapped through `onError` rather than dropped.
 */
async function resolveHttp<M>(effect: HttpEffect<M>): Promise<M> {
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

/**
 * Widen an app effect (`{ type: string }`) to the builtin union carrying message
 * type `M`. See the boundary note in {@link resolveEffects} for why this single
 * narrowing is sound. Because the parameter is the concrete erased supertype
 * `{ type: string }` (a supertype of every builtin member), this is a plain
 * downcast — not an `as unknown as` double assertion.
 */
function asBuiltin<M>(effect: { type: string }): BuiltinEffect<M> {
  return effect as BuiltinEffect<M>
}

/** True if the effect is, or transitively wraps, an http effect. */
function containsHttp(effect: BuiltinEffect): boolean {
  switch (effect.type) {
    case 'http':
      return true
    case 'sequence':
    case 'race':
      return effect.effects.some(containsHttp)
    case 'retry':
      return containsHttp(effect.inner)
    case 'debounce':
      return containsHttp(effect.inner)
    case 'cancel':
      return 'inner' in effect && containsHttp(effect.inner)
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
async function resolveToMessages<M>(effect: BuiltinEffect<M>): Promise<M[]> {
  switch (effect.type) {
    case 'http':
      return [await resolveHttp(effect)]
    case 'sequence': {
      const msgs: M[] = []
      for (const inner of effect.effects) {
        msgs.push(...(await resolveToMessages(inner)))
      }
      return msgs
    }
    case 'race': {
      const racers = effect.effects.filter(containsHttp)
      if (racers.length === 0) return []
      // First racer to settle wins; the rest are ignored (as in the live runner).
      return Promise.race(racers.map((r) => resolveToMessages(r)))
    }
    case 'retry':
      return resolveToMessages(effect.inner)
    case 'debounce':
      return resolveToMessages(effect.inner)
    case 'cancel':
      return 'inner' in effect ? resolveToMessages(effect.inner) : []
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

  // The single, deliberate boundary of this module. `E` — the app's effect union —
  // is only constrained to `{ type: string }`, but every effect that carries
  // server-resolvable work is a builtin whose messages are the component's `M`
  // (the link is `update`'s own signature: it maps `M` back to `E[]`). The effect
  // union erases that message type at the container, so the compiler can't recover
  // it from `E` alone; `asBuiltin` re-establishes it once, here. This is sound for
  // the resolver: a genuinely custom (non-builtin) effect matches no `switch` arm
  // in `resolveToMessages` and falls through to `[]`, contributing no messages.
  const builtins = effects.map((effect) => asBuiltin<M>(effect))

  // Nothing reachable is an http effect — no server pre-loading to do.
  if (!builtins.some(containsHttp)) return state

  // Resolve each top-level effect to its ordered messages (top-level in parallel).
  const messageLists = await Promise.all(builtins.map((effect) => resolveToMessages(effect)))

  // Apply messages to state in effect order.
  let currentState = state
  const newEffects: E[] = []

  for (const messages of messageLists) {
    for (const msg of messages) {
      const [nextState, moreEffects] = update(currentState, msg)
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
