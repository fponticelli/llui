// ── Async State ──────────────────────────────────────────────────

/** Models the lifecycle of an async operation. */
export type Async<T, E> =
  | { type: 'idle' }
  | { type: 'loading'; stale?: T }
  | { type: 'success'; data: T }
  | { type: 'failure'; error: E }

/** Standard API error type produced by the http() effect. */
export type ApiError =
  | { kind: 'network'; message: string }
  | { kind: 'timeout' }
  | { kind: 'notfound' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'ratelimit'; retryAfter?: number }
  | { kind: 'validation'; fields: Record<string, string[]> }
  | { kind: 'server'; status: number; message: string }

// ── Effect Types ──────────────────────────────────────────────────

export interface HttpEffect {
  type: 'http'
  url: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  onSuccess: string
  onError: string
}

export interface CancelEffect {
  type: 'cancel'
  token: string
}

export interface CancelReplaceEffect {
  type: 'cancel'
  token: string
  inner: BuiltinEffect
}

export interface DebounceEffect {
  type: 'debounce'
  key: string
  ms: number
  inner: BuiltinEffect
}

export interface SequenceEffect {
  type: 'sequence'
  effects: BuiltinEffect[]
}

export interface RaceEffect {
  type: 'race'
  effects: BuiltinEffect[]
}

type BuiltinEffect =
  | HttpEffect
  | CancelEffect
  | CancelReplaceEffect
  | DebounceEffect
  | SequenceEffect
  | RaceEffect

// Re-export for user convenience
export type { BuiltinEffect as Effect }

// ── Builders ──────────────────────────────────────────────────────

export function http(opts: {
  url: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  onSuccess: string
  onError: string
}): HttpEffect {
  return { type: 'http', ...opts }
}

export function cancel(token: string): CancelEffect
export function cancel(token: string, inner: BuiltinEffect): CancelReplaceEffect
export function cancel(token: string, inner?: BuiltinEffect): CancelEffect | CancelReplaceEffect {
  if (inner) return { type: 'cancel', token, inner }
  return { type: 'cancel', token }
}

export function debounce(key: string, ms: number, inner: BuiltinEffect): DebounceEffect {
  return { type: 'debounce', key, ms, inner }
}

export function sequence(effects: BuiltinEffect[]): SequenceEffect {
  return { type: 'sequence', effects }
}

export function race(effects: BuiltinEffect[]): RaceEffect {
  return { type: 'race', effects }
}

// ── Handler Chain ─────────────────────────────────────────────────

// Internal send type — widened for dynamic message creation (http onSuccess/onError)
type InternalSend = (msg: Record<string, unknown>) => void
type InternalHandler = (effect: { type: string }, send: InternalSend, signal: AbortSignal) => void

export interface EffectCtx<E, M> {
  effect: E
  send: (msg: M) => void
  signal: AbortSignal
}

/** Plugin handler — returns true if the effect was handled, false to pass through. */
export type EffectPlugin<E, M> = (ctx: EffectCtx<E, M>) => boolean

interface EffectChain<E extends { type: string }, M> {
  /** Add a plugin that handles specific effects. Returns true if handled, false to pass through. */
  use<E2, M2>(plugin: EffectPlugin<E2, M2>): EffectChain<E, M>
  /** Terminal handler for remaining effects. Returns the final onEffect function. */
  else(handler: (ctx: EffectCtx<E, M>) => void): (ctx: EffectCtx<E, M>) => void
}

export function handleEffects<E extends { type: string }, M = never>(): EffectChain<E, M> {
  const cancelControllers = new Map<string, AbortController>()
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const plugins: Array<(ctx: EffectCtx<unknown, unknown>) => boolean> = []
  let cleanupRegistered = false

  const chain: EffectChain<E, M> = {
    use(plugin) {
      plugins.push(plugin as (ctx: EffectCtx<unknown, unknown>) => boolean)
      return chain
    },
    else(handler) {
      const custom: InternalHandler = (effect, send, signal) => {
        const ctx = { effect, send: send as unknown as (msg: unknown) => void, signal }
        for (const plugin of plugins) {
          if (plugin(ctx)) return
        }
        handler({
          effect: effect as E,
          send: send as unknown as (msg: M) => void,
          signal,
        })
      }
      return ({ effect, send, signal }: EffectCtx<E, M>) => {
        if (!cleanupRegistered) {
          signal.addEventListener(
            'abort',
            () => {
              for (const ctrl of cancelControllers.values()) ctrl.abort()
              cancelControllers.clear()
              for (const timer of debounceTimers.values()) clearTimeout(timer)
              debounceTimers.clear()
            },
            { once: true },
          )
          cleanupRegistered = true
        }
        // Widen send for internal dispatch — built-in effects create dynamic messages
        const internalSend = send as unknown as InternalSend
        dispatchEffect(effect, internalSend, signal, cancelControllers, debounceTimers, custom)
      }
    },
  }

  return chain
}

