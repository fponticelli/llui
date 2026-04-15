---
title: LLM Guide
description: 'System prompt and idiomatic patterns for LLMs generating LLui code.'
---

# LLui Component

You are writing a TypeScript component using the LLui framework.

## Pattern

LLui uses The Elm Architecture: `init` returns initial state and effects;
`update(state, msg)` returns `[newState, effects]`; `view({ send, text, ... })`
returns DOM nodes once at mount and binds state to the DOM through accessor
functions. State is immutable. Effects are plain data objects returned from
`update()`. Destructure view helpers from the single `View<S, M>` parameter.

## Canonical shape

This is what an LLui component looks like. Mirror this shape — destructure
reactive primitives (`text`, `each`, `show`, `branch`, `memo`, `selector`,
`ctx`) from the view bag, import element helpers (`div`, `button`, `span`…)
directly:

```typescript
import { component, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

export const Counter = component<State, Msg, never>({
  name: 'Counter',
  init: () => [{ count: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'dec':
        return [{ ...state, count: Math.max(0, state.count - 1) }, []]
      case 'reset':
        return [{ count: 0 }, []]
    }
  },
  // Destructure ALL the reactive primitives you need from the view bag.
  // Inside the bag, `s` infers as State without annotation.
  view: ({ send, text, show }) => [
    div({ class: 'counter' }, [
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      text((s) => String(s.count)),
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    ]),
    ...show({
      when: (s) => s.count > 0,
      render: () => [button({ onClick: () => send({ type: 'reset' }) }, [text('reset')])],
    }),
  ],
})
```

## Reactive primitives: bag vs. import

`text`, `each`, `show`, `branch`, `memo`, `selector`, and `ctx` exist in two
forms that are **the same functions at runtime**:

1. **Destructured from the view bag** (`view: ({ text, each }) => …`) —
   pre-bound to the component's `S` and `M`, so `(s) => s.field` infers
   without annotation.
2. **Imported from `@llui/dom`** — the stateless entry point. You must
   annotate `(s: State) => …` explicitly when reading state.

The bag is a typing shim over the imports — there is no second
implementation. The split exists only because TypeScript can't infer
`S` from call-site context without a parameter carrying the type.

**Mechanical rule:**

- _Inside_ a `component({ view: (h) => … })` body → **destructure from
  the bag**. No annotations needed.
- _Outside_ — Level-1 view functions, shared UI helpers, test fixtures,
  scratch scripts → **import directly** and annotate `(s: State) => …`
  where you read state.

The `@llui/lint-idiomatic` plugin's `view-bag-import` rule enforces this
automatically. It only fires inside files that contain a `component()`
call, leaving helper modules alone.

## Key Types

```typescript
interface ComponentDef<S, M, E = never, D = void> {
  name: string
  // `data` is typed by D. Top-level components use D = void (default);
  // lazy()-loaded children receive D-typed init data from the parent.
  init: (data: D) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (h: View<S, M>) => Node[]
  onEffect?: (ctx: { effect: E; send: (msg: M) => void; signal: AbortSignal }) => void
}

// component() wrapper preserves all four type params.
function component<S, M, E = never, D = void>(
  def: ComponentDef<S, M, E, D>,
): ComponentDef<S, M, E, D>

// View<S, M> is a bundle of state-bound helpers + send. Destructure in
// `view` to drop per-call generics — every accessor infers `s: S` from
// the component.
interface View<S, M> {
  send: (msg: M) => void
  show(opts: { when: (s: S) => boolean; render: (h: View<S, M>) => Node[] }): Node[]
  branch(opts: {
    on: (s: S) => string | number
    cases: Record<string, (h: View<S, M>) => Node[]>
  }): Node[]
  each<T>(opts: {
    items: (s: S) => T[]
    key: (item: T) => string | number
    render: (bag: { item; index: () => number; send }) => Node[]
  }): Node[]
  text(accessor: ((s: S) => string) | string): Text
  memo<T>(accessor: (s: S) => T): (s: S) => T
  ctx<T>(c: Context<T>): (s: S) => T
}
// slice(h, selector) — standalone function for sub-slice view composition
function slice<Root, Sub, M>(h: View<Root, M>, sel: (s: Root) => Sub): View<Sub, M>

function onMount(callback: (el: Element) => (() => void) | void): void
// item accessor: item.field (shorthand) or item(t => t.expr) (computed) — both return () => V
```

