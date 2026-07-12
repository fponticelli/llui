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

export interface HttpEffect<M = unknown> {
  type: 'http'
  url: string
  method?: string
  body?: unknown
  contentType?: string
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'
  onSuccess: (data: unknown, headers: Headers) => M
  onError: (error: ApiError) => M
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

/**
 * Write to the console as an effect (effects-as-data debug aid). The signal
 * runtime intentionally does NOT special-case a `log` effect in core — it is
 * just data handled here, like every other effect.
 */
export interface LogEffect {
  type: 'log'
  message: string
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug'
  data?: unknown
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

/** Read a key from storage, dispatch the message returned by `onLoad(value)`. */
export interface StorageGetEffect<M = unknown> {
  type: 'storage-get'
  key: string
  onLoad: (value: unknown) => M
  scope: StorageScope
}

/** Listen for changes to a storage key. Fires the message returned by `onChange(value)` on cross-tab writes. */
export interface StorageWatchEffect<M = unknown> {
  type: 'storage-watch'
  key: string
  onChange: (value: unknown) => M
  scope: StorageScope
}

/** Post a message to a BroadcastChannel. Fire-and-forget. */
export interface BroadcastEffect {
  type: 'broadcast'
  channel: string
  data: unknown
}

/** Subscribe to a BroadcastChannel. Fires the message returned by `onMessage(data)` per incoming message. */
export interface BroadcastListenEffect<M = unknown> {
  type: 'broadcast-listen'
  channel: string
  onMessage: (data: unknown) => M
}

export interface SequenceEffect {
  type: 'sequence'
  effects: BuiltinEffect[]
}

export interface RaceEffect {
  type: 'race'
  effects: BuiltinEffect[]
}

export interface WebSocketEffect<M = unknown> {
  type: 'websocket'
  url: string
  key: string
  protocols?: string[]
  onOpen?: () => M
  onMessage: (data: unknown) => M
  onClose?: (code: number, reason: string) => M
  onError?: () => M
}

export interface WebSocketSendEffect {
  type: 'ws-send'
  key: string
  data: unknown
}

export interface UploadEffect<M = unknown> {
  type: 'upload'
  url: string
  method?: string
  body: FormData | Blob
  headers?: Record<string, string>
  /** Abort the upload after this many milliseconds (wires `xhr.timeout`). */
  timeout?: number
  onProgress: (loaded: number, total: number) => M
  onSuccess: (data: unknown, status: number) => M
  onError: (error: ApiError) => M
}

export interface RetryEffect {
  type: 'retry'
  /** Only `http` effects are retriable — retry re-issues the request on failure. */
  inner: HttpEffect
  maxAttempts: number
  delayMs: number
}

export interface ClipboardReadEffect<M = unknown> {
  type: 'clipboard-read'
  onSuccess: (text: string) => M
  onError: (error: string) => M
}

export interface ClipboardWriteEffect {
  type: 'clipboard-write'
  text: string
}

export interface NotificationEffect<M = unknown> {
  type: 'notification'
  title: string
  body?: string
  icon?: string
  tag?: string
  onClick?: () => M
  onClose?: () => M
  onError?: () => M
}

export interface GeolocationEffect<M = unknown> {
  type: 'geolocation'
  onSuccess: (position: { latitude: number; longitude: number; accuracy: number }) => M
  onError: (error: string) => M
  enableHighAccuracy?: boolean
}

type BuiltinEffect =
  | HttpEffect
  | CancelEffect
  | CancelReplaceEffect
  | DebounceEffect
  | TimeoutEffect
  | IntervalEffect
  | LogEffect
  | StorageSetEffect
  | StorageRemoveEffect
  | StorageGetEffect
  | StorageWatchEffect
  | BroadcastEffect
  | BroadcastListenEffect
  | SequenceEffect
  | RaceEffect
  | WebSocketEffect
  | WebSocketSendEffect
  | RetryEffect
  | UploadEffect
  | ClipboardReadEffect
  | ClipboardWriteEffect
  | NotificationEffect
  | GeolocationEffect

// Re-export for user convenience
export type { BuiltinEffect as Effect }

// ── Builders ──────────────────────────────────────────────────────

export function http<M>(opts: {
  url: string
  method?: string
  body?: unknown
  contentType?: string
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'
  onSuccess: (data: unknown, headers: Headers) => M
  onError: (error: ApiError) => M
}): HttpEffect<M> {
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

/**
 * Delay then dispatch a message — the effects-as-data form of `setTimeout`.
 * This is the replacement for the old core `delay` effect: `delay(ms, msg)` is
 * `timeout(ms, msg)` (fire `msg` once after `ms`; auto-cancels on unmount).
 */
export const delay = timeout

/** Log to the console as an effect. Replaces the old core `log` effect. */
export function log(
  message: string,
  opts?: { level?: LogEffect['level']; data?: unknown },
): LogEffect {
  return { type: 'log', message, ...opts }
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

export function storageGet<M>(
  key: string,
  onLoad: (value: unknown) => M,
  scope: StorageScope = 'local',
): StorageGetEffect<M> {
  return { type: 'storage-get', key, onLoad, scope }
}

export function storageWatch<M>(
  key: string,
  onChange: (value: unknown) => M,
  scope: StorageScope = 'local',
): StorageWatchEffect<M> {
  return { type: 'storage-watch', key, onChange, scope }
}

// ── BroadcastChannel ──────────────────────────────────────────────

export function broadcast(channel: string, data: unknown): BroadcastEffect {
  return { type: 'broadcast', channel, data }
}

export function broadcastListen<M>(
  channel: string,
  onMessage: (data: unknown) => M,
): BroadcastListenEffect<M> {
  return { type: 'broadcast-listen', channel, onMessage }
}

// ── WebSocket ────────────────────────────────────────────────────

export function websocket<M>(opts: {
  url: string
  key: string
  protocols?: string[]
  onOpen?: () => M
  onMessage: (data: unknown) => M
  onClose?: (code: number, reason: string) => M
  onError?: () => M
}): WebSocketEffect<M> {
  return { type: 'websocket', ...opts }
}

export function wsSend(key: string, data: unknown): WebSocketSendEffect {
  return { type: 'ws-send', key, data }
}

// ── Retry ────────────────────────────────────────────────────────

export function retry(
  inner: HttpEffect,
  opts: { maxAttempts: number; delayMs: number },
): RetryEffect {
  return { type: 'retry', inner, maxAttempts: opts.maxAttempts, delayMs: opts.delayMs }
}

// ── Upload ──────────────────────────────────────────────────

export function upload<M>(opts: {
  url: string
  method?: string
  body: FormData | Blob
  headers?: Record<string, string>
  timeout?: number
  onProgress: (loaded: number, total: number) => M
  onSuccess: (data: unknown, status: number) => M
  onError: (error: ApiError) => M
}): UploadEffect<M> {
  return { type: 'upload', ...opts }
}

// ── Clipboard ───────────────────────────────────────────────────

export function clipboardRead<M>(opts: {
  onSuccess: (text: string) => M
  onError: (error: string) => M
}): ClipboardReadEffect<M> {
  return { type: 'clipboard-read', ...opts }
}

export function clipboardWrite(text: string): ClipboardWriteEffect {
  return { type: 'clipboard-write', text }
}

// ── Notification ────────────────────────────────────────────────

export function notification<M>(
  title: string,
  opts?: {
    body?: string
    icon?: string
    tag?: string
    onClick?: () => M
    onClose?: () => M
    onError?: () => M
  },
): NotificationEffect<M> {
  return { type: 'notification', title, ...opts }
}

// ── Geolocation ─────────────────────────────────────────────────

export function geolocation<M>(opts: {
  onSuccess: (position: { latitude: number; longitude: number; accuracy: number }) => M
  onError: (error: string) => M
  enableHighAccuracy?: boolean
}): GeolocationEffect<M> {
  return { type: 'geolocation', ...opts }
}

// ── Sequence / Race ──────────────────────────────────────────────

export function sequence(effects: BuiltinEffect[]): SequenceEffect {
  return { type: 'sequence', effects }
}

export function race(effects: BuiltinEffect[]): RaceEffect {
  return { type: 'race', effects }
}

// ── Handler Chain ─────────────────────────────────────────────────

// Internal send type — widened for dynamic message creation (http onSuccess/onError)
type InternalSend = (msg: unknown) => void
type InternalHandler = (effect: { type: string }, send: InternalSend, signal: AbortSignal) => void

export interface EffectCtx<E, M> {
  effect: E
  send: (msg: M) => void
  signal: AbortSignal
}

/** Plugin handler — returns true if the effect was handled, false to pass through. */
export type EffectPlugin<E, M> = (ctx: EffectCtx<E, M>) => boolean

interface EffectChain<E extends { type: string }, M> {
  /**
   * Add a plugin that handles specific effects. Returns true if handled, false to
   * pass through. Plugins run BEFORE the built-in switch on every dispatch, so a
   * plugin can intercept even a built-in kind (e.g. `http`) — the first plugin to
   * return `true` wins and the built-in handler never runs. `E2` is constrained to
   * a subtype of the chain's effect type `E`.
   */
  use<E2 extends E, M2 = M>(plugin: EffectPlugin<E2, M2>): EffectChain<E, M>
  /** Terminal handler for remaining effects. Returns the final onEffect function. */
  else(handler: (ctx: EffectCtx<E, M>) => void): (ctx: EffectCtx<E, M>) => void
}

/**
 * Per-mount registry of stateful effect resources. One is created lazily per
 * distinct `AbortSignal` (i.e. per mount — each mount owns its own signal) and is
 * torn down exactly once when that signal aborts. Keying off the signal (rather
 * than a chain- or definition-level closure) is what keeps two concurrent mounts
 * of the same component isolated: disposing one mount never cancels the other's
 * in-flight http / intervals / debounces / websockets, and there is no one-shot
 * `cleanupRegistered` latch to starve a later mount of its teardown.
 */
interface Registry {
  cancelControllers: Map<string, AbortController>
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>
  websockets: Map<string, WebSocket>
}

type PluginFn = (ctx: EffectCtx<unknown, unknown>) => boolean

/** Shared, per-mount context threaded through every (recursive) dispatch. */
interface Deps {
  registry: Registry
  custom: InternalHandler
  plugins: readonly PluginFn[]
}

export function handleEffects<E extends { type: string }, M = never>(): EffectChain<E, M> {
  // Per-mount registries, keyed off each mount's lifecycle signal. A WeakMap so a
  // torn-down mount's registry is collectible once its signal is unreachable.
  const registries = new WeakMap<AbortSignal, Registry>()
  const plugins: PluginFn[] = []

  function registryFor(signal: AbortSignal): Registry {
    const cached = registries.get(signal)
    if (cached) return cached
    const registry: Registry = {
      cancelControllers: new Map(),
      debounceTimers: new Map(),
      websockets: new Map(),
    }
    registries.set(signal, registry)
    if (!signal.aborted) {
      signal.addEventListener(
        'abort',
        () => {
          for (const ctrl of registry.cancelControllers.values()) ctrl.abort()
          registry.cancelControllers.clear()
          for (const timer of registry.debounceTimers.values()) clearTimeout(timer)
          registry.debounceTimers.clear()
          for (const ws of registry.websockets.values()) {
            ws.onclose = null // don't dispatch app onClose after unmount
            ws.close()
          }
          registry.websockets.clear()
          registries.delete(signal)
        },
        { once: true },
      )
    }
    return registry
  }

  const chain: EffectChain<E, M> = {
    use(plugin) {
      plugins.push(plugin as PluginFn)
      return chain
    },
    else(handler) {
      // Terminal handler for effects that no plugin and no built-in claimed.
      // Plugins have already run (at the top of `dispatchEffect`), so this only
      // ever forwards genuinely custom effects to the user handler.
      const custom: InternalHandler = (effect, send, signal) => {
        handler({
          effect: effect as E,
          send: send as unknown as (msg: M) => void,
          signal,
        })
      }
      return ({ effect, send, signal }: EffectCtx<E, M>) => {
        const deps: Deps = { registry: registryFor(signal), custom, plugins }
        dispatchEffect(effect, send as unknown as InternalSend, signal, deps)
      }
    },
  }

  return chain
}

/**
 * Adapt a `handleEffects()` chain (the `(ctx) => void` returned by `.else()`) to
 * the signal-runtime `onEffect` shape: `(effect, api) => cleanup`.
 *
 * The signal runtime now hands `onEffect` a per-mount `api.signal` (an
 * `AbortSignal` aborted exactly once, on THIS mount's `dispose()`). When present,
 * this adapter passes that signal straight through to the chain: every mount owns
 * a distinct signal, so the chain keys its per-mount registries off it and two
 * concurrent mounts of one definition never interfere. Teardown is driven by the
 * runtime aborting `api.signal`, so the returned cleanup is a no-op — the chain's
 * own abort listener clears the mount's pending http / debounce / interval /
 * websocket resources. We must NOT abort `api.signal` ourselves (it is the
 * runtime's, shared with everything else on the mount).
 *
 * FALLBACK: when no `api.signal` is supplied (a bare unit test, or a non-signal
 * caller), the adapter owns one AbortController per mount and the returned cleanup
 * aborts it. It is (re)created lazily — never at factory-call time, since
 * `asOnEffect` typically runs at module top-level where constructing an
 * AbortController throws on Cloudflare Workers — and recreated once aborted so a
 * re-mount of the same definition never inherits a dead signal. The cleanup is
 * memoized per generation so it always targets the controller live at its dispatch.
 *
 * Usage: `onEffect: asOnEffect(handleEffects<E, M>().use(…).else(…))`.
 */
export function asOnEffect<E extends { type: string }, M>(
  chain: (ctx: EffectCtx<E, M>) => void,
): (effect: E, api: { send: (msg: M) => void; signal?: AbortSignal }) => () => void {
  const noop = (): void => {}
  let controller: AbortController | null = null
  let cleanup: (() => void) | null = null
  return (effect, { send, signal }) => {
    if (signal) {
      // Per-mount signal from the runtime — teardown is the runtime's job.
      chain({ effect, send, signal })
      return noop
    }
    // Fallback: own a controller per mount, recreating once aborted.
    if (controller === null || controller.signal.aborted) {
      const ctrl = new AbortController()
      controller = ctrl
      cleanup = () => ctrl.abort() // memoized per generation
    }
    chain({ effect, send, signal: controller.signal })
    return cleanup!
  }
}

// ── Internal dispatch ────────────────────────────────────────────

/**
 * Dispatch one effect. Returns whether the effect COMPLETES WITHOUT DISPATCHING a
 * message — i.e. it is fire-and-forget and will never call `send`. `sequence` uses
 * this to advance past such a step immediately (waiting on a message it will never
 * emit would stall the chain forever). Everything that dispatches (now or async),
 * subscribes, or recurses returns `false`.
 *
 * Plugins registered via `.use()` run FIRST, on every dispatch level (including
 * effects nested in `sequence`/`race`/`retry`/`cancel`), so a plugin can intercept
 * a built-in kind. A plugin that claims an effect returns `false` here (we can't
 * know whether it dispatched).
 */
function dispatchEffect(
  effect: { type: string },
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
): boolean {
  for (const plugin of deps.plugins) {
    if (plugin({ effect, send: send as unknown as (msg: unknown) => void, signal })) return false
  }
  switch (effect.type) {
    case 'http':
      runHttp(effect as HttpEffect, send, signal)
      return false
    case 'cancel':
      return runCancel(effect as CancelEffect | CancelReplaceEffect, send, signal, deps)
    case 'debounce':
      runDebounce(effect as DebounceEffect, send, signal, deps)
      return false
    case 'timeout':
      runTimeout(effect as TimeoutEffect, send, signal)
      return false
    case 'interval':
      runInterval(effect as IntervalEffect, send, signal, deps)
      return false
    case 'log':
      runLog(effect as LogEffect)
      return true
    case 'storage-set':
      runStorageSet(effect as StorageSetEffect)
      return true
    case 'storage-remove':
      runStorageRemove(effect as StorageRemoveEffect)
      return true
    case 'storage-get':
      runStorageGet(effect as StorageGetEffect, send)
      return false
    case 'storage-watch':
      runStorageWatch(effect as StorageWatchEffect, send, signal)
      return false
    case 'broadcast':
      runBroadcast(effect as BroadcastEffect)
      return true
    case 'broadcast-listen':
      runBroadcastListen(effect as BroadcastListenEffect, send, signal)
      return false
    case 'sequence':
      runSequence(effect as SequenceEffect, send, signal, deps)
      return false
    case 'race':
      runRace(effect as RaceEffect, send, signal, deps)
      return false
    case 'websocket':
      runWebSocket(effect as WebSocketEffect, send, signal, deps)
      return false
    case 'ws-send':
      runWsSend(effect as WebSocketSendEffect, deps)
      return true
    case 'retry':
      runRetry(effect as RetryEffect, send, signal, deps)
      return false
    case 'upload':
      runUpload(effect as UploadEffect, send, signal)
      return false
    case 'clipboard-read':
      runClipboardRead(effect as ClipboardReadEffect, send, signal)
      return false
    case 'clipboard-write':
      runClipboardWrite(effect as ClipboardWriteEffect)
      return true
    case 'notification':
      runNotification(effect as NotificationEffect, send, signal)
      return false
    case 'geolocation':
      runGeolocation(effect as GeolocationEffect, send, signal)
      return false
    default:
      deps.custom(effect, send, signal)
      return false
  }
}

function isPassThroughBody(body: unknown): body is FormData | Blob | URLSearchParams | ArrayBuffer {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
  )
}

/**
 * Build the `RequestInit` (method + body + content-type headers) for an http
 * effect, WITHOUT a signal. Shared by the live `runHttp` and the SSR
 * `resolveEffects` so both derive identical requests. Callers add `signal`
 * (and any timeout) themselves.
 * @internal
 */
export function buildRequest(effect: HttpEffect): RequestInit {
  const opts: RequestInit = {}
  if (effect.method) opts.method = effect.method

  if (effect.body !== undefined) {
    if (isPassThroughBody(effect.body) || typeof effect.body === 'string') {
      opts.body = effect.body as BodyInit
    } else {
      opts.body = JSON.stringify(effect.body)
    }
  }

  // Build headers: start with user-provided, then add content-type logic
  const headers: Record<string, string> = { ...(effect.headers ?? {}) }
  if (effect.contentType) {
    headers['content-type'] = effect.contentType
  } else if (
    effect.body !== undefined &&
    !isPassThroughBody(effect.body) &&
    typeof effect.body !== 'string'
  ) {
    // Auto-set for JSON-serialized bodies, unless user already set it
    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json'
    }
  }
  if (Object.keys(headers).length > 0) opts.headers = headers
  return opts
}

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
    // A fetch network failure (TypeError) or a body-parse failure (SyntaxError).
    if (err instanceof TypeError || err instanceof SyntaxError) {
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

/**
 * Parse a response body by explicit `responseType`, else auto-detect from the
 * `content-type` header. Shared by `runHttp` and `resolveEffects`.
 * @internal
 */
export async function parseResponse(
  res: Response,
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer',
): Promise<unknown> {
  if (responseType) {
    switch (responseType) {
      case 'json':
        return res.json()
      case 'text':
        return res.text()
      case 'blob':
        return res.blob()
      case 'arrayBuffer':
        return res.arrayBuffer()
    }
  }
  // Auto-detect from content-type
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : res.text()
}

/**
 * Map an HTTP status to an {@link ApiError}, without needing a `Response` — shared
 * by the fetch (`http`) and XHR (`upload`) paths. For 400/422 a parsed JSON body
 * (if any) is inspected for a `{ errors }` validation map.
 */
function statusToApiError(
  status: number,
  statusText: string,
  extra: { retryAfter?: string | null; jsonBody?: unknown } = {},
): ApiError {
  switch (status) {
    case 401:
      return { kind: 'unauthorized' }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'notfound' }
    case 429:
      return {
        kind: 'ratelimit',
        retryAfter: extra.retryAfter ? parseInt(extra.retryAfter, 10) : undefined,
      }
    case 400:
    case 422: {
      const body = extra.jsonBody
      if (body && typeof body === 'object' && 'errors' in body) {
        const errors = (body as { errors: Record<string, string[]> }).errors
        return { kind: 'validation', fields: errors }
      }
      return { kind: 'server', status, message: statusText }
    }
    default:
      return { kind: 'server', status, message: statusText }
  }
}

export async function httpStatusToApiError(res: Response): Promise<ApiError> {
  let jsonBody: unknown
  if (res.status === 400 || res.status === 422) {
    try {
      jsonBody = await res.json()
    } catch {
      /* no JSON body — fall through to a plain server error */
    }
  }
  return statusToApiError(res.status, res.statusText, {
    retryAfter: res.headers.get('retry-after'),
    jsonBody,
  })
}

function runCancel(
  effect: CancelEffect | CancelReplaceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): boolean {
  const { cancelControllers, debounceTimers, websockets } = deps.registry
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

  const ws = websockets.get(effect.token)
  if (ws) {
    ws.onclose = null // programmatic cancel — don't dispatch app onClose
    ws.close()
    websockets.delete(effect.token)
  }

  if ('inner' in effect && effect.inner) {
    const ctrl = new AbortController()
    cancelControllers.set(effect.token, ctrl)
    // `AbortSignal.any` ties the inner's lifetime to BOTH the mount and this
    // token's controller without hanging a growing listener off `componentSignal`.
    const innerSignal = AbortSignal.any([componentSignal, ctrl.signal])
    dispatchEffect(effect.inner, send, innerSignal, deps)
    return false // the inner effect may dispatch
  }
  return true // bare cancel completes without dispatching
}

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

function runLog(effect: LogEffect): void {
  const fn = console[effect.level ?? 'log'] ?? console.log
  if (effect.data !== undefined) fn(effect.message, effect.data)
  else fn(effect.message)
}

function runInterval(
  effect: IntervalEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): void {
  const { cancelControllers } = deps.registry
  // Clear any existing interval on the same key
  const existing = cancelControllers.get(effect.key)
  if (existing) existing.abort()

  const ctrl = new AbortController()
  cancelControllers.set(effect.key, ctrl)
  // Stop when EITHER the mount aborts or this interval's controller aborts, via a
  // single derived signal (no manual listener retained on `componentSignal`).
  const stopSignal = AbortSignal.any([componentSignal, ctrl.signal])

  const timer = setInterval(() => {
    if (stopSignal.aborted) {
      clearInterval(timer)
      return
    }
    send(effect.msg as Record<string, unknown>)
  }, effect.ms)

  stopSignal.addEventListener(
    'abort',
    () => {
      clearInterval(timer)
      if (cancelControllers.get(effect.key) === ctrl) cancelControllers.delete(effect.key)
    },
    { once: true },
  )
}

function runDebounce(
  effect: DebounceEffect,
  send: InternalSend,
  componentSignal: AbortSignal,
  deps: Deps,
): void {
  const { debounceTimers, cancelControllers } = deps.registry
  const existing = debounceTimers.get(effect.key)
  if (existing !== undefined) clearTimeout(existing)

  const timer = setTimeout(() => {
    debounceTimers.delete(effect.key)
    if (componentSignal.aborted) return

    // Register an abort controller under the debounce key so a later `cancel(key)`
    // can abort the now in-flight inner effect (e.g. the debounced http request),
    // not merely clear a timer that has already fired. Abort any prior in-flight
    // inner under the same key first.
    const prior = cancelControllers.get(effect.key)
    if (prior) prior.abort()
    const ctrl = new AbortController()
    cancelControllers.set(effect.key, ctrl)
    const innerSignal = AbortSignal.any([componentSignal, ctrl.signal])
    ctrl.signal.addEventListener(
      'abort',
      () => {
        if (cancelControllers.get(effect.key) === ctrl) cancelControllers.delete(effect.key)
      },
      { once: true },
    )
    dispatchEffect(effect.inner, send, innerSignal, deps)
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
    send(effect.onLoad(null))
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
  send(effect.onLoad(value))
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
    send(effect.onChange(value))
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
    send(effect.onMessage(e.data))
  })
  signal.addEventListener(
    'abort',
    () => {
      bc.close()
    },
    { once: true },
  )
}

function runWebSocket(
  effect: WebSocketEffect,
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
): void {
  const { websockets } = deps.registry
  // Replace any existing websocket on the same key. Detach its handlers FIRST so
  // its async `onclose` can neither dispatch a spurious app `onClose` nor delete
  // the replacement from the registry (the replacement-race bug).
  const existing = websockets.get(effect.key)
  if (existing) {
    existing.onopen = null
    existing.onmessage = null
    existing.onclose = null
    existing.onerror = null
    existing.close()
  }

  const ws = effect.protocols
    ? new WebSocket(effect.url, effect.protocols)
    : new WebSocket(effect.url)
  websockets.set(effect.key, ws)

  ws.onopen = () => {
    if (effect.onOpen) send(effect.onOpen())
  }

  ws.onmessage = (e: MessageEvent) => {
    let data: unknown
    try {
      data = JSON.parse(e.data as string)
    } catch {
      data = e.data
    }
    send(effect.onMessage(data))
  }

  ws.onclose = (e: CloseEvent) => {
    // Only clear the registry slot if it still points at THIS socket — a
    // replacement may already own the key.
    if (websockets.get(effect.key) === ws) websockets.delete(effect.key)
    if (effect.onClose) send(effect.onClose(e.code, e.reason))
  }

  ws.onerror = () => {
    if (effect.onError) send(effect.onError())
  }

  signal.addEventListener(
    'abort',
    () => {
      ws.onclose = null // unmount — don't dispatch app onClose
      ws.close()
      if (websockets.get(effect.key) === ws) websockets.delete(effect.key)
    },
    { once: true },
  )
}

function runWsSend(effect: WebSocketSendEffect, deps: Deps): void {
  const ws = deps.registry.websockets.get(effect.key)
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(typeof effect.data === 'string' ? effect.data : JSON.stringify(effect.data))
}

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

