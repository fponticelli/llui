# v2c — Module System, Diagnostic Schema, MCP-as-Adapter

> **Status (2026-06-02): REALIZED (public ABI deferred).** The internal `CompilerModule`/`ModuleRegistry` (`module.ts`) and the decomposed opt-in packages (`compiler-introspection`/`-devtools`/`-ssr`) shipped and are wired through `@llui/vite-plugin` and `@llui/mcp`. Only the _public third-party library ABI_ / cross-package `__llui_deps.json` layer remains unbuilt. Retained as design rationale.

**Status:** Proposal. Open for revision until adopted.
**Depends on:** v2a. (Loosely on v2b — see §1.)
**Blocks:** the public ABI proposal (a separate future doc).

Read [`README.md`](./README.md), [`shared.md`](./shared.md), and v2a's [implementation roadmap](./v2a.md) for context first. Reading [`v2b.md`](./v2b.md) is optional but recommended (some v2c diagnostic-schema work is easier after v2b's diagnostics exist).

---

## 1. Scope

v2c contains three pieces that share a theme — "second-pass cleanup after v2a/v2b establish the engine and its outputs":

1. **Module system** — refactor `@llui/compiler` internals into four opt-in modules (`core`, `agent`, `ssr`, `devtools`) with a per-`SyntaxKind` visitor registry. The module ABI is **internal-only at v1**; the public-extension story is deferred to a future proposal.
2. **Normalized diagnostic schema** — lift all diagnostics into a single canonical shape so every adapter (ESLint, MCP, future LSP) consumes the same format. Diagnostics produced by v2a/v2b ship in ad-hoc shapes until v2c normalizes them.
3. **MCP-as-adapter** — `@llui/mcp` gains a static-mode that calls `compiler.analyzeFile()`, mirroring the live-mode that already calls into the running runtime. Today `@llui/mcp` is purely a runtime relay; v2c _adds_ static capability without removing live-mode tools.

v2c can ship before v2b if needed — the module system and diagnostic schema don't depend on the cross-file walker. The MCP static-mode tools that only make sense with cross-file analysis (e.g., a `findReadsOf(path)` tool) would be deferred to a v2c.1 if v2c lands before v2b.

---

## 2. Module system (§7)

Compilers grow features. LLui's compiler must accommodate features that not every project uses. The module system makes feature scope an explicit, per-project choice.

### 2.1 Module shape

Each module is a TS package exporting a small interface. Modules **never** walk the AST themselves; they register per-`SyntaxKind` handlers that the compiler's single-pass walker dispatches to.

```ts
interface CompilerModule {
  name: string
  compilerVersion: string // semver range against compiler API

  diagnostics: DiagnosticDefinition[]

  // Per-node-kind handlers. The walker visits each AST node once;
  // every module with a handler for that kind receives the node.
  visitors: {
    [K in ts.SyntaxKind]?: (ctx: AnalysisContext, node: ts.Node) => void
  }

  // Emission contributions, called once per file after analysis completes
  emit?(ctx: EmissionContext, analysis: FileAnalysis): EmissionContribution[]

  // Optional: declare runtime imports this module's emissions require
  runtimeImports?: string[]
}
```

This shape rules out the O(modules × nodes) trap: the walker runs once per file regardless of module count.

**Visitor and emission ordering.** Module ordering is deterministic and observable:

- Visitors for a given `SyntaxKind` run in **declaration order** — the order the modules appear in `llui.config.ts`'s `modules: [...]` array. This is observable to module authors (a module that depends on annotations another module produces must be declared after it). Alphabetical-by-name was considered and rejected: it would couple correctness to a module's package name.
- Emission contributions are merged after all analysis completes. If two modules contribute to the same `ComponentDef` field, that is a hard compiler error (`llui/module-emission-conflict`) — not a silent overwrite. The error names both modules and the contested field.
- The `runtimeImports` array is merged by union (deduplicated by import specifier); identical imports from multiple modules collapse to one.

Ordering is asserted by golden-file tests that swap module declaration order and assert the emitted output differs in a known way.

### 2.2 The package layout

**Final shape that shipped** (revised from the original four-package proposal during implementation — see §2.2.1 below):

**`@llui/compiler`** (orchestrator + always-on dom modules)

The package every consumer depends on. Owns the pipeline, the `ModuleRegistry` primitive, the shared utilities (`createMaskLiteral`, `computeAccessorMask`, `isHelperCall`, `isComponentCall`, `findComponentCalls`), and the dom code-generation modules — the modules whose emission the `@llui/dom` runtime executes:

