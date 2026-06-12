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

### Persistent Layouts

Declare app chrome (header, sidebar, dialogs, session state) as a `Layout` component that stays mounted across client navigation. The route-scoped `Page` swaps in and out at the layout's `pageSlot()` position while the surrounding layout subtree — and every DOM node, focus trap, portal, and effect subscription inside it — is untouched.

> **Do not name your layout file `+Layout.ts`.** Vike reserves the `+` prefix for its own framework-adapter config conventions, and `+Layout.ts` specifically is interpreted by `vike-react` / `vike-vue` / `vike-solid` as a framework-native layout config. `@llui/vike` isn't a framework adapter in that sense — it's a render adapter, and `createOnRenderClient({ Layout })` consumes the layout component directly. Name your file `Layout.ts`, `app-layout.ts`, or place it anywhere outside `/pages` that Vike won't scan, then import it from `+onRenderClient.ts` / `+onRenderHtml.ts` by path.

```ts
// pages/Layout.ts    ← not +Layout.ts
import { component, div, header, main } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'

export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => [{ session: null }, []],
  update: layoutUpdate,
  view: ({ send }) => [
    div({ class: 'app-shell' }, [
      header([
        /* persistent chrome */
      ]),
      main([pageSlot()]), // ← where the route's Page renders
    ]),
  ],
})
```

```ts
// pages/+onRenderClient.ts
import { createOnRenderClient } from '@llui/vike/client'
import { AppLayout } from './Layout'

export const onRenderClient = createOnRenderClient({
  Layout: AppLayout,
})
```

```ts
// pages/+onRenderHtml.ts — server renders layout + page as one tree
import { createOnRenderHtml } from '@llui/vike/server'
import { AppLayout } from './Layout'

export const onRenderHtml = createOnRenderHtml({
  Layout: AppLayout,
})
```

Call `pageSlot()` exactly once in each layout's view, at the position where nested content should render. It's an ordinary structural primitive — composes naturally inside `show()`, `branch()`, `provide()`, and any other view tree.

You can place your **own siblings** next to `pageSlot()` — before it or after it — in the same parent element (e.g. a navigation-loading bar beside the page inside `<main>`). The slot owns only the region between its anchor and a synthesized end sentinel, so on both SSR and every client navigation it inserts/disposes that region without touching your siblings. The `display: contents` wrapper that older guidance used to isolate the slot is **no longer needed** — drop it.

```ts
import { div, main, text } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'

const navBar = () => div({ class: 'nav-loading' }, [text('…')])

main([
  navBar(), // ← your sibling survives navigation…
  pageSlot(), // …only this region swaps
])
```

#### Nested layouts

Pass an array to stack layouts outer-to-inner. Each layout except the innermost calls its own `pageSlot()`. The innermost layer is always the route's `Page`.

```ts
createOnRenderClient({
  Layout: [AppLayout, DashboardLayout],
})
```

For per-route chains — e.g. `/dashboard/*` routes use `[AppLayout, DashboardLayout]` while `/settings` uses `[AppLayout]` — pass a resolver function instead:

```ts
createOnRenderClient({
  Layout: (pageContext) =>
    pageContext.urlPathname.startsWith('/dashboard') ? [AppLayout, DashboardLayout] : [AppLayout],
})
```

The resolver's `pageContext` exposes Vike's routing fields directly — `urlPathname` (a `string`) and `routeParams` (a `Record<string, string>`) — so you branch the chain on the route with no cast. Configure the **same resolver** on `createOnRenderHtml` so the server renders the identical chain the client hydrates. (Its type is exported as `LayoutResolverContext` / `ServerLayoutResolverContext` if you want to annotate a standalone resolver.)

The chain diff on each nav walks old and new chains in parallel and finds the first mismatch. Every layer before that mismatch stays mounted; every layer at or after it is torn down innermost-first and re-mounted outermost-first. Navigating from `/dashboard/reports` to `/dashboard/overview` only disposes the `Page` — `AppLayout` and `DashboardLayout` stay alive. Navigating to `/settings` disposes `DashboardLayout` and the `Page`, keeping only `AppLayout`.

