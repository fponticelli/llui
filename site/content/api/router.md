---
title: '@llui/router'
description: 'Named, type-safe routing with Standard Schema, guards, and history/hash modes'
---

# @llui/router

<!-- package-version:start -->

**Current package version:** `0.12.1`

<!-- package-version:end -->

Named, type-safe URL routing for LLui, with history and hash modes, guards, and link helpers.

```bash
pnpm add @llui/router
```

## Named routes

Routes live in one keyed registry. Its keys are stable route names, and each path template determines the exact parameters accepted by matching and generation.

```ts
import { createRouter, route, routeCodec } from '@llui/router'
import { z } from 'zod'

const integer = routeCodec(z.coerce.number().int().positive(), String)

const routes = {
  home: route('/'),
  article: route('/articles/:slug'),
  archive: route('/archive/:year?', {
    params: { year: integer },
    defaults: { year: 2026 },
  }),
  search: route('/search', {
    query: { page: integer },
    defaults: { page: 1 },
  }),
  files: route('/files/*path'),
}

const router = createRouter(routes)

router.href('home')
router.href('article', { slug: 'typed-urls' })
router.href('search', {})

router.match('/archive/2025')
// { name: 'archive', params: { year: 2025 } }

router.match('/not-a-route') // null
```

Templates support static segments, required `:parameter` segments, optional `:parameter?` segments at any position, and final `*rest` segments. Plain path parameters are strings. Rest parameters are decoded segment arrays, so an encoded slash remains inside its original segment. A template cannot combine optional and rest segments because their boundary is not bidirectionally representable.

Matching precedence is static, then parameter, then rest, independent of registry order. Equal-specificity templates that can overlap are rejected at construction with both route names. Because arbitrary validators cannot prove that two parameter domains are disjoint, otherwise identical typed-parameter templates are treated as overlapping; give them distinct static structure.

`match()` returns a route location containing URL identity only. Keep fetched data, drafts, loading state, and other page state in your application model.

## Route codecs and Standard Schema

