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

### Page Transitions

`createOnRenderClient` accepts `onLeave` and `onEnter` hooks that fire around the dispose-and-remount cycle on client navigation. `onLeave` is awaited — return a promise to defer the swap until a leave animation finishes:

```ts
import { createOnRenderClient, fromTransition } from '@llui/vike/client'
import { routeTransition } from '@llui/transitions'

export const onRenderClient = createOnRenderClient({
  ...fromTransition(routeTransition({ duration: 200 })),
})
```

`fromTransition` adapts any `TransitionOptions` (the shape returned by `routeTransition`, `fade`, `slide`, etc.) into the hook pair. The transition operates on the container element — its opacity / transform fades out the outgoing page, then the new page fades in after mount.

For raw animations without `@llui/transitions`, write the hooks yourself:

```ts
export const onRenderClient = createOnRenderClient({
  onLeave: (el) => el.animate({ opacity: [1, 0] }, 200).finished,
  onEnter: (el) => el.animate({ opacity: [0, 1] }, 200),
})
```

### Client Navigation Lifecycle

When Vike fires a client-side navigation, `@llui/vike` runs this sequence inside `onRenderClient`:

1. **`onLeave(el)`** — awaited. The outgoing page's DOM is still mounted; this is the only moment where a leave animation can read/write it.
2. **`currentHandle.dispose()`** — tears down the outgoing component's scope tree. All `onMount` cleanups run here, portals are removed from their targets, focus traps are popped, body scroll locks release, sibling `aria-hidden` is restored. The regression test in `@llui/components/test/components/dialog-dispose.test.ts` covers this path explicitly.
3. **`el.textContent = ''`** — the outgoing DOM is cleared from the container.
4. **`mountApp(el, Page, data)`** — the new page mounts.
5. **`onEnter(el)`** — synchronous; fire-and-forget. Promises are ignored here.
6. **`onMount()`** — legacy hook, fires last on every render (including the initial hydration).

On the initial hydration render, `onLeave` and `onEnter` are both skipped — there's no outgoing page to leave, and hydration doesn't insert new DOM that needs an enter animation.

**AbortSignal semantics for in-flight effects.** When a component is disposed, its `AbortController` fires and `inst.signal.aborted` becomes `true`. Effect handlers should guard their `send()` calls against `signal.aborted` — the base package already does this in `@llui/effects`. Network requests that have already been accepted by the server are NOT cancelled by navigation; cancellation only applies to future `send()` dispatches into the now-aborted instance. This is intentional: cancelling a successful signup POST just because the user clicked a nav link would lose data.

**Scroll position is the host's problem.** Vike controls scroll-to-top behavior via `scrollToTop` in `+config.ts`. `@llui/vike` doesn't touch scroll — if you need custom scroll handling, configure it on the Vike side.

## How It Works

### Server (`onRenderHtml`)

Renders the component to HTML via `renderToString()`. Automatically initializes jsdom for server-side DOM (lazy-loaded to avoid client bundle pollution). Serializes state into a `<script>` tag for hydration.

### Client (`onRenderClient`)

Hydrates the server-rendered HTML on the client. Attaches event listeners and reactive bindings to existing DOM nodes without re-rendering. Falls back to fresh `mountApp()` for client-side navigations.

## API

| Export                 | Sub-path            | Description                                                      |
| ---------------------- | ------------------- | ---------------------------------------------------------------- |
| `onRenderHtml`         | `@llui/vike/server` | Default server hook — minimal HTML template                      |
| `createOnRenderHtml`   | `@llui/vike/server` | Factory for custom document templates                            |
| `onRenderClient`       | `@llui/vike/client` | Default client hook — hydrate or mount                           |
| `createOnRenderClient` | `@llui/vike/client` | Factory for custom container + `onLeave` / `onEnter` / `onMount` |
| `fromTransition`       | `@llui/vike/client` | Adapter: `TransitionOptions` → `{ onLeave, onEnter }` hook pair  |

The barrel export (`@llui/vike`) re-exports everything, but prefer sub-path imports to avoid bundling jsdom into the client.
