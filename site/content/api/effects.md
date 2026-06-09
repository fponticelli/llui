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

### `resolveEffects()`

Execute all HTTP effects from the effect list, apply responses
to state via update(), return the final loaded state.

```typescript
function resolveEffects<S, M extends { type: string }, E extends { type: string }>(
  state: S,
  effects: E[],
  update: UpdateFn<S, M, E>,
  maxDepth = 3,
): Promise<S>
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

### `_getEffectInterceptor()`

@internal consumed by `@llui/dom`'s effect-dispatch wrapper.

```typescript
function _getEffectInterceptor(): EffectInterceptor
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

### `log()`

Log to the console as an effect. Replaces the old core `log` effect.

```typescript
function log(message: string, opts?: { level?: LogEffect['level']; data?: unknown }): LogEffect
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
function storageGet<M>(
  key: string,
  onLoad: (value: unknown) => M,
  scope: StorageScope = 'local',
): StorageGetEffect<M>
```

### `storageWatch()`

```typescript
function storageWatch<M>(
  key: string,
  onChange: (value: unknown) => M,
  scope: StorageScope = 'local',
): StorageWatchEffect<M>
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

### `asOnEffect()`

Adapt a `handleEffects()` chain (the `(ctx) => void` returned by `.else()`) to
the signal-runtime `onEffect` shape: `(effect, { send }) => cleanup`.
The signal component's `onEffect` takes the effect + a `{ send }` api and may
return a cleanup (run on unmount) — there is no ambient `AbortSignal` like the
legacy runtime passed. This adapter owns one AbortController per MOUNT: every
effect dispatched during a mount shares that mount's `signal`, and the returned
cleanup aborts it, so in-flight http / debounce / interval / websocket effects
tear down when the component unmounts (the chain's own abort listener clears its
pending registries).
Lifetime is per-mount, not per-definition. `asOnEffect(chain)` is evaluated once
at the component literal, so the returned `onEffect` is reused across every mount
of that definition (the runtime reads `def.onEffect`). A client-side re-mount
(e.g. @llui/vike disposing + re-mounting a page on SPA navigation) must therefore
get a FRESH, non-aborted controller — otherwise the previous unmount's abort
leaks into the next mount and any async effect that guards on `signal.aborted`
before its `send` silently drops its result, leaving state stuck mid-transition.
Usage: `onEffect: asOnEffect(handleEffects<E, M>().http(…).else(…))`.

```typescript
function asOnEffect<E extends { type: string }, M>(
  chain: (ctx: EffectCtx<E, M>) => void,
): (effect: E, api: { send: (msg: M) => void }) => () => void
```

## Types

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

### `EffectInterceptor`

```typescript
export type EffectInterceptor = ((effect: unknown, id: string) => EffectInterceptorResult) | null
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

## Constants

### `delay`

Delay then dispatch a message — the effects-as-data form of `setTimeout`.
This is the replacement for the old core `delay` effect: `delay(ms, msg)` is
`timeout(ms, msg)` (fire `msg` once after `ms`; auto-cancels on unmount).

```typescript
const delay
```

<!-- auto-api:end -->
