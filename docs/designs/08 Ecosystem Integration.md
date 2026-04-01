# LLui Ecosystem Integration

LLui does not exist in isolation. Two integration axes determine whether developers can adopt it in real projects: (1) a component library providing accessible, production-grade UI primitives so teams do not rewrite dialogs and comboboxes from scratch, and (2) a server-side framework providing SSR, routing, data loading, and deployment so LLui applications work beyond the SPA use case. This document specifies both.

---

## 1. Component Library: Ark UI via `@llui/ark`

### Why Ark UI

The headless component library landscape divides into two camps: framework-locked libraries (Radix/React, Kobalte/Solid, Melt+Bits/Svelte, Headless UI/React+Vue, Base UI/React) and framework-agnostic libraries built on state machines. Ark UI is the only production-grade option in the second camp with meaningful adoption. It provides 45+ accessible components — Dialog, Select, Combobox, Menu, Tooltip, Tabs, Accordion, DatePicker, TreeView, and more — each powered by a Zag.js finite state machine underneath.

The FSM architecture is a natural fit for TEA. A Zag machine is a pure `(state, event) → state` transition function with a `connect` layer that maps machine state to DOM attributes, ARIA props, and event handlers. This is structurally identical to how LLui's `update()` maps `(State, Msg) → [State, Effect[]]`. The adapter layer is thin because both systems share the same fundamental model: immutable state, explicit transitions, derived DOM.

Ark UI already ships framework adapters for React, Solid, Vue, and Svelte. The LLui adapter (`@llui/ark`) becomes the fifth target.

### Architecture

The integration stack has two layers:

```
@llui/ark                    Component wrappers + framework adapter (useMachine, normalizeProps)
    ↓
@zag-js/dialog, /select...  Individual state machines (unchanged)
```

**`@llui/ark` — the framework adapter and component wrappers.** This package provides two low-level functions (`useMachine`, `normalizeProps`) for bridging Zag machines into LLui's reactivity model, plus pre-built LLui view functions for each component.

```typescript
function useMachine<C extends Record<string, unknown>>(
  machine: Machine<C>,
  options?: { context?: Partial<C> }
): { state: MachineState<C>; send: (event: MachineEvent) => void; api: ConnectAPI }
```

`useMachine` initializes the Zag machine, subscribes to state changes, and feeds them into LLui's reactivity model. The machine's internal state transitions are opaque to LLui — only the `connect` output matters. When the machine transitions (e.g., dialog opens), `useMachine` calls `connect(service, normalizeProps)` to produce a new set of DOM attributes and event handlers. The LLui adapter registers these as bindings with bitmask dirty tracking — the machine's output object is the "state" from LLui's perspective.

```typescript
function normalizeProps(props: Record<string, any>): Record<string, any>
```

`normalizeProps` translates Zag's framework-neutral prop names into LLui's element helper conventions. The mapping is straightforward: `onClick` → LLui's `onClick` parameter, `className` → `class`, `style` objects → style strings. Data attributes (`data-state`, `data-part`, `data-scope`, `data-disabled`) and ARIA attributes (`role`, `aria-expanded`, `aria-modal`, `aria-labelledby`) pass through unchanged — LLui's element helpers accept arbitrary attributes.

Each Ark component becomes a LLui view function that:

1. Calls `useMachine` with the component's Zag machine and user-provided config.
2. Calls `connect` to get the API object with part-specific prop getters (`getRootProps()`, `getTriggerProps()`, `getContentProps()`).
3. Renders LLui DOM elements, spreading the props from each getter onto the corresponding element.
4. Uses LLui's `portal()` for floating content (Dialog overlay, Select dropdown, Tooltip, Popover).
5. Returns `Node[]` like any LLui view function.

### Component Anatomy: Dialog Example

```typescript
import { dialog } from '@zag-js/dialog'
import { useMachine, normalizeProps } from '@llui/ark'
import { div, button, h2, p, text, portal, show } from '@llui/core'

type DialogConfig = {
  open?: boolean
  onOpenChange?: (details: { open: boolean }) => void
}

function dialogView<S>(
  props: { config: (s: S) => DialogConfig; trigger: () => Node[]; content: () => Node[] },
  send: (msg: any) => void
): Node[] {
  const { state, api } = useMachine(dialog.machine, {
    context: props.config,
  })

  return [
    // Trigger
    button({ ...api.getTriggerProps() }, props.trigger()),

    // Portal for overlay + content
    show({ when: () => api.isOpen, render: () =>
      portal({ target: document.body, render: () => [
        div({ ...api.getBackdropProps() }),
        div({ ...api.getPositionerProps() }, [
          div({ ...api.getContentProps() }, [
            h2({ ...api.getTitleProps() }, [text('Dialog Title')]),
            p({ ...api.getDescriptionProps() }, props.content()),
            button({ ...api.getCloseTriggerProps() }, [text('Close')]),
          ]),
        ]),
      ]}),
    }),
  ]
}
```

