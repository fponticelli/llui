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

Default onRenderHtml hook for simple cases.
Uses a minimal HTML document template.

```typescript
function onRenderHtml(pageContext: PageContext): Promise<RenderHtmlResult>
```

### `createOnRenderHtml()`

Factory to create a customized onRenderHtml hook.

```typescript
// pages/+onRenderHtml.ts
import { createOnRenderHtml } from '@llui/vike'
export const onRenderHtml = createOnRenderHtml({
  document: ({ html, state, head }) => `<!DOCTYPE html>
    <html>
      <head>${head}<link rel="stylesheet" href="/styles.css" /></head>
      <body><div id="app">${html}</div>
      <script>window.__LLUI_STATE__ = ${state}</script></body>
    </html>`,
})
```

```typescript
function createOnRenderHtml(options: {
  document: (ctx: DocumentContext) => string
}): (pageContext: PageContext) => Promise<RenderHtmlResult>
```

### `renderPage()`

```typescript
function renderPage(
  pageContext: PageContext,
  document: (ctx: DocumentContext) => string,
): Promise<RenderHtmlResult>
```

### `fromTransition()`

Adapt a `TransitionOptions` object (e.g. the output of
`routeTransition()` from `@llui/transitions`, or any preset like
`fade()` / `slide()`) into the `onLeave` / `onEnter` shape expected
by `createOnRenderClient`.

```typescript
import { createOnRenderClient, fromTransition } from '@llui/vike/client'
import { routeTransition } from '@llui/transitions'
export const onRenderClient = createOnRenderClient({
  ...fromTransition(routeTransition({ duration: 200 })),
})
```

The transition operates on the container element itself — its
opacity / transform fades out the outgoing page, then the new page
fades in when it mounts. If the preset doesn't restore its starting
style on `leave`, the container may still carry leftover properties
when the new page mounts; use `enter` to reset them explicitly or
pick presets that self-clean.

```typescript
function fromTransition(t: TransitionOptions): Pick<RenderClientOptions, 'onLeave' | 'onEnter'>
```

### `_resetCurrentHandleForTest()`

@internal — test helper. Disposes the current handle (if any) and clears
the module-level state so subsequent calls behave as a first mount.
Not part of the public API; subject to change without notice.

```typescript
function _resetCurrentHandleForTest(): void
```

### `onRenderClient()`

Default onRenderClient hook — no animation hooks. Hydrates if
`isHydration` is true, otherwise mounts fresh. Use `createOnRenderClient`
for the customizable factory form.

```typescript
function onRenderClient(pageContext: ClientPageContext): Promise<void>
```

### `createOnRenderClient()`

Factory to create a customized onRenderClient hook.

```typescript
// pages/+onRenderClient.ts
import { createOnRenderClient } from '@llui/vike/client'
export const onRenderClient = createOnRenderClient({
  container: '#root',
  onLeave: (el) => el.animate({ opacity: [1, 0] }, 200).finished,
  onEnter: (el) => el.animate({ opacity: [0, 1] }, 200),
  onMount: () => console.log('Page ready'),
})
```

```typescript
function createOnRenderClient(
  options: RenderClientOptions,
): (pageContext: ClientPageContext) => Promise<void>
```

### `renderClient()`

```typescript
function renderClient(pageContext: ClientPageContext, options: RenderClientOptions): Promise<void>
```

## Interfaces

### `PageContext`

```typescript
export interface PageContext {
  Page: ComponentDef<unknown, unknown, unknown, unknown>
  data?: unknown
  head?: string
}
```

### `DocumentContext`

```typescript
export interface DocumentContext {
  /** Rendered component HTML */
  html: string
  /** JSON-serialized initial state */
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

### `ClientPageContext`

```typescript
export interface ClientPageContext {
  Page: ComponentDef<unknown, unknown, unknown, unknown>
  data?: unknown
  isHydration?: boolean
}
```

### `RenderClientOptions`

Page-lifecycle hooks that fire around the dispose → clear → mount
sequence on client navigation. Use these to animate page transitions,
save scroll state, emit analytics events, or defer the swap behind
any async work that must complete before the next page appears.
The sequence is:

```
  client nav triggered
    │
    ▼
  onLeave(el)   ← awaited if it returns a promise
    │              (the outgoing page's DOM is still mounted here)
    ▼
  currentHandle.dispose()
    │              (all scopes torn down — portals, focus traps,
    │               onMount cleanups all fire synchronously here)
    ▼
  el.textContent = ''
    │              (old DOM removed)
    ▼
  mountApp(el, Page, data)
    │              (new page mounted)
    ▼
  onEnter(el)   ← not awaited; animate in-place
    │
    ▼
  onMount()     ← legacy shim, still fires last
```

On the initial render (hydration), `onLeave` and `onEnter` are NOT
called — there's no outgoing page to leave and no animation to enter.
If you need to run code after hydration, use `onMount`.

```typescript
export interface RenderClientOptions {
  /** CSS selector for the mount container. Default: '#app' */
  container?: string

  /**
   * Called on the outgoing page's container BEFORE dispose + clear + mount.
   * Return a promise to defer the swap until the leave animation finishes.
   * The container element is passed as the argument — its children are
   * still the previous page's DOM at this point.
   *
   * Not called on the initial hydration render.
   */
  onLeave?: (el: HTMLElement) => void | Promise<void>

  /**
   * Called after the new page is mounted into the container. Use this to
   * kick off an enter animation on the freshly-rendered content. Not
   * awaited — if you return a promise, the resolution is ignored.
   *
   * Not called on the initial hydration render.
   */
  onEnter?: (el: HTMLElement) => void

  /**
   * Called after mount or hydration completes. Fires on every render
   * including the initial hydration. Use this for per-render side
   * effects that don't fit the animation hooks (analytics, focus
   * management, etc.).
   */
  onMount?: () => void
}
```

## Constants

### `DEFAULT_DOCUMENT`

```typescript
const DEFAULT_DOCUMENT
```

### `currentHandle`

```typescript
const currentHandle: AppHandle | null
```

<!-- auto-api:end -->
