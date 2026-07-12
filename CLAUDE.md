# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is LLui

LLui is a compile-time-optimized web framework built on The Elm Architecture (TEA), designed for LLM-first authoring. It runs on a **signal** runtime (`@llui/dom` — a single import surface; there is no legacy runtime and no `/signals` subpath). There is no virtual DOM — `view()` runs once at mount, building real DOM nodes with reactive bindings. State changes drive a **chunked-mask reconciler**: each binding carries a sparse mask of the dependency-path chunks it reads; on update the runtime computes the dirty chunk-set from old→new state (reference-equality per path), gates out bindings whose mask doesn't intersect it, then commits only values that actually changed (output-equality). Structural primitives (`branch`, `each`, `show`, plus `unsafeHtml`/`lazy`/`virtualEach`/`foreign`/`portal`/`provide`) are **lazy `Mountable`s** — recipes that build their live nodes and register their reconcile spec / child scope at the point they are _placed_ (materialized by `populate` for element children and by `runBuild` for a build's returned array, both under a live build context), not at construction. So a `Mountable` captured in a variable and reused inside a toggling `show`/`branch` arm rebuilds fresh on every remount (spec lands in the placing scope); placing one twice yields two independent live instances. They reconcile arms/keyed rows and own child scopes.

The Vite plugin runs a **single signal transform** (`@llui/compiler`) via the TypeScript Compiler API: it lowers signal expressions in a component's DIRECT view to runtime helpers (`signalText`/`el`/`react`/`signalEach`/…) as an optimization, emits introspection metadata, and runs the signal lint rules as non-bypassable build errors. Anything it can't lower (view-helper functions, block-body views) runs via the real runtime authoring helpers (which consume signal handles), so both forms coexist.

## Commands

```bash
pnpm turbo build          # Build all packages (tsc)
pnpm turbo check          # Type-check all packages (tsc --noEmit)
pnpm turbo lint           # ESLint all packages
pnpm turbo test           # Run tests (vitest) across all packages
pnpm format               # Prettier format everything
pnpm format:check         # Check formatting without writing

# Single package
pnpm --filter @llui/dom build
pnpm --filter @llui/dom test
pnpm --filter @llui/dom check

# Single test file (from package dir)
cd packages/dom && pnpm vitest run test/signals/runtime.test.ts

# Benchmarks (js-framework-benchmark)
pnpm bench:setup              # One-time: clone + compile js-framework-benchmark repo
pnpm bench                    # Build + run jfb + compare against saved baseline
pnpm bench --runs 3           # N runs, median-of-medians (reduces single-run noise)
pnpm bench --save             # Overwrite baseline with current results
pnpm bench --all              # Also re-run all competitor frameworks (~15 min)
pnpm bench:build              # Build jfb app only (no benchmark run)
```

## Development Approach

