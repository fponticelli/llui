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

/** Fires `msg` once, after `ms` milliseconds. Auto-cancels if the component unmounts. */
export interface TimeoutEffect {
  type: 'timeout'
  ms: number
  msg: unknown
}

/** Fires `msg` every `ms` milliseconds. Cancel with `cancel(key)`. */
export interface IntervalEffect {
  type: 'interval'
  key: string
  ms: number
  msg: unknown
}

export type StorageScope = 'local' | 'session'

/** Write a JSON value to localStorage/sessionStorage. Fire-and-forget. */
export interface StorageSetEffect {
  type: 'storage-set'
  key: string
  value: unknown
  scope: StorageScope
}

/** Remove a key from storage. Fire-and-forget. */
export interface StorageRemoveEffect {
  type: 'storage-remove'
  key: string
  scope: StorageScope
}

/** Read a key from storage, dispatch `{ type: onLoad, value }` with the parsed JSON (or null). */
export interface StorageGetEffect {
  type: 'storage-get'
  key: string
  onLoad: string
  scope: StorageScope
}

/** Listen for changes to a storage key. Fires `{ type: onChange, value }` on cross-tab writes. */
export interface StorageWatchEffect {
  type: 'storage-watch'
  key: string
  onChange: string
  scope: StorageScope
}

/** Post a message to a BroadcastChannel. Fire-and-forget. */
export interface BroadcastEffect {
  type: 'broadcast'
  channel: string
  data: unknown
}

/** Subscribe to a BroadcastChannel. Fires `{ type: onMessage, data }` per incoming message. */
export interface BroadcastListenEffect {
  type: 'broadcast-listen'
  channel: string
  onMessage: string
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
  | TimeoutEffect
  | IntervalEffect
  | StorageSetEffect
  | StorageRemoveEffect
  | StorageGetEffect
  | StorageWatchEffect
  | BroadcastEffect
  | BroadcastListenEffect
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

export function timeout<M>(ms: number, msg: M): TimeoutEffect {
  return { type: 'timeout', ms, msg }
}

export function interval<M>(key: string, ms: number, msg: M): IntervalEffect {
  return { type: 'interval', key, ms, msg }
}

// ── Storage ───────────────────────────────────────────────────────

/** Synchronous read from storage. Use at init time to seed state. Returns `null` on miss or invalid JSON. */
export function storageLoad<T = unknown>(key: string, scope: StorageScope = 'local'): T | null {
  if (typeof window === 'undefined') return null
  const store = scope === 'local' ? window.localStorage : window.sessionStorage
  const raw = store.getItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function storageSet(
  key: string,
  value: unknown,
  scope: StorageScope = 'local',
): StorageSetEffect {
  return { type: 'storage-set', key, value, scope }
}

export function storageRemove(key: string, scope: StorageScope = 'local'): StorageRemoveEffect {
  return { type: 'storage-remove', key, scope }
}

export function storageGet(
  key: string,
  onLoad: string,
  scope: StorageScope = 'local',
): StorageGetEffect {
  return { type: 'storage-get', key, onLoad, scope }
}

export function storageWatch(
  key: string,
  onChange: string,
  scope: StorageScope = 'local',
): StorageWatchEffect {
  return { type: 'storage-watch', key, onChange, scope }
}

// ── BroadcastChannel ──────────────────────────────────────────────

export function broadcast(channel: string, data: unknown): BroadcastEffect {
  return { type: 'broadcast', channel, data }
}

export function broadcastListen(channel: string, onMessage: string): BroadcastListenEffect {
  return { type: 'broadcast-listen', channel, onMessage }
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
    case 'timeout':
      runTimeout(effect as TimeoutEffect, send, signal)
      break
    case 'interval':
      runInterval(effect as IntervalEffect, send, signal, cancelControllers)
      break
    case 'storage-set':
      runStorageSet(effect as StorageSetEffect)
      break
    case 'storage-remove':
      runStorageRemove(effect as StorageRemoveEffect)
      break
    case 'storage-get':
      runStorageGet(effect as StorageGetEffect, send)
      break
    case 'storage-watch':
      runStorageWatch(effect as StorageWatchEffect, send, signal)
      break
    case 'broadcast':
      runBroadcast(effect as BroadcastEffect)
      break
    case 'broadcast-listen':
      runBroadcastListen(effect as BroadcastListenEffect, send, signal)
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

function runTimeout(effect: TimeoutEffect, send: InternalSend, signal: AbortSignal): void {
  const timer = setTimeout(() => {
    if (!signal.aborted) send(effect.msg as Record<string, unknown>)
  }, effect.ms)
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
}

function runInterval(
  effect: IntervalEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
): void {
  // Clear any existing interval on the same key
  const existing = cancelControllers.get(effect.key)
  if (existing) existing.abort()

  const ctrl = new AbortController()
  cancelControllers.set(effect.key, ctrl)
  componentSignal.addEventListener('abort', () => ctrl.abort(), { once: true })

  const timer = setInterval(() => {
    if (ctrl.signal.aborted || componentSignal.aborted) {
      clearInterval(timer)
      return
    }
    send(effect.msg as Record<string, unknown>)
  }, effect.ms)

  ctrl.signal.addEventListener(
    'abort',
    () => {
      clearInterval(timer)
      cancelControllers.delete(effect.key)
    },
    { once: true },
  )
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

function getStorage(scope: StorageScope): Storage | null {
  if (typeof window === 'undefined') return null
  return scope === 'local' ? window.localStorage : window.sessionStorage
}

function runStorageSet(effect: StorageSetEffect): void {
  const store = getStorage(effect.scope)
  if (!store) return
  try {
    store.setItem(effect.key, JSON.stringify(effect.value))
  } catch {
    // quota exceeded or serialization failed — silent, same as localStorage itself
  }
}

function runStorageRemove(effect: StorageRemoveEffect): void {
  const store = getStorage(effect.scope)
  if (store) store.removeItem(effect.key)
}

function runStorageGet(effect: StorageGetEffect, send: InternalSend): void {
  const store = getStorage(effect.scope)
  if (!store) {
    send({ type: effect.onLoad, value: null })
    return
  }
  const raw = store.getItem(effect.key)
  let value: unknown = null
  if (raw !== null) {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  send({ type: effect.onLoad, value })
}

function runStorageWatch(
  effect: StorageWatchEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof window === 'undefined') return
  // `storage` event only fires on localStorage, and only cross-tab.
  // For sessionStorage (single-tab) we have no cross-change signal — watcher is a no-op.
  if (effect.scope !== 'local') return
  const handler = (e: StorageEvent): void => {
    if (e.key !== effect.key) return
    let value: unknown = null
    if (e.newValue !== null) {
      try {
        value = JSON.parse(e.newValue)
      } catch {
        value = null
      }
    }
    send({ type: effect.onChange, value })
  }
  window.addEventListener('storage', handler)
  signal.addEventListener('abort', () => window.removeEventListener('storage', handler), {
    once: true,
  })
}

function runBroadcast(effect: BroadcastEffect): void {
  if (typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel(effect.channel)
  try {
    bc.postMessage(effect.data)
  } finally {
    bc.close()
  }
}

function runBroadcastListen(
  effect: BroadcastListenEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel(effect.channel)
  bc.addEventListener('message', (e: MessageEvent) => {
    send({ type: effect.onMessage, data: e.data })
  })
  signal.addEventListener(
    'abort',
    () => {
      bc.close()
    },
    { once: true },
  )
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
