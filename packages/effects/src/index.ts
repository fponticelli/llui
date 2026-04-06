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
  onProgress: (loaded: number, total: number) => M
  onSuccess: (data: unknown, status: number) => M
  onError: (error: ApiError) => M
}

export interface RetryEffect {
  type: 'retry'
  inner: BuiltinEffect
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
  inner: BuiltinEffect,
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
  /** Add a plugin that handles specific effects. Returns true if handled, false to pass through. */
  use<E2, M2>(plugin: EffectPlugin<E2, M2>): EffectChain<E, M>
  /** Terminal handler for remaining effects. Returns the final onEffect function. */
  else(handler: (ctx: EffectCtx<E, M>) => void): (ctx: EffectCtx<E, M>) => void
}

export function handleEffects<E extends { type: string }, M = never>(): EffectChain<E, M> {
  const cancelControllers = new Map<string, AbortController>()
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const websockets = new Map<string, WebSocket>()
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
              for (const ws of websockets.values()) ws.close()
              websockets.clear()
            },
            { once: true },
          )
          cleanupRegistered = true
        }
        // Widen send for internal dispatch — built-in effects create dynamic messages
        const internalSend = send as unknown as InternalSend
        dispatchEffect(
          effect,
          internalSend,
          signal,
          cancelControllers,
          debounceTimers,
          websockets,
          custom,
        )
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
  websockets: Map<string, WebSocket>,
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
        websockets,
        custom,
      )
      break
    case 'debounce':
      runDebounce(
        effect as DebounceEffect,
        send,
        signal,
        cancelControllers,
        debounceTimers,
        websockets,
        custom,
      )
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
      runSequence(
        effect as SequenceEffect,
        send,
        signal,
        cancelControllers,
        debounceTimers,
        websockets,
        custom,
      )
      break
    case 'race':
      runRace(
        effect as RaceEffect,
        send,
        signal,
        cancelControllers,
        debounceTimers,
        websockets,
        custom,
      )
      break
    case 'websocket':
      runWebSocket(effect as WebSocketEffect, send, signal, websockets)
      break
    case 'ws-send':
      runWsSend(effect as WebSocketSendEffect, websockets)
      break
    case 'retry':
      runRetry(
        effect as RetryEffect,
        send,
        signal,
        cancelControllers,
        debounceTimers,
        websockets,
        custom,
      )
      break
    case 'upload':
      runUpload(effect as UploadEffect, send, signal)
      break
    case 'clipboard-read':
      runClipboardRead(effect as ClipboardReadEffect, send, signal)
      break
    case 'clipboard-write':
      runClipboardWrite(effect as ClipboardWriteEffect)
      break
    case 'notification':
      runNotification(effect as NotificationEffect, send, signal)
      break
    case 'geolocation':
      runGeolocation(effect as GeolocationEffect, send, signal)
      break
    default:
      custom(effect, send, signal)
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

function runHttp(effect: HttpEffect, send: InternalSend, signal: AbortSignal): void {
  const fetchSignal = effect.timeout
    ? AbortSignal.any([signal, AbortSignal.timeout(effect.timeout)])
    : signal

  const opts: RequestInit = { signal: fetchSignal }
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

  fetch(effect.url, opts)
    .then(async (res) => {
      if (signal.aborted) return

      if (res.ok) {
        const data = await parseResponseBody(res, effect.responseType)
        send(effect.onSuccess(data, res.headers))
        return
      }

      // Map HTTP status to ApiError
      const error = await httpStatusToApiError(res)
      send(effect.onError(error))
    })
    .catch((err: unknown) => {
      if (signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        send(effect.onError({ kind: 'timeout' }))
        return
      }
      const error: ApiError =
        err instanceof TypeError && err.message.includes('fetch')
          ? { kind: 'network', message: err.message }
          : { kind: 'network', message: String(err) }
      send(effect.onError(error))
    })
}

async function parseResponseBody(
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
  websockets: Map<string, WebSocket>,
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

  const ws = websockets.get(effect.token)
  if (ws) {
    ws.close()
    websockets.delete(effect.token)
  }

  if ('inner' in effect && effect.inner) {
    const ctrl = new AbortController()
    cancelControllers.set(effect.token, ctrl)
    componentSignal.addEventListener('abort', () => ctrl.abort(), { once: true })
    dispatchEffect(
      effect.inner,
      send,
      ctrl.signal,
      cancelControllers,
      debounceTimers,
      websockets,
      custom,
    )
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
  websockets: Map<string, WebSocket>,
  custom: InternalHandler,
): void {
  const existing = debounceTimers.get(effect.key)
  if (existing !== undefined) clearTimeout(existing)

  const timer = setTimeout(() => {
    debounceTimers.delete(effect.key)
    if (!componentSignal.aborted) {
      dispatchEffect(
        effect.inner,
        send,
        componentSignal,
        cancelControllers,
        debounceTimers,
        websockets,
        custom,
      )
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
  websockets: Map<string, WebSocket>,
): void {
  // Close existing websocket on the same key
  const existing = websockets.get(effect.key)
  if (existing) existing.close()

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
    websockets.delete(effect.key)
    if (effect.onClose) send(effect.onClose(e.code, e.reason))
  }

  ws.onerror = () => {
    if (effect.onError) send(effect.onError())
  }

  signal.addEventListener(
    'abort',
    () => {
      ws.close()
      websockets.delete(effect.key)
    },
    { once: true },
  )
}

function runWsSend(effect: WebSocketSendEffect, websockets: Map<string, WebSocket>): void {
  const ws = websockets.get(effect.key)
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(typeof effect.data === 'string' ? effect.data : JSON.stringify(effect.data))
}

function runRetry(
  effect: RetryEffect,
  send: InternalSend,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  websockets: Map<string, WebSocket>,
  custom: InternalHandler,
): void {
  const inner = effect.inner
  // Retry only works for http effects
  if (inner.type !== 'http') {
    dispatchEffect(inner, send, signal, cancelControllers, debounceTimers, websockets, custom)
    return
  }

  const httpEffect = inner as HttpEffect
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
          const timer = setTimeout(() => {
            if (!signal.aborted) tryOnce()
          }, delay)
          signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
          return undefined as unknown // message is suppressed
        }
        return httpEffect.onError(error)
      },
    }

    // Use a custom send that suppresses undefined messages (from retry interception)
    const retrySend: InternalSend = (msg: unknown) => {
      if (msg !== undefined) send(msg)
    }

    dispatchEffect(
      wrapped,
      retrySend,
      signal,
      cancelControllers,
      debounceTimers,
      websockets,
      custom,
    )
  }

  tryOnce()
}

function runUpload(effect: UploadEffect, send: InternalSend, signal: AbortSignal): void {
  if (typeof XMLHttpRequest === 'undefined') return

  const xhr = new XMLHttpRequest()
  const method = effect.method ?? 'POST'

  xhr.open(method, effect.url)

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
    send(effect.onSuccess(data, xhr.status))
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
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  websockets: Map<string, WebSocket>,
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

    dispatchEffect(
      current,
      wrappedSend,
      signal,
      cancelControllers,
      debounceTimers,
      websockets,
      custom,
    )
  }

  next()
}

function runRace(
  effect: RaceEffect,
  send: InternalSend,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  websockets: Map<string, WebSocket>,
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
    dispatchEffect(
      inner,
      raceSend,
      ctrl.signal,
      cancelControllers,
      debounceTimers,
      websockets,
      custom,
    )
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

export { resolveEffects } from './resolve'
