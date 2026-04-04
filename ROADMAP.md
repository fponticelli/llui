# Roadmap

## Phase 1 — Core Runtime (`@llui/dom`) ✅

- [x] Scope tree, binding system, message queue, two-phase update
- [x] `mountApp()`, `hydrateApp()`, `component()`, `flush()`
- [x] View primitives: `text`, `branch`, `show`, `each`, `portal`, `memo`, `onMount`, `errorBoundary`, `child`, `foreign`
- [x] Element helpers: `div`, `span`, `button`, etc. (45+ tags)
- [x] `elSplit()` / `elTemplate()` compiled constructors
- [x] `chainUpdate()` for composable update handlers
- [x] `peek()` for imperative item accessor reads in event handlers
- [x] `view(send)` and structural render callbacks take `send` only — state reads flow through accessor closures
- [x] `each()` render uses options bag `({ send, item, index })`

## Phase 2 — Compiler (`@llui/vite-plugin`) ✅

- [x] 3-pass transform: prop split → mask injection → import cleanup
- [x] Subtree collapse: nested elements → `elTemplate(html, patchFn)`
- [x] Placeholder text nodes, event delegation, selector dedup
- [x] Cross-file safety: FULL_MASK for bindings in non-component files
- [x] `__dirty` compares at top-level field (not nested paths)
- [x] Static subtree prerendering, constant folding, `@__PURE__` annotations
- [x] Diagnostics: accessibility, `each()` misuse, exhaustive `update()`
- [x] Source maps: per-statement edits via MagicString
- [x] HMR: `replaceComponent` in `accept()` callback, tree-shaken in production

## Phase 3 — Test & Effects ✅

- [x] `@llui/test`: testComponent, testView, propertyTest, replayTrace, assertEffects
- [x] `@llui/effects`: http, cancel, debounce, sequence, race, handleEffects().use()
- [x] `Async<T, E>` type + `ApiError` union (network, timeout, notfound, unauthorized, etc.)
- [x] `resolveEffects()` for server-side HTTP effect execution (SSR data loading)

## Phase 4 — SSR & Hydration ✅

- [x] `renderToString()` with `data-llui-hydrate` markers
- [x] `hydrateApp()` — atomic DOM swap (server HTML visible until JS loads)
- [x] `initSsrDom()` from `@llui/dom/ssr` (jsdom setup, server-only sub-path)
- [x] `resolveEffects()` — pre-load data server-side before rendering
- [x] Hydration code tree-shaken from SPA builds (zero bytes)
- [x] `@llui/vike` — onRenderHtml + onRenderClient hooks (untested)

## Phase 5 — Ecosystem ✅

- [x] DevTools: `installDevTools()` from `@llui/dom/devtools` (sub-path, tree-shaken)
- [x] `@llui/router`: createRouter, route, param, rest, connectRouter, routing.link/listener
- [x] `@llui/mcp` — MCP server exposing debug API as LLM tools
- [x] `@llui/lint-idiomatic` — AST linter for 6 anti-pattern rules
- [x] Evaluation suite — 15-task runner with reference implementations

## Optimizations ✅

**Runtime:**

- [x] `each()` fast paths: same-ref skip, append-only, swap detection, bulk clear, full-replace
- [x] Per-item direct updaters (bypass Phase 2 allBindings scan)
- [x] Fresh binding skip (Phase 1 bindings skip Phase 2 on same tick)
- [x] Scope disposal nulls binding references for prompt GC

**Compiler:**

- [x] Template cloning: subtree collapse, placeholder text, event delegation
- [x] Selector dedup, constant folding, static subtree prerendering

**Bundle:**

- [x] Sub-path exports: `@llui/dom/hmr`, `@llui/dom/ssr`, `@llui/dom/devtools`
- [x] All dev-only code tree-shaken from production builds
- [x] `sideEffects: false`, named re-exports

**jfb results (vs Solid/Svelte):**

- Create 1k: within 5-10%
- Update/Select/Swap: on par or faster
- Bundle: 4.0 KB gzip (smaller than Solid)

## GitHub Explorer (validation app) ✅

- [x] Search with debounce/cancel, pagination with URL params
- [x] Repo detail: file tree, README (foreign + shadow DOM), issues with label colors
- [x] File viewer with line numbers (foreign)
- [x] History-mode routing with `@llui/router`
- [x] SSR with server-side data loading via `resolveEffects()`
- [x] `Async<T, ApiError>` state modeling

---

## Remaining

### 5. ~~Package Polish~~ ✅

349 tests across 8 packages. Added: resolveEffects tests (8), MCP tool tests (9), Vike integration tests (5). All packages audited — exports match, gaps filled.

### 6. ~~Documentation~~ ✅

README rewritten. Getting-started guide with project setup + first component tutorial. Cookbook covering forms, async (Async/ApiError/debounce), composition (view functions, chainUpdate), routing, SSR (resolveEffects, hydration), foreign libraries, and testing.