### Component Anatomy: Combobox Example

Combobox is the most complex Ark component — it exercises text input, filtering, keyboard navigation, floating positioning, and selection state simultaneously.

```typescript
import { combobox } from '@zag-js/combobox'
import { useMachine } from '@llui/ark'
import { div, input, button, label, text, ul, li, portal, each, show } from '@llui/core'

function comboboxView<S, T extends { value: string; label: string }>(
  props: {
    items: (s: S) => T[]
    value: (s: S) => string | null
    onValueChange: (value: string) => void
    placeholder?: string
  },
  send: (msg: any) => void
): Node[] {
  const { api } = useMachine(combobox.machine, {
    context: {
      collection: combobox.collection({ items: props.items }),
      onValueChange: (details) => props.onValueChange(details.value[0]),
    },
  })

  return [
    div({ ...api.getRootProps() }, [
      label({ ...api.getLabelProps() }, [text('Select item')]),
      div({ ...api.getControlProps() }, [
        input({ ...api.getInputProps(), placeholder: props.placeholder ?? '' }),
        button({ ...api.getTriggerProps() }, [text('▼')]),
        show({ when: () => api.hasSelectedItems, render: () =>
          button({ ...api.getClearTriggerProps() }, [text('✕')])
        }),
      ]),
      portal({ target: document.body, render: () =>
        div({ ...api.getPositionerProps() }, [
          ul({ ...api.getContentProps() }, [
            each({
              items: () => api.collection.items,
              key: (item) => item.value,
              render: (item) => li(
                { ...api.getItemProps({ item: item() }) },
                [text((s) => item(i => i.label))]
              ),
            }),
          ]),
        ]),
      }),
    ]),
  ]
}
```

### Integration with LLui Primitives

**Portal.** Ark's floating components (Dialog, Select, Tooltip, Popover, Menu, Combobox, FloatingPanel) render content outside the normal DOM hierarchy. LLui's `portal()` primitive handles this directly — it renders to `document.body` or any target element, with bindings participating in the same update cycle. No special adapter logic needed.

**Transitions.** Ark uses CSS-based animations driven by `data-state` attributes (`data-state="open"` / `data-state="closed"`). LLui's `show()` with `enter`/`leave` callbacks can coordinate with these, but the primary mechanism is pure CSS — Ark delays DOM removal while close animations complete via internal transition-end listeners. This means LLui's `show({ when: () => api.isOpen })` must respect Ark's unmount timing rather than immediately disposing the scope. The adapter wraps this: `show` disposes only after the machine signals the exit animation is complete (the machine transitions from `closing` → `closed`, not from `open` → `closed` directly).

**Focus management.** Zag machines handle focus trapping (Dialog), focus restoration (Dialog close → trigger), and arrow-key navigation (Menu, Select, Combobox) internally via DOM API calls. These are imperative side effects that Zag executes in its own effect layer. LLui does not need to manage focus — the machine does it. The adapter's only responsibility is ensuring the correct elements are in the DOM when the machine fires focus commands.

**Keyboard navigation.** Event handlers returned by `getInputProps()`, `getTriggerProps()`, `getContentProps()`, etc. include `onKeyDown` handlers that implement arrow-key cycling, Home/End, Enter/Space selection, and Escape dismissal. LLui's element helpers pass these through as standard event listeners.

### Styling Surface

Ark components emit no CSS. All styling is via data attributes set by the Zag machines:

```css
/* Target by scope + part */
[data-scope="dialog"][data-part="content"] { }

/* Target by state */
[data-state="open"] { animation: fadeIn 200ms ease-out; }
[data-state="closed"] { animation: fadeOut 150ms ease-in; }

/* Combine scope + state */
[data-scope="select"][data-part="content"][data-state="open"] { }

/* Pseudo-states */
[data-disabled] { opacity: 0.5; }
[data-focus] { outline: 2px solid blue; }
[data-checked] { background: var(--accent); }
[data-readonly] { cursor: not-allowed; }
```

This is fully compatible with LLui's approach — no framework-specific styling solution required. Developers use CSS files, Tailwind with arbitrary selectors (`data-[state=open]:opacity-100`), or any CSS methodology.

