# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is LLui

LLui is a compile-time-optimized web framework built on The Elm Architecture (TEA), designed for LLM-first authoring. There is no virtual DOM — `view()` runs once at mount, building real DOM nodes with reactive bindings. State changes drive a two-phase update: Phase 1 reconciles structural primitives (`branch`, `each`, `show`), Phase 2 iterates a flat binding array with bitmask gating (`(binding.mask & dirty) === 0`) to skip irrelevant updates.

The Vite plugin compiler performs 3 passes: (1) static/dynamic prop split, (2) dependency analysis + bitmask injection via TypeScript Compiler API, (3) import cleanup. It rewrites element helper calls to `elSplit()` and synthesizes `__dirty(oldState, newState)` functions per component.

## Commands

```bash
pnpm turbo build          # Build all packages (tsc)
pnpm turbo check          # Type-check all packages (tsc --noEmit)
pnpm turbo lint           # ESLint all packages
pnpm turbo test           # Run tests (vitest) across all packages
pnpm format               # Prettier format everything
pnpm format:check         # Check formatting without writing

# Single package
pnpm --filter @llui/core build
pnpm --filter @llui/core test
pnpm --filter @llui/core check

# Single test file (from package dir)
cd packages/core && pnpm vitest run src/some.test.ts
```

## Code Style

- Single quotes, no semicolons, trailing commas
- Prefix unused parameters with `_`
- Configured via `.prettierrc` and `eslint.config.ts` (flat config)

## Monorepo Structure

Six packages under `packages/`, managed by pnpm workspaces + Turborepo:

| Package | Purpose | Dependencies |
|---------|---------|-------------|
| `@llui/core` | Runtime: component, mount, scope tree, bindings, element helpers, structural primitives | — |
| `@llui/vite-plugin` | Compiler: 3-pass TypeScript transform (prop split → mask injection → import cleanup) | peer: vite |
| `@llui/test` | Test harness: testComponent, assertEffects, testView, propertyTest, replayTrace | @llui/core |
| `@llui/effects` | Effect builders: http, cancel, debounce, sequence, race + handleEffects chain | — |
| `@llui/ark` | Ark UI adapter: useMachine, normalizeProps (Zag.js FSM bridge) | @llui/core |
| `@llui/vike` | Vike SSR adapter: onRenderHtml, onRenderClient | @llui/core |

Build order: `@llui/core` and `@llui/effects` first (no deps), then `@llui/test`, `@llui/ark`, `@llui/vike` (depend on core). Turbo handles this via `"dependsOn": ["^build"]`.

## Architecture Concepts

**Component shape:** `component<State, Msg, Effect>({ name, init, update, view, onEffect? })`. State must be JSON-serializable. Msg and Effect are discriminated unions with a `type` field.

**Two composition levels:**
- **Level 1 (default):** View functions — modules exporting `update()` and `view()` functions. Parent owns state; child operates on a slice. Use `(props, send)` convention.
- **Level 2 (opt-in):** `child()` — full component boundary with own bitmask, update cycle, and scope tree. Only for 30+ state paths, library components, or independent effect lifecycle.

**Bitmask tiers:** ≤31 unique access paths → single number mask. 32–62 → two-word mask pair. 63+ → compiler warning recommending decomposition.

**Effects as data:** `update()` returns `[newState, effects]`. Core runtime handles `delay` and `log`. The `@llui/effects` package provides `handleEffects<E>().else(handler)` for http/cancel/debounce/sequence/race.

**`send()` batching:** Messages queue into a microtask. Multiple `send()` calls coalesce into one update cycle. `flush()` forces synchronous execution.

## Design Docs

Comprehensive specs live in `docs/designs/`. These are the authoritative reference:

- `01 Architecture.md` — mental model, composition, effects, expressibility catalogue
- `02 Compiler.md` — the 3-pass Vite plugin, TypeScript Compiler API, correctness invariants
- `03 Runtime DOM.md` — two-phase update, message queue, binding system, scope lifecycle
- `04 Test Strategy.md` — testComponent, propertyTest, replayTrace, testing philosophy
- `05 Performance.md` — benchmarking methodology (Playwright + 4× CPU throttle)
- `06 Bundle Size.md` — per-primitive cost analysis, tree-shaking requirements
- `07 LLM Friendliness.md` — system prompt design, evaluation tasks, LLM debug protocol
- `08 Ecosystem Integration.md` — Ark UI via Zag.js, Vike SSR, foreign() for imperative libs
- `09 API Reference.md` — authoritative type signatures for all public exports
