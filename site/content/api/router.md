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
function route<R = any>(segments: Segment[], buildOrOpts: ((params: Record<string, string>) => R) | RouteDefOptions, buildOrToPath?: ((params: Record<string, string>) => R) | { toPath: (route: R) => string }): RouteDef<R>
```

### `createRouter()`

```typescript
function createRouter<R>(defs: RouteDef<any>[], config?: RouterConfig<R>): Router<R>
```

### `matchDef()`

```typescript
function matchDef<R>(def: RouteDef<R>, pathSegments: string[]): Record<string, string> | null
```

### `tryFormat()`

```typescript
function tryFormat<R>(def: RouteDef<R>, r: R): string | null
```

### `parseQuery()`

```typescript
function parseQuery(qs: string): Record<string, string>
```

### `getUrlKeys()`

Extract URL-relevant field names from a route definition

```typescript
function getUrlKeys<R>(def: RouteDef<R>): Set<string>
```

### `partialEqual()`

Compare two objects only on the specified keys

```typescript
function partialEqual(a: Record<string, unknown>, b: Record<string, unknown>, keys: Set<string>): boolean
```

### `deepEqual()`

```typescript
function deepEqual(a: unknown, b: unknown): boolean
```

### `connectRouter()`

```typescript
function connectRouter<R>(router: Router<R>, options?: ConnectOptions<R>): ConnectedRouter<R>
```

## Types

### `Segment`

```typescript
export type Segment = string | ParamSegment | RestSegment
```

## Interfaces

### `ParamSegment`

```typescript
interface ParamSegment {
  __kind: 'param'
  name: string
}
```

### `RestSegment`

```typescript
interface RestSegment {
  __kind: 'rest'
  name: string
}
```

### `RouteDefOptions`

```typescript
interface RouteDefOptions {
  query?: string[]
}
```

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

### `RouterConfig`

```typescript
export interface RouterConfig<R> {
  mode?: 'hash' | 'history'
  fallback?: R
}
```

### `Router`

```typescript
export interface Router<R> {
  /** Match a pathname to a Route. Returns fallback if no match. */
  match(pathname: string): R
  /** Format a Route back to a pathname (without hash/history prefix). */
  toPath(route: R): string
  /** Format a Route to a full href (with # prefix in hash mode). */
  href(route: R): string
  /** The configured mode */
  mode: 'hash' | 'history'
  /** All route definitions (for iteration) */
  routes: ReadonlyArray<RouteDef<R>>
  /** The fallback route */
  fallback: R
}
```

### `RouterEffect`

```typescript
export interface RouterEffect {
  type: '__router'
  action: 'push' | 'replace' | 'back' | 'forward' | 'scroll'
  path?: string
  x?: number
  y?: number
}
```

### `ConnectOptions`

```typescript
export interface ConnectOptions<R> {
  /**
   * Called before entering a new route. Return:
   * - `void` / `undefined` → allow navigation
   * - `false` → block navigation (stay on current route)
   * - a different `Route` → redirect to that route
   */
  beforeEnter?: (to: R, from: R | null) => R | false | void
  /**
   * Called before leaving the current route. Return:
   * - `true` → allow navigation
   * - `false` → block (e.g. unsaved changes prompt)
   */
  beforeLeave?: (from: R, to: R) => boolean
}
```

### `ConnectedRouter`

```typescript
export interface ConnectedRouter<R> {
  /** Effect: push a new route onto history */
  push(route: R): RouterEffect
  /** Effect: replace current history entry */
  replace(route: R): RouterEffect
  /** Effect: go back */
  back(): RouterEffect
  /** Effect: go forward */
  forward(): RouterEffect
  /** Effect: scroll to position */
  scroll(x: number, y: number): RouterEffect

  /** Plugin for handleEffects().use() — handles RouterEffect */
  handleEffect: (ctx: { effect: { type: string }; send: unknown; signal: AbortSignal }) => boolean

  /**
   * View helper: attach URL change listener via onMount.
   * Returns an empty comment node. Sends { type: 'navigate', route } on URL change.
   */
  listener<M>(send: (msg: M) => void, msgFactory?: (route: R) => M): Node[]

  /**
   * View helper: render a navigation link.
   * Generates <a> with proper href and click handler that sends navigate message.
   */
  link<M>(
    send: (msg: M) => void,
    route: R,
    attrs: Record<string, unknown>,
    children: Node[],
    msgFactory?: (route: R) => M,
  ): HTMLElement

  /**
   * Create an update handler for mergeHandlers.
   * Returns [newState, Effect[]] for navigate messages, null for others.
   */
  createHandler<S, M, E>(config: {
    /** Message type to handle (default: 'navigate') */
    message?: string
    /** Extract route from message */
    getRoute: (msg: M) => R
    /** Optional guard — can redirect */
    guard?: (route: R, state: S) => R
    /** Build new state + effects for the route */
    onNavigate: (state: S, route: R) => [S, E[]]
  }): (state: S, msg: M) => [S, E[]] | null
}
```


<!-- auto-api:end -->
