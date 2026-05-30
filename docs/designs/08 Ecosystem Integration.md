# LLui Ecosystem Integration

LLui does not exist in isolation. A server-side framework providing SSR, routing, data loading, and deployment ensures LLui applications work beyond the SPA use case. This document specifies the Vike integration and cross-cutting concerns.

---

## 1. Server Framework: Vike via `@llui/vike`

### Why Vike

Vike (formerly vite-plugin-ssr) is explicitly designed for the "build your own framework" use case. Unlike Astro (which integrates frameworks as islands within its own rendering model), Next.js (React-only), Nuxt (Vue-only), or SvelteKit (Svelte-only), Vike is a Vite-based server framework that provides routing, SSR orchestration, data loading, and deployment — then gets out of the way. The UI framework provides the actual rendering via two hooks: `onRenderHtml` (server) and `onRenderClient` (client).

This matches LLui's architecture precisely. LLui already has:

- A Vite plugin for compilation (composes with Vike's Vite plugin).
- Signal SSR — `renderToString` / `renderNodes` / `serializeNodes` (maps to `onRenderHtml`).
- `hydrateSignalApp()` — atomic-swap hydration, no claim markers (maps to `onRenderClient` with an `isHydration` check).
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
    llui(), // Lowers signal views to the runtime form; signal lint as build errors
    vike(), // Handles routing, SSR orchestration, data loading
  ],
})
```

**LLui plugin responsibilities:** Lower the signal direct view to the runtime emitters, surface the signal lint rules as build errors, emit dev/agent introspection metadata, tree-shake dev-only code. (Signal SSR needs no special compiler output — `renderToString` walks the same view; hydration rebuilds and atomic-swaps, so there are no `data-llui-hydrate` markers to emit.)

**Vike plugin responsibilities:** Filesystem routing, page context management, SSR request handling, HTML streaming orchestration, pre-rendering (SSG), deployment adapters.

No overlap. The plugins operate at different levels of abstraction.

### `@llui/vike` Adapter Architecture

The `@llui/vike` package provides rendering hooks via sub-path exports. Use `@llui/vike/server` for the server hook and `@llui/vike/client` for the client hook — this keeps jsdom out of the client bundle.

### Basic Setup

```typescript
// pages/+onRenderHtml.ts
export { onRenderHtml } from '@llui/vike/server'

// pages/+onRenderClient.ts
export { onRenderClient } from '@llui/vike/client'
```

### Custom Document Template

Use `createOnRenderHtml` to control the DOM environment, the (optional) layout chain, and the full HTML document:

```typescript
// pages/+onRenderHtml.ts
import { createOnRenderHtml } from '@llui/vike/server'

