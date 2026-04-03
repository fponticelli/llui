# Roadmap

## Phase 1 — Core Runtime (`@llui/dom`) ✅

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

## Phase 2 — Compiler (`@llui/vite-plugin`) ✅

- [x] Pass 2 pre-scan — `collectAllDeps`, access path extraction, `fieldBits` map
- [x] Pass 1 — static/dynamic prop split, `elSplit()` emission
- [x] Pass 2 — per-accessor mask computation, `__dirty` injection, `text()` mask injection
- [x] Pass 3 — import cleanup, element helper elision, `elSplit` addition
- [x] Diagnostics — `each()` scoped accessor misuse, `.map()` on state arrays, exhaustive `update()`, accessibility (img alt, onClick role), controlled input without handler
- [x] `__msgSchema` emission (dev mode) — extracts Msg type variants for runtime validation
- [x] HMR — self-accept in dev mode via `import.meta.hot.accept()`

## Phase 3 — Test & Effects ✅

- [x] `testComponent()` — zero-DOM harness
- [x] `assertEffects()` — partial deep matching
- [x] `testView()` — mounts component with given state, returns query/queryAll
- [x] `propertyTest()` — generative invariant testing with random message sequences
- [x] `replayTrace()` — deterministic trace replay with state + effects comparison
- [x] `handleEffects()` — http, cancel, debounce consumption chain with AbortSignal cleanup
- [x] Effect builders — `http()`, `cancel()`, `debounce()`, `sequence()`, `race()`

## Phase 4 — SSR & Hydration ✅ (partial)

- [x] `renderToString()` — runtime SSR with `data-llui-hydrate` markers
- [x] `hydrateApp()` — client takeover with server state (clears + re-mounts)
- [x] `@llui/vike` — `onRenderHtml` + `onRenderClient` hooks

## Phase 5 — Ecosystem ✅ (partial)

- [x] `window.__lluiDebug` DevTools API — getState, send, evalUpdate, message history, exportTrace
- [x] `@llui/mcp` — MCP server exposing debug API as LLM tools
- [x] `@llui/lint-idiomatic` — AST linter for 6 anti-pattern rules + scoring
- [x] Evaluation suite — 15-task runner with reference implementations

## Optimizations ✅

**Runtime — `each()` reconciler fast paths:**
- [x] Same array reference → skip entirely
- [x] Append-only (no reordering, new items at end) → insert only new entries
- [x] Two-element swap detection → two targeted DOM moves
- [x] Bulk clear → Range.deleteContents + dispose without key lookup
- [x] DocumentFragment batching — append, replace, and reorder use fragments
- [x] Full-replace fast path — skip Map/Set when no keys survive
- [x] Survivors-in-order check — only insert new nodes when existing are correctly positioned

**Runtime — binding evaluation:**
- [x] Flat binding array per component (dead-flag + lazy compaction)
- [x] Per-item direct updaters — bypass allBindings, called by each() on item change
- [x] Fresh binding skip — bindings created during Phase 1 skip Phase 2 on same tick
- [x] Scope disposal nulls binding references (accessor, node, lastValue) for prompt GC

**Compiler — template cloning:**
- [x] Subtree collapse — nested element helpers → single `elTemplate(html, patchFn)` call
- [x] Placeholder text nodes — template HTML includes spaces for reactive text positions
- [x] Event delegation — multiple same-type handlers → single delegated listener on root
- [x] Item selector deduplication — repeated `item(sel)` calls hoisted + cached

**Compiler — bundle:**
- [x] Static subtree prerendering → `<template>` clone
- [x] `/*@__PURE__*/` annotations on `elSplit` calls
- [x] Constant folding for zero-mask bindings
- [x] Per-item accessor calls compiled natively
- [x] DevTools tree-shaken from production bundles (auto-enabled in dev, lazy in prod)

**Bundle — tree-shaking:**
- [x] `sideEffects: false` on all packages
- [x] Barrel file uses named re-exports

**js-framework-benchmark results (vs Solid/Svelte):**
- Create 1k: within 5-10%
- Update 10th: on par or faster
- Select: faster
- Swap: faster
- Bundle: 4.0 KB gzip (17% smaller than Solid)

---

## Next Steps

### 0. ~~Rename `@llui/core` → `@llui/dom`~~ ✅

Completed. The DOM-specific package is now `@llui/dom`, reserving `@llui/core` for shared abstractions if native platform targets are added.

### 1. Real App Validation

Build a [Realworld (Conduit)](https://github.com/gothinkster/realworld) app — the standardized "medium.com clone" that exercises auth, routing, CRUD, forms, pagination, and API integration. This validates the full surface area: effects, composition (Level 1 + Level 2), `each()`, `branch()`, `portal()`, and async patterns against a real API backend.

- [ ] Implement Conduit spec: articles, comments, auth, profiles, feed, pagination
- [ ] Verify all element helpers work correctly in compiled mode
- [ ] Stress-test `branch()`, `show()`, `portal()` in realistic combinations
- [ ] Validate Level 1 and Level 2 composition patterns in a real component hierarchy
- [ ] Exercise `@llui/effects` (http, cancel, debounce) against the Conduit API

### 2. SSR/Hydration Hardening

`hydrateApp()` currently clears server HTML and re-mounts. True walk-and-attach hydration would reuse server-rendered DOM nodes without re-creating them.

- [ ] Implement DOM-reuse hydration — walk existing server HTML, attach bindings without re-rendering
- [ ] Compiler: emit `__renderToString` as component property for static SSR (no jsdom)
- [ ] Verify Vike integration end-to-end (server render → client hydrate → interact)
- [ ] Measure TTFB and hydration cost vs full client render

### 3. HMR State Preservation

The compiler emits `import.meta.hot.accept()` but the mount system doesn't re-run `view()` with preserved state on module replacement.

- [ ] Implement HMR handler: replace `update()`, `view()`, `onEffect()` functions on hot update
- [ ] Re-run `view(currentState, send)` to rebuild DOM with new view logic
- [ ] Dispose old scope tree, register new bindings, run Phase 2
- [ ] Preserve in-flight effects via AbortSignal transfer
- [ ] Test with Vite dev server on a multi-component app

### 4. Source Maps

The compiler uses `ts.createPrinter` which doesn't produce source maps. Stack traces in transformed code point to generated line numbers.

- [ ] Integrate `magic-string` for targeted string patches with offset tracking
- [ ] Emit `.map` files alongside transformed output
- [ ] Verify error stack traces point to original source in Vite dev + production

### 5. Package Polish

Verify `@llui/effects` and `@llui/test` match the API Reference design doc. Fill in gaps.

- [ ] Audit `@llui/effects` exports against `09 API Reference.md` — verify http, cancel, debounce, sequence, race
- [ ] Audit `@llui/test` exports — verify testComponent, testView, propertyTest, replayTrace, assertEffects
- [ ] Add missing tests for any gaps found
- [ ] Verify `@llui/mcp` and `@llui/lint-idiomatic` (from PR #1) work end-to-end

### 6. Documentation & Developer Experience

Design docs are comprehensive but developer-facing docs don't exist.

- [ ] Getting-started guide — project setup with Vite, first component, basic patterns
- [ ] API cookbook — common patterns (forms, async, lists, composition) with examples
- [ ] Migration guide — how LLui differs from React/Solid/Svelte for developers coming from those
- [ ] Project template — `create-llui-app` or Vite template with recommended structure
- [ ] Document `peek()`, `FieldMsg<T>`, and other utilities added in recent PRs
