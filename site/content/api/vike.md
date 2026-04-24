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
import { AppLayout } from './Layout' // ← NOT './+Layout'
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
Scopes are threaded so inner layers inherit the outer layer's scope
tree for context lookups.
@internal — exported for unit testing only (`_renderChain`).

```typescript
function _renderChain(
  chain: LayoutChain,
  chainData: readonly unknown[],
  env: DomEnv,
): { html: string; envelope: HydrationEnvelope }
```

### `fromTransition()`

Adapt a `TransitionOptions` object (e.g. the output of
`routeTransition()` from `@llui/transitions`, or a preset like `fade`
/ `slide`) into the `onLeave` / `onEnter` pair expected by
`createOnRenderClient`.

```ts
import { createOnRenderClient, fromTransition } from '@llui/vike/client'
import { routeTransition } from '@llui/transitions'
export const onRenderClient = createOnRenderClient({
  Layout: AppLayout,
  ...fromTransition(routeTransition({ duration: 200 })),
})
```

The transition operates on the slot element — in a no-layout setup,
the root container; in a layout setup, the innermost surviving
layer's `pageSlot()` element. Opacity / transform fades apply to the
outgoing page content, then the new page fades in.

```typescript
function fromTransition(t: TransitionOptions): Pick<RenderClientOptions, 'onLeave' | 'onEnter'>
```

### `_resetChainForTest()`

@internal — test helper. Disposes every layer in the current chain
and clears the module state so subsequent calls behave as a first
mount. Not part of the public API; subject to change without notice.

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
on first load, mounts fresh on subsequent navs. Use `createOnRenderClient`
for the customizable factory form.

```typescript
function onRenderClient(pageContext: ClientPageContext): Promise<void>
```

### `createOnRenderClient()`

Factory to create a customized onRenderClient hook. See `RenderClientOptions`
for the full option surface — this is the entry point for persistent
layouts, route transitions, and lifecycle hooks.
**Do not name your layout file `+Layout.ts`.** Vike reserves the `+`
prefix for its own framework config conventions, and `+Layout.ts` is
interpreted by `vike-react` / `vike-vue` / `vike-solid` framework
adapters as a native layout config. `@llui/vike` isn't a framework
adapter in that sense — it's a render adapter, and `createOnRenderClient`
consumes the layout component directly via the `Layout` option. Name
the file `Layout.ts`, `app-layout.ts`, or anywhere outside `/pages`
that Vike won't scan, and import it here by path.

```ts
// pages/+onRenderClient.ts
import { createOnRenderClient, fromTransition } from '@llui/vike/client'
import { routeTransition } from '@llui/transitions'
import { AppLayout } from './Layout' // ← NOT './+Layout'
export const onRenderClient = createOnRenderClient({
  Layout: AppLayout,
  ...fromTransition(routeTransition({ duration: 200 })),
  onMount: () => console.log('page rendered'),
})
```

```typescript
function createOnRenderClient(
  options: RenderClientOptions,
): (pageContext: ClientPageContext) => Promise<void>
```

### `_mountChainSuffix()`

Mount (or hydrate) `chain[startAt..end]` into `initialTarget`, with
the initial layer's rootLifetime parented at `initialParentLifetime`.
Threads slot → next-target → next-parentLifetime through the chain.
`initialTarget` is `HTMLElement` for the outermost layer (container-
based mount/hydrate) and `Comment` for inner layers that mount relative
to a `pageSlot()` anchor.
Fails loudly if a non-innermost layer forgot to call `pageSlot()`,
or if the innermost layer called `pageSlot()` unnecessarily.
@internal — test helper. Exported so `client-page-slot.test.ts` can
test anchor-mount/dispose contracts directly with hand-built DOM.
Not part of the public API.

```typescript
function _mountChainSuffix(
  chain: LayoutChain,
  chainData: readonly unknown[],
  startAt: number,
  initialTarget: HTMLElement | Comment,
  initialParentLifetime: Lifetime | undefined,
  opts: MountOpts,
): void
```

## Interfaces

### `PageContext`