## Effects

Effects use **typed message constructors** — callbacks, not strings:

```typescript
import { http, cancel, debounce, handleEffects } from '@llui/effects'
import type { ApiError } from '@llui/effects'

// HTTP with typed callbacks + flexible body:
http({
  url: '/api/users',
  method: 'POST',
  body: { name: 'Franco' },             // auto JSON.stringify + Content-Type
  // body: formData,                     // FormData/Blob/URLSearchParams pass through
  timeout: 5000,                         // optional request timeout (ms)
  onSuccess: (data, headers) => ({ type: 'usersLoaded' as const, payload: data }),
  onError: (err: ApiError) => ({ type: 'fetchFailed' as const, error: err }),
})

// Compose: cancel previous + debounce + http
cancel('search', debounce('search', 300, http({
  url: `/api/search?q=${q}`,
  onSuccess: (data) => ({ type: 'results' as const, payload: data }),
  onError: (err) => ({ type: 'searchError' as const, error: err }),
})))

// WebSocket:
import { websocket, wsSend } from '@llui/effects'
websocket({
  url: 'wss://api.example.com/ws',
  key: 'feed',
  onMessage: (data) => ({ type: 'wsMessage' as const, payload: data }),
  onClose: (code, reason) => ({ type: 'wsDisconnected' as const }),
})
wsSend('feed', { action: 'subscribe', channel: 'updates' })

// Retry with exponential backoff:
import { retry } from '@llui/effects'
retry(http({ url: '/api/data', onSuccess: ..., onError: ... }), {
  maxAttempts: 3,
  delayMs: 1000,  // 1s, 2s, 4s
})

// Handle effects:
onEffect: handleEffects<Effect, Msg>()
  .else(({ effect, send, signal }) => { /* custom effects */ })
```

## Persistent layouts (`@llui/vike`)

When building a Vike app with `@llui/vike`, declare app chrome (header,
sidebar, session state, portalled dialogs) as a `Layout` component that
stays mounted across client navigation. Pages render at the layout's
`pageSlot()` position and only the page — not the layout — is disposed
and re-mounted when the user navigates.

**Filename rule:** name the layout file `Layout.ts` (or `app-layout.ts`,
or anywhere outside `/pages`). NEVER name it `+Layout.ts` — Vike reserves
the `+` prefix for its own framework-adapter conventions and treats
`+Layout.ts` as a `vike-react` / `vike-vue` / `vike-solid` config that
collides with `@llui/vike`'s `Layout` option.

```typescript
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
      main([pageSlot()]), // ← exactly one pageSlot() per layout
    ]),
  ],
})
```

```typescript
// pages/+onRenderClient.ts
import { createOnRenderClient } from '@llui/vike/client'
import { AppLayout } from './Layout'

export const onRenderClient = createOnRenderClient({
  Layout: AppLayout,
})
```

```typescript
// pages/+onRenderHtml.ts — same Layout on the server
import { createOnRenderHtml } from '@llui/vike/server'
import { AppLayout } from './Layout'

export const onRenderHtml = createOnRenderHtml({
  Layout: AppLayout,
})
```

For nested layouts pass an array outermost-to-innermost (every layer
except the innermost calls its own `pageSlot()`), or a resolver
function for per-route chains:

```typescript
createOnRenderClient({
  Layout: (pageContext) =>
    pageContext.urlPathname.startsWith('/dashboard') ? [AppLayout, DashboardLayout] : [AppLayout],
})
```

