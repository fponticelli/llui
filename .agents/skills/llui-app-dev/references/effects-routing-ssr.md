# Effects, data fetching, routing, SSR

## Effects as data (@llui/effects)

The runtime core special-cases **no** effect type. `update` returns `[state, effects]`;
each effect is a plain data object handed to your `onEffect`. `@llui/effects` provides
the builders and a handler chain.

### Builders (return effect-data for the `E[]`)

```ts
import { http, cancel, debounce, sequence, race, timeout, interval, log } from '@llui/effects'

http<Msg>({
  url, method?, body?, headers?, timeout?,
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer',
  onSuccess: (data, headers) => Msg,
  onError: (error: ApiError) => Msg,
})
cancel(token)                         // cancel an in-flight keyed effect
cancel(token, inner)                  // cancel-and-replace
debounce(key, ms, inner)              // coalesce; only the last within `ms` runs
sequence([...effects])                // run in order, each after the previous completes
race([...effects])                    // first to settle wins
timeout(ms, msg) / delay(ms, msg)     // fire `msg` once after ms (delay is an alias)
interval(key, ms, msg)                // repeat until cancel(key)
log(message, { level?, data? })
// also: retry, upload, websocket, storage*, broadcast*, notification, geolocation, clipboard*
```

Typed helper + composition, the idiomatic shape:

```ts
const searchHttp = (url: string) =>
  http<Msg>({
    url,
    headers: JSON_HEADERS,
    onSuccess: (data) => ({ type: 'searchOk', payload: data as SearchResult }),
    onError: (error) => ({ type: 'apiError', error }),
  })
// in update():
return [{ ...state, query: q }, [debounce('search', 300, searchHttp(searchUrl(q)))]]
// to abandon an in-flight search when the box is cleared:
return [{ ...state, query: '' }, [cancel('search')]]
```

### Wiring `onEffect`

Build a handler chain and adapt it to the component's `onEffect`:

```ts
import { handleEffects, asOnEffect } from '@llui/effects'

const chain = handleEffects<Effect, Msg>()   // batteries-included (http/timeout/debounce/…)
  .use(routing.handleEffect)                  // add app-specific handlers (e.g. the router's)
  .else(({ effect }) => console.warn('unhandled effect', effect))

// component:
onEffect: asOnEffect(chain),                  // adapts to (effect, api) => void | cleanup
```

`asOnEffect` gives the chain the runtime's `send`, and an `AbortSignal` (`api.signal`) that
cancels in-flight work on unmount. **A per-mount controller is created per mount** — don't
share one controller across mounts.

### `ApiError` — the error taxonomy

```ts
type ApiError =
  | { kind: 'network'; message: string }
  | { kind: 'parse'; message: string } // a 2xx whose body failed to parse — NOT a connection failure
  | { kind: 'timeout' }
  | { kind: 'notfound' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'ratelimit'; retryAfter?: number }
  | { kind: 'validation'; fields: Record<string, string[]> }
  | { kind: 'server'; status: number; message: string }
```

Match on `kind` in your `onError` reducer. If you `switch (error.kind)` exhaustively,
include a `parse` case (added recently: a successful request with a malformed body is
distinct from a network failure — retrying it is pointless).

### Effect review points

- **Every emitted effect needs a handler.** An effect with no matching handler and no `.else` is silently dropped (dev warns). If a fetch "does nothing," check `onEffect` is wired and the chain covers that effect type.
- **No I/O in `update`/`view`.** Side effects belong in effects handled by `onEffect`. A `fetch()` in `update` breaks purity, replay, and SSR.
- **Cancellation:** use a stable `key` with `cancel`/`debounce`/`interval` so superseded work is abandoned; otherwise a stale response can overwrite fresh state.
- **`sequence` runs to completion per step** — a nested `sequence` runs strictly in order (fixed recently); don't rely on the old first-message behavior.

## Routing (@llui/router)