    dispatchEffect(wrapped, retrySend, signal, deps)
  }

  tryOnce()
}

function runUpload(effect: UploadEffect, send: InternalSend, signal: AbortSignal): void {
  if (typeof XMLHttpRequest === 'undefined') return

  const xhr = new XMLHttpRequest()
  const method = effect.method ?? 'POST'

  xhr.open(method, effect.url)
  if (effect.timeout) xhr.timeout = effect.timeout

  if (effect.headers) {
    for (const [key, value] of Object.entries(effect.headers)) {
      xhr.setRequestHeader(key, value)
    }
  }

  xhr.upload.onprogress = (e: ProgressEvent) => {
    if (signal.aborted) return
    send(effect.onProgress(e.loaded, e.total))
  }

  xhr.onload = () => {
    if (signal.aborted) return
    let data: unknown
    try {
      data = JSON.parse(xhr.responseText)
    } catch {
      data = xhr.responseText
    }
    // Match the http() contract: only 2xx is success; non-2xx maps through the
    // same status→ApiError table and routes to onError.
    if (xhr.status >= 200 && xhr.status < 300) {
      send(effect.onSuccess(data, xhr.status))
    } else {
      send(
        effect.onError(
          statusToApiError(xhr.status, xhr.statusText, {
            retryAfter: xhr.getResponseHeader('retry-after'),
            jsonBody: data,
          }),
        ),
      )
    }
  }

  xhr.onerror = () => {
    if (signal.aborted) return
    send(effect.onError({ kind: 'network', message: 'Upload failed' }))
  }

  xhr.ontimeout = () => {
    if (signal.aborted) return
    send(effect.onError({ kind: 'timeout' }))
  }

  signal.addEventListener('abort', () => xhr.abort(), { once: true })

  xhr.send(effect.body)
}

