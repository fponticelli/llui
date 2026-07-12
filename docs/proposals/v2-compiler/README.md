# LLui v2 Compiler Architecture

> **Status (2026-07): CORRECTION.** The 2026-06-02 note below overstated what shipped and named artifacts that have since been **deleted**. Ground truth (see root `CLAUDE.md` "Active proposals"): v2a landed — `@llui/compiler` is a standalone package (extracted from `@llui/vite-plugin`) and `@llui/eslint-plugin` is gone. Cross-file analysis is live, but via `cross-file-resolver.ts` (+ the signal transform's own `signals/analyze-deps.ts` / `extract-deps.ts`), **not** a `cross-file-walker.ts` — that walker was deleted. v2c's `CompilerModule`/`ModuleRegistry` (`module.ts`), `introspection-factory.ts`, and the `@llui/compiler-introspection` / `@llui/compiler-devtools` packages were **never shipped and are deleted** (only `@llui/compiler` and `@llui/compiler-ssr` exist). The live transform is `transformSignalComponentSource`, which emits agent/devtools metadata **inline** (`signals/transform-component.ts` `sharedMetaProps`), not through a module registry. There is no runtime `track()` primitive in `@llui/dom` — only a compiler annotation. The cross-package `__llui_deps.json` ABI is **dormant**: the producer ships manifests but the consumer narrowing is not wired into the live transform. Read the sub-docs as historical design rationale.

> **Status (2026-06-02): LARGELY REALIZED.** _(Superseded by the 2026-07 correction above — the walker, module registry, and introspection/devtools packages named here were deleted, not shipped.)_ v2a (extraction → standalone `@llui/compiler`, `@llui/eslint-plugin` removed) and v2b (cross-file analysis, `manifest.ts`, `__compilerVersion`, the `track({ deps })` escape hatch) landed. Only the _public cross-package library ABI_ (`__llui_deps.json` emit/consume) remains deferred. These sub-docs are retained as design rationale, not open work.

**Status:** Proposal. Open for revision until adopted.
**Last revised:** 2026-05-17

This proposal redesigns the compiler architecture as three sibling sub-proposals that can be adopted, deferred, or rejected independently. The original integrated document lived at `docs/proposals/v2-compiler-architecture.md`; it has been split into this folder to support per-phase execution by fresh-context agents.

---

## Vision

LLui is a language. Languages have compilers. The compiler is the source of truth for what counts as valid LLui code and for what gets emitted. Build tools and lint tools integrate with the compiler; they do not replace it.

Today, the same analytical questions ("what paths does this accessor read?", "is this view helper exhaustive?", "is this binding overflowing?") are answered twice across `@llui/vite-plugin`'s per-file walker and `@llui/eslint-plugin`'s ~15 type-aware rules. The v2 architecture factors so that **no analytical question has more than one implementation in this repo** — adapters consume; they do not recompute.

---

## Sub-proposals

### v2a — Compiler extraction · [`v2a.md`](./v2a.md)

**Scope:** Carve `@llui/compiler` out of `@llui/vite-plugin`; ESLint and MCP become thin adapters.

**Touches only**: `packages/vite-plugin/`, `packages/eslint-plugin-llui/`, and the new `packages/compiler/`. **Does not touch**: `packages/dom/`, `packages/test/`, any test directory, or any runtime contract.

**No new user-visible capability and no runtime contract change.** v2a is architectural debt repayment, period. Its value is solely that exactly one engine answers analytical questions, which is the precondition for everything in v2b/v2c. Approve v2a on the architecture argument or not at all; do not approve it on the strength of v2b's user-visible wins.

### v2b — Cross-file analysis · [`v2b.md`](./v2b.md)

**Scope:** Library manifest (`__llui_deps.json`), `track()` primitive, cross-file walker, `__compilerVersion` runtime gate, `genericUpdate` versioning, `defineTestComponent()` and the in-package test migration in `packages/dom/test/`.

**Depends on v2a.** Delivers the dicerun2 sentinel-`show()` win (Appendix A in [`shared.md`](./shared.md)).

### v2c — Module system · [`v2c.md`](./v2c.md)

**Scope:** Pluggable compiler modules, normalized diagnostic schema, MCP-as-adapter.

**Depends on v2a.** Currently lacks a named third-party module use case; ships internal-only modules and defers the public ABI until a documented third-party need exists.

---

## Sequencing rationale

The original draft put `__compilerVersion`, the runtime versioning gate, `defineTestComponent()`, and the test-migration story in v2a. Reviewer feedback was that v2a then shipped runtime-contract changes and ~84 test-file edits without the cross-file walker that justifies them — meaning consumers paid migration cost for zero user-visible win, and if v2b ever slipped, the FULL_MASK silent-degrade hazard (see §20.12 in [`shared.md`](./shared.md)) would ship without its compensating value.

The current split resolves this: v2a touches only files in `packages/vite-plugin/` and `packages/eslint-plugin-llui/`; nothing in `packages/dom/`, `packages/test/`, or any test directory. The runtime contract change and its associated migration move into v2b alongside the cross-file walker that pays for it.

---

## Reading order for fresh agents

A fresh agent picking up implementation work should read in this order:

1. **`/Users/franco/projects/llui/CLAUDE.md`** — repo conventions, commands, code style, monorepo layout.
2. **This file** — the sub-proposal map and sequencing decision.
3. **[`shared.md`](./shared.md)** — engineering principles, problem statement, system architecture, data flow, source-map composition, resilience design, testing strategy, versioning, definition of done, open questions, and gaps. This is the _background_ every phase needs.
4. **Your phase's file** — [`v2a.md`](./v2a.md), [`v2b.md`](./v2b.md), or [`v2c.md`](./v2c.md). Each contains the phase-specific design content _plus_ a sequenced implementation roadmap (spike phase, production steps, exit gates, failure paths).
5. **Selected design docs** as needed. _(The numbered `docs/designs/01`–`13` spec files referenced here were **removed** with the pre-signal runtime; that directory no longer exists. The authoritative docs now live in `site/content/` and are published to [llui.dev](https://llui.dev) — Architecture, API Reference, etc. — with in-flight design under `docs/proposals/`.)_ Formerly-cited topics: runtime mental model (→ [Architecture](https://llui.dev/architecture)); the compiler and its superseded sections; `mountApp` / update model / binding system (→ [Architecture](https://llui.dev/architecture)); runtime test philosophy; and LLM authoring philosophy.

Do not read other phases' files unless cross-referenced. The split exists specifically so each phase is self-contained from an implementation standpoint.

---

## File map

```
docs/proposals/v2-compiler/
├── README.md      this file — vision, sub-proposal map, sequencing rationale, reading order
├── shared.md      principles, architecture, data flow, resilience, testing, versioning, DoD, gaps
├── v2a.md         compiler extraction: scope, content, sequenced roadmap, exit gates
├── v2b.md         cross-file analysis: scope, content (schema, walker, runtime contract), sequenced roadmap, exit gates
└── v2c.md         module system: scope, content, sequenced roadmap, exit gates
```

The original `docs/proposals/v2-compiler-architecture.md` is now a stub pointing here.
