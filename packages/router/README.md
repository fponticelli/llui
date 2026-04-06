# @llui/router

Router for [LLui](https://github.com/fponticelli/llui). Structured path matching with history and hash mode support.

```bash
pnpm add @llui/router
```

## Usage

```ts
import { route, param, rest, createRouter, connectRouter } from '@llui/router'
import { div, a } from '@llui/dom'

// Define routes
const home = route([])
const search = route(['search'], (b) => b, ['q', 'page'])
const detail = route(['item', param('id')])
const docs = route(['docs', rest('path')])

// Create router
const router = createRouter({ home, search, detail, docs }, { mode: 'history' })

// Connect to effects system
const routing = connectRouter(router)
```

## API

### Route Definition

| Function                                | Description                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `route(segments, builder?, queryKeys?)` | Define a route with path segments and optional query keys |
| `param(name)`                           | Named path parameter (e.g. `/item/:id`)                   |
| `rest(name)`                            | Rest parameter capturing remaining path                   |

### Router

| Function                       | Description                                             |
| ------------------------------ | ------------------------------------------------------- |
| `createRouter(routes, config)` | Create router instance (`history` or `hash` mode)       |
| `connectRouter(router)`        | Connect router to LLui effects, returns routing helpers |

### Routing Helpers (from connectRouter)

| Method / Effect                       | Description                                                   |
| ------------------------------------- | ------------------------------------------------------------- |
| `.link(send, route, attrs, children)` | Render a navigation link with client-side routing             |
| `.listener(send)`                     | Popstate listener -- call in `view()` to react to URL changes |
| `.handleEffect`                       | Effect handler plugin for navigate/push/replace effects       |
| `.push(route)`                        | Push navigation effect                                        |
| `.replace(route)`                     | Replace navigation effect                                     |
| `.back()`                             | Navigate back effect                                          |
| `.forward()`                          | Navigate forward effect                                       |
| `.scroll()`                           | Scroll restoration effect                                     |

## License

MIT