**Layout → page communication.** Pages read layout-provided operations
via `useContextValue` (for stable dispatcher bags) or `useContext` (for
state-dependent values). `pageSlot()` parents the page's scope inside
the layout's scope tree, so context lookups walk up through the slot
and find providers the layout installed above it. Use this for toast
dispatchers, global progress bars, breadcrumbs, session refresh, any
pattern where a page triggers a layout operation without importing
from the layout's internals.

```typescript
// Inside the layout's view, above the pageSlot()
...provideValue(
  ToastContext,
  { show: (msg: string) => send({ type: 'toast/show', msg }) },
  () => [main([pageSlot()])],
),

// Inside any page's view
const toast = useContextValue(ToastContext)
button({ onClick: () => toast.show('Saved') }, [text('Save')])
```

## Rules

- Never mutate state in `update()`. Always return a new object: `{ ...state, field: newValue }`.
- Reactive values in `view()` are arrow functions: `text(s => s.label)`, `div({ class: s => s.active ? 'on' : '' })`.
- Static values are literals: `div({ class: 'container' })`.
- Destructure view helpers from the `view` argument: `view: ({ send, show, each, branch, text, memo }) => [...]`. This pins `s: S` across all state-bound calls -- no per-call generics. Import element helpers (`div`, `button`, `span`...) normally.
- **Inside a component view body, destructure reactive primitives from the bag** (`text`, `each`, `show`, `branch`, `memo`, `selector`, `ctx`). Do NOT import them — the bag form gives `(s) => s.field` type inference, the imported form does not. The lint rule `view-bag-import` enforces this. (Outside a component body — Level-1 helpers, test fixtures — imports are correct and the lint rule won't fire.)
- When extracting view helpers (functions called from `view`), pass the needed primitives as arguments: `function myHelper(text: View<S,M>['text'], send: Send<M>): Node[]`.
- Never use `.map()` on state arrays in `view()`. Always use `each()` for reactive lists.
- Never spread arrays into element children: `div([...arr.map(...)])` prevents template-clone optimization. Use `each()` instead, even for static arrays.
- In `each()`, `render` receives `item` (a scoped accessor proxy) and `index` (a getter).
  Read item properties via property access: `item.text` (returns a reactive accessor).
  Use `item(t => t.expr)` for computed expressions.
  Invoke the accessor to read imperatively: `item.id()` (e.g. inside event handlers).
- Wrap derived values used in multiple places in `memo()`.
- Use `show` for boolean conditions. Use `branch` for named states (3+ cases or non-boolean).
- Use `lazy({ loader, fallback, error?, data? })` for code-split components: `loader: () => import('./Heavy').then(m => m.default)`. Renders `fallback` until loaded; the `error` handler fires on rejection. Cancels cleanly if the parent scope is disposed mid-load.
- Use `virtualEach({ items, key, itemHeight, containerHeight, render })` from `@llui/dom` for large lists (1k+ rows) with fixed row height. Renders only visible rows; scrolling reconciles in place without touching component state.
- For composition, use view functions (Level 1) with `(props, send)` convention.
  Only use `child()` for library components with encapsulated internals or 30+ state paths.
- For Vike apps with persistent app chrome (header, sidebar, session state, portalled dialogs), declare a `Layout` component and use `pageSlot()` from `@llui/vike/client` at the position where the route's page should render. Wire it via `createOnRenderClient({ Layout })` + `createOnRenderHtml({ Layout })`. Pages read layout-provided operations (toast dispatchers, progress bars, breadcrumbs) via `useContextValue` (for static dispatcher bags) or `useContext` (for state-dependent values) — `pageSlot()` parents the page's scope inside the layout's scope tree so context lookups walk through the slot. Pass an array `[AppLayout, DashboardLayout]` for nested layouts, or a `(pageContext) => chain` resolver for per-route chains. NEVER name the file `+Layout.ts` (collides with Vike's framework-adapter convention) — use `Layout.ts` or anywhere outside `/pages`.
- For context, prefer `provideValue(ctx, value, children)` + `useContextValue(ctx)` when the value is a stable dispatcher bag, action record, or DI container that doesn't depend on state. Use the reactive `provide(ctx, accessor, children)` + `useContext(ctx)` when the value DOES need to track state (e.g. `provide(ThemeContext, (s) => s.theme, () => [...])`). The static forms read as `useContextValue(ctx).method(...)` instead of `useContext(ctx)(undefined as never).method(...)`.
- For forms with many fields, use a single `setField` message:
  `{ type: 'setField'; field: keyof Fields; value: string }` instead of one message per field.
  Use `applyField(state, msg.field, msg.value)` from `@llui/dom` to apply updates.
