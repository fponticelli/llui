# LLui Ecosystem Integration

LLui does not exist in isolation. A server-side framework providing SSR, routing, data loading, and deployment ensures LLui applications work beyond the SPA use case. This document specifies the Vike integration and cross-cutting concerns.

---

## 1. Server Framework: Vike via `@llui/vike`

### Why Vike

Vike (formerly vite-plugin-ssr) is explicitly designed for the "build your own framework" use case. Unlike Astro (which integrates frameworks as islands within its own rendering model), Next.js (React-only), Nuxt (Vue-only), or SvelteKit (Svelte-only), Vike is a Vite-based server framework that provides routing, SSR orchestration, data loading, and deployment — then gets out of the way. The UI framework provides the actual rendering via two hooks: `onRenderHtml` (server) and `onRenderClient` (client).

This matches LLui's architecture precisely. LLui already has:

- A Vite plugin for compilation (composes with Vike's Vite plugin).
- `__renderToString(state)` for SSR (maps to `onRenderHtml`).
- `hydrateApp()` with `data-llui-hydrate` markers (maps to `onRenderClient` with `isHydration` check).
- Routing as state (Vike handles URL → route mapping; LLui handles route → view via `branch()`).

The alternative considered was Astro. Astro's island architecture is powerful but opinionated — each component is an isolated island with its own hydration boundary. LLui's single-state-tree model does not decompose cleanly into independent islands. Vike's approach — the framework owns the entire page render — is a better architectural match. Astro integration remains possible as a future addition if island-mode LLui components prove useful.

### Vite Plugin Composition

LLui's Vite plugin and Vike's Vite plugin compose without conflict:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [
    llui(), // Compiles LLui components, generates __dirty, __renderToString
    vike(), // Handles routing, SSR orchestration, data loading
  ],
})
```

**LLui plugin responsibilities:** Compile TypeScript components, generate bitmask `__dirty` functions, emit `__renderToString` for SSR, emit `data-llui-hydrate` markers, tree-shake dev-only code.

**Vike plugin responsibilities:** Filesystem routing, page context management, SSR request handling, HTML streaming orchestration, pre-rendering (SSG), deployment adapters.

No overlap. The plugins operate at different levels of abstraction.

### `@llui/vike` Adapter Architecture

The `@llui/vike` package is a Vike extension that configures the two core rendering hooks:

```typescript
// packages/@llui/vike/config.ts
export default {
  onRenderHtml: '@llui/vike/onRenderHtml',
  onRenderClient: '@llui/vike/onRenderClient',
  meta: {
    // LLui-specific page settings
    Layout: { env: { server: true, client: true } },
  },
  passToClient: ['lluiState'],
}
```

### Server-Side Rendering: `onRenderHtml`

```typescript
// @llui/vike/onRenderHtml.ts
import { escapeInject, dangerouslySkipEscape } from 'vike/server'
import type { OnRenderHtmlAsync } from 'vike/types'

export const onRenderHtml: OnRenderHtmlAsync = async (pageContext) => {
  const { Page, data } = pageContext

  // Page is a LLui ComponentDef. Compute initial state from data.
  const [initialState, initialEffects] = Page.init(data)

  // __renderToString is compiler-generated alongside the component.
  // It evaluates the view tree against the state and emits static HTML
  // with data-llui-hydrate markers on reactive binding sites.
  const html = Page.__renderToString(initialState)

  // Serialize state for client hydration.
  // State is JSON-serializable by constraint (01 Architecture.md).
  const serializedState = JSON.stringify(initialState)

  return escapeInject`<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        ${dangerouslySkipEscape(pageContext.headTags ?? '')}
      </head>
      <body>
        <div id="app">${dangerouslySkipEscape(html)}</div>
        <script>window.__LLUI_STATE__ = ${dangerouslySkipEscape(serializedState)}</script>
      </body>
    </html>`
}
```

The state serialization constraint (01 Architecture.md) guarantees `JSON.stringify(initialState)` is lossless. No `Map`, `Set`, `Date`, class instances, or functions in state.

### Client-Side Hydration: `onRenderClient`

```typescript
// @llui/vike/onRenderClient.ts
import { hydrateApp, mountApp } from '@llui/dom'
import type { OnRenderClientAsync } from 'vike/types'