- **Test-driven development:** Define the type/shape first, write one or more failing tests, then implement until they pass.
- **Tests live in a separate `test/` folder** within each package (e.g. `packages/core/test/`), not alongside source files.
- **No `any` types** unless strictly unavoidable. `as unknown as X` is a code smell — find a better type or restructure.
- **Nothing is sacred.** There is no legacy code or backward compatibility concern. When changing assumptions, update the docs in `site/content/` (published to [llui.dev](https://llui.dev)) to match.
- **No shortcuts.** Engineering economy, expedience, or "good enough for now" must never drive decisions. The drivers are engineering excellence, sound solutions, correctness, and developer experience. If the correct fix is harder, do the harder thing.

## Code Style

- Single quotes, no semicolons, trailing commas
- Prefix unused parameters with `_`
- Configured via `.prettierrc` and `eslint.config.ts` (flat config)

## Monorepo Structure

Twenty-one packages under `packages/`, managed by pnpm workspaces + Turborepo:

| Package                                | Purpose                                                                                                                                                                                                                                                                                      | Dependencies                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@llui/dom`                            | Runtime: component, mount, scope tree, bindings, element helpers, structural primitives                                                                                                                                                                                                      | —                                                                                                              |
| `@llui/compiler`                       | Engine: signal TypeScript transform (view lowering + inline introspection metadata) + compile-time lint rules (all severity: error)                                                                                                                                                          | typescript                                                                                                     |
| `@llui/compiler-ssr`                   | Opt-in: 'use client' directive transforms                                                                                                                                                                                                                                                    | @llui/compiler                                                                                                 |
| `@llui/vite-plugin`                    | Vite adapter: wires compiler into Vite, surfaces diagnostics via this.error()                                                                                                                                                                                                                | peer: vite                                                                                                     |
| `@llui/components`                     | Headless components: accordion, dialog, tabs, select, tree-view, timer, tour, etc.                                                                                                                                                                                                           | @llui/dom                                                                                                      |
| `@llui/test`                           | Test harness: testComponent, assertEffects, testView, propertyTest, replayTrace                                                                                                                                                                                                              | @llui/dom                                                                                                      |
| `@llui/effects`                        | Effect builders: http, cancel, debounce, sequence, race + handleEffects chain                                                                                                                                                                                                                | —                                                                                                              |
| `@llui/security`                       | Shared URL + loopback-origin sanitization consumed by the DOM-sink and dev-server security surfaces (a2ui, markdown, markdown-editor, mcp, vite-plugin)                                                                                                                                      | —                                                                                                              |
| `@llui/router`                         | Client router with route-matching helpers and link components                                                                                                                                                                                                                                | @llui/dom                                                                                                      |
| `@llui/transitions`                    | Animation/transition wrapper helpers                                                                                                                                                                                                                                                         | @llui/dom                                                                                                      |
| `@llui/mcp`                            | MCP server exposing LLui debug API to LLMs                                                                                                                                                                                                                                                   | @llui/compiler, @llui/vite-plugin, @modelcontextprotocol/sdk, ws, zod (+ peer: @llui/dom, optional playwright) |
| `@llui/vike`                           | Vike SSR adapter: onRenderHtml, onRenderClient                                                                                                                                                                                                                                               | @llui/dom                                                                                                      |
| `@llui/agent` (`packages/agent`)       | LAP (LLui Agent Protocol) server + browser client runtime for driving a running app from LLM clients                                                                                                                                                                                         | ws, zod, @modelcontextprotocol/sdk                                                                             |
| `llui-agent` (`packages/agent-bridge`) | MCP CLI that bridges Claude / other LLM clients to a running `@llui/agent` server (thin LAP-over-HTTP forwarder)                                                                                                                                                                             | @llui/agent                                                                                                    |
| `@llui/agent-e2e`                      | End-to-end fixtures and tests for the agent surface                                                                                                                                                                                                                                          | @llui/agent                                                                                                    |
| `@llui/devmode-annotate`               | Dev-mode HUD: capture-only overlay that drops annotated notes from the running app into the shared notebook for the LLM                                                                                                                                                                      | @llui/dom (peer)                                                                                               |
| `@llui/markdown`                       | Reactive Markdown rendering: `markdown()` parses to mdast and builds live reactive DOM (no HTML string), per-node renderer overrides, streaming-friendly keyed blocks, bundled light/dark themes                                                                                             | @llui/dom (peer)                                                                                               |
| `@llui/lexical`                        | Low-level Lexical ↔ signal-runtime binding: `lexicalForeign` seam, plugin contract, DecoratorNode↔LLui sub-view bridge                                                                                                                                                                       | @llui/dom + lexical (peer)                                                                                     |
| `@llui/lexical-collab`                 | Opt-in collaborative editing: `yjsCollab` binding over an injected Yjs provider — CRDT sync, scoped undo, presence cursors                                                                                                                                                                   | @llui/lexical + @lexical/yjs + yjs (peer)                                                                      |
| `@llui/markdown-editor`                | WYSIWYG Markdown editor: `markdownEditor()` component, transformer registry, GFM/callout plugins, toolbar surface, `collab` seam                                                                                                                                                             | @llui/lexical, @llui/dom                                                                                       |
| `@llui/a2ui`                           | Renderer for Google's A2UI protocol (v0.9): `mountA2ui()` applies server→client envelopes to a TEA surface store, reactive `{path}` bindings + templates + two-way binding + actions, open catalog registry (`defineCatalog`), Basic catalog reuses `@llui/components` (CheckBox/Tabs/Modal) | @llui/dom (peer) + @llui/components                                                                            |

**Note for future LLMs:** framework lint rules are compile-time ERRORS in `@llui/compiler` (run by `@llui/vite-plugin`), never ESLint rules. The signal lint set (`packages/compiler/src/signals/rules.ts`) covers `peek-in-slot`, `operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`, plus the shared cross-file/agent/convention checks. Do NOT reintroduce `@llui/eslint-plugin` or recreate rules as ESLint rules: LLMs ignore lint warnings, so non-bypassable compiler errors are the only effective channel.

Build order is computed by Turbo via `"dependsOn": ["^build"]`. Roots: `@llui/dom` and `@llui/effects` (no deps); everything else layers on top.

## Architecture Concepts

**Component shape:** `component<State, Msg, Effect>({ name, init, update, view, onEffect? })`. State must be JSON-serializable. Msg and Effect are discriminated unions with a `type` field. `init()` takes NO arguments. `view` receives a `{ state, send }` bag where `state` is a `Signal<State>` — read it with `state.map(s => …)` (derive a reactive value), `state.at('field')` (narrow to a sub-path signal), or `state.peek()` (one-shot read in handlers/effects). Element + structural helpers (`div`, `button`, `text`, `each`, `show`, `branch`, …) are module imports from `@llui/dom`, NOT bag members.

**Composition:**

- **View functions (default):** factor sub-views as plain functions that take signal handles — `header(state.at('header'), send)` or `header(state.map(s => s.header), send)`. They run via the real runtime authoring helpers (which consume handles), so they compose without compilation. Annotate their return as `Renderable` (a list, `readonly Mountable[]`) or `Mountable` (a single element) — NOT `Node`/`Node[]`. Every authoring helper (`el`/`text`/`each`/`show`/…) returns a lazy `Mountable`; the cross-file compiler walker recognizes `Renderable`/`Mountable` (and legacy `Node` shapes) as view-helper returns. A helper called for a side effect (notably `onMount`) is now inert unless its returned `Mountable` is PLACED in the view array — discarding it registers nothing.
- **Library components:** the `connect(state: Signal<Slice>, send, opts?)` + `overlay({ state, send, parts, content })` pattern (see `@llui/components`) returns Signal-handle part bags the consumer spreads onto elements. A full child-component boundary (own update cycle + scope tree) is for independent effect lifecycle / library packaging.

**Reactivity (chunked mask):** there is no path ceiling. Each binding carries a sparse mask of the dependency-path chunks it reads; on update the runtime builds the dirty chunk-set from old→new state (reference-equality per path), gates out non-intersecting bindings, and commits only changed values (output-equality). Structural primitives reconcile and own child scopes. (This replaces the deleted two-word-bitmask / `elSplit` / `__dirty` model.)

**Effects as data:** `update()` returns `[newState, effects]`. The core runtime does NOT special-case any effect type — every effect is passed to the component's `onEffect` handler; with no handler an emitted effect is dropped (the runtime warns in dev). The `@llui/effects` package provides the effect builders (`http`/`cancel`/`debounce`/`sequence`/`race`/`timeout`/`interval`/`delay`/`log`/…) and `handleEffects<E>().else(handler)` (adapt to `onEffect` via `asOnEffect`). `delay(ms, msg)` (alias of `timeout`) and `log(message)` replace the old built-in core `delay`/`log` effects.

**`send()` is synchronous:** in the signal runtime each `send()` runs the reducer and applies the update immediately (no microtask batching). `handle.flush()` is a no-op under the default synchronous scheduler (kept for harness/agent parity); in `raf` mode it force-commits synchronously. **`batch(fn)`** (on the handle AND in the view/`onEffect` bag, alongside `send`) coalesces a burst of `send`s into ONE reconcile: every reducer still runs in order and effects still fire per message, but the DOM commit + subscriber notification are deferred to a single pass against the final state when the outermost `batch` returns. State is applied by the time `batch` returns, so the synchronous contract holds at the boundary — this is the opt-in burst/streaming fast path (drain a websocket frame of N ticks as one re-render; ~2.4× on a 1k-tick burst). The compiler also auto-wraps provably-safe straight-line multi-`send` handlers (a block of only `send(...)` calls) in `batch(...)` and injects `batch` into the bag. There is NO microtask/rAF auto-batching by default (it would break sync predictability). The OPT-IN frame-scheduled mode shipped: `mountApp(container, def, { scheduler: 'raf' })` keeps reducers/effects synchronous (the data contract holds) but coalesces the DOM commit + subscriber notification to one reconcile per animation frame (microtask fallback off-browser; `handle.flush()` forces a synchronous commit) — measured at vanilla parity on the 1k-burst ticker op (5.9ms vs 14.1 per-send).

## Docs

The authoritative docs live in `site/content/` and are published to **[llui.dev](https://llui.dev)** (built with Vike; a few pages are symlinks to `docs/*.md`, and `api/<pkg>.md` pages are generated by `site/src/generate-api.ts`). Key pages:

- [Architecture](https://llui.dev/architecture) (`site/content/architecture.md`) — mental model, build-once views, chunked-mask reactivity, the compiler, scope tree
- [Getting Started](https://llui.dev/getting-started), [Cookbook](https://llui.dev/cookbook), [Composition Patterns](https://llui.dev/composition-patterns)
- [API Reference](https://llui.dev/api/dom) — per-package type signatures (`site/content/api/<pkg>.md`)
- [Agents](https://llui.dev/agents) — agent protocol, message shapes, JSDoc annotations, tool surfaces
- [Debugging](https://llui.dev/debugging), [Benchmarks](https://llui.dev/benchmarks), [Publishing a precompiled library](https://llui.dev/publishing-a-precompiled-library)

> The old numbered spec files (`docs/designs/01`–`13`) were **removed** with the pre-signal runtime. Do not reference `docs/designs/`; it no longer exists. In-flight design work lives under `docs/proposals/`.

## Active proposals

Major architectural changes in flight. Read before touching the relevant packages:

- **v2 Compiler Architecture** (`docs/proposals/v2-compiler/`) — partially realized by the signals migration: `@llui/compiler` is a standalone package (extracted from `@llui/vite-plugin`), and cross-file Msg/State/Effect analysis is live (`cross-file-resolver.ts`, wired into the vite-plugin). The **live** transform path is `transformSignalComponentSource` (a single string-edit signal transform); it emits agent/devtools metadata **inline** (its own `sharedMetaProps`), NOT through a registry.

  **Superseded/removed (do not resurrect without a reason):**
  - The v2c compiler-module registry (`module.ts` `CompilerModule`/`ModuleRegistry`), the introspection/devtools factories (`introspection-factory.ts`), and the `@llui/compiler-{introspection,devtools}` packages were **deleted** — they were only ever driven by the `transformLlui` orchestrator, which the signals migration replaced with `transformSignalComponentSource` (inline metadata emission). The extraction functions live in `@llui/compiler` (`msg-schema.ts`, `state-schema.ts`, `msg-annotations.ts`, `schema-hash.ts`, `binding-descriptors.ts`) and are called inline by the transform.
  - The legacy cross-file dep-analysis **walker** (`walkProgram`/`crossFileAccessorPaths` in `cross-file-walker.ts`) was **deleted** — it was the v2b transform path, removed from the live route when the signal transform became the only compilation route. The live cross-file work uses `cross-file-resolver.ts` (Msg/State/Effect schema resolution) + the signal transform's own dep analyzer (`analyze-deps.ts`/`extract-deps.ts`).

  **Dormant-but-kept:** The cross-package library ABI (`__llui_deps.json`, schema v2) — the **producer** (`build-manifest.ts` + `scripts/emit-deps.mjs`, wired into `scripts/publish.sh`) ships manifests, but the **consumer** narrowing is **not wired into the live transform** (it needs a `ts.Program`/checker the string-edit transform lacks; phase 3 was evidence-closed 2026-06-10 — zero qualifying call sites in real consumers). `manifest-resolve.ts` is kept as dormant forward-compat; `collect-deps.ts` / `track-utils.ts` stay because the producer uses them. See the status note in `docs/publishing-a-precompiled-library.md`.

  Note there is no runtime `track()` _primitive_ in `@llui/dom` — only the compiler annotation. The proposal predates the signal runtime, so its references to the legacy runtime (`update-loop.ts`), the deleted `@llui/eslint-plugin`, and the two-word bitmask are historical — read it for the module-system direction, not the runtime model.