function runSequence(
  effect: SequenceEffect,
  send: InternalSend,
  signal: AbortSignal,
  deps: Deps,
): void {
  const effects = effect.effects.slice()

  function next(): void {
    if (signal.aborted || effects.length === 0) return
    const current = effects.shift()!

    // A step advances the sequence exactly once — on its first emitted message
    // (the common terminal-message case, e.g. http's onSuccess/onError). A step
    // that emits several messages (interval ticks, upload progress) advances on
    // the first and must NOT fast-forward the remaining steps. A step that emits
    // NO message advances synchronously, driven by the `completesWithoutDispatch`
    // signal returned from `dispatchEffect` (rather than a hardcoded name-set) —
    // bare `cancel`, `clipboard-write`, `log`, `storage-set`/`-remove`,
    // `broadcast`, and `ws-send` all report this. A step that SUBSCRIBES
    // (interval, websocket, storage-watch, broadcast-listen) advances on its
    // first dispatched message, so a subscription mid-sequence gates the rest of
    // the chain on its first event.
    let advanced = false
    const advance = (): void => {
      if (advanced || signal.aborted) return
      advanced = true
      next()
    }

    const wrappedSend: InternalSend = (msg) => {
      send(msg)
      advance()
    }

    const completesWithoutDispatch = dispatchEffect(current, wrappedSend, signal, deps)
    if (completesWithoutDispatch) advance()
  }

  next()
}