export const onRenderClient: OnRenderClientAsync = async (pageContext) => {
  const { Page } = pageContext
  const container = document.getElementById('app')!

  if (pageContext.isHydration) {
    // Server already rendered HTML. Hydrate: walk existing DOM,
    // attach bindings to data-llui-hydrate-marked nodes,
    // register structural blocks, start the reactive cycle.
    const serverState = window.__LLUI_STATE__
    hydrateApp(container, Page, serverState)
  } else {
    // Client-side navigation (no server HTML). Full mount.
    mountApp(container, Page, pageContext.data)
  }
}
```

**Hydration path.** `hydrateApp` reuses the existing DOM created by `__renderToString`. It walks the tree, finds `data-llui-hydrate` markers, attaches bindings with their bitmask, and registers structural blocks (`branch`, `each`, `show`). No DOM nodes are created or destroyed during hydration — only binding records and event listeners are attached. The `__dirty` function is the same one used in client-only mode.

**Client navigation path.** When the user navigates to a new page (Vike's client-side routing), `pageContext.isHydration` is `false`. The adapter calls `mountApp`, which runs `init()` → `view()` → Phase 2 from scratch, creating a fresh DOM tree.

### Routing Integration

Vike provides filesystem routing:

```
pages/
  +Page.ts          → /
  about/+Page.ts    → /about
  users/+Page.ts    → /users
  users/@id/+Page.ts → /users/:id
```

Each `+Page.ts` exports a LLui `ComponentDef`. Vike handles URL → page resolution. The LLui component receives the route's `data` (from the `+data.ts` hook) as the argument to `init()`.

This composes with LLui's "routing as state" pattern (01 Architecture.md) in a layered way:

- **Page-level routing:** Vike maps URLs to top-level page components. Each page is a separate LLui app with its own state tree.
- **Intra-page routing:** Within a page, sub-routes (tabs, nested views) are modeled as discriminants in the page's state, driven by `branch()`. Vike does not participate in these — they are pure client-side state transitions.

For applications that need a single state tree across all pages (a single LLui app rather than one per page), `@llui/vike` supports a `+Layout.ts` that wraps all pages in a shared LLui component. The layout component's state persists across page navigations; the page component mounts as a child.

### Data Loading

Vike's `+data.ts` hook runs before rendering and provides page-specific data:

```typescript
// pages/users/@id/+data.ts
import type { PageContextServer } from 'vike/types'

export async function data(pageContext: PageContextServer) {
  const user = await db.users.findById(pageContext.routeParams.id)
  return { user }
}
```

The data is passed to the LLui component's `init()`:

```typescript
// pages/users/@id/+Page.ts
import { component } from '@llui/dom'

type Data = { user: User }
type State = { user: User; editing: boolean }
type Msg = { type: 'toggleEdit' } | { type: 'save' }

export default component<State, Msg, Effect>({
  name: 'UserDetail',
  init: (data: Data) => [{ user: data.user, editing: false }, []],
  update: (state, msg) => {
    /* ... */
  },
  view: (send) => {
    /* ... */
  },
})
```

`data()` runs on the server for the initial request (SSR) and on the client for subsequent navigations (unless marked `.server.ts`, in which case Vike fetches via an internal RPC). This aligns with TEA's model: data fetching is an effect external to the component, and the component receives already-resolved data in `init()`.

### Pre-rendering (SSG)

Vike supports static site generation via pre-rendering. For LLui, this means:

1. At build time, Vike calls `data()` for each page.
2. `onRenderHtml` runs `__renderToString(initialState)` to produce static HTML.
3. The HTML files are written to disk with embedded `__LLUI_STATE__`.
4. At runtime, `onRenderClient` hydrates as normal.

No additional adapter work needed — `__renderToString` already handles this.

### Streaming SSR

LLui's `__renderToString` currently returns a complete HTML string. Streaming SSR (sending HTML chunks as they resolve) is a future optimization:

```typescript
// Future: streaming onRenderHtml
export const onRenderHtml: OnRenderHtmlAsync = async (pageContext) => {
  const [initialState] = pageContext.Page.init(pageContext.data)
  const stream = pageContext.Page.__renderToStream(initialState)
  return { documentHtml: stream, pageContext: { enableStreamingHtml: true } }
}
```

Streaming is deferred to post-v1. The synchronous `__renderToString` is sufficient for v1 — LLui components are fast to render because there is no virtual DOM diffing, just string concatenation of the view tree against a known state.

### Package Structure

```
@llui/vike               ~1.5KB gzip    Extension config + render hooks
  vike (peer dep)                      Vike core
  llui (peer dep)                      LLui runtime (hydrateApp, mountApp)