```ts
import { createRouter, route, routeCodec } from '@llui/router'
import { connectRouter } from '@llui/router/connect' // note the subpath
import { z } from 'zod'

const positiveInt = routeCodec(z.coerce.number().int().positive(), String)

export const router = createRouter(
  {
    home: route('/'),
    login: route('/login'),
    admin: route('/admin'),
    article: route('/articles/:slug'),
    archive: route('/archive/:year?', {
      params: { year: positiveInt },
      defaults: { year: 2026 },
    }),
    search: route('/search', {
      query: { page: positiveInt },
      defaults: { page: 1 },
    }),
    files: route('/files/*path'),
  },
  { mode: 'history' }, // default is 'hash'
)

export const routing = connectRouter(router, {
  beforeEnter(to) {
    if (to.name === 'admin' && !isLoggedIn()) return router.location('login')
  },
  beforeLeave(from, to) {
    /* return true=allow, false=block */
  },
})
```

- Route templates support static segments, required `:name`, optional `:name?`, and a
  final `*rest`. Matching precedence is static → parameter → rest, independent of registry
  order; ambiguous equal-specificity templates are rejected at construction.
- `routeCodec(StandardSchema, format)` gives a parameter/query its validated output type.
  Use `repeatedRouteCodec` for repeated query values or a typed rest parameter. Codecs and
  defaults must round-trip canonically, remain synchronous, and produce JSON-safe identity.
- `router.match(url)` returns `{ name, params } | null`; an unmatched URL is explicit, not a
  fabricated fallback. `router.location`, `href`, and `toPath` take a route name plus its
  exact route-specific params.
- Keep only URL identity in `RouteLocation`. Fetched records, drafts, loading state, and
  other page data belong elsewhere in the app model.
- `routing.push`/`replace`/`navigate`/`back`/`forward`/`scroll` return **effect data** for
  `update`; they are not imperative navigation calls. Route those effects through
  `.use(routing.handleEffect)`.
- `routing.link(send, name, params?, attrs, children, msgFactory?)` builds an anchor with the
  same typed destination. Modified clicks, non-self targets, and `download` remain native.
- Place `...routing.listener(send)` in the view once. It dispatches `navigate` with a matched
  location or `unmatched` with the invalid URL. Represent the current location in state and
  branch on `location.name`.

### Routing review points

- `connectRouter` comes from `@llui/router/connect`, not the root.
- `...routing.listener(send)` must be placed in the view or browser back/forward and
  address-bar changes never reach the reducer.
- Guards see normalized `RouteLocation`s. `beforeEnter` redirects by returning another
  location and follows redirects to a fixed point (10-hop cap); it can run once per hop.
  `beforeLeave` runs once for the original request.
- Navigating to the current canonical location is a full no-op: no guard, history write, or
  message. After accepting a noncanonical browser URL, the connector replaces it with the
  canonical URL without a second dispatch.
- All history/location access goes through injectable `RouterEnv`; do not reach for browser
  globals from router logic. Foreign/unstamped history positions are intentionally unknown.

## SSR + hydration (@llui/vike)

```ts
// +onRenderHtml.ts
export { onRenderHtml } from '@llui/vike/server' // defaults, or:
export default createOnRenderHtml({ Layout: AppLayout, document: ({ html, state, head }) => `…` })

// +onRenderClient.ts
export { onRenderClient } from '@llui/vike/client'
```

- A persistent layout renders nested page content where you place **`pageSlot()`** (call it **once**, e.g. `main([pageSlot()])`). Contexts provided above the slot (`provide`) replay into the nested page's build.
- Layout files are named `Layout.ts` — **not** `+Layout.ts` (Vike reserves the `+` prefix for its own hooks).

### The hydration contract (the big SSR gotcha)

LLui hydration **adopts** the server-rendered DOM and re-derives client state as
`data ?? init()`. This only works if:

1. **State is JSON-serializable** (SKILL.md item 5) — the server serializes it into the page and the client deserializes.
2. **`init()` is deterministic and environment-independent.** A non-deterministic `init` (timestamps, `Math.random`, locale-dependent formatting, reading `localStorage`/`window`) produces different state on server vs client, and because hydration adopts the server DOM, the UI silently shows server values that disagree with client state until the next unrelated commit.

- **Tell:** `init: () => ({ now: Date.now(), … })`, `init` reading `localStorage`, locale-dependent strings computed in `init`.
- **Fix:** keep `init` pure; seed environment-dependent state via an init **effect** (which the vike adapter replays after hydration), not in `init` itself. Do browser-only reads in `onMount`.

- Serialized state is escaped for the inline `<script>` (`</script>`, U+2028/9) — don't hand-roll a second serialization path.
