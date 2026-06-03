---
title: '@llui/vike'
description: 'SSR/SSG adapter: onRenderHtml, onRenderClient, createOnRenderHtml/createOnRenderClient factories'
---

# @llui/vike

[Vike](https://vike.dev) SSR/SSG adapter for [LLui](https://github.com/fponticelli/llui). Server-side rendering with client hydration, or static site generation via prerendering.

```bash
pnpm add @llui/vike
```

## Setup

Use sub-path imports to keep jsdom out of the client bundle:

```ts
// pages/+onRenderHtml.ts
export { onRenderHtml } from '@llui/vike/server'
```

```ts
// pages/+onRenderClient.ts
export { onRenderClient } from '@llui/vike/client'
```

### Custom Document Template

Use `createOnRenderHtml` to control the full HTML document — add stylesheets, meta tags, favicons:

```ts
// pages/+onRenderHtml.ts
import { createOnRenderHtml } from '@llui/vike/server'

export const onRenderHtml = createOnRenderHtml({
  document: ({ html, state, pageContext }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script>
  </body>
</html>`,
})
```

### Custom Container

Use `createOnRenderClient` to configure the mount container or add lifecycle hooks:

```ts
// pages/+onRenderClient.ts
import { createOnRenderClient } from '@llui/vike/client'