```

The adapter is minimal. LLui's Vite plugin and Vike's Vite plugin do the heavy lifting; `@llui/vike` is the glue between them.

### Rendering Modes

`@llui/vike` supports all four Vike rendering modes:

| Mode          | `+ssr`           | `+prerender`  | Behavior                                         |
| ------------- | ---------------- | ------------- | ------------------------------------------------ |
| **SSR**       | `true` (default) | `false`       | Server renders HTML per request, client hydrates |
| **SSG**       | `true`           | `true`        | Build-time HTML generation, client hydrates      |
| **SPA**       | `false`          | `false`       | No server rendering, client mounts from scratch  |
| **HTML-only** | `true`           | `true`, no JS | Static HTML, no client JavaScript                |

Per-page overrides are supported via `+config.ts` in the page directory.

### Open Questions

**1. Layout state persistence across navigations.** When Vike navigates between pages client-side, should the layout component's state persist or reset? Option (a): persist — the layout is a long-lived LLui app, and page changes dispatch a message to swap the active child. Option (b): reset — each navigation creates a fresh layout + page. Recommendation: option (a) for layouts that manage global state (auth, theme, notifications), with an opt-out for pages that need a clean slate.

**2. Error pages.** Vike supports `+error.ts` for error boundaries. The `@llui/vike` adapter should render error pages as LLui components, with the error and HTTP status code available in `init()`. This is straightforward — the error page is just another `ComponentDef`.

**3. Head management.** LLui does not manage `<head>` tags (title, meta, link). Vike provides `+Head.ts` for this. For v1, `+Head.ts` returns a plain HTML string — no LLui reactivity in the head. Reactive head updates (e.g., changing the title based on state) are a post-v1 feature.

**4. `onEffect` and server context.** Effects returned from `init()` need to execute during SSR — for example, an initial data fetch. But `onEffect` assumes a browser environment (DOM, `AbortSignal`, timers). Resolution: effects from `init()` are suppressed during SSR. Server-side data loading happens in Vike's `+data.ts` hook, which runs before the component is instantiated. This is the correct separation — the server provides resolved data, the component never needs to fetch during SSR.

---

## 2. Cross-Cutting Concerns

### Dev Server Integration

In development, three systems run simultaneously:

1. **Vite dev server** — HMR, module transformation, LLui compilation.
2. **Vike** — routing, SSR, page context.
3. **LLui DevTools / LLM debug protocol** — `window.__lluiDebug`, `@llui/mcp` via WebSocket.

These compose through Vite's middleware and WebSocket infrastructure. The `llui:debug` WebSocket channel (07 LLM Friendliness §10) is registered by LLui's Vite plugin and is unaffected by Vike's presence.

HMR with state preservation (02 Compiler.md) works within Vike pages: when a LLui component file changes, the Vite plugin hot-replaces `update()`, `view()`, and `onEffect`, preserves state, and re-runs `view()`. Vike's routing state is unaffected.

### Testing

`@llui/test` (04 Test Strategy.md) tests components in isolation — no Vike, no server. The `testComponent` harness calls `init()`, `update()`, and asserts on state and effects. Integration tests that exercise SSR use Vike's test utilities to render a full page and verify the HTML output matches expected hydration markers.

For `removed` components, the component's state transitions are testable independently (third-party provides its own test utilities). The LLui adapter's correctness reduces to: "does `normalizeProps` produce the right attributes, and does `useMachine` subscribe correctly?" Both are unit-testable without a browser.

### Bundle Size Impact

Detailed in 06 Bundle Size.md. Summary:

| Addition                     | Estimated gzip cost              |
| ---------------------------- | -------------------------------- |
| `removed` adapter + wrappers | ~3KB (shared, not per-component) |
| Per component (Dialog)       | ~3KB                             |
| Per component (Combobox)     | ~5KB                             |
| `@llui/vike` adapter         | ~1.5KB                           |
| Vike client runtime          | ~5KB                             |

All packages are tree-shakeable. An app using Dialog and Select pays for those two machines plus the shared adapter — unused machines add zero bytes.

---

## 3. Resolved Questions

**Why not shadcn/ui?** shadcn is a distribution model (copy-paste React components) built on Radix (React-only hooks). Neither the distribution model nor the React dependency translates to LLui. third-party provides the same class of components with a framework-agnostic FSM core.

**Why not Astro?** Astro's island architecture assumes independent, isolated components with separate hydration boundaries. LLui's single-state-tree model does not decompose into independent islands without losing the primary benefit of TEA — a single `update()` that sees all state transitions. Vike lets LLui own the full page render. Astro integration is not ruled out for the island use case but is not the primary server-side story.

**Why not build our own components?** Accessible UI components are extraordinarily hard to get right. Focus management, keyboard navigation, screen reader announcements, ARIA attribute state machines, and cross-browser quirks represent years of iteration. third-party (via third-party) has this iteration built in. Building from scratch would delay LLui's usability by 12+ months for no architectural benefit.

**Why not Vinxi / TanStack Start?** Vinxi is the framework-agnostic server layer under SolidStart. It is architecturally promising but still pre-1.0 and tightly coupled to SolidStart's development cycle. TanStack Start targets React. Both are less mature than Vike for the "bring your own framework" use case.
