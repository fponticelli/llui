# `@llui/mcp` Tools & CDP — Implementation Plan Index

> **For agentic workers:** This is an index. Each phase below links to a self-contained implementation plan. Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` on the phase plan, not on this index.

**Spec:** `docs/superpowers/specs/2026-04-17-mcp-tools-and-cdp-design.md`

**Goal:** Add 36 new MCP tools to `@llui/mcp` and a second transport (Chrome DevTools Protocol) so an LLM can debug LLui apps at state-machine, DOM, and browser-infrastructure levels.

**Execution model:** Five sequential phases, each a self-contained commit cluster. Each phase produces working, testable software on its own. Phases 2–5 share infrastructure introduced in Phase 1 (tool-registry decomposition, runtime trackers, effect interceptor hook).

---

## Phase ordering & dependencies

```
Phase 1 — Debug-API expansion (21 tools)           ← foundational; must ship first
  │
  ├──► Phase 2 — CDP transport + CDP tools (6 tools)
  │
  ├──► Phase 3 — Compiler metadata (3 tools)
  │
  ├──► Phase 4 — Source-scan + test-runner (4 tools)
  │
  └──► Phase 5 — SSR (2 tools)
```

Phases 2–5 are independent of each other after Phase 1 lands; they can be executed in any order (or in parallel worktrees).

---

## Phase plan files

| Phase | File | Tools | Primary packages touched |
|---|---|---|---|
| 1 | `2026-04-17-mcp-phase-1-debug-api.md` | 21 | `@llui/mcp`, `@llui/dom`, `@llui/effects`, `@llui/vite-plugin` (marker file only) |
| 2 | `2026-04-17-mcp-phase-2-cdp-transport.md` | 6 | `@llui/mcp` |
| 3 | `2026-04-17-mcp-phase-3-compiler-metadata.md` | 3 | `@llui/mcp`, `@llui/dom`, `@llui/vite-plugin` |
| 4 | `2026-04-17-mcp-phase-4-source-scan.md` | 4 | `@llui/mcp` |
| 5 | `2026-04-17-mcp-phase-5-ssr.md` | 2 | `@llui/mcp`, `@llui/dom`, `@llui/vike` |

---

## Cross-phase conventions

The following rules apply to every phase plan. They come from `CLAUDE.md`, the spec, and the user's memory:

### Development conventions

- **TDD is mandatory.** Every tool, every runtime tracker, every infra change: write a failing test first, verify red, implement, verify green. No exceptions.
- **Tests live in `packages/<pkg>/test/`**, never alongside source. Unit tests, jsdom tests, and Playwright tests go in separate files.
- **No `any` types.** No `as unknown as X` escape hatches. If the type needs restructuring, restructure.
- **No shortcuts.** If the correct fix is harder, do the harder thing.
- **Single quotes, no semicolons, trailing commas.** Prettier enforces this (`pnpm format`).

### Test tiers

| Tier | File | Scope |
|---|---|---|
| Unit | `packages/mcp/test/mcp.test.ts` | Every tool's routing + argument handling against a mocked debug API |
| jsdom e2e | `packages/mcp/test/e2e.test.ts` | Phase 1 DOM-touching tools against a real devtools installation in jsdom |
| Playwright e2e | `packages/mcp/test/playwright-e2e.test.ts` | Phase 2 CDP tools + one smoke per Phase 3/5 against real Chromium |

### Verification gate (end of every phase)

Before declaring a phase done, run from repo root:

```bash
pnpm turbo check          # type-check everything
pnpm turbo lint           # ESLint
pnpm turbo test           # unit + jsdom tests
pnpm --filter @llui/mcp test:e2e   # Playwright e2e (Phase 2/3/5)
pnpm format:check         # prettier
```

All five must pass. Any failure blocks the phase from completing.

### Commit grain within a phase

- One phase = one commit cluster reviewed as a unit.
- Within a phase, commits grouped by tool category (e.g., all DOM-touching tools in one commit, all effects tools in another).
- **Never auto-commit.** Present the commit message, ask the user to approve, then run `git commit`.

### Per-phase doc updates

Every phase plan ends with a docs task that updates, in the same commit cluster as the code:

- `packages/mcp/README.md` — tool table entries for new tools
- `docs/designs/07 LLM Friendliness.md` §10 — MCP tool list
- `docs/designs/09 API Reference.md` — new `LluiDebugAPI` methods (Phases 1, 3, 5) and `@llui/effects` `_setEffectInterceptor` (Phase 1)
- `CLAUDE.md` — add `@llui/mcp` to the package table if missing
- `packages/<pkg>/CHANGELOG.md` — per-package changelog entries

### Type glossary reference

Types like `ElementReport`, `ScopeNode`, `EachDiff`, `DisposerEvent`, `PendingEffect`, `EffectTimelineEntry`, `EffectMatch`, `StateDiff`, `HydrationDivergence`, `ConsoleEntry`, `NetworkEntry`, `ErrorEntry` are defined precisely in §10 of the spec. Every phase plan references those definitions — don't redefine them.

---

## How to execute

**Recommended flow:**

1. Read the spec end-to-end: `docs/superpowers/specs/2026-04-17-mcp-tools-and-cdp-design.md`.
2. Start with Phase 1. Invoke `superpowers:executing-plans` on `2026-04-17-mcp-phase-1-debug-api.md`.
3. After Phase 1's verification gate passes and the commit cluster is merged, proceed to Phase 2.
4. Phases 3, 4, 5 can run in any order (or in parallel worktrees via `superpowers:using-git-worktrees`).

Each phase plan is self-contained — no task references a task in another phase plan.
