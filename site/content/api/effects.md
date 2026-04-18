---
title: '@llui/effects'
description: 'Effect builders: http, cancel, debounce, websocket, retry, upload'
---

# @llui/effects

Effect builders for [LLui](https://github.com/fponticelli/llui). Effects are data -- `update()` returns them, the runtime dispatches.

```bash
pnpm add @llui/effects
```

## Usage

```ts
import { http, cancel, debounce, handleEffects } from '@llui/effects'

// Debounced search with cancel
function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'search':
      return [
        { ...state, query: msg.value },
        [
          cancel('search'),
          debounce(
            'search',
            300,
            http({
              url: `/api/search?q=${msg.value}`,
              onSuccess: (data) => ({ type: 'results', data }),
              onError: (err) => ({ type: 'searchError', err }),
            }),
          ),
        ],
      ]
  }
}

// Wire up in component
const handler = handleEffects<Effect, Msg>()
  .use(httpPlugin)
  .else((effect, send) => {
    /* custom effects */
  })
```

## API

### Effect Builders

| Function                                                   | Description                                     |
| ---------------------------------------------------------- | ----------------------------------------------- |
| `http({ url, onSuccess, onError })`                        | HTTP request effect                             |
| `cancel(token, inner?)`                                    | Cancel by token, optionally replace with inner  |
| `debounce(key, ms, inner)`                                 | Debounce inner effect by key                    |
| `timeout(ms, msg)`                                         | Fire msg after delay                            |
| `interval(ms, msg)`                                        | Fire msg on interval                            |
| `storageSet(key, value, storage?)`                         | Write to localStorage/sessionStorage            |
| `storageGet(key, onResult, storage?)`                      | Read from storage                               |
| `storageRemove(key, storage?)`                             | Remove from storage                             |
| `storageWatch(key, onChange)`                              | Watch storage for changes                       |
| `broadcast(channel, data)`                                 | Send on BroadcastChannel                        |
| `broadcastListen(channel, onMsg)`                          | Listen on BroadcastChannel                      |
| `sequence([...effects])`                                   | Run effects in order                            |
| `race([...effects])`                                       | Run effects concurrently, first wins            |
| `upload({ url, body, onProgress, onSuccess, onError })`    | File upload with progress via XHR               |
| `clipboardRead({ onSuccess, onError })`                    | Read text from clipboard                        |
| `clipboardWrite(text)`                                     | Write text to clipboard (fire-and-forget)       |
| `notification(title, opts?)`                               | Show browser notification (requests permission) |
| `geolocation({ onSuccess, onError, enableHighAccuracy? })` | One-shot geolocation position                   |

### Upload

Upload files with progress tracking via XMLHttpRequest:

```ts
import { upload } from '@llui/effects'

const effect = upload({
  url: '/api/upload',
  body: formData,
  headers: { Authorization: `Bearer ${token}` },
  onProgress: (loaded, total) => ({
    type: 'uploadProgress',
    pct: Math.round((loaded / total) * 100),
  }),
  onSuccess: (data, status) => ({ type: 'uploadDone', data, status }),
  onError: (error) => ({ type: 'uploadFailed', error }),
})
```

### Clipboard

Read and write text via the Clipboard API:

```ts
import { clipboardRead, clipboardWrite } from '@llui/effects'

// Copy text to clipboard (fire-and-forget)
clipboardWrite('Hello, world!')

// Read text from clipboard
clipboardRead({
  onSuccess: (text) => ({ type: 'pasted', text }),
  onError: (error) => ({ type: 'clipError', error }),
})
```

### Notification

Show browser notifications (requests permission automatically):

```ts
import { notification } from '@llui/effects'

notification('New message', {
  body: 'You have a new message from Alice',
  icon: '/avatar.png',
  onClick: () => ({ type: 'openChat' }),
  onError: () => ({ type: 'notifBlocked' }),
})
```

### Geolocation

One-shot position request:

```ts
import { geolocation } from '@llui/effects'

geolocation({
  enableHighAccuracy: true,
  onSuccess: (pos) => ({
    type: 'located',
    lat: pos.latitude,
    lng: pos.longitude,
  }),
  onError: (error) => ({ type: 'geoError', error }),
})
```

### Effect Handling

| Function                | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `handleEffects<E, M>()` | Chainable effect handler builder                 |
| `.use(plugin)`          | Add an effect handler plugin                     |
| `.else(handler)`        | Fallback for unhandled effects                   |
| `resolveEffects(def)`   | SSR data loading -- resolves effects server-side |

### Types

| Type          | Description                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `Async<T, E>` | `idle \| loading \| success \| failure` -- async data state                                        |
| `ApiError`    | `network \| timeout \| notfound \| unauthorized \| forbidden \| ratelimit \| validation \| server` |

<!-- auto-api:start -->

## Functions

### `http()`

```typescript
function http<M>(opts: {
  url: string
  method?: string
  body?: unknown
  contentType?: string
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'
  onSuccess: (data: unknown, headers: Headers) => M
  onError: (error: ApiError) => M
}): HttpEffect<M>
```

### `cancel()`

```typescript
export function cancel(token: string): CancelEffect
export function cancel(token: string, inner: BuiltinEffect): CancelReplaceEffect
```

### `debounce()`

```typescript
function debounce(key: string, ms: number, inner: BuiltinEffect): DebounceEffect
```

### `timeout()`

```typescript
function timeout<M>(ms: number, msg: M): TimeoutEffect
```

### `interval()`

```typescript
function interval<M>(key: string, ms: number, msg: M): IntervalEffect
```

### `storageLoad()`

Synchronous read from storage. Use at init time to seed state. Returns `null` on miss or invalid JSON.

```typescript
function storageLoad<T = unknown>(key: string, scope: StorageScope = 'local'): T | null
```

### `storageSet()`

```typescript
function storageSet(key: string, value: unknown, scope: StorageScope = 'local'): StorageSetEffect
```

### `storageRemove()`

```typescript
function storageRemove(key: string, scope: StorageScope = 'local'): StorageRemoveEffect
```

### `storageGet()`

```typescript
function storageGet<M>(key: string, onLoad: (value: unknown) => M, scope: StorageScope = 'local'): StorageGetEffect<M>
```

### `storageWatch()`

```typescript
function storageWatch<M>(key: string, onChange: (value: unknown) => M, scope: StorageScope = 'local'): StorageWatchEffect<M>
```

### `broadcast()`

```typescript
function broadcast(channel: string, data: unknown): BroadcastEffect
```

### `broadcastListen()`

```typescript
function broadcastListen<M>(channel: string, onMessage: (data: unknown) => M): BroadcastListenEffect<M>
```

### `websocket()`

```typescript
function websocket<M>(opts: {
  url: string
  key: string
  protocols?: string[]
  onOpen?: () => M
  onMessage: (data: unknown) => M
  onClose?: (code: number, reason: string) => M
  onError?: () => M
}): WebSocketEffect<M>
```

### `wsSend()`

```typescript
function wsSend(key: string, data: unknown): WebSocketSendEffect
```

### `retry()`

```typescript
function retry(inner: BuiltinEffect, opts: { maxAttempts: number; delayMs: number }): RetryEffect
```

### `upload()`

```typescript
function upload<M>(opts: {
  url: string
  method?: string
  body: FormData | Blob
  headers?: Record<string, string>
  onProgress: (loaded: number, total: number) => M
  onSuccess: (data: unknown, status: number) => M
  onError: (error: ApiError) => M
}): UploadEffect<M>
```

### `clipboardRead()`

```typescript
function clipboardRead<M>(opts: {
  onSuccess: (text: string) => M
  onError: (error: string) => M
}): ClipboardReadEffect<M>
```

### `clipboardWrite()`

```typescript
function clipboardWrite(text: string): ClipboardWriteEffect
```

### `notification()`

```typescript
function notification<M>(title: string, opts?: {
    body?: string
    icon?: string
    tag?: string
    onClick?: () => M
    onClose?: () => M
    onError?: () => M
  }): NotificationEffect<M>
```

### `geolocation()`

```typescript
function geolocation<M>(opts: {
  onSuccess: (position: { latitude: number; longitude: number; accuracy: number }) => M
  onError: (error: string) => M
  enableHighAccuracy?: boolean
}): GeolocationEffect<M>
```

### `sequence()`

```typescript
function sequence(effects: BuiltinEffect[]): SequenceEffect
```

### `race()`

```typescript
function race(effects: BuiltinEffect[]): RaceEffect
```

### `handleEffects()`

```typescript
function handleEffects<E extends { type: string }, M = never>(): EffectChain<E, M>
```

### `dispatchEffect()`

```typescript
function dispatchEffect(effect: { type: string }, send: InternalSend, signal: AbortSignal, cancelControllers: Map<string, AbortController>, debounceTimers: Map<string, ReturnType<typeof setTimeout>>, websockets: Map<string, WebSocket>, custom: InternalHandler): void
```

### `isPassThroughBody()`

```typescript
function isPassThroughBody(body: unknown): body is FormData | Blob | URLSearchParams | ArrayBuffer
```

### `runHttp()`

```typescript
function runHttp(effect: HttpEffect, send: InternalSend, signal: AbortSignal): void
```

### `parseResponseBody()`

```typescript
function parseResponseBody(res: Response, responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer'): Promise<unknown>
```

### `httpStatusToApiError()`

```typescript
function httpStatusToApiError(res: Response): Promise<ApiError>
```

### `runCancel()`

```typescript
function runCancel(effect: CancelEffect | CancelReplaceEffect, send: InternalSend, componentSignal: AbortSignal, cancelControllers: Map<string, AbortController>, debounceTimers: Map<string, ReturnType<typeof setTimeout>>, websockets: Map<string, WebSocket>, custom: InternalHandler): void
```

### `runTimeout()`

```typescript
function runTimeout(effect: TimeoutEffect, send: InternalSend, signal: AbortSignal): void
```

### `runInterval()`

```typescript
function runInterval(effect: IntervalEffect, send: InternalSend, componentSignal: AbortSignal, cancelControllers: Map<string, AbortController>): void
```

### `runDebounce()`

```typescript
function runDebounce(effect: DebounceEffect, send: InternalSend, componentSignal: AbortSignal, cancelControllers: Map<string, AbortController>, debounceTimers: Map<string, ReturnType<typeof setTimeout>>, websockets: Map<string, WebSocket>, custom: InternalHandler): void
```

### `getStorage()`

```typescript
function getStorage(scope: StorageScope): Storage | null
```

### `runStorageSet()`

```typescript
function runStorageSet(effect: StorageSetEffect): void
```

### `runStorageRemove()`

```typescript
function runStorageRemove(effect: StorageRemoveEffect): void
```

### `runStorageGet()`

```typescript
function runStorageGet(effect: StorageGetEffect, send: InternalSend): void
```

### `runStorageWatch()`

```typescript
function runStorageWatch(effect: StorageWatchEffect, send: InternalSend, signal: AbortSignal): void
```

### `runBroadcast()`

```typescript
function runBroadcast(effect: BroadcastEffect): void
```

### `runBroadcastListen()`

```typescript
function runBroadcastListen(effect: BroadcastListenEffect, send: InternalSend, signal: AbortSignal): void
```

### `runWebSocket()`

```typescript
function runWebSocket(effect: WebSocketEffect, send: InternalSend, signal: AbortSignal, websockets: Map<string, WebSocket>): void
```

### `runWsSend()`

```typescript
function runWsSend(effect: WebSocketSendEffect, websockets: Map<string, WebSocket>): void
```

### `runRetry()`

```typescript
function runRetry(effect: RetryEffect, send: InternalSend, signal: AbortSignal, cancelControllers: Map<string, AbortController>, debounceTimers: Map<string, ReturnType<typeof setTimeout>>, websockets: Map<string, WebSocket>, custom: InternalHandler): void
```

### `runUpload()`

```typescript
function runUpload(effect: UploadEffect, send: InternalSend, signal: AbortSignal): void
```

### `runSequence()`

```typescript
function runSequence(effect: SequenceEffect, send: InternalSend, signal: AbortSignal, cancelControllers: Map<string, AbortController>, debounceTimers: Map<string, ReturnType<typeof setTimeout>>, websockets: Map<string, WebSocket>, custom: InternalHandler): void
```

### `runRace()`

```typescript
function runRace(effect: RaceEffect, send: InternalSend, signal: AbortSignal, cancelControllers: Map<string, AbortController>, debounceTimers: Map<string, ReturnType<typeof setTimeout>>, websockets: Map<string, WebSocket>, custom: InternalHandler): void
```

### `runClipboardRead()`

```typescript
function runClipboardRead(effect: ClipboardReadEffect, send: InternalSend, signal: AbortSignal): void
```

### `runClipboardWrite()`

```typescript
function runClipboardWrite(effect: ClipboardWriteEffect): void
```

### `runNotification()`

```typescript
function runNotification(effect: NotificationEffect, send: InternalSend, signal: AbortSignal): void
```

### `runGeolocation()`

```typescript
function runGeolocation(effect: GeolocationEffect, send: InternalSend, signal: AbortSignal): void
```

## Types

### `Async`

Models the lifecycle of an async operation.

```typescript
export type Async<T, E> =
  | { type: 'idle' }
  | { type: 'loading'; stale?: T }
  | { type: 'success'; data: T }
  | { type: 'failure'; error: E }
```

### `ApiError`

Standard API error type produced by the http() effect.

```typescript
export type ApiError =
  | { kind: 'network'; message: string }
  | { kind: 'timeout' }
  | { kind: 'notfound' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'ratelimit'; retryAfter?: number }
  | { kind: 'validation'; fields: Record<string, string[]> }
  | { kind: 'server'; status: number; message: string }
```

### `StorageScope`

```typescript
export type StorageScope = 'local' | 'session'
```

### `BuiltinEffect`

```typescript
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
```

### `InternalSend`

```typescript
type InternalSend = (msg: unknown) => void
```

### `InternalHandler`

```typescript
type InternalHandler = (effect: { type: string }, send: InternalSend, signal: AbortSignal) => void
```

### `EffectPlugin`

Plugin handler — returns true if the effect was handled, false to pass through.

```typescript
export type EffectPlugin<E, M> = (ctx: EffectCtx<E, M>) => boolean
```

## Interfaces

### `HttpEffect`

```typescript
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
```

### `CancelEffect`

```typescript
export interface CancelEffect {
  type: 'cancel'
  token: string
}
```

### `CancelReplaceEffect`

```typescript
export interface CancelReplaceEffect {
  type: 'cancel'
  token: string
  inner: BuiltinEffect
}
```

### `DebounceEffect`

```typescript
export interface DebounceEffect {
  type: 'debounce'
  key: string
  ms: number
  inner: BuiltinEffect
}
```

### `TimeoutEffect`

Fires `msg` once, after `ms` milliseconds. Auto-cancels if the component unmounts.

```typescript
export interface TimeoutEffect {
  type: 'timeout'
  ms: number
  msg: unknown
}
```

### `IntervalEffect`

Fires `msg` every `ms` milliseconds. Cancel with `cancel(key)`.

```typescript
export interface IntervalEffect {
  type: 'interval'
  key: string
  ms: number
  msg: unknown
}
```

### `StorageSetEffect`

Write a JSON value to localStorage/sessionStorage. Fire-and-forget.

```typescript
export interface StorageSetEffect {
  type: 'storage-set'
  key: string
  value: unknown
  scope: StorageScope
}
```

### `StorageRemoveEffect`

Remove a key from storage. Fire-and-forget.

```typescript
export interface StorageRemoveEffect {
  type: 'storage-remove'
  key: string
  scope: StorageScope
}
```

### `StorageGetEffect`

Read a key from storage, dispatch the message returned by `onLoad(value)`.

```typescript
export interface StorageGetEffect<M = unknown> {
  type: 'storage-get'
  key: string
  onLoad: (value: unknown) => M
  scope: StorageScope
}
```

### `StorageWatchEffect`

Listen for changes to a storage key. Fires the message returned by `onChange(value)` on cross-tab writes.

```typescript
export interface StorageWatchEffect<M = unknown> {
  type: 'storage-watch'
  key: string
  onChange: (value: unknown) => M
  scope: StorageScope
}
```

### `BroadcastEffect`

Post a message to a BroadcastChannel. Fire-and-forget.

```typescript
export interface BroadcastEffect {
  type: 'broadcast'
  channel: string
  data: unknown
}
```

### `BroadcastListenEffect`

Subscribe to a BroadcastChannel. Fires the message returned by `onMessage(data)` per incoming message.

```typescript
export interface BroadcastListenEffect<M = unknown> {
  type: 'broadcast-listen'
  channel: string
  onMessage: (data: unknown) => M
}
```

### `SequenceEffect`

```typescript
export interface SequenceEffect {
  type: 'sequence'
  effects: BuiltinEffect[]
}
```

### `RaceEffect`

```typescript
export interface RaceEffect {
  type: 'race'
  effects: BuiltinEffect[]
}
```

### `WebSocketEffect`

```typescript
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
```

### `WebSocketSendEffect`

```typescript
export interface WebSocketSendEffect {
  type: 'ws-send'
  key: string
  data: unknown
}
```

### `UploadEffect`

```typescript
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
```

### `RetryEffect`

```typescript
export interface RetryEffect {
  type: 'retry'
  inner: BuiltinEffect
  maxAttempts: number
  delayMs: number
}
```

### `ClipboardReadEffect`

```typescript
export interface ClipboardReadEffect<M = unknown> {
  type: 'clipboard-read'
  onSuccess: (text: string) => M
  onError: (error: string) => M
}
```

### `ClipboardWriteEffect`

```typescript
export interface ClipboardWriteEffect {
  type: 'clipboard-write'
  text: string
}
```

### `NotificationEffect`

```typescript
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
```

### `GeolocationEffect`

```typescript
export interface GeolocationEffect<M = unknown> {
  type: 'geolocation'
  onSuccess: (position: { latitude: number; longitude: number; accuracy: number }) => M
  onError: (error: string) => M
  enableHighAccuracy?: boolean
}
```

### `EffectCtx`

```typescript
export interface EffectCtx<E, M> {
  effect: E
  send: (msg: M) => void
  signal: AbortSignal
}
```

### `EffectChain`

```typescript
interface EffectChain<E extends { type: string }, M> {
  /** Add a plugin that handles specific effects. Returns true if handled, false to pass through. */
  use<E2, M2>(plugin: EffectPlugin<E2, M2>): EffectChain<E, M>
  /** Terminal handler for remaining effects. Returns the final onEffect function. */
  else(handler: (ctx: EffectCtx<E, M>) => void): (ctx: EffectCtx<E, M>) => void
}
```


<!-- auto-api:end -->