`routeCodec(schema, format)` pairs any synchronous [Standard Schema v1](https://standardschema.dev/schema) validator with canonical formatting. The schema's output type becomes the parameter type; the router has no runtime dependency on a validation library.

Query parameters are explicit. `repeatedRouteCodec()` represents ordered repeated query values and custom rest parameters. Scalar query codecs reject duplicate values. Unknown query keys are ignored when matching and omitted by generation. Defaults are present after matching, optional while generating, and omitted from the canonical URL; explicitly passing `undefined` for a defaulted parameter is equivalent to omitting it, and the rule also applies to rest defaults. Object and array defaults are cloned into each returned location, so mutating one result cannot affect another.
Each default must itself round-trip through its codec; invalid or noncanonical defaults are rejected when the router is created.
Generated URLs are accepted only when matching them produces the same complete normalized parameters, so a lossy formatter fails instead of silently addressing a different location.

Route locations remain JSON-roundtrip-safe URL identity. Absent nondefaulted optional parameters are omitted, while defaulted parameters remain present. Values may contain `null`, strings, booleans, finite numbers other than negative zero, ordinary dense arrays without owned state, and ordinary plain data objects. `undefined`, functions, symbols, bigints, non-finite or negative-zero numbers, sparse/stateful/subclassed arrays, cyclic values, null/custom-prototype objects, and class or built-in collection instances are rejected with a contextual error.

A route may declare `refine`, a synchronous Standard Schema over the complete normalized parameter object. It may reject the object, but it may not transform it or add page data. A Promise produces a descriptive configuration error because routing remains synchronous.

## Connected routing

```ts
import { connectRouter } from '@llui/router/connect'

const routing = connectRouter(router)

routing.push('article', { slug: 'typed-urls' })
routing.replace('search', { page: 2 })
routing.navigate('home')

routing.link(send, 'article', { slug: 'typed-urls' }, { class: 'link' }, children)
```

`link`, `push`, `replace`, and `navigate` use the same route-name-specific destination type as `href`. Navigating to the current canonical location is a full no-op: no guards, history write, or message.

Place `...routing.listener(send)` in the view to handle browser back/forward and address-bar changes. A match dispatches `{ type: 'navigate', location }`. An invalid browser URL dispatches `{ type: 'unmatched', url }`; the application decides whether to render not-found state or navigate intentionally. After guards accept a noncanonical URL, the connector replaces it canonically without adding history or dispatching twice.

## Guards

```ts
const routing = connectRouter(router, {
  beforeEnter(to) {
    if (to.name === 'admin' && !isLoggedIn()) return router.location('login')
  },
  beforeLeave(from) {
    if (from.name === 'editor' && hasUnsavedChanges()) {
      return confirm('Discard unsaved changes?')
    }
    return true
  },
})
```

Redirect targets are normalized route locations and chain until accepted, blocked, or settled at the same canonical URL, with a 10-hop bound. `beforeLeave` runs once for the originally requested navigation.

## History integrity

All browser reads and mutations go through `RouterEnv`. `browserRouterEnv()` is the default; inject an adapter for tests, SSR hosts, or embedded frames. The connector stamps entries it creates with an index and run identifier, preserving other `history.state` keys. A blocked browser traversal is restored only when both positions belong to the same known run; the router never guesses across foreign, hand-edited, legacy, or otherwise unstamped entries. This deliberately prefers a visible URL/state disagreement over traversing to the wrong entry.

Hash mode listens to both `popstate` and `hashchange`, pairs the events for one physical traversal, and suppresses only echoes from its own writes. History mode keeps one `popstate` subscription. Modifier clicks, non-`_self` targets, downloads, and already-prevented clicks remain native browser behavior.

Custom environments must keep their location reads live and must forward the
destination from `HashChangeEvent.newURL`. A preceding `popstate` guard can
rewrite the live hash before the matching `hashchange` arrives:

```ts
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
  get historyLength() {
    return frame.history.length
  },
  setHash: (hash) => {
    frame.location.hash = hash
  },
  pushState: (state, url) => frame.history.pushState(state, '', url),
  replaceState: (state, url) => frame.history.replaceState(state, '', url ?? null),
  back: () => frame.history.back(),
  forward: () => frame.history.forward(),
  go: (delta) => frame.history.go(delta),
  scrollTo: (x, y) => frame.scrollTo(x, y),
  onUrlChange: (event, handler) => {
    const listener = (change: Event) => {
      if (event === 'hashchange') {
        handler(new URL((change as HashChangeEvent).newURL).hash)
      } else {
        handler()
      }
    }
    frame.addEventListener(event, listener)
    return () => frame.removeEventListener(event, listener)
  },
}

const framed = connectRouter(router, { env: frameEnv })
```

<!-- auto-api:start -->

## Functions

### `createRouter()`

```typescript
function createRouter<const Registry extends RouteRegistry>(
  routes: Registry,
  config?: RouterConfig,
): Router<Registry>
```

### `repeatedRouteCodec()`

Define a route codec whose URL representation is an ordered repeated value.

```typescript
function repeatedRouteCodec<Schema extends StandardSchemaV1>(
  schema: Schema,
  format: (value: StandardSchemaV1.InferOutput<Schema>) => readonly string[],
): RouteCodec<StandardSchemaV1.InferOutput<Schema>, true>
```

### `route()`

```typescript
export function route<const Path extends string>(
  path: Path,
): RouteDefinition<Path, EmptyRecord, EmptyRecord, EmptyRecord>
export function route<const Path extends string, const Options extends RouteOptionShape<Path>>(
  path: Path,
  options: Options & {
    readonly params?: OptionParams<Options> &
      Record<Exclude<keyof OptionParams<Options>, PathNames<Path>>, never>
    readonly query?: OptionQuery<Options> &
      Record<Extract<keyof OptionQuery<Options>, PathNames<Path>>, never>
    readonly defaults?: Partial<
      ParameterValues<Path, OptionParams<Options>, OptionQuery<Options>>
    > &
      Record<
        Exclude<
          keyof OptionDefaults<Options>,
          keyof ParameterValues<Path, OptionParams<Options>, OptionQuery<Options>>
        >,
        never
      >
    readonly refine?: OptionRefinement<Options> &
      StandardSchemaV1<
        NormalizedParams<
          Path,
          OptionParams<Options>,
          OptionQuery<Options>,
          CheckedDefaults<Path, Options>
        >,
        NormalizedParams<
          Path,
          OptionParams<Options>,
          OptionQuery<Options>,
          CheckedDefaults<Path, Options>
        >
      > &
      ExactKeys<
        NormalizedParams<
          Path,
          OptionParams<Options>,
          OptionQuery<Options>,
          CheckedDefaults<Path, Options>
        >,
        StandardSchemaV1.InferOutput<OptionRefinement<Options>>
      >
  },
): RouteDefinition<
  Path,
  OptionParams<Options>,
  OptionQuery<Options>,
  CheckedDefaults<Path, Options>
>
```

### `routeCodec()`

Define a scalar path or query route codec.

```typescript
function routeCodec<Schema extends StandardSchemaV1>(
  schema: Schema,
  format: (value: StandardSchemaV1.InferOutput<Schema>) => string,
): RouteCodec<StandardSchemaV1.InferOutput<Schema>>
```

## Types

### `RouteDestination`

```typescript
export type RouteDestination<Registry extends RouteRegistry> = {
  [Name in keyof Registry & string]: keyof DefinitionGeneration<Registry[Name]> extends never
    ? [name: Name]
    : [name: Name, params: Simplify<DefinitionGeneration<Registry[Name]>>]
}[keyof Registry & string]
```

### `RouteDestinationArguments`

The parameter tail for one exact, route-name-specific destination call.

```typescript
export type RouteDestinationArguments<
  Registry extends RouteRegistry,
  Name extends keyof Registry & string,
  Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<Registry, Name>,
> = keyof RouteGenerationParams<Registry, Name> extends never
  ? []
  : [params: ExactParameters<RouteGenerationParams<Registry, Name>, Params>]
```

### `RouteGenerationParams`

```typescript
export type RouteGenerationParams<
  Registry extends RouteRegistry,
  Name extends keyof Registry & string,
> = Simplify<DefinitionGeneration<Registry[Name]>>
```

### `RouteLocation`

```typescript
export type RouteLocation<Registry extends RouteRegistry> = {
  [Name in keyof Registry & string]: {
    name: Name
    params: Simplify<DefinitionNormalized<Registry[Name]>>
  }
}[keyof Registry & string]
```

### `RouteRegistry`

```typescript
export type RouteRegistry = Readonly<Record<string, RouteDefinitionShape>>
```

## Interfaces

### `RouteCodec`

A synchronous Standard Schema validator paired with its canonical URL formatter.

```typescript
export interface RouteCodec<Output, Multiple extends boolean = false> {
  readonly schema: StandardSchemaV1<unknown, Output>
  readonly format: (value: Output) => Multiple extends true ? readonly string[] : string
  readonly multiple: Multiple
}
```

### `RouteDefinition`

One named route's typed URL contract. Names are supplied by the registry.

```typescript
export interface RouteDefinition<
  Path extends string = string,
  Params extends CodecMap = CodecMap,
  Query extends Readonly<Record<string, AnyCodec>> = Readonly<Record<string, AnyCodec>>,
  Defaults extends Partial<ParameterValues<Path, Params, Query>> = Partial<
    ParameterValues<Path, Params, Query>
  >,
> {
  readonly path: Path
  readonly params: Params
  readonly query: Query
  readonly defaults: Defaults
  readonly refine?: StandardSchemaV1
}
```

### `Router`

```typescript
export interface Router<Registry extends RouteRegistry> {
  match(input: string): RouteLocation<Registry> | null
  location<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouteLocation<Registry>
  toPath<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): string
  href<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): string
  readonly mode: 'hash' | 'history'
  readonly base: string
  readonly routes: Registry
}
```

### `RouterConfig`

```typescript
export interface RouterConfig {
  readonly mode?: 'hash' | 'history'
  /** History-mode base path. */
  readonly base?: string
}
```

### `StandardSchemaV1`

The Standard Schema interface.

```typescript
interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}
```

## Public Entry Points

### `@llui/router/connect`

#### Functions

##### `browserRouterEnv()` from `@llui/router/connect`

Wrap the browser globals as a {@link RouterEnv} — the default for
`connectRouter`.

Reads delegate through getters, so evaluating this on a server process before
a DOM exists is safe: the globals are only dereferenced when a member is
actually used, and the read members fall back rather than throwing (the
connector seeds its starting route at construction time, which happens at
module scope in most apps).

```typescript
function browserRouterEnv(): RouterEnv
```

##### `connectRouter()` from `@llui/router/connect`

Bind a {@link Router} to a History/Location surface: the effect handler, the
browser-driven URL listener, and the `link()` helper, all running the same
guard pipeline.

POSITION MODEL (what a blocked navigation is undone with). The browser
exposes no counter for "where in the stack am I", so every entry this
connector creates is stamped with a monotonic index in `history.state` (under
`__llui_idx`, merged into whatever the host already owns there), starting with
the entry the app loaded on. A guard-blocked browser navigation is undone by
`history.go(delta)` computed from two such stamps — a TRAVERSAL, so the stack,
its length and every forward entry survive exactly as they were (#103).

An entry NOBODY stamped has no knowable position, and no position is invented
for one — in either mode (#150; the reasoning, the alternatives that were
measured and rejected, and the behaviour this costs are all recorded on
`adoptLandedEntry`). Blocking a navigation onto such an entry is
guard-honouring but NOT undoable: nothing is dispatched and application location
keeps the route you never left, but the URL is left showing the blocked one
until the next navigation. That visible disagreement is deliberately preferred
over a guessed `history.go(delta)`, which traverses to the wrong entry and
dispatches a route the user never asked for.

An index is therefore only half of a position. `delta = here - there` is the
PHYSICAL distance between two entries only while every entry between them was
numbered in the same consecutive pass; an entry the router could not place
ENDS such a pass, and the next one it numbers starts a new one whose indices
count physical entries from a different origin. So each stamp also carries the
RUN it was numbered in (`__llui_run`, see `mintRun`), and a delta is computed
only between two entries of the same run. Across runs the distance is
unknowable and the block is left un-undone, exactly as it is for an entry with
no stamp at all.

Every history/location touch goes through {@link RouterEnv} (default
{@link browserRouterEnv}); nothing in this file reaches for `location`,
`history` or `window` directly (#111).

```typescript
function connectRouter<
  const Registry extends RouteRegistry,
  NavigateMessage = RouterNavigateMessage<Registry>,
  UnmatchedMessage = RouterUnmatchedMessage,
>(
  router: Router<Registry>,
  options?: ConnectOptions<Registry, NavigateMessage, UnmatchedMessage>,
): ConnectedRouter<Registry, NavigateMessage, UnmatchedMessage>
```

#### Types

##### `RouterMessage` from `@llui/router/connect`

```typescript
export type RouterMessage<Registry extends RouteRegistry> =
  | RouterNavigateMessage<Registry>
  | RouterUnmatchedMessage
```

#### Interfaces

##### `ConnectedRouter` from `@llui/router/connect`

```typescript
export interface ConnectedRouter<
  Registry extends RouteRegistry,
  NavigateMessage = RouterNavigateMessage<Registry>,
  UnmatchedMessage = RouterUnmatchedMessage,
> {
  /**
   * Effect: push a new history entry — URL only.
   *
   * Use when the reducer that emitted the effect has already updated its
   * current location (e.g. a navigate handler that bundles
   * state changes inline before delegating URL work). For
   * navigate-and-let-the-app-react flows from anywhere else, prefer
   * `navigate()` — it dispatches the listener-captured navigate
   * message after pushState so application location and route-side-effects
   * stay in sync without each reducer re-implementing the delegation.
   */
  push<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouterEffect
  /**
   * Effect: replace the current history entry — URL only. Same
   * URL-only contract as `push()`. For replace-and-react flows, see
   * `navigate()` (push semantics) — there's no `replaceAndDispatch`
   * variant yet because the use case hasn't surfaced; if it does,
   * model it the same way.
   */
  replace<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouterEffect
  /**
   * Effect: push history AND dispatch the listener-captured navigate
   * message so the reducer can update its current location and run any
   * route-side-effects (data fetches, page-meta resets, analytics).
   *
   * Resolves the asymmetry where `link()` did pushState + send while
   * `push()` did pushState only — apps that wanted programmatic
   * navigation from arbitrary reducers had to either re-implement the
   * delegation or live with desynchronized application location.
   *
   * Dispatches through the `send` the effect runner hands every effect,
   * so it works from ANY effect — including an `init()` effect that runs
   * before any view mounts. It does NOT depend on `listener()` being
   * mounted (that only handles browser-driven popstate/hashchange).
   * The message shape is `{ type: 'navigate', location }` unless overridden
   * via `connectRouter`'s `navigateMsg` option.
   */
  navigate<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouterEffect
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
   * Returns the onMount marker to place in the view. Sends
   * `{ type: 'navigate', location }` or `{ type: 'unmatched', url }`.
   */
  listener(send: (msg: NavigateMessage | UnmatchedMessage) => void): Renderable
  listener<M>(
    send: (msg: M | UnmatchedMessage) => void,
    msgFactory: (location: RouteLocation<Registry>) => M,
  ): Renderable
  listener<M, U>(
    send: (msg: M | U) => void,
    msgFactory: (location: RouteLocation<Registry>) => M,
    unmatchedFactory: (url: string) => U,
  ): Renderable

  /**
   * View helper: render a navigation link.
   * Generates <a> with proper href and click handler that sends navigate message.
   */
  link<
    M,
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    send: (msg: M) => void,
    name: Name,
    ...args: ExactLinkArguments<Registry, Name, Params, M>
  ): Mountable

  /**
   * Create an update handler for navigate messages — call it from your
   * component's `update` (returns early when it handles the message).
   * Returns [newState, Effect[]] for navigate messages, null for others.
   */
  createHandler<S, M, E>(config: {
    /** Message type to handle (default: 'navigate') */
    message?: string
    /** Extract route from message */
    getLocation: (msg: M) => RouteLocation<Registry>
    /** Optional guard — can redirect */
    guard?: (location: RouteLocation<Registry>, state: S) => RouteLocation<Registry>
    /** Build new state + effects for the route */
    onNavigate: (state: S, location: RouteLocation<Registry>) => [S, E[]]
  }): (state: S, msg: M) => [S, E[]] | null
}
```

##### `ConnectOptions` from `@llui/router/connect`

```typescript
export interface ConnectOptions<
  Registry extends RouteRegistry,
  NavigateMessage = RouterNavigateMessage<Registry>,
  UnmatchedMessage = RouterUnmatchedMessage,
> {
  /**
   * The History/Location surface to drive (default: {@link browserRouterEnv}).
   * Inject one to route a test, an SSR host, or an embedded frame through its
   * own history without touching the page's.
   */
  env?: RouterEnv

  /**
   * Called before entering a new route. Return:
   * - `void` / `undefined` → allow navigation
   * - `false` → block navigation (stay on current route)
   * - a different route location → redirect to that location
   *
   * A redirect CHAINS: the target is offered back to this same function until it
   * is accepted, blocked, or stops moving the URL (capped at 10 hops — see
   * `runGuards`). So this may be called several times for one navigation, and
   * only the settled route is dispatched. `from` is the route being LEFT on
   * every hop — no hop is entered.
   */
  beforeEnter?: (
    to: RouteLocation<Registry>,
    from: RouteLocation<Registry> | null,
  ) => RouteLocation<Registry> | false | void
  /**
   * Called before leaving the current route. Return:
   * - `true` → allow navigation
   * - `false` → block (e.g. unsaved changes prompt)
   *
   * Called ONCE per navigation, before any `beforeEnter`, with the route
   * originally REQUESTED as `to` — a redirect chain must not prompt N times.
   */
  beforeLeave?: (from: RouteLocation<Registry>, to: RouteLocation<Registry>) => boolean

  /**
   * Build the message dispatched by the `navigate()` effect (and the
   * popstate/hashchange listener and `link()`) when the route changes.
   * Defaults to `{ type: 'navigate', location }`. Override only if your app
   * uses a different message shape for route changes; the same factory then
   * applies to every route-change dispatch so they stay consistent.
   */
  navigateMsg?: (location: RouteLocation<Registry>) => NavigateMessage
  /** Build the message dispatched for a browser-driven unmatched URL. */
  unmatchedMsg?: (url: string) => UnmatchedMessage
}
```

##### `RouterEffect` from `@llui/router/connect`

```typescript
export interface RouterEffect {
  type: '__router'
  action: 'push' | 'replace' | 'navigate' | 'back' | 'forward' | 'scroll'
  path?: string
  /** The normalized route location targeted by this effect. */
  location?: unknown
  x?: number
  y?: number
}
```

##### `RouterEnv` from `@llui/router/connect`

The History / Location / scroll surface `connectRouter` depends on, injected
rather than reached for globally — the same pattern `@llui/dom`'s
`dom-env.ts` already models, and for the same three reasons: no
`globalThis` mutation (strict-isolate runtimes forbid it), no process-level
singleton two routers could collide on, and a test/SSR host can supply its
own surface instead of shimming the world.

The surface is deliberately narrow — exactly what the connector touches. The
READ members return an empty/`null` value where the corresponding global is
absent, matching the guards this replaced; the MUTATORS dereference their
global at call time, so invoking one on a runtime with no history is the same
error it always was.

```typescript
export interface RouterEnv {
  /** `location.hash` (`''` where there is no location). */
  readonly hash: string
  /** `location.pathname` (`''` where there is no location). */
  readonly pathname: string
  /** `location.search` (`''` where there is no location). */
  readonly search: string
  /** `history.state` (`null` where there is no history). */
  readonly historyState: unknown
  /**
   * `history.length` — the session-history entry count (`0` where there is no
   * history).
   *
   * A CAPABILITY TEST, not a position. `0` means "this surface has no history at
   * all" — every real session history contains at least the entry you are
   * standing on — and that is the only question asked of it: the
   * construction-time seed checks it before writing a stamp, which is what keeps
   * an SSR import (where `connectRouter` runs at module scope) a no-op instead
   * of a throw.
   *
   * It is NO LONGER the hash-mode push-vs-traversal discriminator. That use was
   * deleted in #150 — see `adoptLandedEntry` for why — so an implementation is
   * free to report any positive constant for a surface that has a history, and
   * reporting an exact count buys nothing.
   */
  readonly historyLength: number

  /** Assign `location.hash` — a same-document navigation that fires `hashchange`. */
  setHash(hash: string): void

  pushState(state: unknown, url: string): void
  /**
   * `history.replaceState(state, '', url)` — swap the current entry's state,
   * and its URL when one is given.
   *
   * `url` is OPTIONAL because "re-stamp this entry's state and leave the URL
   * alone" is a distinct operation (merging a foreign key into `history.state`,
   * recording a scroll offset), and `''` does not express it: an empty url
   * resolves against the document base and drops the fragment, which silently
   * breaks hash mode. An implementation must forward an absent `url` as absent.
   */
  replaceState(state: unknown, url?: string): void
  back(): void
  forward(): void
  /** `history.go(delta)` — used to REWIND a blocked pop, never a fresh push. */
  go(delta: number): void

  scrollTo(x: number, y: number): void

  /**
   * Subscribe to a browser-driven URL change. Returns the unsubscribe, so the
   * caller never has to hold the handler identity to detach it. A hashchange
   * supplies the fragment from the event's `newURL`; this remains the traversal
   * destination even when a guard synchronously rewrites `location.hash` while
   * handling the preceding popstate. Call the handler without an argument for
   * popstate. Custom adapters must derive the hash argument from
   * `HashChangeEvent.newURL`, not from the live location.
   */
  onUrlChange(event: 'popstate' | 'hashchange', handler: (newHash?: string) => void): () => void
}
```

##### `RouterNavigateMessage` from `@llui/router/connect`

```typescript
export interface RouterNavigateMessage<Registry extends RouteRegistry> {
  readonly type: 'navigate'
  readonly location: RouteLocation<Registry>
}
```

##### `RouterUnmatchedMessage` from `@llui/router/connect`

```typescript
export interface RouterUnmatchedMessage {
  readonly type: 'unmatched'
  readonly url: string
}
```

<!-- auto-api:end -->
