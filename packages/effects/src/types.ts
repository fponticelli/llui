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
  /**
   * Decide whether a given failure should be retried. `attempt` is 1-based (the
   * attempt that just failed). Defaults to retrying only transient failures —
   * `network`, `timeout`, `ratelimit`, and 5xx `server` errors — so a `401`,
   * `403`, `404`, or `validation` error fails fast instead of hammering the
   * server. On a `ratelimit` error carrying `retryAfter`, the wait honors it
   * (`max(retryAfter*1000, backoff)`).
   */
  retryOn?: (error: ApiError, attempt: number) => boolean
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

export type BuiltinEffect =
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
