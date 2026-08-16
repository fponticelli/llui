# @llui/router

Named, type-safe URL routing for [LLui](https://github.com/fponticelli/llui), with history and hash modes, guards, and link helpers.

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

router.href('home') // '#/'
router.href('article', { slug: 'typed-urls' }) // '#/articles/typed-urls'
router.href('search', {}) // '#/search' (the default is omitted)

router.match('/archive/2025')
// { name: 'archive', params: { year: 2025 } }

router.match('/not-a-route') // null
```

Templates support static segments, required `:parameter` segments, optional `:parameter?` segments at any position, and final `*rest` segments. Plain path parameters are strings. Rest parameters are decoded segment arrays, so an encoded slash remains inside its original segment. A template cannot combine optional and rest segments because their boundary is not bidirectionally representable.

Matching precedence is static, then parameter, then rest, independent of registry order. Equal-specificity templates that can overlap are rejected at construction with both route names. Because arbitrary validators cannot prove that two parameter domains are disjoint, otherwise identical typed-parameter templates are treated as overlapping; give them distinct static structure.

`match()` returns a route location containing URL identity only. Keep fetched data, drafts, loading state, and other page state in your application model.

## Route codecs and Standard Schema

`routeCodec(schema, format)` pairs any synchronous [Standard Schema v1](https://standardschema.dev/schema) validator with canonical formatting. The schema's output type becomes the parameter type; the router has no runtime dependency on Zod, Valibot, or another validator.

Query parameters must be declared explicitly. Use `repeatedRouteCodec()` when repeated query values or a rest parameter form one semantic array:

```ts
import { repeatedRouteCodec, route } from '@llui/router'
import * as v from 'valibot'

const tags = repeatedRouteCodec(v.array(v.pipe(v.string(), v.nonEmpty())), (values) => values)

const tagged = route('/tagged', {
  query: { tag: tags },
  defaults: { tag: [] },
})
```

Scalar query codecs reject duplicate values. Unknown query keys do not prevent matching and are omitted by generation. Defaults are always present after matching, optional while generating, and omitted from the canonical URL; explicitly passing `undefined` for a defaulted parameter is equivalent to omitting it, and the rule also applies to rest defaults. Object and array defaults are cloned into each returned location, so mutating one result cannot affect another.
Each default must itself round-trip through its codec; invalid or noncanonical defaults are rejected when the router is created.
Generated URLs are accepted only when matching them produces the same complete normalized parameters, so a lossy formatter fails instead of silently addressing a different location.

Route locations remain JSON-roundtrip-safe URL identity. Absent nondefaulted optional parameters are omitted, while defaulted parameters remain present. Values may contain `null`, strings, booleans, finite numbers, dense arrays, and plain data objects. `undefined`, functions, symbols, bigints, non-finite numbers, sparse or cyclic values, and class or built-in collection instances are rejected with a contextual error.

A route may declare `refine`, a synchronous Standard Schema over the complete normalized parameter object. It may reject the object, but it may not transform it or add page data. Any schema returning a Promise produces a descriptive configuration error because routing remains synchronous.

## Connected routing

```ts
import { connectRouter } from '@llui/router/connect'

const routing = connectRouter(router)

routing.push('article', { slug: 'typed-urls' })
routing.replace('search', { page: 2 })
routing.navigate('home')

// In a view:
routing.link(send, 'article', { slug: 'typed-urls' }, { class: 'link' }, children)
```

`link`, `push`, `replace`, and `navigate` use the same route-name-specific destination type as `href`. Navigating to the current canonical location is a full no-op: no guards, history write, or message.

Place `...routing.listener(send)` in the view to handle browser back/forward and address-bar changes. A matched URL dispatches `{ type: 'navigate', location }`. An invalid browser URL dispatches `{ type: 'unmatched', url }`; the application decides whether to render not-found state or navigate intentionally. After guards accept a noncanonical matched URL, the connector replaces it with the canonical URL without adding history or dispatching twice.

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

Redirect targets are normalized route locations and chain until accepted, blocked, or settled at the same canonical URL, with the existing 10-hop bound. `beforeLeave` runs once for the originally requested navigation.

## History / Location adapter

All browser reads and mutations go through `RouterEnv`. `browserRouterEnv()` is the default; inject your own adapter for tests, SSR hosts, or embedded frames. The connector stamps entries it creates so a guard-blocked browser traversal can be restored without destroying forward history. It never guesses a position for foreign or otherwise unstamped entries.

```ts
import { browserRouterEnv, connectRouter } from '@llui/router/connect'

const routing = connectRouter(router, { env: browserRouterEnv() })
```