- `each-memo` — wrap allocating each() items in memo()
- `item-dedup` — hoist **sN/**aN in render bodies
- `structural-mask` — inject \_\_mask on each/branch/scope/show
- `text-mask` — inject \_\_mask as text()'s 2nd arg
- `element-rewrite` — div() → elSplit / elTemplate / \_\_cloneStaticTemplate
- `row-factory` — each() → row-factory shape
- `core-synthesis` — **update / **handlers / \_\_prefixes
- `mask-legend` — \_\_maskLegend (introspection helper)
- `compiler-stamp` — **lluiCompilerEmitted + **compilerVersion (integrity / runtime contract)

Plus the registry-hook entry points for opt-in modules: `registerIntrospectionFactory`, `registerDevtoolsFactory`, `getIntrospectionFactory`, `getDevtoolsFactory`.

**`@llui/compiler-introspection`** (opt-in)

Runtime introspection metadata consumed by BOTH the end-user agent runtime (`@llui/agent-bridge`) and the dev-MCP tooling (`@llui/mcp`). The compiler doesn't pick which consumer reads the metadata; both read the same emitted output.

- `state-schema` — `__stateSchema` emission
- `msg-annotations` — `__msgAnnotations` emission
- `msg-schema` — `__msgSchema` + `__effectSchema` emission
- `schema-hash` — `__schemaHash` (HMR re-send gating; **always-on** when the factory is registered)
- `binding-descriptors` — preTransform pass tagging handler arrows with `__lluiVariants`

Exports `introspectionFactory` (an `IntrospectionFactory`) — hosts pass this to `registerIntrospectionFactory` at module-import time.

**`@llui/compiler-devtools`** (opt-in)

Dev-MCP / LLM tooling support. Emits debug aids the dev MCP (`@llui/mcp`) consumes for source navigation and future trace instrumentation. Distinct from `compiler-introspection`: that package emits SHARED metadata both agent and dev tooling consume; this one emits dev-only aids that don't need to ship in end-user builds.

- `component-meta` — `__componentMeta: { file, line }`
- (future) trace instrumentation: `_eachDiffLog`, `_disposerLog`, `_effectTimeline`, `_coverage` when the runtime devtools spec lands

Exports `devtoolsFactory` — hosts pass this to `registerDevtoolsFactory`.

**`@llui/compiler-ssr`** (opt-in)

SSR transforms invoked directly by `@llui/vike` — not registered through a factory because they don't compose with the main `transformLlui` pipeline (they're an alternative entry point for `'use client'` modules).

- `transformUseClientSsr` — rewrites client-only modules into SSR-safe stubs
- `hasUseClientDirective` — cheap string scan for the directive

#### 2.2.1 What changed from the original four-package design

The original §2.2 proposed `compiler-core` / `compiler-agent` / `compiler-ssr` / `compiler-devtools`. Two changes during implementation:

1. **`compiler-core` collapsed into `@llui/compiler`.** The "core" modules are always-on — every LLui app needs them. A separate package buys no stripping benefit (the modules can't be tree-shaken; if you don't compile dom code, you don't have an LLui app). The boilerplate (separate package.json, tsconfig, dep wiring) costs real engineering without payoff. Modules in `@llui/compiler/src/modules/` are owned by the orchestrator package.
2. **`compiler-agent` renamed to `compiler-introspection`.** At runtime the distinction "agent vs devtools" is real (different runtime packages consume the metadata). At compile time the SAME metadata serves both. Naming the compiler-side package "agent" overstates the coupling. `compiler-introspection` accurately describes the compile-time concern; the runtime split happens in `@llui/agent-bridge` vs `@llui/mcp`.

### 2.3 Activation

**Registry-hook pattern.** Each opt-in package exposes a factory function. Hosts (Vite plugin, MCP, test setup) register the factories at module-import time:

```ts
// vite-plugin/src/index.ts
import { registerIntrospectionFactory, registerDevtoolsFactory } from '@llui/compiler'
import { introspectionFactory } from '@llui/compiler-introspection'
import { devtoolsFactory } from '@llui/compiler-devtools'

registerIntrospectionFactory(introspectionFactory)
registerDevtoolsFactory(devtoolsFactory)
```

When a factory isn't registered, the orchestrator skips that module set entirely — no schemas / hash / descriptors / componentMeta emit. That's the "production build with introspection off" path: the user's app builds without including those module factories at all.

**Why factory hooks, not `defineConfig({ modules: [...] })`.** The original §2.3 proposed an `llui.config.ts` file with explicit module activation. The shipped design uses a registry hook instead because:

1. **No circular workspace dep.** `defineConfig` requires `@llui/compiler` to import the sibling packages (to validate factory shapes, generate types, etc.). The sibling packages import `@llui/compiler` for shared types. That's a workspace cycle turbo refuses to build. The registry hook flips ownership: `@llui/compiler` exposes the slot, siblings fill it.
2. **One canonical wiring location.** With multiple consumers (Vite plugin, MCP, tests), a per-project `llui.config.ts` would require each consumer to read and apply it. The registry hook centralizes wiring in the consumer that already owns the compiler invocation. Tests register at `vitest.setup.ts`; the Vite plugin registers at plugin-import; MCP registers at tool-load.
3. **Tree-shaking still works.** A project that doesn't import `@llui/compiler-introspection` doesn't bundle its modules. Static analysis correctly identifies the unused dependency.

The factory signatures live in `@llui/compiler/src/introspection-factory.ts`:

```ts
export type IntrospectionFactory = (input: IntrospectionFactoryInput) => CompilerModule[]
export type DevtoolsFactory = (input: DevtoolsFactoryInput) => CompilerModule[]
```

Each factory receives the file-level state (sourceFile, hoisted schemas, flags) the orchestrator already computed, and returns the set of modules to activate for that file. Per-module gating lives inside the factory (e.g., `componentMeta` gates on `devMode`; `schemaHash` is unconditional even out of agent mode for HMR re-send).

**Where `defineConfig` could land later.** If a future scenario demands per-project module configuration (multiple consumers with different feature sets, third-party module authors), `defineConfig` can layer on top of the registry hook — wire it once, configure declaratively at the project root. The hook is the lower-level primitive; `defineConfig` is sugar over it. For the current single-internal-consumer scope, the sugar isn't worth the boilerplate.

### 2.4 Module dependencies

Modules can declare dependencies on each other (`agent` requires `core`'s path analysis). The compiler resolves the activation graph at init; a missing dependency is a hard error with a clear remediation message.

### 2.5 Third-party modules — deferred until a named consumer exists

The module interface is **internal-only at v1.** The four shipping modules (`core`, `agent`, `ssr`, `devtools`) live in this monorepo and consume the interface; nothing else does. The interface is _not_ part of the public API contract — we may break it across compiler minor versions without a deprecation cycle.

The original v2 vision was to publish the module ABI for third-party authors. We are deferring that promise because:

- There is no named third-party consumer today. Designing a public ABI for hypothetical users tends to over-fit to the wrong constraints ([`shared.md`](./shared.md) §0.3: "Eager API surface" is on the reject list).
- The four internal modules will surface the real shape constraints (visitor dispatch ordering, emission contribution merging, runtimeImports lifecycle) during v2c. Promoting the interface to public after we have _used_ it is cheaper than promoting it before.
- A public ABI carries a documentation, versioning, and compatibility cost we should not pay until someone is on the other side of it.

The interface becomes public — with semver guarantees, an `extending.md` guide ([`shared.md`](./shared.md) §20.9), and a compatibility test matrix — when a documented third-party module is in development. Until then, the file paths are `packages/compiler-*/`, not `@my-company/compiler-*`.

---

## 3. Diagnostic schema (§12)

All diagnostics flow through a single schema. Every adapter consumes the same shape.

```ts
interface Diagnostic {
  id: string                    // 'llui/bitmask-overflow', '@my-org/foo', ...
  severity: 'error' | 'warning' | 'info'
  category: 'reactivity' | 'composition' | 'agent' | 'style' | 'perf' | ...
  message: string               // human-readable, present-tense, actionable
  location: {
    file: string                // absolute path (translated to project-relative on emission)
    range: { start: Position, end: Position }
  }
  relatedInformation?: Array<{
    location: { file: string, range: { start: Position, end: Position } }
    message: string
  }>
  fixes?: CodeAction[]          // structured edits for autofix
  documentation?: string        // URL to user-facing docs for this id
}
```

Properties of this schema:

- **Stable IDs.** `llui/bitmask-overflow` means the same thing across all versions. Renaming requires a deprecation cycle.
- **Adapter-translatable.** ESLint message IDs, MCP tool outputs, and CLI text formatters all derive from this shape. No adapter generates diagnostics; they translate.
- **Fixable diagnostics carry their fixes.** Autofix logic lives with the diagnostic, not with the adapter.

v2a and v2b ship diagnostics in ad-hoc shapes that match this schema in spirit but aren't unified. v2c normalizes them — the ID, severity, category, and (where present) `fixes` move into a single shared structure consumed identically by every adapter.

---

## 4. `@llui/mcp` as adapter (§9.3)

`@llui/mcp` today is _already_ a relay over the runtime: the tools in `packages/mcp/src/tools/` (`debug-api.ts`, `compiler.ts`, `source.ts`, `ssr.ts`, `cdp.ts`) issue `ctx.relay!.call(...)` against the running app and return whatever the runtime answers. No `ts.createSourceFile`, no `ts.TypeChecker`, no symbol-table walking exists in this package today. v2c does not "convert" MCP into an adapter; it _extends_ the existing live-only relay with a second mode:

- **Live mode (existing).** Tools query the running runtime via `ctx.relay!.call(...)` and read runtime-denormalized fields ([`shared.md`](./shared.md) §6.6). Unchanged.
- **Static mode (new in v2c).** Tools that work without a running app gain a compiler dependency: they call `@llui/compiler.analyzeFile()` to answer the same questions against source. Same return shape as live mode where the question is answerable from static analysis alone.

The "live vs. static" split is explicit in the MCP tool definitions: `llui_live_*` tools require an agent-bridge connection; `llui_static_*` tools require the compiler. Tools that work either way prefer live when both are available.

No code is removed from `@llui/mcp` by this change — the package gains new static-mode tools, it does not lose existing ones.

---

## 5. Versioning interaction (§14.3)

Each module declares the compiler API version it targets:

```ts
export default defineModule({
  name: '@llui/compiler-agent',
  compilerVersion: '^0.3.0',
  // ...
})
```

Loading a module that targets an incompatible compiler version: hard error at compiler init, with a clear remediation message.

---

## 6. Exit criteria

Checkbox state captured at the v2c-partial landing (2026-05-18). This push delivered the diagnostic schema and the MCP static-mode adapter; the **module decomposition (§2)** is deferred as the largest residual.

- [ ] **Module decomposition: deferred.** `@llui/compiler` is _not_ split into `compiler-core` / `compiler-agent` / `compiler-ssr` / `compiler-devtools`. The visitor-registry refactor (§2.1), `llui.config.ts` shape (§2.3), and per-module activation (§2.4) are all paper-only at this commit. See §7.9 below for the handover note to whoever picks this up next.
- [x] §3 diagnostic schema **defined** at `packages/compiler/src/diagnostic.ts`. Stable IDs (`llui/<slug>`), severity, category, project-relative file location with line/column range, optional `fixes`, optional `documentation` URL. `toCanonicalDiagnostic()` adapter converts walker-internal `WalkerDiagnostic` to the canonical shape. 10 unit tests in `packages/compiler/test/diagnostic-schema.test.ts`. **Partially applied**: v2c-era diagnostics (walker, manifest) carry stable IDs; v2a/v2b ad-hoc warns in `transform.ts` are NOT yet routed through the canonical shape — that's mechanical follow-up.
- [x] §4 MCP static-mode: two new tools (`llui_static_show_compiled`, `llui_static_collect_paths`) shipped in `packages/mcp/src/tools/static-compiler.ts`. Both call `@llui/compiler` directly (no relay). No existing live-mode tool was removed; the live/static surface is now both-named (no auto-prefer-live dispatch yet — distinct tool names so callers can pick explicitly). 5 unit tests against on-disk temp files. **Coverage is two tools, not "every existing tool"**: a fuller enumeration of static-answerable questions (binding sources, msg schema introspection, prefix table walks) is the natural follow-up once module decomposition gives the engine a more structured analyzer surface.
- [x] §2.5 module-ABI decision: **internal-only at v1**, no `extending.md` shipped. Already recorded in `v2c.md` §2.5 and `shared.md` §20.9.

**Additional v2b carry-over** (not in the §6 original list, surfaced from v2b §10.1.3 handover):

- [x] **Vite-adapter cross-file pipeline integration**. `LluiPluginOptions.crossFile?: boolean | 'silent'` added (off by default). When enabled, the plugin builds a `ts.Program` at `configResolved`, computes cross-file accessor paths per file via `crossFileAccessorPaths`, and threads them into `transformLlui`'s new `crossFilePaths` parameter. Three unit tests (`packages/compiler/test/cross-file-pipeline.test.ts`) cover the plumbing. **Prototype-grade caveats** documented on the option: Program does not refresh on HMR; out-of-project imports unfollowed; opt-in only.
- [ ] **Vite-adapter Program HMR refresh**: still deferred (see crossFile option docstring). The cleanest landing alongside v2c's module decomposition is `ts.createIncrementalProgram` driven by the per-module-walker registry.
- [ ] **`@llui/cli publish-deps` manifest generator + v2b codemod + `llui/prefer-static-deps` lint rule**: still deferred. All three need a `@llui/cli` package that doesn't exist; same blocker as v2b §7.
- [ ] **Full `~84` test migration + `dom/test/fallback/` + bundle-size tree-shake fixture**: still deferred (cosmetic).

---

## 7. v2c Implementation Roadmap

### 7.1 Phase 0 — Pre-implementation reading

Estimated effort: 0.5 session.

Read in order:

1. [`README.md`](./README.md), [`shared.md`](./shared.md), this file.
2. v2a's cross-phase handshake artifacts ([`v2a.md`](./v2a.md) §7) — the `compileFile` API surface this phase will refactor.
3. `packages/mcp/src/tools/{debug-api,compiler,source,ssr,cdp}.ts` — get a feel for the existing live-mode tools.
4. The `packages/compiler/src/` content as it exists post-v2a (and post-v2b if v2b landed).

Done when you can answer:

- Which v2a diagnostics live in which logical module (core / agent / ssr / devtools)?
- Which MCP tools answer questions that _could_ be answered from source alone?

### 7.2 Phase 1 — Module-shape spike

Estimated effort: 1 session.

Steps:

1. Define the `CompilerModule` interface in `packages/compiler/src/module.ts`. Type-check against `ts.SyntaxKind`.
2. Sketch how `compiler-core` decomposes from the current monolithic `transform.ts` — which visitors land in core vs. agent vs. ssr vs. devtools. Produce a one-page mapping document at `packages/compiler/MODULE-MAPPING.md`.
3. Validate the mapping by hand-tracing one example: take a fixture component, follow which visitor would handle each AST node, confirm the final emission matches today's output.

**Exit:** the module decomposition is on paper; one fixture hand-traces correctly through it.

### 7.3 Phase 2 — Extract `@llui/compiler-core`

Estimated effort: 2 sessions.

Steps:

1. Create `packages/compiler-core/` package skeleton. Wire into workspace + turbo.
2. Move the `core` visitors out of `@llui/compiler` into `@llui/compiler-core`. Concretely: path collection, mask injection, `__update`/`__handlers` synthesis, element-helper rewrites.
3. Update `@llui/compiler`'s walker to dispatch to registered modules' visitors instead of calling its internal functions directly.
4. Add the visitor + emission ordering goldens (§2.1).
5. Verify: all existing tests pass; `@llui/compiler` is now a thin coordinator over `@llui/compiler-core`.

**Exit:** `compiler-core` ships as its own package; the walker dispatches; tests green.

### 7.4 Phase 3 — Extract `agent`, `ssr`, `devtools`

Estimated effort: 1.5 sessions per module (~4.5 sessions total). Same pattern as Phase 2.

For each module, in order:

1. Create the package; wire into workspace.
2. Move the visitors and emission contributions from `@llui/compiler-core` (where they were temporarily) into the new module package.
3. Add module activation to `llui.config.ts`: omit the module → no emissions of that kind.
4. Verify a project with the module disabled produces a bundle with none of the module's emitted fields (golden fixture).

**Exit:** all four modules ship; project-level enable/disable works; bundle-size goldens assert correct stripping.

### 7.5 Phase 4 — `llui.config.ts` shape + default behavior

Estimated effort: 1 session.

Steps:

1. Implement `defineConfig` per §2.3. The TypeScript parameter type enforces factory-call convention; passing the bare module value is a TypeScript error.
2. Implement missing-config default behavior: `[core(), devtools()]`.
3. Implement `modules: []` hard error with the remediation message.
4. Add tests for: missing config, valid config with overrides, `modules: []` error case.

**Exit:** config behavior matches §2.3; LLM-authorability spot-check passes (a fresh LLM given the one-sentence system-prompt blurb produces a correct `llui.config.ts`).

### 7.6 Phase 5 — Diagnostic schema normalization

Estimated effort: 1.5 sessions.

Steps:

1. Define the `Diagnostic` interface in `packages/compiler/src/diagnostic.ts` per §3.
2. Walk every diagnostic emitted by `@llui/compiler-core`, `-agent`, `-ssr`, `-devtools` and replace its ad-hoc emission with a `Diagnostic`-shaped object.
3. Update the ESLint adapter to translate `Diagnostic` → ESLint message ID + report. Verify no rule's wire format changed for downstream ESLint configs.
4. Update the MCP adapter to translate `Diagnostic` → its existing tool output schemas. Verify no MCP tool's contract changed.
5. Add stable-ID test: every diagnostic ID is in an explicit allowlist; renames require a deprecation comment plus an alias.

**Exit:** every diagnostic flows through the normalized schema; downstream consumers see no contract change.

### 7.7 Phase 6 — MCP static-mode

Estimated effort: 1.5 sessions.

Steps:

1. Identify which `packages/mcp/src/tools/` tools answer questions that can be answered from source alone. List them in `packages/mcp/STATIC-TOOLS.md`.
2. For each, add a `llui_static_*` variant that calls `@llui/compiler.analyzeFile()` instead of the live relay. The return shape must match the live variant exactly.
3. Add a dispatch table: tools available in both modes prefer live when a relay is present; fall back to static otherwise.
4. Update MCP tool tests: every static-mode tool gets a tool-level test using fixture projects; every live/both-mode tool gets coverage of both paths.

**Exit:** static-mode tools ship; live-mode tools unchanged; both have tests.

### 7.8 Phase 7 — Codify decisions

Estimated effort: 0.25 session.

Update [`shared.md`](./shared.md) §20.9 to record that the public ABI decision stays "deferred." Update §19.6 to record the module activation API as resolved. Update §2.5 of this file with the final decision text.

### 7.9 Status snapshot — module decomposition (feature-complete)

**Status:** v2c §2 module decomposition is **feature-complete**. Every load-bearing concern in the compiler flows through the `CompilerModule` registry. 15 modules LIVE across 4 packages (per §2.2). Both Phase 2b directions exercised. All helpers physically relocated into their module files. `transform.ts` shrank from ~4860 lines to ~1740 — the remainder is orchestrator + cleanupImports + shared utilities consumed by modules.

**Architecture reference:** §2.2 describes the four packages and their module ownership; §2.3 describes the registry-hook activation pattern. §7.9.2 below documents the Phase 2b chain ordering + three load-bearing invariants that surfaced during implementation.

**Contract test:** `packages/compiler/test/bundle-strip-goldens.test.ts` asserts that unregistered factories produce no emission, registered factories produce their expected emission, and always-on modules emit regardless.

**15 modules now LIVE in `transformLlui`'s production pipeline:**

| Module                                                                          | Activation                                              | Replaces                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `componentMetaModule`                                                           | `devMode` only                                          | inline `injectComponentMeta`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `stateSchemaModule({ stateSchema })`                                            | `shouldEmitAgentMetadata` + has stateSchema             | inline `injectStateSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `msgAnnotationsModule({ msgAnnotations })`                                      | `shouldEmitAgentMetadata` + non-null map                | inline `injectMsgAnnotations`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `msgSchemaModule({ msgSchema, effectSchema })`                                  | `shouldEmitAgentMetadata` + at least one schema         | inline `injectMsgSchema` + `injectEffectSchema`                                                                                                                                                                                                                                                                                                                                                                                                             |
| `schemaHashModule`                                                              | always (even non-agent — deterministic null-input hash) | inline `injectSchemaHash`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `maskLegendModule({ fieldBits, fieldBitsHi })`                                  | `fieldBits.size > 0 \|\| fieldBitsHi.size > 0`          | inline `legendProp` build inside `tryInjectDirty`                                                                                                                                                                                                                                                                                                                                                                                                           |
| `compilerStampModule`                                                           | always (umbrella mandatory)                             | inline `injectCompilerEmittedMarker`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `eachMemoModule({ fieldBits, viewHelperNames, viewHelperAliases })`             | `fieldBits.size > 0 \|\| fieldBitsHi.size > 0`          | inline `tryWrapEachItemsWithMemo` (top-down via `transformCallEnter`)                                                                                                                                                                                                                                                                                                                                                                                       |
| `structuralMaskModule({ fieldBits, viewHelperNames, viewHelperAliases })`       | `fieldBits.size > 0`                                    | inline `tryInjectStructuralMask` for each/branch/scope/show (top-down via `transformCallEnter`)                                                                                                                                                                                                                                                                                                                                                             |
| `textMaskModule({ fieldBits, viewHelperNames, viewHelperAliases, lluiImport })` | always                                                  | inline `tryInjectTextMask` (top-down via `transformCallEnter`)                                                                                                                                                                                                                                                                                                                                                                                              |
| `itemDedupModule({ viewHelperNames, viewHelperAliases })`                       | always                                                  | inline `tryDeduplicateItemSelectors` (top-down via `transformCallEnter`)                                                                                                                                                                                                                                                                                                                                                                                    |
| `elementRewriteModule({ importedHelpers, fieldBits, fieldBitsHi })`             | always                                                  | inline `tryTransformElementCall` — thin wrapper; the 1500+ lines of helpers (`analyzeSubtree`, `classifyKind`, subtree-collapse / template-clone machinery) still live in transform.ts and are imported by the module (top-down via `transformCallEnter`)                                                                                                                                                                                                   |
| `rowFactoryModule({ viewHelperNames, viewHelperAliases, filename, source })`    | always                                                  | inline `tryEmitRowFactory` — thin wrapper; the 570-line function + private helpers (`rewriteRoot`, `containsStructuralCall`, `_containsSelectorBind`) still live in transform.ts. First production module using **bottom-up `transformCall`** (decomp-11's exit hook) — runs after `elementRewriteModule` has rewritten the render body's children into `elTemplate(...)` calls.                                                                            |
| `coreSynthesisModule({ fieldBits, fieldBitsHi, lluiImport })`                   | always                                                  | inline `tryInjectDirty` — thin wrapper for the **co-emitted core trio** (`__update`, `__handlers`, `__prefixes`). The 600+ lines of helpers (`tryBuildHandlers`, `buildCaseHandler`, `buildUpdateBody`, `buildPrefixesProp`, `computeStructuralMask`) stay in transform.ts per v2c §7.9.2 decision (b). Resolves the (a)/(b) decision in favour of (b): co-emitted core synthesis stays inline by design; the registry owns the call path via thin wrapper. |

**Registry-conflict identity fix** (surfaced during decomp-19): conflict-detection previously keyed `(field, target)` by `${pos}-${end}`. After `coreSynthesisModule.transformCallEnter` rewrites a `component()` call via the factory, the resulting node is synthetic (pos=-1, end=-1). Two synthetic component() calls in one file hashed to the same key → false conflict. **Fix**: `ModuleRegistry.run`'s emission-conflict map now keys by `ts.CallExpression` object identity (`Map<ts.CallExpression, Map<string, string>>`) for per-target contributions, with a separate map for file-global. Synthetic nodes compare correctly. Position info preserved separately by switching `tryInjectDirty`'s return from `createCallExpression` to `updateCallExpression` — the new node inherits the original's `pos`/`end`, so `componentMetaModule.emit` can still extract the line number for `__componentMeta.line`.

**Phase 2b/per-target invariant** (surfaced during decomp-15): when transformCall hooks rewrite calls, `ts.visitEachChild` rebuilds ancestor nodes. Any per-target module that captures `ts.CallExpression` refs to `component()` during the visitor phase (Phase 2) gets stale refs once Phase 2b runs. **Fix**: per-target modules collect their targets in `emit` by walking `analysis.sourceFile` (which is the post-Phase-2b tree). The shared helper is `_shared.ts`'s `findComponentCalls`. Six modules (`component-meta`, `compiler-stamp`, `state-schema`, `msg-schema`, `msg-annotations`, `schema-hash`) refactored to this pattern in decomp-15.

**Notes on the table:**

- The `componentMeta`, `stateSchema`, `msgAnnotations`, `msgSchema`, `schemaHash`, `bindingDescriptors` rows now live in opt-in sibling packages (`@llui/compiler-introspection`, `@llui/compiler-devtools`) and activate via the registry-hook factories described in §2.3.
- The `eachMemo`, `itemDedup`, `structuralMask`, `textMask`, `elementRewrite`, `rowFactory`, `coreSynthesis`, `maskLegend`, `compilerStamp` rows live in `@llui/compiler` (always-on dom modules).
- The `Activation` column describes the registry-level gate; the `Replaces` column documents what inline code the module supplanted.

### 7.9.2 Phase 2b chain ordering reference

For modules using `transformCallEnter` / `transformCall`, declaration order is observable. The production order is:

```
each() call:
  enter chain (top-down):
    1. eachMemoModule         memo-wrap items accessor
    2. itemDedupModule        hoist __sN/__aN in render body
    3. structuralMaskModule   inject __mask on options
  recurse into children:
    elementRewriteModule fires on div() / button() / etc.
    textMaskModule fires on text() calls
  exit chain (bottom-up):
    rowFactoryModule          emit row-factory shape (needs post-element-rewrite render body)

component() call:
  enter chain:
    coreSynthesisModule       inject __update / __handlers / __prefixes
  emit phase merges per-target contributions:
    componentMeta, compilerStamp, stateSchema, msgSchema,
    msgAnnotations, schemaHash (via findComponentCalls on post-Phase-2b SF)
```

**Invariants that bit (and were fixed):**

1. **Per-target reference identity** (decomp-15): per-target modules must capture their `ts.CallExpression` targets in `emit` by walking `analysis.sourceFile` (the post-Phase-2b tree), not in the visitor phase. Phase 2b's `ts.visitEachChild` rebuilds ancestor nodes when any descendant rewrites, invalidating visit-captured refs. The shared helper is `_shared.ts`'s `findComponentCalls`.

2. **Synthetic-node conflict identity** (decomp-19): the registry's emission-conflict map keys `(field, target)` by `ts.CallExpression` object identity, not by `${pos}-${end}`. Synthetic nodes produced by Phase 2b have pos=-1 and would otherwise hash-collide. Position info is preserved separately by using `f.updateCallExpression` (not `createCallExpression`) when rewriting calls — the new node inherits the original's `pos`/`end`.

3. **Sentinel edit for Phase 2b rewrites**: when a module rewrites a call but the umbrella's visitor doesn't otherwise push to `edits`, the umbrella reads the module's slot post-`registry.run` and pushes a zero-width sentinel edit so the per-statement-diff downstream doesn't short-circuit on `edits.length === 0`.

### 7.9.1 Implementation history

Module decomposition shipped across 30 commits (v2c/decomp-1 through v2c/decomp-28 plus a few `decomp-Z` codification commits). The migration ran in three broad phases:

1. **Registry primitive + module shape** (decomp-1..12) — `CompilerModule` interface, `ModuleRegistry`, the three hook types (`preTransform`, `transformCallEnter`, `transformCall`), unit tests proving dispatch + ordering + chain composition.
2. **Module migrations** (decomp-13..19) — pulled each inline concern out of `transform.ts` into a CompilerModule. Three patterns emerged: pure emission (msg-schema, state-schema, etc.), per-call rewrite (element-rewrite, row-factory), and co-emitted core synthesis (the `__update`/`__handlers`/`__prefixes` trio).
3. **Pure-refactor code moves** (decomp-20..28) — relocated module implementations into their final package files. Element-rewrite (1500 lines) + core-synthesis (1200 lines) + row-factory (570 lines) physically moved; then the four sibling packages were scaffolded; then the introspection + devtools + ssr modules moved into their packages; then the registry-hook activation API.

The final architecture (§2.2 / §2.3) differs from the original design in two ways documented in §2.2.1: the `compiler-core` package collapsed into `@llui/compiler` (always-on modules don't benefit from package separation), and `compiler-agent` was renamed `compiler-introspection` (the compile-time concern is metadata for any introspector, not "agent-specific" code).

Earlier in-flight handover notes are preserved in git history (`docs/proposals/v2-compiler/v2c.md` at decomp-9, decomp-12, decomp-19 for representative snapshots) but no longer needed as forward-looking guidance.

---

## 8. Failure paths

### 8.1 If module decomposition reveals shared state across modules

The shape in §2.1 assumes modules accumulate findings independently. If `agent`'s analysis turns out to require `core`'s path information, that's a module dependency, not a violation — `agent` declares `core` as a dependency per §2.4 and the activation graph enforces order.

But if `agent` needs to _modify_ `core`'s emissions (or vice versa), the §2.1 emission-conflict rule fires and the design is wrong. Resolution: introduce a single coordinator module that merges, or change the contract so each module owns disjoint output fields.

### 8.2 If a diagnostic ID needs to rename

This is a deprecation cycle, not a free edit. Add the new ID alongside the old; the old emits the new ID as `relatedInformation` for one minor version; remove the old in the next minor. This is the §3 "Stable IDs" commitment in action.

### 8.3 If `core()` defaults break an existing project

This means the project was implicitly depending on a non-default module being enabled. The codemod should detect the old plugin config's options and synthesize the right `modules: [...]` array. If a project was passing options the codemod doesn't recognize, the migration falls back to "explicitly enumerate the modules you need" with a guided error message.
