// ── Builders ──────────────────────────────────────────────────────

import type {
  BroadcastEffect,
  BroadcastListenEffect,
  BuiltinEffect,
  CancelEffect,
  CancelReplaceEffect,
  ClipboardReadEffect,
  ClipboardWriteEffect,
  DebounceEffect,
  GeolocationEffect,
  HttpEffect,
  IntervalEffect,
  LogEffect,
  NotificationEffect,
  RaceEffect,
  RetryEffect,
  SequenceEffect,
  StorageGetEffect,
  StorageRemoveEffect,
  StorageScope,
  StorageSetEffect,
  StorageWatchEffect,
  TimeoutEffect,
  UploadEffect,
  WebSocketEffect,
  WebSocketSendEffect,
  ApiError,
} from './types.js'

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

// ── Upload ──────────────────────────────────────────────

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