#### Route-scoped section layouts (persistent sidebar)

This is the idiomatic way to build a **section with its own persistent chrome** — a docs area with a left sidebar, a settings master-detail, a dashboard rail. Make the section's chrome a layout that's only in the chain for that section's routes:

```ts
// /docs/* keeps DocsLayout (the sidebar) mounted; everything else drops it.
const Layout = (pageContext) =>
  pageContext.urlPathname.startsWith('/docs') ? [AppLayout, DocsLayout] : [AppLayout]

createOnRenderHtml({ Layout, domEnv: jsdomEnv })
createOnRenderClient({ Layout, ...fromTransition(routeTransition({ duration: 200 })) })
```

Navigating `/docs/intro → /docs/advanced` keeps `AppLayout` **and** `DocsLayout` mounted — the sidebar's DOM, scroll position, focus, and effect subscriptions are untouched — and re-mounts only the innermost article `Page`. Because the transition operates on the innermost surviving layer's `pageSlot()` container, `fromTransition(...)` animates just the article column, not the persistent sidebar. Navigating out of `/docs` disposes `DocsLayout` (and its sidebar) along with the page.

#### Layout ↔ Page communication

Layouts and pages are independent component instances with their own state, update, and `send`. They share state and expose cross-cutting operations via **context**, not via direct messaging.

The scope-tree integration makes this natural: `pageSlot()` creates its slot as a child of the layout's render scope, and the page's `rootLifetime` is parented inside that slot. `useContext` from within the page walks up through the slot and finds any providers the layout installed above it.

Common pattern — a layout-owned toast system:

```ts
// pages/Layout.ts
import { component, div, main, provide, createContext } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'

interface ToastDispatchers {
  show: (msg: string) => void
  dismiss: (id: string) => void
}
export const ToastContext = createContext<ToastDispatchers>(undefined, 'Toast')

// Note: import { provideValue, useContextValue } from '@llui/dom' for
// the stable-dispatcher pattern below — they're the static-bag
// companions to the reactive provide / useContext primitives.

export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => [{ toasts: [] }, []],
  update: layoutUpdate,
  view: ({ send }) => [
    div({ class: 'app-shell' }, [
      ToastStack(), // reads from layout state
      ...provideValue(
        ToastContext,
        {
          show: (msg) => send({ type: 'toast/show', msg }),
          dismiss: (id) => send({ type: 'toast/dismiss', id }),
        },
        () => [main([pageSlot()])],
      ),
    ]),
  ],
})
```

```ts
// Any page below the layout can now use the toast dispatcher.
// pages/studio/+Page.ts
import { component, button, text, useContextValue } from '@llui/dom'
import { ToastContext } from '../Layout'

export const StudioPage = component<StudioState, StudioMsg>({
  name: 'StudioPage',
  init: () => [{ saved: false }, []],
  update: (s, m) => {
    if (m.type === 'saveSucceeded') {
      // ...
    }
    return [s, []]
  },
  view: ({ send }) => {
    const toast = useContextValue(ToastContext)
    return [button({ onClick: () => toast.show('Saved') }, [text('Save')])]
  },
})
```

`provideValue` and `useContextValue` are companions to the reactive `provide` / `useContext` for the common case of publishing a stable dispatcher bag — anything that doesn't depend on the parent's state. Use them for toast queues, session managers, breadcrumb dispatchers, and any other pattern where a page calls into layout-owned operations through a closure-captured `send`. The reactive `provide(ctx, accessor, children)` and `useContext(ctx)` forms still exist for context values that DO depend on state (e.g. `provide(ThemeContext, (s) => s.theme, () => [...])`).

Toast state machines, global progress indicators, breadcrumb/title bars, modal-takeover chrome toggles, and session-expired banners all fall out of this pattern naturally — the layout owns the state, provides a dispatcher via context, and any page can trigger layout operations without touching the layout's internals.

For the rarer case where a layout needs to **probe a page** (e.g. "is your form dirty? can we navigate away?"), use **addressed effects** — the page registers an address on mount, the layout dispatches a targeted effect to it.

#### Layout data

