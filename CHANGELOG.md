---
title: Changelog
description: Release history for LLui packages
---

# Changelog

All notable changes to LLui packages are documented here. LLui is a pre-1.0 project — every release may include breaking changes, though we try to call them out explicitly.

**How to read this file:** entries are anchored by **release date**. Inside each release, fixes are grouped by **`@llui/<package>@<version>`** sub-sections so you always know exactly which package and version a bullet applies to. Cross-cutting changes that affect every package (like build-output fixes) live under a shared "All packages" section. Breaking changes and migration notes sit at the top of each release block because they usually cut across multiple packages.

Packages version in lockstep at release time: `@llui/dom`, `@llui/vite-plugin`, `@llui/test`, `@llui/router`, `@llui/transitions`, `@llui/components`, `@llui/vike` share a version line. `@llui/effects`, `@llui/mcp`, and `@llui/lint-idiomatic` have their own cadence.

## 2026-04-15 — 0.0.16

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.16`; `@llui/mcp@0.0.10`; `@llui/lint-idiomatic@0.0.12`

Headline: **persistent layouts** in `@llui/vike`. Declare app chrome (header, sidebar, session state, portalled dialogs) as a `Layout` component that stays mounted across client navigation — only the route's page disposes and re-mounts. Nested layout chains and per-route chain resolvers both supported from day one. Plus the supporting runtime primitives in `@llui/dom`, a compiler walker fix, and two lint-rule false-positive fixes.

### `@llui/vike@0.0.16`

- **Added** `Layout` option on `createOnRenderClient` / `createOnRenderHtml`. Accepts a single `ComponentDef`, an array `[outer, ..., inner]` for nested chains, or a `(pageContext) => chain` function for per-route resolution. Persistent layouts stay mounted across client nav; only the divergent suffix of the chain disposes and re-mounts. Outer-layer DOM — and every portal, focus trap, scroll position, and effect subscription rooted inside it — survives page swaps.
- **Added** `pageSlot()` primitive (exported from `@llui/vike/client`) — a declarative structural marker a layout places in its view to declare where the nested Page or nested Layout renders. Creates its scope as a child of the current render scope so contexts flow from layout providers through the slot into the page via standard `useContext` lookups. Call exactly once per layout; layouts with zero or two-plus slots throw with descriptive errors.
- **Added** Chain diff on nav walks old and new chains in parallel by component identity and preserves every shared prefix layer. Navigating between `/dashboard/reports` and `/dashboard/overview` disposes only the innermost `Page`; navigating from `/dashboard/*` to `/settings` collapses the chain to `[AppLayout]`. Per-route resolvers enable this cleanly.
- **Added** Chain-aware hydration envelope: `window.__LLUI_STATE__` is now `{ layouts: [{ name, state }, ...], page: { name, state } }` for layout-using pages. Entries carry the component name so server/client chain mismatches fail loud with a clear error instead of silently binding wrong state to wrong instance. The legacy flat envelope shape is still read for pages without a configured `Layout` — no migration required for existing apps.
- **Added** Regression tests covering single-layout mount + nav, nested 3-layer chains, context flow through the slot, chain diffing with per-route resolvers, SSR composed rendering, and error paths (missing `pageSlot` in a layout, `pageSlot` called from the innermost page). 10 tests in `packages/vike/test/layout.test.ts`.

### `@llui/dom@0.0.16`

- **Added** `MountOptions.parentScope` on `mountApp` / `hydrateApp` — when provided, the mounted instance's `rootScope` becomes a child of that scope. This is the keystone that makes persistent layouts compose: `@llui/vike`'s `pageSlot()` uses it to parent a page instance into its enclosing layout's scope tree, so `useContext` lookups walk layer boundaries and scope disposal cascades in the right direction on nav.
- **Added** `@llui/dom/internal` subpath export. Surfaces low-level primitives (`getRenderContext`, `setRenderContext`, `clearRenderContext`, `createScope`, `disposeScope`, `addDisposer`) for framework-adapter packages that need to build structural primitives like `pageSlot()` on top of the runtime. Not part of the public app-author API — stability contract applies only to the main `@llui/dom` barrel.
- **Added** `renderNodes` and `serializeNodes` factored out of `renderToString`. Chain renders (e.g. `@llui/vike/server`'s layout-composed SSR) can now render multiple instances, append their outputs into each other's slot markers, and serialize the composed tree once with the union of every layer's bindings. `renderToString` is a trivial one-liner on top and its public contract is unchanged.
- **Fixed** `elSplit` children now flatten nested arrays one level, matching `createElement`'s existing behavior. Patterns like `main([helperReturningNodeArray()])` worked in unit tests (raw path flattens) but silently crashed at SSR build time because the compiled path didn't. Both paths now agree — catches this class of test-vs-production mismatch permanently.

### `@llui/vite-plugin@0.0.16`

- **Fixed** `computeAccessorMask`'s AST walker no longer crashes on chained method calls inside template literals inside reactive accessors. Previously a pattern like `text((_s) => \`$${item.x.toLocaleString()}\`)`inside an`each()`row crashed the whole build with "Cannot read properties of undefined (reading 'kind')" — the row-factory rewrite synthesizes new sub-trees whose inner`PropertyAccessExpression`nodes have no parent pointers, and the walker's`ts.isPropertyAccessExpression(node.parent)`crashed on undefined. Guarded every parent access in the walker; mask accounting is unchanged because resolving a chain from an inner PAE produces a prefix of the outer chain (idempotent`|=`). Regression tests in `accessor-walker-parent.test.ts`.

### `@llui/lint-idiomatic@0.0.12`

- **Fixed** `state-mutation` rule's "Increment/decrement on state" check no longer flags all prefix and postfix unary operators on state access — only `++` and `--` count as mutations. Before the fix, the canonical toggle reducer `return [{ ...state, flag: !state.flag }, []]` was flagged as a mutation because `!` is a prefix unary operator; `-state.x`, `~state.x`, `+state.x` were caught the same way.
- **Fixed** `spread-in-children` rule now exempts `provide` and `pageSlot` alongside the existing structural-primitive exemptions (`each`, `show`, `branch`, `virtualEach`, `onMount`). Both return `Node[]` and must be spread, and the rule was tripping on every layout authoring pattern that placed a context provider or page slot inside an element-helper children array.
- **Fixed** `@llui/lint-idiomatic/vite` plugin now reads source from disk via `readFileSync(id)` inside the transform hook instead of trusting the pipeline `code` argument. Before the fix, `enforce: 'post'` meant the plugin was linting the AST AFTER `@llui/vite-plugin` had rewritten component bodies — compiler-generated row-updater `++` / `--` loops triggered false-positive `state-mutation` warnings that didn't correspond to anything in user source. Reading from disk guarantees we only ever see what the author wrote.

### `@llui/mcp@0.0.10`

- **Improved** Cascade bump from `@llui/dom@0.0.16` and `@llui/lint-idiomatic@0.0.12` runtime dependencies. No direct code changes — same contracts as 0.0.9.

### `@llui/{test,router,transitions,components}@0.0.16`

- **Improved** Cascade bump from `@llui/dom@0.0.16` (tier-1 lockstep). No direct code changes — same contracts as 0.0.15. `components`, `router`, and `transitions` also have their `peerDependencies["@llui/dom"]` range updated from `^0.0.15` to `^0.0.16`.

### Docs

- **Added** New "Persistent Layouts" + "Layout → Page communication via context" recipes in the cookbook under the SSR section.
- **Added** New "Persistent layouts (@llui/vike)" section in the LLM guide with the canonical shape and a new rules bullet so LLMs reach for `pageSlot()` as the idiom.
- **Added** New "Cross-instance scope parenting" subsection in the architecture doc explaining how `parentScope` + `pageSlot()` make context flow layer → layer and how disposal cascades asymmetrically on nav.
- **Added** New `examples/vike-layout` workspace — full working example with root layout (toast stack + session context dispatchers from layout state), nested dashboard layout with sidebar, four routes exercising different chain shapes, per-route chain resolver. All four routes prerender via Vike SSG.

## 2026-04-14 — 0.0.15

**Released:** `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.15`; `@llui/mcp@0.0.9`

Addresses two production reports against `@llui/vike` + `@llui/transitions` page routing, and bakes the browser-e2e test back into the default `pnpm verify` pipeline.

### `@llui/vike@0.0.15`

- **Added** `RenderClientOptions.onLeave(el)` — awaited before dispose, so leave animations can run against the outgoing page's still-mounted DOM. Return a promise to defer the dispose-and-mount swap until the animation finishes.
- **Added** `RenderClientOptions.onEnter(el)` — fires after the new page mounts, for enter animations. Sync; promise returns are ignored. Neither hook fires on the initial hydration render.
- **Added** `fromTransition(t)` adapter — converts any `TransitionOptions` (the shape returned by `routeTransition`, `fade`, `slide`, etc. from `@llui/transitions`) into the `{ onLeave, onEnter }` pair, so wiring route transitions into Vike filesystem routing is one line: `createOnRenderClient({ ...fromTransition(routeTransition({ duration: 200 })) })`.
- **Improved** README documents the full client-navigation lifecycle: `onLeave` → `dispose` → `textContent = ''` → `mountApp` → `onEnter` → `onMount`, with notes on `AbortSignal` semantics for in-flight effects (the signal gates `send()` dispatches but does not cancel in-flight network requests — intentional, avoids losing a successful POST on nav) and scroll handling (Vike's problem via `scrollToTop`, not ours).

### `@llui/transitions@0.0.15`

- **Improved** `routeTransition()` JSDoc now documents both call sites: manual `branch()`-based routing (spread `{ enter, leave }` into the branch call) and `@llui/vike` filesystem routing (wrap via `fromTransition` from `@llui/vike/client`). Previous wording implied the primary path was `branch()` and left Vike users reaching for a helper with nowhere to plug it in.

### `@llui/components@0.0.15`

- **Added** `dialog-dispose.test.ts` regression test: asserts that disposing a mounted app with an open `dialog.overlay` leaves `document.body` clean — no leftover portal content, focus-trap stack empty, body scroll lock count zero, sibling `aria-hidden` / `inert` restored, idempotent on second `dispose()`. Empirically confirms the scope-disposer chain correctly tears down overlay state when `@llui/vike` clears a page during client navigation.

### `@llui/vite-plugin@0.0.15`

- **Fixed** `test/mcp-watch.test.ts` was leaking `fs.watch` handles on the marker directory's parent on every `setup()` call. Over ~200 test invocations the accumulated handles hit macOS's EMFILE cap and sporadically crashed other tests running in parallel. Track active fake servers per test and fire their registered `close` handlers in `afterEach` so the plugin's cleanup path runs.

### `@llui/mcp@0.0.9`

- **Fixed** `test/playwright-e2e.test.ts` reworked to use vite's programmatic `createServer` API with `server.watch: null` and `optimizeDeps.noDiscovery: true`. The previous `spawn('pnpm', ['dev'])` path was unreliable on macOS: vite's default chokidar watcher tries to register directory watches across the whole monorepo at startup and blows through the launchctl-default 256-fd soft limit before printing its ready message, surfacing as a spurious `vite startup timeout` that had broken this suite on every developer machine since it landed.
- **Fixed** Narrowly-scoped `process.on('uncaughtException')` filter installed during the suite swallows only `{ code: 'EMFILE', syscall: 'watch' }` errors originating from vite's `watchPackageDataPlugin`, which registers `fs.watch` on every `package.json` regardless of `server.watch`. Legit exceptions still propagate; the filter is removed in `afterAll`.
- **Improved** Suite is re-included in the default `pnpm verify` pipeline — runs in ~3s against a real Vite dev server and a real Chromium browser. The earlier `LLUI_RUN_E2E` opt-in flag is gone; `loadPlaywright()` probes `playwright.chromium.executablePath()` + `existsSync` so fresh checkouts (before `pnpm install`) and CI jobs without Chromium installed still skip the suite cleanly.
- **Added** `pnpm test:e2e` root script — shortcut for `pnpm --filter @llui/mcp test` when iterating on the browser-integration suite.

### CI

- **Added** Playwright Chromium install + cache step in `.github/workflows/ci.yml`. Cache keyed on `pnpm-lock.yaml`, stored at `~/.cache/ms-playwright`. Cold install is ~30s with `--with-deps`; cache hits run `install-deps chromium` only to refresh system libraries.

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