export const onRenderClient = createOnRenderClient({
  container: '#root',
  onMount: () => console.log('Page ready'),
})
```

## How It Works

### Server (`onRenderHtml`)

Renders the component to HTML via `renderToString()`. Automatically initializes jsdom for server-side DOM (lazy-loaded to avoid client bundle pollution). Serializes state into a `<script>` tag for hydration.

### Client (`onRenderClient`)

Hydrates the server-rendered HTML on the client. Attaches event listeners and reactive bindings to existing DOM nodes without re-rendering. Falls back to fresh `mountApp()` for client-side navigations.

## API

| Export                 | Sub-path            | Description                                 |
| ---------------------- | ------------------- | ------------------------------------------- |
| `onRenderHtml`         | `@llui/vike/server` | Default server hook — minimal HTML template |
| `createOnRenderHtml`   | `@llui/vike/server` | Factory for custom document templates       |
| `onRenderClient`       | `@llui/vike/client` | Default client hook — hydrate or mount      |
| `createOnRenderClient` | `@llui/vike/client` | Factory for custom container/lifecycle      |

The barrel export (`@llui/vike`) re-exports everything, but prefer sub-path imports to avoid bundling jsdom into the client.

<!-- auto-api:start -->

## Functions

### `onRenderHtml()`

Default onRenderHtml hook — no layout, minimal document template,
jsdom-backed DOM env. For Cloudflare Workers (no jsdom support) or
a custom layout / document, use `createOnRenderHtml({ domEnv, … })`
with `linkedomEnv` from `@llui/dom/ssr/linkedom`.
The lazy import below keeps jsdom out of the client bundle —
Rollup's graph walker only pulls it when this server hook executes.

```typescript
function onRenderHtml(pageContext: PageContext): Promise<RenderHtmlResult>
```

### `createOnRenderHtml()`

Factory to create a customized onRenderHtml hook.
**Do not name your layout file `+Layout.ts`.** Vike reserves `+Layout`
for its own framework-adapter config (`vike-react` / `vike-vue` /
`vike-solid`) and will conflict with `@llui/vike`'s `Layout` option.
Name the file `Layout.ts`, `app-layout.ts`, or anywhere outside
`/pages` that Vike won't scan, and import it here by path.

```ts
// pages/+onRenderHtml.ts
import { createOnRenderHtml } from '@llui/vike/server'
import { AppLayout } from './Layout.js' // ← NOT './+Layout'
export const onRenderHtml = createOnRenderHtml({
  Layout: AppLayout,
  document: ({ html, state, head }) => `<!DOCTYPE html>
    <html><head>${head}<link rel="stylesheet" href="/styles.css" /></head>
    <body><div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script></body></html>`,
})
```

```typescript
function createOnRenderHtml(
  options: RenderHtmlOptions,
): (pageContext: PageContext) => Promise<RenderHtmlResult>
```

### `_renderChain()`

Render every layer of the chain into one composed DOM tree, then
serialize. At each non-innermost layer, consume the pending
`pageSlot()` registration and insert the next layer's nodes as
siblings after the anchor comment, bracketed by an end sentinel.
Contexts provided above a slot are replayed into the nested layer's
build so they reach the nested page.
@internal — exported for unit testing only (`_renderChain`).

```typescript
function _renderChain(
  chain: LayoutChain,
  chainData: readonly unknown[],
  env: DomEnv,
): { html: string; envelope: HydrationEnvelope }
```

### `pageSlot()`

Declare where a persistent layout renders its nested content — either
a nested layout or the route's page component. The vike adapter's
client and server render paths walk the layout chain, and each layer's
`pageSlot()` call records the position where the next layer mounts.
Emits a single `<!-- llui-page-slot -->` comment as an insertion
anchor. The nested layer's DOM lives as siblings of this comment
within the layout's own parent element; a synthesized end sentinel
(`<!-- llui-mount-end -->`) brackets the owned region.
Contexts provided by the layout (via `provide()`) ABOVE the slot are
reachable from inside the nested page: `pageSlot()` snapshots the
in-scope context values and the adapter replays them into the nested
layer's build. That's how patterns like a layout-owned toast
dispatcher work — the page does `useContext(ToastContext)` and reads
the value the layout provided above the slot.
Do NOT name the file `+Layout.ts` — Vike reserves the `+` prefix for
its own framework config conventions. Use `Layout.ts`, `app-layout.ts`,
or anywhere outside `/pages` that Vike won't scan.

```ts
// pages/Layout.ts    ← not +Layout.ts
import { component, div, main, header } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'
export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => ({  ...  }),
  update: layoutUpdate,
  view: ({ send }) => [
    div({ class: 'app-shell' }, [
      header([...]),
      main([pageSlot()]),    // ← here the page goes (no wrapper div)
    ]),
  ],
})
```

Returns a `Mountable` (the slot's anchor comment) — drop it straight into
a children array (`main([pageSlot()])`); no spread needed.
Call exactly once per layout. Calling more than once in a single
view throws (when both are placed).

```typescript
function pageSlot(): Mountable
```

### `fromTransition()`

Adapt a `TransitionOptions` object into the `onLeave` / `onEnter` pair
expected by `createOnRenderClient`.

```ts
import { createOnRenderClient, fromTransition } from '@llui/vike/client'
import { routeTransition } from '@llui/transitions'
export const onRenderClient = createOnRenderClient({
  Layout: AppLayout,
  ...fromTransition(routeTransition({ duration: 200 })),
})
```

The transition operates on the slot element — in a no-layout setup,
the root container; in a layout setup, the innermost surviving layer's
`pageSlot()` element.

```typescript
function fromTransition(t: TransitionOptions): Pick<RenderClientOptions, 'onLeave' | 'onEnter'>
```

### `_resetChainForTest()`

@internal — test helper. Disposes every layer in the current chain and
clears the module state so subsequent calls behave as a first mount.

```typescript
function _resetChainForTest(): void
```

### `_resetCurrentHandleForTest()`

Back-compat alias for the pre-layout test helper name.
@internal
@deprecated — use `_resetChainForTest` instead.

```typescript
function _resetCurrentHandleForTest(): void
```

### `onRenderClient()`

Default onRenderClient hook — no layout, no animation hooks. Hydrates
on first load, mounts fresh on subsequent navs.

```typescript
function onRenderClient(pageContext: ClientPageContext): Promise<void>
```

### `createOnRenderClient()`

Factory to create a customized onRenderClient hook. See
`RenderClientOptions` for the full option surface.
**Do not name your layout file `+Layout.ts`.** Vike reserves the `+`
prefix for its own framework config conventions. Name the file
`Layout.ts`, `app-layout.ts`, or anywhere outside `/pages` that Vike
won't scan, and import it here by path.

```typescript
function createOnRenderClient(
  options: RenderClientOptions,
): (pageContext: ClientPageContext) => Promise<void>
```

### `getLayoutChain()`

Public read of the current layout chain — live `LayerHandle`s for
`[...layouts, page]`, outermost first. Empty before the first mount.

```typescript
function getLayoutChain(): readonly LayerHandle[]
```

### `_mountChainSuffix()`

Mount (or hydrate) `chain[startAt..end]` into `initialTarget`, replaying
`initialContexts` into the first layer's build. Threads each layer's slot
(anchor + captured contexts) into the next layer's target + contexts.
`initialTarget` is an `HTMLElement` for the outermost layer (container mount/
hydrate) and a `Comment` for inner layers mounting relative to a `pageSlot()`
anchor.
Fails loudly if a non-innermost layer forgot to call `pageSlot()`, or if the
innermost layer called `pageSlot()` unnecessarily.
@internal — test helper. Exported so `client-page-slot.test.ts` can exercise
anchor-mount/dispose contracts directly with hand-built DOM.

```typescript
function _mountChainSuffix(
  chain: LayoutChain,
  chainData: readonly unknown[],
  startAt: number,
  initialTarget: HTMLElement | Comment,
  initialContexts: ReadonlyMap<symbol, unknown> | undefined,
  opts: MountOpts,
): void
```

## Types

### `LayerHandle`

The live handle a mounted/hydrated layer exposes (send/getState/subscribe).

```typescript
export type LayerHandle = SignalComponentHandle<unknown, unknown>
```

## Interfaces

### `AnyLayer`

Type-erased layer def at the adapter boundary. Declared with METHOD syntax and
a single `unknown` view-bag param so a concrete `SignalComponentDef<S,M,E>`
assigns in for ANY S/M/E — `SignalComponentDef<unknown,unknown,unknown>` can't
be that erasure, because `view(bag: ComponentBag<S,M>)` couples covariant
`state` with contravariant `send` and neither variance direction admits a
heterogeneous chain. This interface is itself assignable to
`SignalComponentDef<unknown,unknown,unknown>`, so `renderNodes(layer)` type-
checks. Mirrors the legacy `AnyComponentDef`.

```typescript
export interface AnyLayer {
  readonly name?: string
  init(): unknown
  update(state: unknown, msg: unknown): unknown
  view(bag: unknown): Renderable
  onEffect?(effect: unknown, api: unknown): void | (() => void)
}
```

### `PageContext`

Page context shape as seen by `@llui/vike`'s server hook. `Page` and
`data` are whichever `+Page.ts` and `+data.ts` Vike resolved for the
current route; `lluiLayoutData` is an optional array of per-layer
layout data matching the chain configured on `createOnRenderHtml`.
`data` is derived from the global `Vike.PageContext` namespace so that
consumer-side augmentations (the Vike convention for typing data) flow
into this hook's callbacks without any cast. When the consumer hasn't
augmented the namespace, `data` falls back to `unknown`.
In the signal runtime a component's `init()` takes no data argument, so
each layer's `data` slice is used directly as that layer's seed STATE
when present; when absent, the layer's own `init()` provides the seed.

```typescript
export interface PageContext {
  Page: AnyLayer
  data?: VikePageContextData
  lluiLayoutData?: readonly unknown[]
  head?: string
}
```

### `DocumentContext`

```typescript
export interface DocumentContext {
  /** Rendered component HTML (layout + page composed if a Layout is configured) */
  html: string
  /** JSON-serialized hydration envelope (chain-aware when Layout is configured) */
  state: string
  /** Head content from pageContext.head (e.g. from +Head.ts) */
  head: string
  /** Full page context for custom logic */
  pageContext: PageContext
}
```

### `RenderHtmlResult`

```typescript
export interface RenderHtmlResult {
  documentHtml: string | { _escaped: string }
  pageContext: { lluiState: unknown }
}
```

### `RenderHtmlOptions`

Options for the customized `createOnRenderHtml` factory. Mirrors
`@llui/vike/client`'s `RenderClientOptions.Layout` — the same chain
shape is accepted for consistency between server and client render.

````typescript
export interface RenderHtmlOptions {
  /** Custom HTML document template. Defaults to a minimal layout. */
  document?: (ctx: DocumentContext) => string

  /**
   * Persistent layout chain. One of:
   *
   * - A single `SignalComponentDef` — becomes a one-layout chain.
   * - An array of `SignalComponentDef`s — outermost first, innermost last.
   *   Every layer except the innermost must call `pageSlot()` in its view.
   * - A function that returns a chain from the current `pageContext` —
   *   enables per-route chains (e.g. reading Vike's `urlPathname`).
   *
   * The server renders the full chain as one composed HTML tree. Client
   * hydration reads the matching envelope and reconstructs the chain
   * layer-by-layer.
   */
  Layout?: AnyLayer | LayoutChain | ((pageContext: PageContext) => LayoutChain)

  /**
   * Factory that returns the `DomEnv` backing SSR render. Call with
   * either `jsdomEnv` (from `@llui/dom/ssr/jsdom`) or `linkedomEnv`
   * (from `@llui/dom/ssr/linkedom`). The factory is invoked once per
   * page render, so each request gets a fresh DOM — safe under
   * concurrency, no `globalThis` mutation.
   *
   * On Cloudflare Workers use `linkedomEnv` — jsdom's transitive deps
   * (whatwg-url, tr46, punycode) don't resolve under workerd.
   *
   * @example
   * ```ts
   * import { jsdomEnv } from '@llui/dom/ssr/jsdom'
   * createOnRenderHtml({ Layout: MyLayout, domEnv: jsdomEnv })
   * ```
   */
  domEnv: () => DomEnv | Promise<DomEnv>
}
````

### `ClientPageContext`

Page context shape as seen by `@llui/vike`'s client-side hooks. The
`Page` and `data` fields come from whichever `+Page.ts` and `+data.ts`
Vike resolved for the current route.
`data` is derived from the global `Vike.PageContext` namespace — the
convention users already know from Vike. Consumer augmentations flow
through to every callback here without a cast; unaugmented projects
fall back to `unknown`.
In the signal runtime a component's `init()` takes no data argument, so
each layer's `data` slice is used directly as that layer's seed STATE
when present; when absent, the layer's own `init()` provides the seed.
`lluiLayoutData` is optional and carries per-layer data for the layout
chain configured via `createOnRenderClient({ Layout })`. It's indexed
outermost-to-innermost, one entry per layout layer.

```typescript
export interface ClientPageContext {
  Page: AnyLayer
  data?: VikePageContextData
  lluiLayoutData?: readonly unknown[]
  isHydration?: boolean
}
```

### `RenderClientOptions`

Page-lifecycle hooks that fire around the dispose → mount cycle on
client navigation. With persistent layouts in play the cycle only
tears down the _divergent_ suffix of the layout chain — any layers
shared between the old and new routes stay mounted.
On the initial hydration render, `onLeave` and `onEnter` are NOT
called — there's no outgoing page to leave and no animation to enter.
Use `onMount` for code that should run on every render including the
initial one.

```typescript
export interface RenderClientOptions {
  /** CSS selector for the mount container. Default: `'#app'`. */
  container?: string

