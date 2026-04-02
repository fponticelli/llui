# Roadmap

## Phase 1 — Core Runtime (`@llui/core`)

The foundation everything else builds on.

- [x] Scope tree — `createScope`, `disposeScope`, child registration, disposer management
- [x] Binding system — `createBinding`, `applyBinding`, flat binding array, kind dispatch
- [x] Message queue — `send()`, `processMessages()`, microtask batching, `flush()`
- [x] Two-phase update — Phase 1 structural reconciliation + Phase 2 binding iteration with bitmask gating
- [x] `mountApp()` — init → view → Phase 2, returns `AppHandle`
- [x] `text()` — reactive text node with mask
- [x] `elSplit()` — compiled element constructor (staticFn, events, bindings, children)
- [x] Element helpers — uncompiled runtime path (`div`, `span`, `button`, etc.)
- [x] `branch()` — discriminant-keyed conditional rendering with scope swap
- [x] `show()` — boolean conditional (two-case branch)
- [x] `each()` — keyed list reconciliation, scoped accessor, `eachItemStable` optimization
- [x] `portal()` — out-of-tree rendering with binding participation
- [x] `memo()` — two-level cache (bitmask + output stability)
- [x] `onMount()` — microtask callback with scope cancellation
- [x] `errorBoundary()` — three-zone error protection (view construction zone)
- [x] `child()` — Level 2 composition boundary, propsMsg, onMsg
- [x] `foreign()` — imperative library bridge with typed sync
- [x] `component()` — definition wrapper

**Validate:** Counter app (mountApp + text + elSplit + element helpers). Measure initial bundle size floor.

## Phase 2 — Compiler (`@llui/vite-plugin`)

- [x] Pass 2 pre-scan — `collectAllDeps`, access path extraction, `fieldBits` map
- [x] Pass 1 — static/dynamic prop split, `elSplit()` emission
- [x] Pass 2 — per-accessor mask computation, `__dirty` injection, `text()` mask injection
- [x] Pass 3 — import cleanup, element helper elision, `elSplit` addition
- [x] Diagnostics — `each()` scoped accessor misuse, `.map()` on state arrays, exhaustive `update()`, accessibility (img alt, onClick role), controlled input without handler
- [x] `__msgSchema` emission (dev mode) — extracts Msg type variants for runtime validation
- [x] HMR — self-accept in dev mode via `import.meta.hot.accept()`
- [x] Source map generation — via magic-string for transformed output

**Validate:** TodoMVC subset (compiled). Measure gzip bundle size vs Solid/Svelte/React. Run LLM evaluation tasks 01–03 (counter, char counter, filterable list).

## Phase 3 — Test & Effects

- [x] `testComponent()` — zero-DOM harness
- [x] `assertEffects()` — partial deep matching
- [x] `testView()` — mounts component with given state, returns query/queryAll
- [x] `propertyTest()` — generative invariant testing with random message sequences
- [x] `replayTrace()` — deterministic trace replay with state + effects comparison
- [x] `handleEffects()` — http, cancel, debounce consumption chain with AbortSignal cleanup
- [x] Effect builders — `http()`, `cancel()`, `debounce()`, `sequence()`, `race()`

**Validate:** Run LLM evaluation tasks 04, 09, 14 (async fetch, debounced search, async validation). Performance benchmarks: run, replace, update, select, swap, remove, clear (Playwright + 4× throttle).

## Optimizations (continuous)

Runtime and bundle size improvements, tracked against benchmarks.

**Runtime — `each()` reconciler fast paths:**
- [x] Same array reference → skip entirely
- [x] Append-only (no reordering, new items at end) → insert only new entries
- [x] Two-element swap detection → two targeted DOM moves (swap: 55ms → 12ms)
- [x] Bulk clear → remove all + dispose without key lookup
- [x] DocumentFragment batching — append, replace, and reorder use fragments for single-reflow insertion
- [x] Full-replace fast path — skip Map/Set when no keys survive (replace: 77ms → 63ms)
- [x] Survivors-in-order check — only insert new nodes when existing ones are already correctly positioned

**Runtime — binding evaluation:**
- [x] Flat binding array per component (dead-flag + lazy compaction, eliminates recursive scope walk)

**Bundle — compiler:**
- [x] Static subtree prerendering → `<template>` clone (elements with only static props + text children)
- [x] `/*@__PURE__*/` annotations on `elSplit` calls
- [x] Constant folding for zero-mask bindings (accessors that don't read state → staticFn)
- [x] Compiler: handle per-item accessor calls natively (TodoMVC: -346 B gzip)

**Bundle — tree-shaking:**
- [x] `sideEffects: false` on all packages, no module-level side effects
- [x] Barrel file uses named re-exports, not `export *`

## Phase 4 — SSR & Hydration

- [ ] `__renderToString()` — compiler-generated static HTML emission
- [ ] `hydrateApp()` — DOM walk, `data-llui-hydrate` marker attachment
- [ ] `@llui/vike` — `onRenderHtml`, `onRenderClient`, Vite plugin composition

**Validate:** SSR round-trip test (render → hydrate → interact). Measure TTFB and hydration cost.

## Phase 5 — Ecosystem

- [ ] `@llui/ark` — `useMachine`, `normalizeProps`, Zag machine bridge
- [ ] Ark component wrappers — Dialog, Select, Combobox, Menu, Tooltip, Tabs (Tier 1)
- [ ] `@llui/devtools` — `window.__lluiDevTools` hook, per-transition recording
- [ ] `@llui/mcp` — MCP server, `window.__lluiDebug` API, WebSocket debug channel

**Validate:** Ark component accessibility audit (axe-core). Full LLM evaluation suite (15 tasks). Bundle size per-component breakdown.
