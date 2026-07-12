---
title: '@llui/router'
description: 'Routing: structured path matching, guards, history/hash mode, link helper'
---

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

## Guards

Router guards let you block or redirect navigation. Pass `beforeEnter` and/or `beforeLeave` to `connectRouter`:

```ts
const routing = connectRouter(router, {
  // Called before entering a new route
  beforeEnter(to, from) {
    // Return void   -> allow
    // Return false  -> block
    // Return Route  -> redirect
  },
  // Called before leaving the current route
  beforeLeave(from, to) {
    // Return true  -> allow
    // Return false -> block
  },
})
```

Guards run in the effect handler and the popstate listener, keeping `update()` pure.

### Auth guard

```ts
const routing = connectRouter(router, {
  beforeEnter(to) {
    if (to.page === 'admin' && !isLoggedIn()) {
      return { page: 'login' }
    }
  },
})
```

### Unsaved changes guard

```ts
const routing = connectRouter(router, {
  beforeLeave(from) {
    if (from.page === 'editor' && hasUnsavedChanges()) {
      return confirm('Discard unsaved changes?')
    }
    return true
  },
})
```

<!-- auto-api:start -->

## Functions

### `createRouter()`

```typescript
function createRouter<R>(defs: RouteDef<any>[], config?: RouterConfig<R>): Router<R>
```

### `param()`

Named path parameter: matches one segment

```typescript
function param(name: string): ParamSegment
```

### `rest()`

Rest parameter: matches remaining segments

```typescript
function rest(name: string): RestSegment
```

### `route()`

Define a route with structured path segments.
@example
route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug }))
route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' }))

```typescript
function route<R = any>(
  segments: Segment[],
  buildOrOpts: ((params: Record<string, string>) => R) | RouteDefOptions,
  buildOrToPath?: ((params: Record<string, string>) => R) | { toPath: (route: R) => string },
): RouteDef<R>
```

## Types

### `Segment`

```typescript
export type Segment = string | ParamSegment | RestSegment
```

## Interfaces

### `RouteDef`

```typescript
export interface RouteDef<R> {
  segments: Segment[]
  build: (params: Record<string, string>) => R
  queryKeys: string[]
  /** Optional manual toPath override */
  toPath?: (route: R) => string
}
```

### `Router`

```typescript
export interface Router<R> {
  /** Match a pathname to a Route. Returns fallback if no match. */
  match(pathname: string): R
  /** Format a Route back to a pathname (base prefixed in history mode, no hash prefix). */
  toPath(route: R): string
  /** Format a Route to a full href (# prefix in hash mode, base prefix in history mode). */
  href(route: R): string
  /** The configured mode */
  mode: 'hash' | 'history'
  /** The normalized base path (empty string when none) */
  base: string
  /** All route definitions (for iteration) */
  routes: ReadonlyArray<RouteDef<R>>
  /** The fallback route */
  fallback: R
}
```

### `RouterConfig`

```typescript
export interface RouterConfig<R> {
  mode?: 'hash' | 'history'
  fallback?: R
  /**
   * Base path (history mode only). All matched pathnames must start with it —
   * a non-matching prefix resolves to `fallback`. `toPath`/`href` prepend it.
   * Trailing slashes are normalized away, e.g. `'/app/'` → `'/app'`.
   */
  base?: string
}
```

<!-- auto-api:end -->
