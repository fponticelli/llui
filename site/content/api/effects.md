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

## License

MIT

<!-- auto-api:start -->

## Type Reference

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

### `HttpEffect`

// ── Effect Types ──────────────────────────────────────────────────

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

### `StorageScope`

```typescript
export type StorageScope = 'local' | 'session'
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

### `EffectPlugin`

Plugin handler — returns true if the effect was handled, false to pass through.

```typescript
export type EffectPlugin<E, M> = (ctx: EffectCtx<E, M>) => boolean
```


<!-- auto-api:end -->