// ── Internal dispatch ────────────────────────────────────────────

function dispatchEffect(
  effect: { type: string },
  send: InternalSend,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: InternalHandler,
): void {
  switch (effect.type) {
    case 'http':
      runHttp(effect as HttpEffect, send, signal)
      break
    case 'cancel':
      runCancel(
        effect as CancelEffect | CancelReplaceEffect,
        send,
        signal,
        cancelControllers,
        debounceTimers,
        custom,
      )
      break
    case 'debounce':
      runDebounce(effect as DebounceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    case 'sequence':
      runSequence(effect as SequenceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    case 'race':
      runRace(effect as RaceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    default:
      custom(effect, send, signal)
  }
}

function runHttp(effect: HttpEffect, send: InternalSend, signal: AbortSignal): void {
  const opts: RequestInit = { signal }
  if (effect.method) opts.method = effect.method
  if (effect.body) opts.body = JSON.stringify(effect.body)
  if (effect.headers) opts.headers = effect.headers

  fetch(effect.url, opts)
    .then(async (res) => {
      if (signal.aborted) return

      if (res.ok) {
        // Success — parse response based on content type
        const ct = res.headers.get('content-type') ?? ''
        const data = ct.includes('application/json') ? await res.json() : await res.text()
        send({ type: effect.onSuccess, payload: data })
        return
      }

      // Map HTTP status to ApiError
      const error = await httpStatusToApiError(res)
      send({ type: effect.onError, error })
    })
    .catch((err: unknown) => {
      if (signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      const error: ApiError =
        err instanceof TypeError && err.message.includes('fetch')
          ? { kind: 'network', message: err.message }
          : { kind: 'network', message: String(err) }
      send({ type: effect.onError, error })
    })
}

async function httpStatusToApiError(res: Response): Promise<ApiError> {
  switch (res.status) {
    case 401:
      return { kind: 'unauthorized' }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'notfound' }
    case 429: {
      const retry = res.headers.get('retry-after')
      return { kind: 'ratelimit', retryAfter: retry ? parseInt(retry, 10) : undefined }
    }
    case 400:
    case 422: {
      try {
        const body = await res.json()
        if (body && typeof body === 'object' && 'errors' in body) {
          const errors = body.errors as Record<string, string[]>
          return { kind: 'validation', fields: errors }
        }
      } catch {
        /* fall through */
      }
      return { kind: 'server', status: res.status, message: res.statusText }
    }
    default:
      return { kind: 'server', status: res.status, message: res.statusText }
  }
}

function runCancel(
  effect: CancelEffect | CancelReplaceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: InternalHandler,
): void {
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

  if ('inner' in effect && effect.inner) {
    const ctrl = new AbortController()
    cancelControllers.set(effect.token, ctrl)
    componentSignal.addEventListener('abort', () => ctrl.abort(), { once: true })
    dispatchEffect(effect.inner, send, ctrl.signal, cancelControllers, debounceTimers, custom)
  }
}

function runDebounce(
  effect: DebounceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: InternalHandler,
): void {
  const existing = debounceTimers.get(effect.key)
  if (existing !== undefined) clearTimeout(existing)

  const timer = setTimeout(() => {
    debounceTimers.delete(effect.key)
    if (!componentSignal.aborted) {
      dispatchEffect(effect.inner, send, componentSignal, cancelControllers, debounceTimers, custom)
    }
  }, effect.ms)

  debounceTimers.set(effect.key, timer)
}

function runSequence(
  effect: SequenceEffect,
  send: InternalSend,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: InternalHandler,
): void {
  const effects = effect.effects.slice()

  function next(): void {
    if (signal.aborted || effects.length === 0) return
    const current = effects.shift()!

    const wrappedSend: InternalSend = (msg) => {
      send(msg)
      next()
    }

    dispatchEffect(current, wrappedSend, signal, cancelControllers, debounceTimers, custom)
  }

  next()
}

function runRace(
  effect: RaceEffect,
  send: InternalSend,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: InternalHandler,
): void {
  const ctrl = new AbortController()
  signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  let settled = false

  const raceSend: InternalSend = (msg) => {
    if (settled) return
    settled = true
    ctrl.abort()
    send(msg)
  }

  for (const inner of effect.effects) {
    dispatchEffect(inner, raceSend, ctrl.signal, cancelControllers, debounceTimers, custom)
  }
}

// ── SSR Effect Resolution ────────────────────────────────────────

export { resolveEffects } from './resolve'