Layouts can have their own server-fetched data alongside per-page `+data.ts` by populating `pageContext.lluiLayoutData` as an array matching the layout chain (outermost first). Each layout's `init(layoutData)` receives its slice.

Wire this from Vike's config mechanism however you like — the adapter just reads `pageContext.lluiLayoutData` when present.

#### Hydration envelope

With a `Layout` configured, `window.__LLUI_STATE__` is chain-aware:

```js
window.__LLUI_STATE__ = {
  layouts: [
    { name: 'AppLayout', state: { session: 'alice' } },
    { name: 'DashboardLayout', state: { active: 'reports' } },
  ],
  page: { name: 'ReportsPage', state: { view: 'summary' } },
}
```

The client matches each layer by component `name` when hydrating — server/client chain mismatches throw with a clear error instead of silently binding the wrong state to the wrong instance. Pages written against the pre-layout flat envelope shape continue to hydrate correctly when no `Layout` is configured.

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

> **`onLeave`/`onEnter` are not loading hooks.** They bracket the DOM **swap**, which runs _after_ Vike has already fetched the new page's `+data` — Vike only invokes `onRenderClient` once the incoming pageContext is populated. Nothing in this cycle covers the during-fetch latency a user perceives as lag. For a loader that appears the moment a navigation starts (on the click, before the round-trip), use [Navigation Progress](#navigation-progress) below.

For raw animations without `@llui/transitions`, write the hooks yourself:

```ts
export const onRenderClient = createOnRenderClient({
  onLeave: (el) => el.animate({ opacity: [1, 0] }, 200).finished,
  onEnter: (el) => el.animate({ opacity: [0, 1] }, 200),
})
```

### Navigation Progress

To show a loader _while_ a client navigation is in flight — the latency between the click and the new page appearing — you need a signal at navigation **start**, before the `+data` round-trip. None of the `onRenderClient` hooks fire there (see the note above). Vike's native `onPageTransitionStart` / `onPageTransitionEnd` hooks do, and `createNavigationProgress()` wraps them into a reactive boolean the layout binds:

```ts
// nav-progress.ts — your module, created once
import { createNavigationProgress } from '@llui/vike/client'

// `delay` debounces the reveal: navigations that resolve faster than 120ms
// (e.g. served from a hover prefetch) never flash the indicator.
export const navProgress = createNavigationProgress({ delay: 120 })
```

`@llui/vike` can't register Vike's `+onPageTransition*` hooks for you — Vike discovers them by the `+` filename convention — so re-export the handle's hook functions from the two convention files:

```ts
// pages/+onPageTransitionStart.ts
export { onPageTransitionStart } from '../nav-progress'
```

```ts
// pages/+onPageTransitionEnd.ts
export { onPageTransitionEnd } from '../nav-progress'
```

Then bind `navProgress.pending` in the layout. It's a `LiveSignal<boolean>`: `peek()` for a one-shot read, `bind(cb)` for a reactive subscription that fires immediately with the current value and on every change. The zero-message path is an `onMount` that toggles a class — `bind` returns its unsubscribe, which doubles as the `onMount` cleanup:

```ts
// pages/Layout.ts
import { component, div, header, main, onMount } from '@llui/dom'
import { pageSlot } from '@llui/vike/client'
import { navProgress } from '../nav-progress'

export const AppLayout = component<LayoutState, LayoutMsg>({
  name: 'AppLayout',
  init: () => [{ session: null }, []],
  update: layoutUpdate,
  view: () => [
    div({ class: 'app-shell' }, [
      onMount((root) => navProgress.pending.bind((p) => root.classList.toggle('nav-pending', p))),
      header([]),
      main([pageSlot()]),
    ]),
  ],
})
```

This replaces the module-singleton + layout-handle capture + hand-rolled `nav/pending` message + reducer case each app would otherwise re-derive. If you'd rather drive the indicator from layout state instead of a class toggle, `bind` straight into a `send({ type: 'nav/pending', pending })` — but the class toggle needs no message at all.

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

## Cloudflare Workers

Two things differ from a Node deploy:

