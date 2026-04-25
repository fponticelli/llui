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
const onEffect = handleEffects<Effect, Msg>().else(({ effect, send, signal }) => {
  // Custom effects beyond the built-in catalogue (http, cancel,
  // debounce, etc.) — handle them here. Built-ins are processed by
  // handleEffects internally; you do not need to register a plugin
  // for them.
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
| `storageLoad<T>(key, scope?)`                              | Synchronous read helper (not an effect)         |
| `broadcast(channel, data)`                                 | Send on BroadcastChannel                        |
| `broadcastListen(channel, onMsg)`                          | Listen on BroadcastChannel                      |
| `websocket({ url, key, onOpen, onMessage, onClose? })`     | Open and subscribe to a WebSocket               |
| `wsSend(key, data)`                                        | Send a frame on a `key`-identified WebSocket    |
| `sequence([...effects])`                                   | Run effects in order                            |
| `race([...effects])`                                       | Run effects concurrently, first wins            |
| `retry(inner, { maxAttempts, delayMs })`                   | Retry inner effect with linear backoff          |
| `upload({ url, body, onProgress, onSuccess, onError })`    | File upload with progress via XHR               |
| `clipboardRead({ onSuccess, onError })`                    | Read text from clipboard                        |
| `clipboardWrite(text)`                                     | Write text to clipboard                         |
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

Read and write text via the Clipboard API. Both functions return an
effect that you yield from `update()`:

```ts
import { clipboardRead, clipboardWrite } from '@llui/effects'

// Copy: yield clipboardWrite from update()
return [state, [clipboardWrite('Hello, world!')]]

// Read: yield clipboardRead from update()
return [
  state,
  [
    clipboardRead({
      onSuccess: (text) => ({ type: 'pasted', text }),
      onError: (error) => ({ type: 'clipError', error }),
    }),
  ],
]
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
