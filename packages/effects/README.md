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

| Function                              | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `http({ url, onSuccess, onError })`   | HTTP request effect                            |
| `cancel(token, inner?)`               | Cancel by token, optionally replace with inner |
| `debounce(key, ms, inner)`            | Debounce inner effect by key                   |
| `timeout(ms, msg)`                    | Fire msg after delay                           |
| `interval(ms, msg)`                   | Fire msg on interval                           |
| `storageSet(key, value, storage?)`    | Write to localStorage/sessionStorage           |
| `storageGet(key, onResult, storage?)` | Read from storage                              |
| `storageRemove(key, storage?)`        | Remove from storage                            |
| `storageWatch(key, onChange)`         | Watch storage for changes                      |
| `broadcast(channel, data)`            | Send on BroadcastChannel                       |
| `broadcastListen(channel, onMsg)`     | Listen on BroadcastChannel                     |
| `sequence([...effects])`              | Run effects in order                           |
| `race([...effects])`                  | Run effects concurrently, first wins           |
| `upload({ url, body, onProgress, onSuccess, onError })` | File upload with progress via XHR |

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
