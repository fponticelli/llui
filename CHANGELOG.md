---
title: Changelog
description: Release history for LLui packages
---

# Changelog

All notable changes to LLui packages are documented here. LLui is a pre-1.0 project — every release may include breaking changes, though we try to call them out explicitly.

**How to read this file:** entries are anchored by **release date**. Inside each release, fixes are grouped by **`@llui/<package>@<version>`** sub-sections so you always know exactly which package and version a bullet applies to. Cross-cutting changes that affect every package (like build-output fixes) live under a shared "All packages" section. Breaking changes and migration notes sit at the top of each release block because they usually cut across multiple packages.

Packages version in lockstep at release time: `@llui/dom`, `@llui/vite-plugin`, `@llui/test`, `@llui/router`, `@llui/transitions`, `@llui/components`, `@llui/vike` share a version line. `@llui/effects`, `@llui/mcp`, and `@llui/lint-idiomatic` have their own cadence.

## 2026-04-14 — 0.0.14

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.14`; `@llui/{effects,mcp}@0.0.8`; `@llui/lint-idiomatic@0.0.11`

Ten production-sourced bug fixes spanning SSR, the compiler, structural reconciliation, runtime timing, and published build output.

### Breaking

- **`@llui/vite-plugin@0.0.14`** — `mcpPort` is now opt-in. Default is `null`. The `/__llui_mcp_status` middleware and WebSocket companion process are only installed when `mcpPort` is passed explicitly. If you were relying on MCP in dev, add `{ mcpPort: 5200 }` (or any port) to your `llui()` call in `vite.config.ts`. Fixes 404 noise in dev logs for apps that don't use MCP.

### Migration

- If you worked around the `show()` source-order bug by reordering sibling branches, you can revert that change — the original source order now works correctly.
- If you worked around the hoisted `class:` accessor bug by inlining the arrow or using a module-level variable, you can revert to the hoisted-`const`-arrow form.
- If you were using MCP in dev, add `{ mcpPort: <port> }` to `llui()` in `vite.config.ts` — the default is now opt-out rather than opt-in.

### `@llui/dom@0.0.14`

- **Fixed** `show()` / `branch()` block source-order reconciliation. Nested structural blocks were landing _before_ their parent in the flat `inst.structuralBlocks` array because every structural primitive did `blocks.push(block)` _after_ running its builder. When a parent reconciled and disposed nested children, the array collapsed mid-iteration and subsequent sibling blocks could be skipped entirely — a sibling `show()` placed after a form would silently fail to mount. All structural primitives (`branch`, `each`, `virtualEach`) now push their block _before_ running the builder, so parents always precede nested children. Parents now also reconcile before children, avoiding wasted work on subtrees the parent is about to unmount.
- **Fixed** `hydrateApp` dropped `init`-time effects. It was short-circuiting `init()` to reuse `serverState`, silently discarding any effects `init()` returned — so HTTP fetches, subscriptions, and timers never fired on the client after hydration. `hydrateApp` now runs the original `init()` purely to extract its effect list, discards the returned state, and dispatches those effects after mount.
- **Fixed** `elSplit` crashed on raw string children. The children parameter was typed `Node[]` but callers pass mixed `(Node | string)[]` arrays from template helpers. In jsdom (SSR), passing a raw string to `appendChild` throws. `elSplit` now accepts `Array<Node | string>` and wraps strings in `document.createTextNode(...)`.
- **Fixed** `onMount` microtask race. Callbacks were deferred via `queueMicrotask`, which meant a synchronous `dispatchEvent` fired immediately after mount (or a `branch()` case swap) could reach the DOM before the listener registered inside `onMount` had attached. `mountApp`, `hydrateApp`, and `branch()`'s reconcile path now push an `onMount` queue and flush it **synchronously** after new nodes are inserted. The `queueMicrotask` fallback still exists for callbacks registered outside any active mount cycle.
- **Improved** `getRenderContext` error message now enumerates the three common causes when a primitive is called outside a `view()` render context: (1) module-scope primitive calls, (2) module-scope overlay helpers like `dialog.overlay` / `popover.overlay` (which internally use `show()` / `branch()`), (3) primitives called from `setTimeout` / `Promise.then` / async event handlers.
- **Improved** `applyBinding` defensive guard. Throws a `TypeError` the moment any function value reaches the DOM-write layer, naming the binding kind, key, and a source snippet of the offending function. Catches future compiler paths that might leak a function value past the binding emitter.

### `@llui/vite-plugin@0.0.14`

- **Breaking** `mcpPort` is now opt-in. See top of release block.
- **Fixed** hoisted `class:` accessor miscompile. A reactive attribute whose value was an `Identifier` resolving to a `const`-bound arrow (e.g. `const cls = (s) => ...; a({ class: cls })`) compiled to `__e.className = cls` in the static setup, coercing the function to its source string at runtime and producing `<a class="(s) => ...">` in the DOM with no binding wired. The compiler now resolves local `const`-bound arrow identifiers to their initializer and emits a reactive binding identical to the inline-arrow form. Applies to both the `elSplit` split pass and the `elTemplate` subtree-collapse pass. Affects `class`, `style`, attribute, and reactive DOM-property accessors. Event handlers were never affected.
- **Fixed** per-item heuristic scope leak. `isPerItemFieldAccess` was detecting any `item.field` expression as a per-item binding candidate, regardless of whether `item` actually referred to an `each()` render-callback parameter. A plain `arr.map((item) => ...)` outside `each()` would produce a broken binding tuple and crash at runtime. The heuristic now walks up the AST and verifies `item` is bound as a parameter of an `each({ render })` callback, handling destructured and renamed bindings.

### All packages — build output

- **Fixed** ESM imports missing `.js` extensions. `moduleResolution: bundler` was stripping `.js` extensions from emitted `import`/`export` statements, breaking strict Node ESM consumers. A new `scripts/add-js-extensions.mjs` pass rewrites all relative imports during publish — 578 edits across 208 source files in all 10 packages. Published tarballs now resolve cleanly under Node's strict ESM loader.
- **Fixed** sourcemaps referenced missing `.ts` files. Published `.map` files referenced `../src/*.ts` paths not shipped in the tarball, breaking source-map debugging for downstream consumers. All 10 `tsconfig.build.json` files now set `inlineSources: true`, embedding the full TypeScript source inline via `sourcesContent`. Sourcemaps are self-contained.

## 2026-04-13 — @llui/lint-idiomatic@0.0.10, @llui/mcp@0.0.7

**Released:** `@llui/lint-idiomatic@0.0.10`; `@llui/mcp@0.0.7`

### `@llui/mcp@0.0.7`

- **Added** `llui_lint` tool; llm-guide reframed for the dual API.

### `@llui/lint-idiomatic@0.0.10`

- **Improved** Tightened rule set, fixed example snippets, adopted across all in-repo projects.

## 2026-04-13 — @llui/lint-idiomatic@0.0.9

**Released:** `@llui/lint-idiomatic@0.0.9`

### `@llui/lint-idiomatic@0.0.9`

- **Added** Ship as a Vite plugin via a `/vite` subpath export.
- **Improved** Publish flow uses `pnpm publish` and restores `workspace:*` in runtime deps.

## 2026-04-12 — 0.0.13

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.13`; `@llui/mcp@0.0.6`

### `@llui/mcp@0.0.6`

- **Added** Auto-connect MCP relay via Vite middleware + file marker; promoted auto-connect e2e to vitest CI.

### `@llui/dom@0.0.13`

- **Added** Bitmask diagnostic surfaced through MCP; `childHandlers` migration landed end-to-end.

## 2026-04-11 — 0.0.12

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.12`

### `@llui/dom@0.0.12`

- **Added** On-demand MCP relay with devtools documentation.
- **Added** `ChildState` / `ChildMsg` type utilities and `childHandlers` runtime.

### Docs

- **Improved** New cookbook recipes for `slice`, `selector`, `lazy`, `virtualEach`, and `sortable`.

## 2026-04-11 — 0.0.11

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.11`

### `@llui/dom@0.0.11`

- **Added** `sliceHandler` shorthand for child update wiring.
- **Improved** Clearer error messages across the runtime.

## 2026-04-11 — 0.0.10

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.10`

### `@llui/dom@0.0.10`

- **Added** `LazyDef<D>` type eliminates user-side casts when using `lazy()`.

### Docs

- **Fixed** Stale `ComponentDef` signature, component count, and version refs.

## 2026-04-11 — 0.0.9

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.9`

### `@llui/dom@0.0.9`

- **Fixed** Expose the `D` type parameter on the `component()` wrapper.

## 2026-04-11 — 0.0.8

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.8`

### `@llui/dom@0.0.8`

- **Added** `virtualEach()` primitive for large-list windowing.
- **Fixed** Phase 1 iteration crash plus demo/theme bugs.

### `@llui/vite-plugin@0.0.8`

- **Fixed** `__handlers` now unions modified fields across all return paths.

### `@llui/components@0.0.8`

- **Added** `sortable` with visual drag feedback, cross-container drag-and-drop, and keyboard a11y (space to grab, arrows to move, escape to cancel).
- **Fixed** `sortable` snapshots item positions at drag start (no flicker) and resolves stale index after sequential drags.

### `@llui/lint-idiomatic@0.0.8`

- **Fixed** `spread-in-children` exempts structural primitives; `each-closure-violation` handles destructured params and render boundaries.

### Docs & examples

- **Added** Root exports for `validateSchema` / `reorder` / theme helpers; new `form-validation` and `i18n-lazy` example apps.
- **Improved** API reference and examples for `virtualEach`, `sortable`, `themeSwitch`, and `form`.

## 2026-04-10 — 0.0.7

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.7`

### `@llui/dom@0.0.7`

- **Added** `lazy()` primitive for code-split component boundaries.

### `@llui/vite-plugin@0.0.7`

- **Fixed** SVG class binding.

### `@llui/components@0.0.7`

- **Added** `form` (Standard Schema), `sortable`, `themeSwitch`; dashboard example app.
- **Fixed** Accessibility audit: 13 violations → 0.

### `@llui/test@0.0.7`

- **Fixed** Typechecking enabled, fixing 109 latent type errors.

### `@llui/lint-idiomatic@0.0.7`

- **Added** Two new rules.

### Docs

- **Improved** Docs site — dark mode.

## 2026-04-09 — 0.0.6

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.6`

### `@llui/dom@0.0.6`

- **Added** SVG and MathML element helpers.

### `@llui/components@0.0.6`

- **Added** `inView` component; RTL keyboard navigation across all directional components.
- **Added** Locale context for i18n (English defaults, zero-setup for English apps) and locale-aware `format` utilities wrapping `Intl`.
- **Fixed** Benchmark chart animations and format stability.

### Docs & CI

- **Added** Animated benchmark charts.
- **Added** GitHub Actions workflow for format, build, check, lint, and test.
- **Fixed** Example app — use `ItemAccessor<Repo>` so `repoItem` shorthand type-checks.

## 2026-04-08 — 0.0.5

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.5`

### `@llui/vite-plugin@0.0.5`

- **Added** Compiler-generated per-message-type handlers (`__handlers`) and compiler-generated `__update` replacing the generic Phase 1/2 loop.
- **Added** Row factory: compiler-generated shared update function for `each()` rows with a runtime fast path (`entry + __rowUpdate`).
- **Added** Detects array operation patterns (e.g. filter) for specialized reconcilers.
- **Fixed** Row factory correctly scopes selector definitions (IIFE wrap), rewrites accessor calls, and preserves user variables.

### `@llui/dom@0.0.5`

- **Fixed** Restore per-row disposer with a generation guard, fixing the Clear memory leak.
- **Fixed** Selector memory leaks: lazy bucket compaction, empty bucket cleanup, bulk clear on `each()` reconcile.
- **Fixed** Set `currentDirtyMask` in `__handleMsg` for memo consistency.
- **Improved** Phase 1 mask gating skips structural blocks on irrelevant changes; shared Phase 2; swap reduced to O(2) with bulk scope disposal.
- **Improved** Scope pooling reuses disposed scope objects to reduce GC pressure; `reconcileRemove` walks in O(n) without a Map.
- **Improved** Strided `reconcileChanged` for every-Nth-item updates; item updaters moved from scope to entry for direct access; render bag object reused across `each()` entries.

### Docs & infra

- **Added** Docs site — benchmarks page auto-generated from `jfb-baseline.json`.
- **Improved** `bench:setup` script validates the detected `jfb` repo before use.

## 2026-04-07 — 0.0.4

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike}@0.0.4`

### `@llui/dom@0.0.4`

- **Added** `branch` / `show` callbacks receive the `View<S,M>` bag.

### `@llui/vike@0.0.4`

- **Added** Sub-path exports; SSG extensions powering the new `llui.dev` docs site with auto-generated API docs for all 10 packages.
- **Fixed** Dispose previous page on client navigation; enable Vike client routing for SPA navigation.

### Docs

- **Fixed** Shiki CSS variables theme (no `!important`, proper light/dark), strip duplicate `h1`, fix entity encoding and content accuracy.

## 2026-04-06 — 0.0.3

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.3`

### Breaking

- **`@llui/effects@0.0.3`** — effects API v2: typed constructors, flexible body, adds `websocket` and `retry`. All existing effect call sites need to move to the typed constructors.

### `@llui/effects@0.0.3`

- **Added** `upload` effect with progress tracking; `clipboard`, `notification`, and `geolocation` effects.

### `@llui/router@0.0.3`

- **Added** Route guards via `beforeEnter` / `beforeLeave` hooks.

### `@llui/transitions@0.0.3`

- **Added** Route transitions and `stagger` for `each()`; spring physics.

### `@llui/components@0.0.3`

- **Added** Complete default theme for all 54 components; `aria-owns` wiring.

### `@llui/lint-idiomatic@0.0.3`

- **Added** 9 new rules: `effect-without-handler`, `forgotten-spread`, `string-effect-callback`, `nested-send-in-update`, `imperative-dom-in-view`, `accessor-side-effect`, plus 3 aria/error-message rules.

### `@llui/dom@0.0.3`

- **Improved** Runtime error messages.

### Docs

- **Improved** Document the styling layer in architecture, API reference, and README; update all effect examples for typed constructors; update system prompt for effects v2 + `View<S,M>`.

## 2026-04-06 — 0.0.2

**Released:** `@llui/{dom,effects,vite-plugin,test,router,transitions,components,vike,lint-idiomatic}@0.0.2`

Initial multi-package release — core TEA runtime (scope tree, bindings, update loop, `mountApp`), element helpers, structural primitives (`show`, `branch`, `each`, `memo`, `portal`, `onMount`), Vite plugin with prop-split and bitmask injection, test harness, effects builders, router, transitions, 54 headless components, idiomatic lint rules, and Vike SSR adapter. 977 tests at release.