function runRace(effect: RaceEffect, send: InternalSend, signal: AbortSignal, deps: Deps): void {
  const ctrl = new AbortController()
  const onAbort = (): void => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let settled = false

  const raceSend: InternalSend = (msg) => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', onAbort) // settled — drop the parent listener
    ctrl.abort()
    send(msg)
  }

  for (const inner of effect.effects) {
    dispatchEffect(inner, raceSend, ctrl.signal, deps)
  }
}

// ── Clipboard ───────────────────────────────────────────────────

function runClipboardRead(
  effect: ClipboardReadEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    send(effect.onError('Clipboard API not available'))
    return
  }
  navigator.clipboard
    .readText()
    .then((text) => {
      if (!signal.aborted) send(effect.onSuccess(text))
    })
    .catch((err: unknown) => {
      if (!signal.aborted) send(effect.onError(err instanceof Error ? err.message : String(err)))
    })
}

function runClipboardWrite(effect: ClipboardWriteEffect): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(effect.text).catch(() => {
    // fire-and-forget
  })
}

// ── Notification ────────────────────────────────────────────────

function runNotification(
  effect: NotificationEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof Notification === 'undefined') {
    if (effect.onError) send(effect.onError())
    return
  }

  const show = (): void => {
    if (signal.aborted) return
    const n = new Notification(effect.title, {
      body: effect.body,
      icon: effect.icon,
      tag: effect.tag,
    })
    if (effect.onClick) {
      const cb = effect.onClick
      n.onclick = () => {
        if (!signal.aborted) send(cb())
      }
    }
    if (effect.onClose) {
      const cb = effect.onClose
      n.onclose = () => {
        if (!signal.aborted) send(cb())
      }
    }
    if (effect.onError) {
      const cb = effect.onError
      n.onerror = () => {
        if (!signal.aborted) send(cb())
      }
    }
  }

  if (Notification.permission === 'granted') {
    show()
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        show()
      } else if (effect.onError) {
        if (!signal.aborted) send(effect.onError())
      }
    })
  } else if (effect.onError) {
    send(effect.onError())
  }
}

// ── Geolocation ─────────────────────────────────────────────────

function runGeolocation(effect: GeolocationEffect, send: InternalSend, signal: AbortSignal): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    send(effect.onError('Geolocation API not available'))
    return
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!signal.aborted) {
        send(
          effect.onSuccess({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }),
        )
      }
    },
    (err) => {
      if (!signal.aborted) send(effect.onError(err.message))
    },
    { enableHighAccuracy: effect.enableHighAccuracy },
  )
}

// ── SSR Effect Resolution ────────────────────────────────────────

export { resolveEffects } from './resolve.js'

// ── Dev-only effect interceptor ──────────────────────────────────

export {
  _setEffectInterceptor,
  _getEffectInterceptor,
  type EffectInterceptor,
  type EffectInterceptorResult,
} from './interceptor.js'
