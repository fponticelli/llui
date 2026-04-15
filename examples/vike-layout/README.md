# @llui/example-vike-layout

End-to-end example of persistent layouts with `@llui/vike`'s `Layout` option + `pageSlot()`.

## What it demonstrates

- **Root layout** (`pages/Layout.ts`) — mounted once on first page load, stays alive across every client navigation. Renders the header, nav links, session state indicator, and the toast stack. Provides two context values to every page below its slot: `ToastContext` (show/dismiss dispatchers) and `SessionContext` (login/logout dispatchers).
- **Nested dashboard layout** (`pages/dashboard/Layout.ts`) — active on `/dashboard/*` routes. Renders a sidebar alongside the page's content inside the root layout's main area. Kept alive when navigating between dashboard pages; disposed when navigating out of `/dashboard`.
- **Per-route chain resolver** (`pages/+onRenderClient.ts`) — a `Layout: (pageContext) => chain` function that returns the nested chain `[AppLayout, DashboardLayout]` for `/dashboard/**` routes and the flat chain `[AppLayout]` for everything else. Same resolver runs server-side in `pages/+onRenderHtml.ts`.
- **Layout → page communication via context** — pages use `useContext(ToastContext)` to push toasts into the root layout's stack, and `useContext(SessionContext)` to change session state. Neither page imports from the layout directly.

## Routes

| Route                 | Chain                          |
| --------------------- | ------------------------------ |
| `/`                   | `[AppLayout]`                  |
| `/settings`           | `[AppLayout]`                  |
| `/dashboard/overview` | `[AppLayout, DashboardLayout]` |
| `/dashboard/reports`  | `[AppLayout, DashboardLayout]` |

## Navigation scenarios to try in the browser

- **`/` → `/settings`** — root layout DOM stays in place, page content swaps.
- **`/dashboard/overview` → `/dashboard/reports`** — both layouts stay alive, only the innermost page disposes + re-mounts. The dashboard sidebar's "last visited" state (if you wire it up) persists across the nav.
- **`/dashboard/overview` → `/settings`** — `DashboardLayout` + overview page both dispose; `AppLayout` stays. The toast stack and session state survive.
- **`/settings` → `/dashboard/overview`** — `DashboardLayout` mounts fresh inside the existing `AppLayout` slot; settings page disposes.

Open the browser devtools element inspector before clicking through — you can watch the DOM subtree of `<header class="app-header">` stay untouched while the contents of `<main class="app-main">` change underneath it.

## A note on file naming

The layout files are named `Layout.ts`, not `+Layout.ts`. Vike reserves the `+` prefix for its own config file conventions (`+Page.ts`, `+config.ts`, `+onRenderHtml.ts`, etc.), and `+Layout.ts` specifically is understood by Vike's framework adapters (`vike-react`, `vike-vue`, `vike-solid`) as a framework-native layout config. `@llui/vike` isn't a Vike "framework adapter" in that sense — it's a render adapter, and `createOnRenderClient({ Layout })` takes the layout component directly. Naming our file `Layout.ts` (no `+`) makes Vike leave it alone and keeps the layout a plain LLui component that `+onRenderClient.ts` imports by path.

## Running

```bash
pnpm install
pnpm --filter @llui/example-vike-layout dev
```

The default port is Vite's dev-server default.

```bash
pnpm --filter @llui/example-vike-layout build
pnpm --filter @llui/example-vike-layout preview
```

`build` prerenders all four routes into static HTML (because `+config.ts` has `prerender: true`). Hydration on first load reads the chain-aware `window.__LLUI_STATE__` envelope and reconstructs the layer chain.