export const onRenderHtml = createOnRenderHtml({
  // Async DomEnv factory — jsdom or linkedom; keeps the DOM impl out of the client bundle.
  domEnv: async () => (await import('@llui/dom/ssr/jsdom')).jsdomEnv(),
  document: ({ html, state, head }) => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="/styles.css" />
    ${head}
  </head>
  <body>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script>
  </body>
</html>`,
})
```

`createOnRenderHtml` also accepts an optional `Layout` resolver `(pageContext) => AnyLayer[]` for persistent layouts (see Routing Integration). The `document` callback receives `{ html, state, head, pageContext }` — `state` is the already-`JSON.stringify`-ed hydration envelope, `head` is content from `+Head.ts`.

### Server-Side Rendering: `onRenderHtml`

Internally, `onRenderHtml` does:

1. Resolves the `DomEnv` (the `domEnv` factory; a `DomEnv` from `@llui/dom/ssr/jsdom` or `@llui/dom/ssr/linkedom`).
2. Seeds each layer's state — in the signal runtime `init()` takes NO data argument, so a layer's per-layer `data` slice is used directly as that layer's seed state (and the layer's own `init()` provides the seed when absent).
3. Builds the layer node trees with `renderNodes(def, seedState, env)` (composing layout + page at the `pageSlot()` anchor) and serializes them with `serializeNodes`.
4. Serializes the hydration envelope into a `<script>` tag via `JSON.stringify`.
5. Returns the document wrapped in Vike's `dangerouslySkipEscape` format.

The state serialization constraint (01 Architecture.md) guarantees `JSON.stringify(initialState)` is lossless. No `Map`, `Set`, `Date`, class instances, or functions in state. Server render is pure — effects (including `onMount`/`portal`) are not dispatched during SSR.

### Client-Side Hydration: `onRenderClient`

```typescript
// Internally:
if (pageContext.isHydration) {
  hydrateSignalApp(target, def, serverState)
} else {
  mountSignalComponent(target, def, { initialState })
}
```

**Hydration path.** `hydrateSignalApp` does NOT reuse server nodes via claim-markers. It rebuilds the (deterministic) client tree against `serverState` (matching the SSR render) and atomically REPLACES the server HTML with the freshly-built tree — the server HTML stays visible until the swap, so there is no flash. `init()`'s effects are skipped by default (the server pass already ran the pure render); pass `runInitEffects: true` for an `init()` that no-ops on the server. Because hydration rebuilds, there are no `data-llui-hydrate` markers and no walk-and-attach step.

**Client navigation path.** When the user navigates to a new page (Vike's client-side routing), `pageContext.isHydration` is `false`. The adapter calls `mountSignalComponent`, which runs `init()` → builds the view → reconciles from scratch, creating a fresh DOM tree.

### Routing Integration

Vike provides filesystem routing:

```
pages/
  +Page.ts          → /
  about/+Page.ts    → /about
  users/+Page.ts    → /users
  users/@id/+Page.ts → /users/:id
```

Each `+Page.ts` exports a signal component. Vike handles URL → page resolution. Because the signal `init()` takes no data argument, the route's `data` (from the `+data.ts` hook) is supplied as the page's seed STATE (the adapter overrides the seed; `init()` still runs so its effects are captured).

This composes with LLui's "routing as state" pattern (01 Architecture.md) in a layered way:

- **Page-level routing:** Vike maps URLs to top-level page components. Each page is a separate LLui app with its own state tree.
- **Intra-page routing:** Within a page, sub-routes (tabs, nested views) are modeled as discriminants in the page's state, driven by `branch()`. Vike does not participate in these — they are pure client-side state transitions.

For applications that need persistent layouts across navigations, `@llui/vike` supports a layout chain. A layout component places `pageSlot()` (from `@llui/vike/client`) where its nested content renders, and the `Layout` resolver passed to `createOnRenderHtml`/`createOnRenderClient` returns the chain of layers for a route. The layout's state persists across page navigations; the nested page mounts at the slot anchor. (Name the file `Layout.ts`, not `+Layout.ts` — Vike reserves the `+` prefix.) Contexts a layout provides above the slot reach the nested page: `pageSlot()` snapshots the in-scope context values and the adapter replays them into the nested layer's separate build.

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

In the signal runtime the page's `init()` takes no argument, so Vike's `data` is supplied as the page's seed STATE. The page's `State` type should therefore be shaped so the route data IS (or embeds) the initial state:

```typescript
// pages/users/@id/+Page.ts
import { component } from '@llui/dom'

// `+data.ts` returns this shape; the adapter seeds it as the page's state.
type State = { user: User; editing: boolean }
type Msg = { type: 'toggleEdit' } | { type: 'save' }

export default component<State, Msg>({
  name: 'UserDetail',
  // init() runs (its effects are captured) but the seed state is overridden by
  // the route data; provide a sensible fallback for client-only mounts.
  init: () => [{ user: EMPTY_USER, editing: false }, []],
  update: (state, msg) => {
    /* ... */
  },
  view: ({ state, send }) => [
    /* ... */
  ],
})
```

`data()` runs on the server for the initial request (SSR) and on the client for subsequent navigations (unless marked `.server.ts`, in which case Vike fetches via an internal RPC). This aligns with TEA's model: data fetching is an effect external to the component, and the component receives already-resolved data as its seed state.

### Pre-rendering (SSG)

Vike supports static site generation via pre-rendering. For LLui, this means:

1. At build time, Vike calls `data()` for each page.
2. `onRenderHtml` runs the signal SSR (`renderNodes` + `serializeNodes`, or `renderToString`) to produce static HTML.
3. The HTML files are written to disk with the embedded `__LLUI_STATE__` envelope.
4. At runtime, `onRenderClient` hydrates as normal (rebuild + atomic swap).

No additional adapter work needed — the signal SSR path already handles this.

### Streaming SSR

The signal SSR path currently returns a complete HTML string (`renderToString` / `serializeNodes`). Streaming SSR (sending HTML chunks as they resolve) is a future optimization and is not part of the current API. The synchronous render is sufficient — LLui builds the node tree once against a known state and serializes it, with no virtual DOM diffing.

### Package Structure

```
@llui/vike               Extension config + render hooks (createOnRenderHtml/Client, pageSlot)
  vike (peer dep)                      Vike core
  @llui/dom (peer dep)                 LLui runtime (renderNodes/serializeNodes, hydrateSignalApp, mountApp)
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

## 2. Imperative Libraries via `foreign()`

For imperative third-party libraries that own their own DOM — code editors, maps, charts, rich-text editors — the boundary is `foreign()`. It creates a container element, hands it to the library's imperative `mount`, and drives the library from declared `state` signals.

```typescript
import { foreign } from '@llui/dom'
import type { Signal } from '@llui/dom'

export function codeView(routeSig: Signal<Route>): Node[] {
  return [
    foreign<EditorInstance, { props: Signal<FileProps> }>({
      tag: 'div', // optional container tag (default 'div')
      // Declared state signals — derived from the parent's signals:
      state: { props: routeSig.map(fileProps) },
      // `state.props` arrives as a LiveSignal (peek + bind), NOT a Signal:
      mount: ({ el, state }) => {
        el.className = 'code-viewer'
        const inst = createEditor(el)
        // bind() fires immediately with the current value, then on every change.
        // Mount-time binds auto-dispose on unmount.
        state.props.bind((props) => inst.render(props))
        return inst
      },
      unmount: (inst) => inst.dispose(),
    }),
  ]
}
```

Key points for the signal shape:

- The declared `state` map's values are signals (`routeSig.map(...)`, `state.at(...)`, …). Inside `mount`, each is materialized to a `LiveSignal<T>` — a minimal read+subscribe handle with `peek()` and `bind(cb)` (no `at`/`map`/`derived`). `bind` fires synchronously with the current value, then on every change, and returns an unsubscribe; mount-time binds auto-dispose on unmount.
- The library owns the DOM inside the container; LLui owns the container and drives the declared signals. There is no `props`/`sync`/`destroy` shape — that was the legacy runtime's API.
- `foreign()` is also the boundary for embedding a genuinely independent app whose state lifetime is distinct from the host's.

`@llui/components` (accordion, dialog, tabs, select, tree-view, …) are built on the signal authoring surface directly (`show`, `portal`, `onMount`, `useContext`, …), not on `foreign()` — `foreign()` is reserved for non-LLui imperative code.

## 3. Cross-Cutting Concerns

### Dev Server Integration

In development, three systems run simultaneously:

1. **Vite dev server** — HMR, module transformation, LLui compilation.
2. **Vike** — routing, SSR, page context.
3. **LLui DevTools / LLM debug protocol** — `window.__lluiDebug`, `@llui/mcp` via WebSocket.

These compose through Vite's middleware and WebSocket infrastructure. The `llui:debug` WebSocket channel (07 LLM Friendliness §10) is registered by LLui's Vite plugin and is unaffected by Vike's presence.

HMR with state preservation (02 Compiler.md) works within Vike pages: when a LLui component file changes, the Vite plugin hot-replaces `update()`, `view()`, and `onEffect`, preserves state, and re-runs `view()`. Vike's routing state is unaffected.

### Testing

`@llui/test` (04 Test Strategy.md) tests components in isolation — no Vike, no server. The `testComponent` harness calls `init()`/`update()` and asserts on state and effects; `testView` mounts via the signal runtime under jsdom/happy-dom. Integration tests that exercise SSR call the signal SSR path directly (`renderToString`/`renderNodes` against a `DomEnv`) and assert on the produced HTML, or use Vike's test utilities to render a full page.

Hydration tests assert that re-rendering the same `serverState` on the client produces a tree equivalent to the server HTML — there are no hydration markers to match (hydration rebuilds and atomic-swaps).

### Bundle Size Impact

Detailed in 06 Bundle Size.md. Summary (byte figures are stale pending re-measurement against the signal runtime):

| Addition                                | gzip cost                   |
| --------------------------------------- | --------------------------- |
| `@llui/components` (per used component) | re-measure (tree-shakeable) |
| `@llui/vike` adapter                    | re-measure                  |
| Vike client runtime                     | separate Vike concern       |

All packages are tree-shakeable. An app pays only for the components it imports.

---

## 4. Resolved Questions

**Why not shadcn/ui?** shadcn is a distribution model (copy-paste React components) built on Radix (React-only hooks). Neither the distribution model nor the React dependency translates to LLui. LLui ships its own headless components (`@llui/components`) built on the signal authoring surface.

**Why not Astro?** Astro's island architecture assumes independent, isolated components with separate hydration boundaries. LLui's single-state-tree model does not decompose into independent islands without losing the primary benefit of TEA — a single `update()` that sees all state transitions. Vike lets LLui own the full page render. Astro integration is not ruled out for the island use case but is not the primary server-side story.

**How are accessible components provided?** `@llui/components` (accordion, dialog, tabs, select, tree-view, tour, timer, …) ship the focus management, keyboard navigation, ARIA state, and screen-reader behavior, built directly on the signal authoring surface (`show`, `portal`, `onMount`, context). For imperative third-party libraries that own their own DOM, use `foreign()` (§2).

**Why not Vinxi / TanStack Start?** Vinxi is the framework-agnostic server layer under SolidStart. It is architecturally promising but still pre-1.0 and tightly coupled to SolidStart's development cycle. TanStack Start targets React. Both are less mature than Vike for the "bring your own framework" use case.