  /**
   * Persistent layout chain. One of:
   *
   * - A single `SignalComponentDef` — becomes a one-layout chain.
   * - An array of `SignalComponentDef`s — outermost layout first,
   *   innermost layout last. Every layer except the innermost must call
   *   `pageSlot()` in its view to declare where nested content renders.
   * - A function that returns a chain from the current `pageContext`.
   *
   * Layers shared between the previous and next navigation stay mounted.
   * Only the divergent suffix is disposed and re-mounted.
   */
  Layout?: AnyLayer | LayoutChain | ((pageContext: ClientPageContext) => LayoutChain)

  /**
   * Called on the slot element whose contents are about to be replaced,
   * BEFORE the divergent suffix is disposed and re-mounted. The slot's
   * current DOM is still attached when this runs. Return a promise to
   * defer the swap until the animation completes.
   *
   * For a plain no-layout setup, the slot element is the root container.
   * Not called on the initial hydration render.
   */
  onLeave?: (el: HTMLElement) => void | Promise<void>

  /**
   * Called after the new divergent suffix is mounted, on the same slot
   * element that was passed to `onLeave`. Fire-and-forget. Not called on
   * the initial hydration render.
   */
  onEnter?: (el: HTMLElement) => void

  /**
   * Called after mount or hydration completes. Fires on every render
   * including the initial hydration. Receives the live layout chain —
   * `[...layouts, page]`, outermost first — as `LayerHandle`s.
   */
  onMount?: (chain: readonly LayerHandle[]) => void

  /**
   * Called for each surviving layout layer whose `lluiLayoutData[i]`
   * slice changed across a client navigation. Surviving layers stay
   * mounted but need a fresh injection of nav-driven data. You decide how
   * to translate the new data into a message and dispatch it through
   * `handle.send(msg)`.
   *
   * Not called for unchanged slices, not on the initial hydration render,
   * and not for the page layer (it always disposes and remounts, so its
   * `init`/seed receives the fresh data directly).
   */
  onLayerDataChange?: (ctx: {
    def: AnyLayer
    handle: LayerHandle
    newData: unknown
    prevData: unknown
  }) => void

  /**
   * Forwarded to the signal hydrate path for every layer on initial
   * hydration. When `true`, effects returned by each component's `init()`
   * are dispatched post-swap on the client. When `false` (default), they
   * are skipped — the SSR pass already ran them.
   *
   * Subsequent client-side navigation always uses a fresh mount, which
   * always fires init effects regardless of this flag.
   */
  runInitEffectsOnHydrate?: boolean
}
```

<!-- auto-api:end -->