### `foreign()` vs `@llui/ark`

These solve different problems and compose cleanly:

- **`@llui/ark`** wraps state-machine-driven components that produce standard DOM. The Zag machine manages behavior; LLui manages rendering. The machine's output is declarative attributes, not imperative DOM manipulation.
- **`foreign()`** wraps imperative libraries that own their own DOM (ProseMirror, Monaco, MapboxGL). These libraries create and mutate DOM nodes directly; LLui cannot and should not manage their internals.

An Ark Select inside a `foreign()` ProseMirror toolbar is a valid composition: the toolbar is a LLui view function containing `@llui/ark` components, and the entire toolbar is a LLui subtree — not a foreign boundary. `foreign()` applies only to the ProseMirror editor itself.

### Package Structure

```
@llui/ark             ~3KB gzip    Framework adapter + component wrappers
@zag-js/dialog        ~3KB gzip    Individual machine (only what you import)
@zag-js/select        ~4KB gzip    Individual machine
@zag-js/combobox      ~5KB gzip    Individual machine
...                                Each machine is independently tree-shakeable
```

Total cost for a Dialog: `@llui/ark` (3KB) + `@zag-js/dialog` (3KB) ≈ **6KB gzip**. Each additional component adds only the machine's weight — the adapter is shared.

### Component Coverage (v1 Priority)

Ark UI ships 45+ components. For LLui v1, prioritize the components that appear in virtually every application:

**Tier 1 — ship with `@llui/ark` v1:**
Dialog, Menu, Select, Combobox, Tabs, Accordion, Tooltip, Popover, Toast, Checkbox, Radio Group, Switch, Slider, Toggle Group, Pagination

**Tier 2 — ship shortly after:**
Date Picker, Color Picker, Number Input, Pin Input, File Upload, TreeView, Splitter, Progress, Tags Input, Clipboard

**Tier 3 — community or on-demand:**
Angle Slider, Floating Panel, Signature Pad, Steps, Timer, Tour, QR Code, Frame, Presence

### Open Questions

**1. Controlled vs. uncontrolled state ownership.** Zag machines maintain their own internal state (e.g., `isOpen` for Dialog). In TEA, all state lives in the component's `State` type managed by `update()`. Two options: (a) let Zag own behavioral state and expose it to LLui via read-only accessors — simpler adapter, but state lives outside the TEA cycle; (b) drive Zag from LLui state by passing controlled props on every update — pure TEA, but requires the adapter to sync bidirectionally. Recommendation: option (a) for v1 with an opt-in controlled mode for components where the developer needs `isOpen` in their `update()` logic.

**2. Message bridging.** When an Ark component fires a callback (`onOpenChange`, `onValueChange`), the adapter must convert it to a LLui `Msg`. Two options: (a) the developer provides a message factory in the component config (`onOpenChange: (open) => ({ type: 'dialogToggled', open })`); (b) the adapter emits a generic `ArkEvent` message type. Recommendation: option (a) — explicit message factories are idiomatic TEA and the compiler can type-check them.

**3. SSR rendering of Ark components.** Zag machines are client-side JavaScript. During SSR (`__renderToString`), the compiler needs to emit the initial HTML for Ark components without running the machine. The adapter must provide a static render path that reads the initial machine context and emits the correct `data-state`, `data-part`, and ARIA attributes for the initial state (typically `closed`/`idle`). On hydration, `useMachine` starts the machine and attaches event handlers to the existing DOM.

---

## 2. Server Framework: Vike via `@llui/vike`

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
    llui(),   // Compiles LLui components, generates __dirty, __renderToString
    vike(),   // Handles routing, SSR orchestration, data loading
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
import { hydrateApp, mountApp } from '@llui/core'
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
import { component } from '@llui/core'

type Data = { user: User }
type State = { user: User; editing: boolean }
type Msg = { type: 'toggleEdit' } | { type: 'save' }

