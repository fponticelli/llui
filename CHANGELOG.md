# Changelog

All notable changes to LLui packages are documented in this file. LLui is a pre-1.0 project — every release may include breaking changes, though we try to call them out explicitly.

Packages version in lockstep at release time: `@llui/dom`, `@llui/vite-plugin`, `@llui/test`, `@llui/router`, `@llui/transitions`, `@llui/components`, `@llui/vike` share a version line, and `@llui/effects`, `@llui/mcp`, `@llui/lint-idiomatic` have their own.

## 2026-04-14

Released: `@llui/{dom,vite-plugin,test,router,transitions,components,vike}@0.0.14`, `@llui/{effects,mcp}@0.0.8`, `@llui/lint-idiomatic@0.0.11`

Ten production-sourced bug fixes spanning SSR, the compiler, structural reconciliation, runtime timing, and published build output.

### Breaking

- **`@llui/vite-plugin` — `mcpPort` is now opt-in.** Default is `null`. The `/__llui_mcp_status` middleware and WebSocket companion process are only installed when `mcpPort` is passed explicitly. If you were relying on MCP in dev, add `{ mcpPort: 5200 }` (or any port) to your `llui()` call in `vite.config.ts`. Fixes 404 noise in dev logs for apps that don't use MCP.

### Fixed

- **`@llui/vite-plugin` — hoisted `class:` accessor miscompile.** A reactive attribute whose value was an `Identifier` resolving to a `const`-bound arrow (e.g. `const cls = (s) => ...; a({ class: cls })`) compiled to `__e.className = cls` in the static setup, coercing the function to its source string at runtime and producing `<a class="(s) => ...">` in the DOM with no binding wired. The compiler now resolves local `const`-bound arrow identifiers to their initializer and emits a reactive binding identical to the inline-arrow form. Applies to both the `elSplit` split pass and the `elTemplate` subtree-collapse pass. Affects `class`, `style`, attribute, and reactive DOM-property accessors. Event handlers were never affected.
- **`@llui/dom` — `show()` / `branch()` block source-order reconciliation.** Nested structural blocks were landing *before* their parent in the flat `inst.structuralBlocks` array because every structural primitive did `blocks.push(block)` *after* running its builder. When a parent reconciled and disposed nested children, the array collapsed mid-iteration and subsequent sibling blocks could be skipped entirely — a sibling `show()` placed after a form would silently fail to mount. All structural primitives (`branch`, `each`, `virtualEach`) now push their block *before* running the builder, so parents always precede nested children. Parents now also reconcile before children, avoiding wasted work on subtrees the parent is about to unmount.
- **`@llui/dom` — `hydrateApp` dropped `init`-time effects.** `hydrateApp` was short-circuiting `init()` to reuse `serverState`, silently discarding any effects `init()` returned — so HTTP fetches, subscriptions, and timers never fired on the client after hydration. `hydrateApp` now runs the original `init()` purely to extract its effect list, discards the returned state, and dispatches those effects after mount.
- **`@llui/dom` — `elSplit` crashed on raw string children.** The children parameter was typed `Node[]` but callers pass mixed `(Node | string)[]` arrays from template helpers. In jsdom (SSR), passing a raw string to `appendChild` throws. `elSplit` now accepts `Array<Node | string>` and wraps strings in `document.createTextNode(...)`.
- **`@llui/dom` — `onMount` microtask race.** `onMount` callbacks were deferred via `queueMicrotask`, which meant a synchronous `dispatchEvent` fired immediately after mount (or a `branch()` case swap) could reach the DOM before the listener registered inside `onMount` had attached. `mountApp`, `hydrateApp`, and `branch()`'s reconcile path now push an `onMount` queue and flush it **synchronously** after new nodes are inserted. The `queueMicrotask` fallback still exists for callbacks registered outside any active mount cycle.
- **`@llui/vite-plugin` — per-item heuristic scope leak.** The compiler's `isPerItemFieldAccess` was detecting any `item.field` expression as a per-item binding candidate, regardless of whether `item` actually referred to an `each()` render-callback parameter. A plain `arr.map((item) => ...)` outside `each()` would produce a broken binding tuple and crash at runtime. The heuristic now walks up the AST and verifies `item` is bound as a parameter of an `each({ render })` callback, handling destructured and renamed bindings.
- **Build output — ESM imports missing `.js` extensions.** `moduleResolution: bundler` was stripping `.js` extensions from emitted `import`/`export` statements, breaking strict Node ESM consumers. A new `scripts/add-js-extensions.mjs` pass rewrites all relative imports during publish — 578 edits across 208 source files in all 10 packages. Published tarballs now resolve cleanly under Node's strict ESM loader.
- **Build output — sourcemaps referenced missing `.ts` files.** Published `.map` files referenced `../src/*.ts` paths not shipped in the tarball, breaking source-map debugging for downstream consumers. All 10 `tsconfig.build.json` files now set `inlineSources: true`, embedding the full TypeScript source inline via `sourcesContent`. Sourcemaps are self-contained.

### Improved

- **`@llui/dom` — `getRenderContext` error message** now enumerates the three common causes when a primitive is called outside a `view()` render context: (1) module-scope primitive calls, (2) module-scope overlay helpers like `dialog.overlay` / `popover.overlay` (which internally use `show()` / `branch()`), (3) primitives called from `setTimeout` / `Promise.then` / async event handlers.
- **`@llui/dom` — `applyBinding` defensive guard.** Throws a `TypeError` the moment any function value reaches the DOM-write layer, naming the binding kind, key, and a source snippet of the offending function. Catches future compiler paths that might leak a function value past the binding emitter.

### Migration notes

- If you worked around the `show()` source-order bug (#4) by reordering sibling branches, you can revert that change — the original source order now works correctly.
- If you worked around the hoisted `class:` accessor bug (#1) by inlining the arrow or using a module-level variable, you can revert to the hoisted-`const`-arrow form.
- If you were using MCP in dev, add `{ mcpPort: <port> }` to `llui()` in `vite.config.ts` — the default is now opt-out rather than opt-in.
