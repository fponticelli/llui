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

| Function                       | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| `createRouter(routes, config)` | Create router instance (`history` or `hash` mode)           |
| `connectRouter(router)`        | Connect router to LLui effects, returns routing helpers     |
| `browserRouterEnv()`           | The default History/Location adapter `connectRouter` drives |

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

## History / Location adapter

`connectRouter` never reaches for `location`, `history` or `window` directly —
every URL read and mutation goes through an injectable `RouterEnv`, the same
pattern `@llui/dom` uses for `DomEnv`. The default is `browserRouterEnv()`,
whose reads fall back to `''`/`null` where the global is absent, so building the
connector at module scope on a server is safe.

Pass your own to drive a test, an SSR host, or an embedded frame without
touching the page's history:

```ts
import { connectRouter, browserRouterEnv } from '@llui/router/connect'
import type { RouterEnv } from '@llui/router/connect'

// The default, spelled out — identical to passing no `env` at all.
const routing = connectRouter(router, { env: browserRouterEnv() })

// Or drive an iframe's history instead of the page's. Implement the members
// yourself; do NOT spread `browserRouterEnv()`, which would evaluate its getters
// once and freeze `hash`/`pathname` at construction time.
const frame = document.querySelector('iframe')!.contentWindow!
const frameEnv: RouterEnv = {
  get hash() {
    return frame.location.hash
  },
  get pathname() {
    return frame.location.pathname
  },
  get search() {
    return frame.location.search
  },
  get historyState() {
    return frame.history.state
  },
  // Load-bearing: it is what tells a NEW hash navigation apart from a
  // traversal. A constant here makes every unstamped hash entry read as a
  // traversal.
  get historyLength() {
    return frame.history.length
  },
  setHash: (hash) => {
    frame.location.hash = hash
  },
  replaceLocation: (url) => frame.location.replace(url),
  pushState: (state, url) => frame.history.pushState(state, '', url),
  // `url` is optional: omit it to replace the entry's STATE and leave the URL
  // alone. Passing `''` is not the same thing — it resolves against the base
  // and drops the fragment.
  replaceState: (state, url) => frame.history.replaceState(state, '', url ?? null),
  back: () => frame.history.back(),
  forward: () => frame.history.forward(),
  go: (delta) => frame.history.go(delta),
  scrollTo: (x, y) => frame.scrollTo(x, y),
  onUrlChange: (event, handler) => {
    frame.addEventListener(event, handler)
    return () => frame.removeEventListener(event, handler)
  },
}

const framed = connectRouter(router, { env: frameEnv })
```

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

## Navigation semantics

The same contract holds in **both** `history` and `hash` mode:

- **`link()`** runs the guards at click time, writes the URL, and dispatches the
  navigate message itself. It does **not** depend on `listener()` being mounted.
  A click on the route you are already on still dispatches — it is a request to
  re-enter that route, not a no-op — though no duplicate URL is written in hash
  mode, where the hash is already correct. A blocked click writes nothing and
  dispatches nothing.
- **`listener()`** handles only **browser-driven** URL changes: back/forward and
  the address bar. Our own writes never dispatch through it twice.
- **`push()` / `replace()`** are **URL-only**: use them when the reducer that
  emitted the effect already updated `state.route`. The one exception is a guard
  **redirect** — the URL then points somewhere the caller never asked for, so the
  navigate message is dispatched and `state.route` and the URL stay in agreement.
  Use **`navigate()`** when you want the push _and_ the dispatch unconditionally.
- A **blocked** browser navigation is undone by a history _traversal_, so the
  stack, its length and every forward entry are left exactly as they were —
  **when the router knows where the popped entry sits**. It knows that for every
  entry it created itself. It does **not** know it for an entry that existed
  before `connectRouter` ran (a deep link the user then navigated away from and
  came back to), because no browser API reports a position. Blocking a
  navigation onto such an entry is **guard-honouring but not undoable**: nothing
  is dispatched, `state.route` keeps the route you never left, and the URL is
  left showing the blocked one until the next navigation — a visible
  disagreement, deliberately preferred over a guessed `history.go(delta)`, which
  traverses to the wrong entry and dispatches a route the user never asked for.

`link()` never intercepts a click carrying a modifier key, a non-`_self`
`target`, a `download` attribute, or a `defaultPrevented` set by an earlier
handler — those are the browser's to handle.

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