export default component<State, Msg, Effect>({
  name: 'UserDetail',
  init: (data: Data) => [{ user: data.user, editing: false }, []],
  update: (state, msg) => { /* ... */ },
  view: (state, send) => { /* ... */ },
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

| Mode | `+ssr` | `+prerender` | Behavior |
|------|--------|-------------|----------|
| **SSR** | `true` (default) | `false` | Server renders HTML per request, client hydrates |
| **SSG** | `true` | `true` | Build-time HTML generation, client hydrates |
| **SPA** | `false` | `false` | No server rendering, client mounts from scratch |
| **HTML-only** | `true` | `true`, no JS | Static HTML, no client JavaScript |

Per-page overrides are supported via `+config.ts` in the page directory.

### Open Questions

**1. Layout state persistence across navigations.** When Vike navigates between pages client-side, should the layout component's state persist or reset? Option (a): persist — the layout is a long-lived LLui app, and page changes dispatch a message to swap the active child. Option (b): reset — each navigation creates a fresh layout + page. Recommendation: option (a) for layouts that manage global state (auth, theme, notifications), with an opt-out for pages that need a clean slate.

**2. Error pages.** Vike supports `+error.ts` for error boundaries. The `@llui/vike` adapter should render error pages as LLui components, with the error and HTTP status code available in `init()`. This is straightforward — the error page is just another `ComponentDef`.

**3. Head management.** LLui does not manage `<head>` tags (title, meta, link). Vike provides `+Head.ts` for this. For v1, `+Head.ts` returns a plain HTML string — no LLui reactivity in the head. Reactive head updates (e.g., changing the title based on state) are a post-v1 feature.

**4. `onEffect` and server context.** Effects returned from `init()` need to execute during SSR — for example, an initial data fetch. But `onEffect` assumes a browser environment (DOM, `AbortSignal`, timers). Resolution: effects from `init()` are suppressed during SSR. Server-side data loading happens in Vike's `+data.ts` hook, which runs before the component is instantiated. This is the correct separation — the server provides resolved data, the component never needs to fetch during SSR.

---

## 3. Cross-Cutting Concerns

### Dev Server Integration

In development, three systems run simultaneously:

1. **Vite dev server** — HMR, module transformation, LLui compilation.
2. **Vike** — routing, SSR, page context.
3. **LLui DevTools / LLM debug protocol** — `window.__lluiDebug`, `@llui/mcp` via WebSocket.

These compose through Vite's middleware and WebSocket infrastructure. The `llui:debug` WebSocket channel (07 LLM Friendliness §10) is registered by LLui's Vite plugin and is unaffected by Vike's presence.

HMR with state preservation (02 Compiler.md) works within Vike pages: when a LLui component file changes, the Vite plugin hot-replaces `update()`, `view()`, and `onEffect`, preserves state, and re-runs `view()`. Vike's routing state is unaffected.

### Testing

`@llui/test` (04 Test Strategy.md) tests components in isolation — no Vike, no server. The `testComponent` harness calls `init()`, `update()`, and asserts on state and effects. Integration tests that exercise SSR use Vike's test utilities to render a full page and verify the HTML output matches expected hydration markers.

For `@llui/ark` components, the Zag machine's state transitions are testable independently (Zag provides its own test utilities). The LLui adapter's correctness reduces to: "does `normalizeProps` produce the right attributes, and does `useMachine` subscribe correctly?" Both are unit-testable without a browser.

### Bundle Size Impact

Detailed in 06 Bundle Size.md. Summary:

| Addition | Estimated gzip cost |
|----------|-------------------|
| `@llui/ark` adapter + wrappers | ~3KB (shared, not per-component) |
| Per Zag machine (Dialog) | ~3KB |
| Per Zag machine (Combobox) | ~5KB |
| `@llui/vike` adapter | ~1.5KB |
| Vike client runtime | ~5KB |

All packages are tree-shakeable. An app using Dialog and Select pays for those two machines plus the shared adapter — unused machines add zero bytes.

---

## 4. Resolved Questions

**Why not shadcn/ui?** shadcn is a distribution model (copy-paste React components) built on Radix (React-only hooks). Neither the distribution model nor the React dependency translates to LLui. Ark UI provides the same class of components with a framework-agnostic FSM core.

**Why not Astro?** Astro's island architecture assumes independent, isolated components with separate hydration boundaries. LLui's single-state-tree model does not decompose into independent islands without losing the primary benefit of TEA — a single `update()` that sees all state transitions. Vike lets LLui own the full page render. Astro integration is not ruled out for the island use case but is not the primary server-side story.

**Why not build our own components?** Accessible UI components are extraordinarily hard to get right. Focus management, keyboard navigation, screen reader announcements, ARIA attribute state machines, and cross-browser quirks represent years of iteration. Ark UI (via Zag.js) has this iteration built in. Building from scratch would delay LLui's usability by 12+ months for no architectural benefit.

**Why not Vinxi / TanStack Start?** Vinxi is the framework-agnostic server layer under SolidStart. It is architecturally promising but still pre-1.0 and tightly coupled to SolidStart's development cycle. TanStack Start targets React. Both are less mature than Vike for the "bring your own framework" use case.