1. **Pick `linkedomEnv`** for SSR — jsdom's transitive deps (`whatwg-url`, `tr46`, `punycode`) don't resolve under workerd. Pass it to `createOnRenderHtml`:

   ```ts
   // pages/+onRenderHtml.ts
   import { createOnRenderHtml } from '@llui/vike/server'
   import { linkedomEnv } from '@llui/dom/ssr/linkedom'

   export const onRenderHtml = createOnRenderHtml({ domEnv: linkedomEnv })
   ```

2. **Guard the manual server-entry import in `worker.ts`.** `@brillout/vite-plugin-server-entry`'s auto-importer doesn't reach into workerd — its generated `loadServerEntry()` resolves a deeply-nested filesystem path that workerd refuses to bind. The fix is to import `dist/server/entry.mjs` yourself, but you **must** guard that import with `import.meta.env.PROD`:

   ```ts
   // worker.ts
   if (import.meta.env.PROD) {
     // @ts-expect-error — generated by `vite build`, absent in dev
     await import('../dist/server/entry.mjs')
   }

   import { renderPage } from 'vike/server'

   export default {
     async fetch(req: Request): Promise<Response> {
       const { httpResponse } = await renderPage({ urlOriginal: req.url })
       if (!httpResponse) return new Response('Not Found', { status: 404 })
       return new Response(httpResponse.body, {
         status: httpResponse.statusCode,
         headers: httpResponse.headers,
       })
     },
   }
   ```

   Use `import.meta.env.PROD`, **not** `process.env.NODE_ENV` — workerd has no Node `process`, so the brillout README's `if (process.env.NODE_ENV === 'production')` snippet evaluates falsy at runtime and silently skips the import, leaving Vike with no registered hooks. Vite substitutes `import.meta.env.PROD` at build time (`true` in `vite build`, `false` in `vite dev`), so the guarded branch is correctly elided in dev.

   **Why the guard matters.** Without it, this sequence breaks dev:

   ```
   pnpm build      # writes dist/server/entry.mjs
   pnpm dev        # workerd resolves the literal '../dist/server/entry.mjs'
   ```

   `dist/server/entry.mjs` calls `setGlobalContext_prodBuildEntry()` at module top level. Vike correctly detects a prod initializer running in dev and throws `[vike@…][Bug] You stumbled upon a Vike bug`. If you've already hit this, `rm -rf dist && pnpm dev` recovers; adding the guard prevents recurrence.

## How It Works

### Server (`onRenderHtml`)

Renders the component to HTML via `renderToString()`. Each render gets a fresh `DomEnv` from the factory passed to `createOnRenderHtml({ domEnv })` — use `jsdomEnv` from `@llui/dom/ssr/jsdom` for Node targets, or `linkedomEnv` from `@llui/dom/ssr/linkedom` for Cloudflare Workers (jsdom's transitive deps don't resolve under workerd). The default `onRenderHtml` export wires up jsdom for zero-config Node setups; `createOnRenderHtml` requires an explicit `domEnv` factory so the bundler can tree-shake whichever DOM you don't use.

### Client (`onRenderClient`)

Hydrates the server-rendered HTML on the client. Attaches event listeners and reactive bindings to existing DOM nodes without re-rendering. Falls back to fresh `mountApp()` for client-side navigations.

## API

| Export                     | Sub-path            | Description                                                                      |
| -------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `onRenderHtml`             | `@llui/vike/server` | Default server hook — minimal HTML template                                      |
| `createOnRenderHtml`       | `@llui/vike/server` | Factory for custom document templates + persistent layouts                       |
| `onRenderClient`           | `@llui/vike/client` | Default client hook — hydrate or mount                                           |
| `createOnRenderClient`     | `@llui/vike/client` | Factory for custom container + layouts + transition hooks                        |
| `pageSlot`                 | `@llui/vike/client` | Structural primitive — declares where a layout renders its page                  |
| `fromTransition`           | `@llui/vike/client` | Adapter: `TransitionOptions` → `{ onLeave, onEnter }` hook pair                  |
| `createNavigationProgress` | `@llui/vike/client` | Reactive `pending` signal + `+onPageTransition*` hooks for a during-fetch loader |

The barrel export (`@llui/vike`) re-exports everything, but prefer sub-path imports to avoid bundling jsdom into the client.