Page context shape as seen by `@llui/vike`'s server hook. `Page` and
`data` are whichever `+Page.ts` and `+data.ts` Vike resolved for the
current route; `lluiLayoutData` is an optional array of per-layer
layout data matching the chain configured on `createOnRenderHtml`.
`data` is derived from the global `Vike.PageContext` namespace so that
consumer-side augmentations (the Vike convention for typing data) flow
into this hook's callbacks without any cast. When the consumer hasn't
augmented the namespace, `data` falls back to `unknown`.

```typescript
export interface PageContext {
  Page: AnyComponentDef
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
   * - A single `ComponentDef` — becomes a one-layout chain.
   * - An array of `ComponentDef`s — outermost first, innermost last.
   *   Every layer except the innermost must call `pageSlot()` in its view.
   * - A function that returns a chain from the current `pageContext` —
   *   enables per-route chains (e.g. reading Vike's `urlPathname`).
   *
   * The server renders the full chain as one composed HTML tree. Client
   * hydration reads the matching envelope and reconstructs the chain
   * layer-by-layer.
   */
  Layout?: AnyComponentDef | LayoutChain | ((pageContext: PageContext) => LayoutChain)

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
convention users already know from Vike. Consumer augmentations of
`Vike.PageContext { interface PageContext { data?: MyData } }` flow
through to every callback here without a cast. Unaugmented projects
fall back to `unknown`.
`lluiLayoutData` is optional and carries per-layer data for the layout
chain configured via `createOnRenderClient({ Layout })`. It's indexed
outermost-to-innermost, one entry per layout layer. Absent entries
mean the corresponding layout's `init()` receives `undefined`. Users
wire this from their Vike `+data.ts` files by merging layout-owned
data under the `lluiLayoutData` key.

```typescript
export interface ClientPageContext {
  Page: AnyComponentDef
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
Navigation sequence for an already-mounted app:

```
  client nav triggered
    │
    ▼
  compare old chain to new chain → find first mismatch index K
    │
    ▼
  onLeave(leaveTarget)   ← awaited; leaveTarget is the slot element
    │                      at depth K-1 (or the root container if K=0)
    │                      whose contents are about to be replaced
    ▼
  dispose chainHandles[K..end] innermost first
    │
    ▼
  leaveTarget.textContent = ''
    │
    ▼
  mount newChain[K..end] into leaveTarget, outermost first
    │
    ▼
  onEnter(leaveTarget)   ← fire-and-forget; fresh DOM in place
    │
    ▼
  onMount()
```

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
   * - A single `ComponentDef` — becomes a one-layout chain.
   * - An array of `ComponentDef`s — outermost layout first, innermost
   *   layout last. Every layer except the innermost must call
   *   `pageSlot()` in its view to declare where nested content renders.
   * - A function that returns a chain from the current `pageContext` —
   *   lets different routes use different chains, e.g. by reading
   *   Vike's `pageContext.urlPathname` or `pageContext.config.Layout`.
   *
   * Layers that are shared between the previous and next navigation
   * stay mounted. Only the divergent suffix is disposed and re-mounted.
   * Dialogs, focus traps, and effect subscriptions rooted in a surviving
   * layer are unaffected by the nav.
   */
  Layout?: AnyComponentDef | LayoutChain | ((pageContext: ClientPageContext) => LayoutChain)

  /**
   * Called on the slot element whose contents are about to be replaced,
   * BEFORE the divergent suffix is disposed and re-mounted. The slot's
   * current DOM is still attached when this runs — the only moment a
   * leave animation can read/write it. Return a promise to defer the
   * swap until the animation completes.
   *
   * For a plain no-layout setup, the slot element is the root container.
   * Not called on the initial hydration render.
   */
  onLeave?: (el: HTMLElement) => void | Promise<void>

  /**
   * Called after the new divergent suffix is mounted, on the same slot
   * element that was passed to `onLeave`. Use this to kick off an enter
   * animation. Fire-and-forget — promise returns are ignored.
   *
   * Not called on the initial hydration render.
   */
  onEnter?: (el: HTMLElement) => void

  /**
   * Called after mount or hydration completes. Fires on every render
   * including the initial hydration. Use for per-render side effects
   * that don't fit the animation hooks.
   */
  onMount?: () => void
}
```

<!-- auto-api:end -->
