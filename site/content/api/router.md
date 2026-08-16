---
title: '@llui/router'
description: 'Named, type-safe routing with Standard Schema, guards, and history/hash modes'
---

# @llui/router

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

Route locations remain JSON-roundtrip-safe URL identity. Absent nondefaulted optional parameters are omitted, while defaulted parameters remain present. Values may contain `null`, strings, booleans, finite numbers, dense arrays, and plain data objects. `undefined`, functions, symbols, bigints, non-finite numbers, sparse or cyclic values, and class or built-in collection instances are rejected with a contextual error.

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

<!-- auto-api:end -->
