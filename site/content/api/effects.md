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

### `_getEffectInterceptor()`

@internal consumed by `@llui/dom`'s effect-dispatch wrapper.

```typescript
function _getEffectInterceptor(): EffectInterceptor
```

### `_setEffectInterceptor()`

Dev-only hook reserved for Phase 2 use. No-op in production — setting
this is a developer opt-in. When `null`, callers skip the check entirely
so there is zero allocation on the hot path.
Phase 1 reality: `@llui/dom`'s dev effect-dispatch wrapper
(`dispatchEffectDev`) catches every update-loop effect upstream, so
Phase 1 callers of this hook will NOT observe invocations. Third-party
effect libraries must not rely on this hook being called during Phase 1.
Phase 2 wires this for off-loop dispatches (e.g., effects dispatched
from Web Workers or post-mount lifecycle hooks) where `@llui/dom`'s
wrapper doesn't reach.

```typescript
function _setEffectInterceptor(hook: EffectInterceptor): void
```

### `asOnEffect()`

Adapt a `handleEffects()` chain (the `(ctx) => void` returned by `.else()`) to
the signal-runtime `onEffect` shape: `(effect, api) => cleanup`.
The signal runtime now hands `onEffect` a per-mount `api.signal` (an
`AbortSignal` aborted exactly once, on THIS mount's `dispose()`). When present,
this adapter passes that signal straight through to the chain: every mount owns
a distinct signal, so the chain keys its per-mount registries off it and two
concurrent mounts of one definition never interfere. Teardown is driven by the
runtime aborting `api.signal`, so the returned cleanup is a no-op — the chain's
own abort listener clears the mount's pending http / debounce / interval /
websocket resources. We must NOT abort `api.signal` ourselves (it is the
runtime's, shared with everything else on the mount).
FALLBACK: when no `api.signal` is supplied (a bare unit test, or a non-signal
caller), the adapter owns one AbortController per mount and the returned cleanup
aborts it. It is (re)created lazily — never at factory-call time, since
`asOnEffect` typically runs at module top-level where constructing an
AbortController throws on Cloudflare Workers — and recreated once aborted so a
re-mount of the same definition never inherits a dead signal. The cleanup is
memoized per generation so it always targets the controller live at its dispatch.
Usage: `onEffect: asOnEffect(handleEffects<E, M>().use(…).else(…))`.

```typescript
function asOnEffect<E extends { type: string }, M>(
  chain: (ctx: EffectCtx<E, M>) => void,
): (effect: E, api: { send: (msg: M) => void; signal?: AbortSignal }) => () => void
```

### `broadcast()`

```typescript
function broadcast(channel: string, data: unknown): BroadcastEffect
```

### `broadcastListen()`

```typescript
function broadcastListen<M>(
  channel: string,
  onMessage: (data: unknown) => M,
): BroadcastListenEffect<M>
```

### `buildRequest()`

Build the `RequestInit` (method + body + content-type headers) for an http
effect, WITHOUT a signal. Shared by the live `runHttp` and the SSR
`resolveEffects` so both derive identical requests. Callers add `signal`
(and any timeout) themselves.
@internal

```typescript
function buildRequest(effect: HttpEffect): RequestInit
```

### `cancel()`

```typescript
export function cancel(token: string): CancelEffect
export function cancel(token: string, inner: BuiltinEffect): CancelReplaceEffect
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

### `debounce()`

```typescript
function debounce(key: string, ms: number, inner: BuiltinEffect): DebounceEffect
```

### `geolocation()`

```typescript
function geolocation<M>(opts: {
  onSuccess: (position: { latitude: number; longitude: number; accuracy: number }) => M
  onError: (error: string) => M
  enableHighAccuracy?: boolean
}): GeolocationEffect<M>
```

### `handleEffects()`

```typescript
function handleEffects<E extends { type: string }, M = never>(): EffectChain<E, M>
```

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

### `httpStatusToApiError()`

```typescript
function httpStatusToApiError(res: Response): Promise<ApiError>
```

### `interval()`

```typescript
function interval<M>(key: string, ms: number, msg: M): IntervalEffect
```

### `log()`

Log to the console as an effect. Replaces the old core `log` effect.

```typescript
function log(message: string, opts?: { level?: LogEffect['level']; data?: unknown }): LogEffect
```

### `notification()`

```typescript
function notification<M>(
  title: string,
  opts?: {
    body?: string
    icon?: string
    tag?: string
    onClick?: () => M
    onClose?: () => M
    onError?: () => M
  },
): NotificationEffect<M>
```

### `parseResponse()`

Parse a response body by explicit `responseType`, else auto-detect from the
`content-type` header. Shared by `runHttp` and `resolveEffects`.
@internal

```typescript
function parseResponse(
  res: Response,
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer',
): Promise<unknown>
```

### `race()`

```typescript
function race(effects: BuiltinEffect[]): RaceEffect
```

### `resolveEffects()`

Execute all HTTP effects from the effect list, apply responses
to state via update(), return the final loaded state.
Requests are built with the SAME `buildRequest`/`parseResponse` core the live
`http` runner uses, so SSR pre-loading derives identical requests (real headers,
content-type, pass-through bodies, `responseType`) and passes the response's real
`Headers` to `onSuccess`. A rejected fetch (network failure / timeout) is mapped
through the effect's `onError` rather than silently dropped, so SSR and the client
converge on the same failure state.

```typescript
function resolveEffects<S, M extends { type: string }, E extends { type: string }>(
  state: S,
  effects: E[],
  update: UpdateFn<S, M, E>,
  maxDepth = 3,
): Promise<S>
```

### `retry()`

```typescript
function retry(inner: HttpEffect, opts: { maxAttempts: number; delayMs: number }): RetryEffect
```

### `sequence()`

```typescript
function sequence(effects: BuiltinEffect[]): SequenceEffect
```

### `storageGet()`

```typescript
function storageGet<M>(
  key: string,
  onLoad: (value: unknown) => M,
  scope: StorageScope = 'local',
): StorageGetEffect<M>
```

### `storageLoad()`

Synchronous read from storage. Use at init time to seed state. Returns `null` on miss or invalid JSON.

```typescript
function storageLoad<T = unknown>(key: string, scope: StorageScope = 'local'): T | null
```

### `storageRemove()`

```typescript
function storageRemove(key: string, scope: StorageScope = 'local'): StorageRemoveEffect
```

### `storageSet()`

```typescript
function storageSet(key: string, value: unknown, scope: StorageScope = 'local'): StorageSetEffect
```

### `storageWatch()`

```typescript
function storageWatch<M>(
  key: string,
  onChange: (value: unknown) => M,
  scope: StorageScope = 'local',
): StorageWatchEffect<M>
```

### `timeout()`

```typescript
function timeout<M>(ms: number, msg: M): TimeoutEffect
```

### `upload()`

```typescript
function upload<M>(opts: {
  url: string
  method?: string
  body: FormData | Blob
  headers?: Record<string, string>
  timeout?: number
  onProgress: (loaded: number, total: number) => M
  onSuccess: (data: unknown, status: number) => M
  onError: (error: ApiError) => M
}): UploadEffect<M>
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

## Types

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

### `Async`

Models the lifecycle of an async operation.

```typescript
export type Async<T, E> =
  | { type: 'idle' }
  | { type: 'loading'; stale?: T }
  | { type: 'success'; data: T }
  | { type: 'failure'; error: E }
```

### `Effect`

```typescript
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
```

### `EffectInterceptor`

```typescript
export type EffectInterceptor = ((effect: unknown, id: string) => EffectInterceptorResult) | null
```

### `EffectInterceptorResult`

Dev-only effect interceptor hook — consumed by `@llui/mcp` (via
`@llui/dom`'s devtools wiring) to implement effect mocking.
Contract:

- Default state is `null` — zero overhead when no interceptor is set.
- Calling `_setEffectInterceptor(null)` clears the hook.
- The hook receives the raw effect object and an opaque dispatch ID;
  it returns either `{ mocked: true, response }` to short-circuit the
  real effect dispatch, or `{ mocked: false }` to pass through.
  Phase 1 consumers rely on the pass-through path; the short-circuit
  path is exercised end-to-end through `@llui/dom`'s effect-dispatch
  wrapper. This module only owns the null-safe set/get contract.

```typescript
export type EffectInterceptorResult = { mocked: true; response: unknown } | { mocked: false }
```

### `EffectPlugin`

Plugin handler — returns true if the effect was handled, false to pass through.

```typescript
export type EffectPlugin<E, M> = (ctx: EffectCtx<E, M>) => boolean
```

### `StorageScope`

```typescript
export type StorageScope = 'local' | 'session'
```

## Interfaces

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

### `DebounceEffect`

```typescript
export interface DebounceEffect {
  type: 'debounce'
  key: string
  ms: number
  inner: BuiltinEffect
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

### `GeolocationEffect`

```typescript
export interface GeolocationEffect<M = unknown> {
  type: 'geolocation'
  onSuccess: (position: { latitude: number; longitude: number; accuracy: number }) => M
  onError: (error: string) => M
  enableHighAccuracy?: boolean
}
```

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

### `LogEffect`

Write to the console as an effect (effects-as-data debug aid). The signal
runtime intentionally does NOT special-case a `log` effect in core — it is
just data handled here, like every other effect.

```typescript
export interface LogEffect {
  type: 'log'
  message: string
  level?: 'log' | 'info' | 'warn' | 'error' | 'debug'
  data?: unknown
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

### `RaceEffect`

```typescript
export interface RaceEffect {
  type: 'race'
  effects: BuiltinEffect[]
}
```

### `RetryEffect`

```typescript
export interface RetryEffect {
  type: 'retry'
  /** Only `http` effects are retriable — retry re-issues the request on failure. */
  inner: HttpEffect
  maxAttempts: number
  delayMs: number
}
```

### `SequenceEffect`

```typescript
export interface SequenceEffect {
  type: 'sequence'
  effects: BuiltinEffect[]
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

### `StorageRemoveEffect`

Remove a key from storage. Fire-and-forget.

```typescript
export interface StorageRemoveEffect {
  type: 'storage-remove'
  key: string
  scope: StorageScope
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

### `TimeoutEffect`

Fires `msg` once, after `ms` milliseconds. Auto-cancels if the component unmounts.

```typescript
export interface TimeoutEffect {
  type: 'timeout'
  ms: number
  msg: unknown
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
  /** Abort the upload after this many milliseconds (wires `xhr.timeout`). */
  timeout?: number
  onProgress: (loaded: number, total: number) => M
  onSuccess: (data: unknown, status: number) => M
  onError: (error: ApiError) => M
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

## Constants

### `delay`

Delay then dispatch a message — the effects-as-data form of `setTimeout`.
This is the replacement for the old core `delay` effect: `delay(ms, msg)` is
`timeout(ms, msg)` (fire `msg` once after `ms`; auto-cancels on unmount).

```typescript
const delay
```

<!-- auto-api:end -->