- Effects use typed message constructors: `onSuccess: (data) => ({ type: 'loaded', payload: data })`.
  Never use string-based effect callbacks.
- For `http`, `cancel`, `debounce`, `websocket`, `retry`: import from `@llui/effects`.
  Wire into onEffect with `handleEffects<Effect, Msg>().else(handler)`.
- `send()` batches via microtask. Use `flush()` only when reading DOM state immediately.
- `@llui/components` ships 58 headless state machines. Each exports `init`, `update`, `connect` and a `Parts` type. Wire them into your app reducer via `sliceHandler` or a single `msg.type === 'compName'` case. Pointer + keyboard accessibility is built in.
- For forms, use the `form` state machine (`FormState` tracks submit status + touched fields) with `validateSchema(schema, values)` against any Standard Schema library (Zod, Valibot, ArkType). Values live in parent state; `form` is a coordinator.
- For drag-to-reorder, use the `sortable` state machine. Call `reorder(arr, from, to)` in the `drop` case. Multiple sortable containers share state and track `fromContainer`/`toContainer` for cross-container drag.
- For theme toggling, use the `themeSwitch` state machine plus `applyTheme(resolveTheme(state.theme))` to set `data-theme` on `<html>`. CSS selectors use `[data-theme='dark']`.
- For scroll-triggered behavior, use the `inView` state machine with `inView.createObserver(el, send, { once: true })` inside `onMount`.
- For component label translations, components read from `LocaleContext` (exported from `@llui/components`, defaulting to English) — English apps need zero setup. Non-English apps call `provide(LocaleContext, (s) => s.locale, () => [...])` at the root.
- For number/date/list/plural formatting, use `formatNumber`, `formatDate`, `formatRelativeTime`, `formatList`, `formatPlural`, `formatFileSize` from `@llui/components` — all wrap `Intl.*` with caching and accept an optional `locale` option.
- **MCP debug tools:** In dev mode, `window.__lluiDebug` exposes `getState()`, `send(msg)`, `getBindings()`, `whyDidUpdate(i)`, `decodeMask(n)`, `getMessageSchema()`, `snapshotState()`/`restoreState()`, and `exportTrace()`. The `@llui/mcp` package wraps these as MCP tools — run `npx @llui/mcp` alongside the dev server and connect via any MCP client (Claude Desktop, Claude Code) for interactive debugging. The relay connects on page load if the MCP server is running; otherwise call `__lluiConnect()` from the console.
- **`llui_lint` MCP tool:** When writing or editing LLui code, call `llui_lint({ source })` or `llui_lint({ path })` to check it against the 17 idiomatic rules WITHOUT running a build. Returns violations with rule names, line/column, and suggestions, plus a 0–17 score. Use this after every non-trivial code generation to self-correct — it catches state mutation, missing memo(), each() closure violations, view-bag-import, async update(), and more. Pass `exclude: ['rule-name']` to skip specific rules. The same checks run as a Vite plugin in dev — this tool gives the LLM the same feedback loop interactively.
