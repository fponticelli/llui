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
  // A capability test, not a position: `0` means "no history here" and is the
  // only value the connector distinguishes (it gates the construction-time
  // seed). Any positive number will do for a surface that has a history.
  get historyLength() {
    return frame.history.length
  },
  setHash: (hash) => {
    frame.location.hash = hash
  },
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

> **Breaking change:** `RouterEnv.replaceLocation` is **gone**. It existed for
> one call site — the hash-mode `replace()` effect — which now writes with
> `replaceState(state, '#/…')` like every other replaced URL in the connector
> ([#164]). `location.replace` **drops** the entry's `history.state` (so the
> stamp, and any key your app owns there, had to be snapshotted and put back)
> and **fires** a `hashchange` (so an echo had to be armed for an event whose
> non-arrival would swallow a later genuine navigation onto the same hash).
> `replaceState` has neither problem. If you implement your own `RouterEnv`,
> delete the member — the interface is exactly what the connector touches, so an
> unused one is drift.

[#164]: https://github.com/fponticelli/llui/issues/164

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

### Redirects are single-hop

A guard redirect is **single-hop**, in both modes and at every call site —
`push()`, `replace()`, `navigate()`, `link()` and the browser-driven listener
alike. `beforeEnter` is asked **once** per navigation; when it returns a target,
that target is the destination and **its own guard is not re-run**.

So this rests on `login`, not on `home`:

```ts
connectRouter(router, {
  beforeEnter(to) {
    if (to.page === 'admin') return { page: 'login' } // taken
    if (to.page === 'login') return { page: 'home' } //  NOT re-asked
  },
})
```

The URL and the dispatched route still **agree** on `login` — a redirect writes
the URL it dispatched (see _Navigation semantics_ below) — so nothing desyncs.
What you get is the first hop, not the fixed point. **Fold the chain yourself**
when you need one:

```ts
connectRouter(router, {
  beforeEnter(to) {
    if (to.page === 'admin') return isLoggedIn() ? { page: 'home' } : { page: 'login' }
  },
})
```

This is deliberate, not a limitation waiting to be lifted. Chaining to a fixed
point needs an **equality on your `Route` type**, and the router has none it can
compute: routes are fully generic, may be primitives (a string-union route is
valid), and may carry fields no URL can express. Identity fails for any guard
that rebuilds the object, structural equality is undefined for an arbitrary `R`,
and `href()` is a lossy projection. Without a fixed-point test, an **idempotent**
guard — one that normalises `to` and returns it, which the "return a Route"
contract explicitly allows — would never settle, so a bounded loop would have to
end by **blocking** a navigation that works today. `beforeLeave` could not be
re-run per hop either: it is the unsaved-changes prompt.

Your app has the route equality the router does not, and `beforeEnter` is a
single function you own — so folding a chain is a local edit, not the middleware
composition the framework would have to do for you. ([#161])

[#161]: https://github.com/fponticelli/llui/issues/161

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
- A **redirected** browser navigation (back/forward or the address bar landing on
  a route whose `beforeEnter` returns a different one) **replaces the entry it
  landed on** with the redirect target, then dispatches it. `state.route` and the
  URL agree, so a reload, a share or a bookmark goes to the redirect target
  rather than back to the guarded route. The entry is _replaced_, never pushed:
  `history.length` is unchanged, back still reaches the entry below and forward
  still reaches every entry above. What stops being reachable at that slot is the
  guarded route itself — returning to it would only redirect again. When the
  landed entry's position is unknown (see the blocked case below) the URL is
  still written, but no index is invented for it. The redirect target's **own**
  guard is not re-run — see _Redirects are single-hop_ — so the URL and the
  route agree on the first hop, and a guard that returns a route addressing the
  URL already showing writes nothing at all.
- A **blocked** browser navigation is undone by a history _traversal_, so the
  stack, its length and every forward entry are left exactly as they were —
  **when the router knows the distance back to the entry it was on**. It knows
  that between two entries it created in one numbering run. It does **not** know
  it for an entry it never stamped, nor across one, because no browser API
  reports a position (see _Which entries the router can place_). Blocking a
  navigation onto or across such an entry is **guard-honouring but not
  undoable**: nothing is dispatched,
  `state.route` keeps the route you never left, and the URL is left showing the
  blocked one until the next navigation — a visible disagreement, deliberately
  preferred over a guessed `history.go(delta)`, which traverses to the wrong
  entry and dispatches a route the user never asked for.

`link()` never intercepts a click carrying a modifier key, a non-`_self`
`target`, a `download` attribute, or a `defaultPrevented` set by an earlier
handler — those are the browser's to handle.

### Which entries the router can place

Every entry `connectRouter` creates is stamped with its position in
`history.state` — an index under `__llui_idx` plus the numbering **run** it
belongs to under `__llui_run`, both merged into whatever your app already keeps
there — starting with the entry the app loaded on. Those are the entries a
blocked navigation can be undone against.

An entry it did **not** create is treated as **unknown**, in both modes, and no
position is invented for one. That covers:

- entries that existed before `connectRouter` ran (a deep link the user
  navigated away from and came back to);
- an entry created by a **foreign `history.pushState`** — analytics, an embedded
  widget, another framework on the page — which fires no event, so the router
  never learns the stack moved. It reads the entry it is standing on rather than
  trusting its own last write, which is how it notices;
- in **hash mode**, an entry created by the user **editing the fragment in the
  address bar**;
- an entry stamped by a **build of this router that predates `__llui_run`** — an
  index with no run beside it. Every such build restarted its numbering across
  entries it could not place and recorded nothing about the restart, so its
  indices name no single run and continuing them would compute a delta straight
  across a gap. The exposure is a **deploy window**: a tab that loaded an older
  build, navigated, and then loaded a newer one on top of that stack loses the
  undo for the entries the older build numbered. The entry the new build loads
  on is re-stamped into a run of its own (your own `history.state` keys are
  preserved), so everything it goes on to create is placeable as usual.

Such an entry also **ends a run**. Indices count physical entries, so they only
subtract to a distance while every entry between two of them was numbered in one
pass; the entries the router numbers after an unknown one start a new run and
count from their own origin. A delta is computed only within a single run.

The address-bar edit itself works normally — guards run, the message is
dispatched, `state.route` follows. What is given up is the _undo_, in two
shapes — both of which leave the stack exactly as it was:

- a guard-blocked traversal **onto** an entry the router never stamped;
- a guard-blocked traversal **across** one — a `history.go(-3)` from a
  back-button long-press menu, say, that spans a hand-edited entry.

In both, the URL is left showing the route the guard refused until the next
navigation, nothing is dispatched, and `state.route` keeps the route you never
left.

There is one gap no `history.state` scheme can close: an **iframe navigation**
grows the _joint_ session history without moving the top-level document, so the
entry it adds is invisible to the stamps above and below it, and even a
single-step delta can under-count. That needs the Navigation API (below).

That is an accepted trade, decided in [#150]. The alternative was to classify an
unstamped `hashchange` by watching `history.length` grow — a push grows the
session history, a traversal does not. It works only while the router has seen
every change to the stack, and it cannot: a **foreign `history.pushState`**
(analytics, an embedded widget, another framework on the page) or an **iframe
navigation** grows the joint session history without firing anything the router
listens to. The cached length then reads a traversal as a push and stamps an
**inverted** index — the entry below numbered above the one it sits under — and
the next blocked back computes its delta from that and traverses **two** entries
backwards, landing somewhere the user never asked for. Refusing to guess costs
an undo; guessing corrupts the stack.

(The `popstate`-vs-`hashchange` distinction is not an alternative: assigning
`location.hash` fires both events, in the same order as `history.back()` —
measured in Chromium 143, with the `location.hash` half reproduced in this
package's jsdom tests. `navigation.currentEntry.index` from the Navigation API
is an authoritative position, immune to foreign `pushState` and iframes alike,
and is the real fix once it can be relied on.)

[#150]: https://github.com/fponticelli/llui/issues/150

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
