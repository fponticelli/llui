# v2c — Module System, Diagnostic Schema, MCP-as-Adapter

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

### 2.2 The four initial modules

**`@llui/compiler-core`** (always on)

- Reactivity analysis (path collection, `__prefixes` emission)
- Mask injection on structural primitives (`each`, `show`, `branch`, `scope`)
- `__update` and `__handlers` synthesis on `component()` calls
- `elSplit` and `elTemplate` rewrites on element helper calls
- Core diagnostics: `bitmask-overflow`, `static-items`, `static-on`, `each-closure-violation`, `pure-update-function`, `subapp-requires-reason`, `state-mutation`, exhaustive-update, exhaustive-effect-handling, `no-let-reactive-accessor`, `no-sample-in-accessor`, plus v2b's `opaque-view-call`, `helper-cycle`, etc.

**`@llui/compiler-agent`** (opt-in)

- `__msgSchema` emission from `Msg` discriminated union types
- `__msgAnnotations` emission from JSDoc / decorator metadata
- Agent diagnostics: `agent-msg-resolvable`, `agent-emits-drift`, `agent-example-on-payload`, `agent-missing-intent`, `agent-warning-on-confirm`, `agent-nonextractable-handler`, `agent-optional-field-undocumented`, `agent-tagsend-translator-missing`, `agent-exclusive-annotations`

**`@llui/compiler-ssr`** (opt-in)

- `__renderToString` emission (currently inline in the Vite plugin's transform)
- Hydration-boundary validation (state serializability, lifecycle ordering)
- SSR-specific diagnostics

**`@llui/compiler-devtools`** (opt-in, defaults to on in dev mode)

- Trace instrumentation: `_eachDiffLog`, `_disposerLog`, `_effectTimeline`, `_coverage` hook insertion
- Per-component metadata for the debugger
- Stripped entirely in production builds

### 2.3 Activation

`llui.config.ts` declares which modules are active. **Every module is a zero-arg-default factory** — there is no "pass the bare module value" shorthand. One canonical spelling beats a bimodal API that splits an LLM author's probability mass:

```ts
import { defineConfig } from '@llui/compiler'
import core from '@llui/compiler-core'
import agent from '@llui/compiler-agent'
import devtools from '@llui/compiler-devtools'

export default defineConfig({
  modules: [
    core(),
    agent({ msgAnnotations: 'jsdoc' }),
    devtools({ enabled: process.env.NODE_ENV !== 'production' }),
  ],
})
```

`core()` with no args is a complete declaration; the call is mandatory. The factory shape is enforced by the `defineConfig` parameter type — passing the bare module value is a TypeScript error with a remediation message ("call this module as a function, e.g. `core()`").

The compiler resolves the module list at init time and only loads enabled modules. Bundle output from a project without the `agent` module contains no `__msgSchema` fields, no `__msgAnnotations`, no agent-specific code paths.

**Full config shape and default behavior.**

```ts
interface CompilerConfig {
  // Module list. Order is observable (§2.1). If omitted entirely, defaults
  // to [core(), devtools({ enabled: process.env.NODE_ENV !== 'production' })].
  modules?: ResolvedModule[]

  // Root used for project-relative source map sources[] ([`shared.md`](./shared.md) §6.4).
  // If omitted, resolved by walking up from the config file's directory;
  // if the config file itself is missing, the root is the nearest ancestor
  // containing a package.json with a workspaces field, falling back to the
  // bundler's resolved root (Vite's `config.root`).
  projectRoot?: string

  // Override the supported TS version range (rarely needed).
  typescript?: { version?: string; configPath?: string }

  // Cache cap; see [`shared.md`](./shared.md) §8.2.
  cache?: { maxBytes?: number }

  // Manifest version-skew policy override; see [`shared.md`](./shared.md) §14.4.
  versionSkewPolicy?: 'error' | 'warn'
}
```

**Missing-config behavior.** `llui.config.ts` is optional. When absent, the compiler boots with the defaults above: `core` + `devtools` (dev-only) modules, project root auto-detected, default cache cap. This means an existing project that runs the codemod and ships _without_ writing a config file still gets correct behavior — the codemod creates a config file only when needed (when a module override is detected from the old plugin config).

A config file with `modules: []` (explicit empty array) is a hard error — the user has expressed an intent (no modules) that produces no transformations and therefore no `__compilerVersion`, which would silently degrade every component to `genericUpdate` per [`v2b.md`](./v2b.md) §5. The error tells the user to remove the `modules` key (to get defaults) or to include at least `core()`.

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

### 7.9 Handover note — module decomposition (in progress)

**Status as of the v2c-decomposition-primitive commit:** Phase 1 (paper mapping) + Phase 2 (registry primitive) + a Phase 3 proof-of-concept module have landed. The actual `transform.ts` decomposition + package skeletons remain deferred.

**What's now in place:**

- **`packages/compiler/MODULE-MAPPING.md`** — paper mapping of every file in `packages/compiler/src/` and every section of `transform.ts` (5 588 lines) to its destination module (core / agent / ssr / devtools / shared). Cross-module dependency graph + 4 open issues this mapping surfaced (cross-file-resolver misnaming, schema-hash straddle, integrity-marker split, connect-pattern pre-pass).
- **`packages/compiler/src/module.ts`** — `CompilerModule` interface, `AnalysisContext`, `EmissionContribution`, `EmissionContext`, `FileAnalysis`, `DiagnosticDefinition`. `ModuleRegistry` class with: single-pass AST dispatch (O(nodes), not O(modules × nodes)), per-module slot accumulators, emission-conflict detection (`llui/module-emission-conflict`), `dependsOn` verification at construction, `runtimeImports` union with dedup. 12 unit tests in `test/module-registry.test.ts`.
- **`packages/compiler/src/modules/reactive-paths.ts`** — proof-of-concept module that owns `__prefixes` emission. Reuses the existing `collectStatePathsFromSource` collector and emits an `ArrayLiteralExpression` of `(s) => s.<path>` arrow functions. 4 validation tests in `test/poc-module-prefixes.test.ts` compare the POC module's output against the monolithic `transformLlui` for representative fixtures; path _sets_ match across both pipelines.

**What the POC surfaced (carry forward):**

- The monolith emits optional-chained accessors (`s?.user?.name`) for non-leaf segments — defends against undefined intermediates during prefix computation. The POC currently emits plain access (`s.user.name`). **The production reactive-paths module must mirror the optional-chain form** for byte-equivalent output. `buildPrefixAccessor` in `modules/reactive-paths.ts` is the change site.
- ~~The current `EmissionContribution` shape is global (one value per `field` per file). For per-component emission (the common case when a file has multiple `component()` calls), the shape needs to carry a target — either an explicit `ts.CallExpression` reference or an indexable list.~~ **Resolved in v2c/decomp-2 (component-meta module landing).** `EmissionContribution` now carries an optional `target?: ts.CallExpression` field. When absent, the contribution is file-global (the common case — `__prefixes`, `__msgSchema`, `__schemaHash`). When present, the umbrella's merger writes the field into that specific `component()` call's config-arg object literal. Conflict detection is keyed on `(field, target)` tuples — same field across different targets is permitted (e.g. `__componentMeta` for two `component()` calls in one file); same field on the same target is the hard error.

**Modules now living in `packages/compiler/src/modules/`:**

| Module                          | Concern                                         | Inputs source                                                                                                     | Field emitted     | Target                                                   | Status                                                                 |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `reactive-paths` (POC)          | `__prefixes` array of stable closures           | `collectStatePathsFromSource` on the source file                                                                  | `__prefixes`      | file-global                                              | POC; not wired into production transform                               |
| `schema-hash` (v2c/decomp-1)    | SHA-256 hash over msg+state+annotations for HMR | Sibling-module slot (`SCHEMA_HASH_INPUTS_SLOT`); empty until msg-schema/state-schema/msg-annotations modules ship | `__schemaHash`    | file-global                                              | Validated against `computeSchemaHash`; awaits sibling producer modules |
| `component-meta` (v2c/decomp-2) | `{ file, line }` per `component()` call         | `CallExpression` visitor finds calls; emit reads `getLineAndCharacterOfPosition`                                  | `__componentMeta` | **per-call** (target = the `component()` CallExpression) | First per-component-targeted emission; validates the `target?` shape   |

**What remains for the full decomposition push:**

1. **Package skeletons.** Four sibling packages — `packages/compiler-core/`, `packages/compiler-agent/`, `packages/compiler-ssr/`, `packages/compiler-devtools/`. Each with its own `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`. Wire into pnpm workspace + turbo. Reuse the v2a skeleton pattern from `packages/compiler/`.
2. **Migrate the contents per MODULE-MAPPING.md.** Each file in the mapping table goes to its named destination. The monolith decomposes section by section, with the per-section line ranges in §7.9 above. Each move is a separate commit so regressions are bisectable.
3. **Wire `transformLlui` to the registry.** Today it does the work inline; after decomposition it instantiates a `ModuleRegistry` from the config, calls `registry.run(sourceFile)`, and merges emissions into the `component()` call literal. The per-statement-diff edit emission machinery stays at the umbrella level.
4. **`llui.config.ts` shape + factory-call enforcement** (v2c §2.3 / Phase 4 of the original roadmap). `defineConfig({ modules: [core(), agent(), ...] })`. Missing-config → `[core(), devtools()]` defaults. `modules: []` → hard error. Test fixtures cover every path.
5. **Bundle-size goldens.** A fixture project with `modules: [core()]` (no agent / no ssr / no devtools) produces a bundle that contains _zero_ references to `__msgSchema`, `__renderToString`, or `_eachDiffLog`. Asserted by reading `dist/` and grepping. This is the §2.2 "stripping the module removes the whole pipeline" guarantee.

**Pick order — status as of the v2c-agent-modules commit.**

1. ~~**Schema hash** — 37 lines, fully covered by existing tests, agent-only.~~ **Done in v2c/decomp-1.** Module now LIVE in production via v2c/decomp-5.
2. **`reactive-paths` (the POC)** — optional-chain emission fixed in v2c/bridge-1; the module now produces byte-equivalent `s?.user?.name` accessors. Promotion to production still pending — the monolith's `__prefixes` emission (via `buildPrefixesProp` + structural-mask code in `rewriteRoot`) is more entangled than the agent inline injectors and migrates as part of step 7.
3. ~~**`msg-annotations` + `msg-schema`** — the agent's core load.~~ **Done in v2c/decomp-4 + v2c/decomp-5.** `msgAnnotationsModule` + `msgSchemaModule` (handling both Msg and Effect schemas) ship as factory modules consuming pre-extracted inputs. `schemaHashModule` is now LIVE — five inline injectors (`injectMsgSchema`, `injectMsgAnnotations`, `injectStateSchema`, `injectEffectSchema`, `injectSchemaHash`) deleted from `transform.ts`. Agent pipeline runs entirely through the registry bridge.
4. ~~**`binding-descriptors`** — agent's largest pre-pass concern.~~ **Done in v2c/decomp-7.** Resolved the §2.1 "preTransform vs visitor" open question via option (a) from MODULE-MAPPING.md: `CompilerModule` now carries an optional `preTransform?(ctx, sf) → sf` hook that fires before the visitor walk. The registry's `run()` threads each module's preTransform output through subsequent modules; the visitor then walks the final post-transform AST. `bindingDescriptorsModule` wraps `injectScopeVariantRegistrations` + `tagDispatchHandlers`. The umbrella reads the module's slot (`BINDING_DESCRIPTORS_SLOT`) to surface the `scopeRegistrationsInjected` flag for `cleanupImports`.
5. ~~**The first registry-into-`transformLlui` wire-up.**~~ **Done in v2c/bridge-2.**
6. ~~**`component-meta`** — promote to production.~~ **Done in v2c/bridge-2.**
7. **Everything else in `transform.ts`** — agent pipeline complete; reactive-paths, `__update`/`__handlers` synthesis, element-helper rewrites, template-clone, row-factory, and dev-only instrumentation hooks remain. **`__maskLegend` migrated to `maskLegendModule` in v2c/decomp-9** — first non-agent factory module shipped; demonstrates the registry handles core-concern fields (the legend gates on the file-level reactive-path count rather than agent-mode). The inline `legendProps` builder + `legendProp` slot deleted from `tryInjectDirty`; the registry's `applyRegistryEmissions` splices `__maskLegend` into the same config-arg literal `tryInjectDirty` returns.

**Modules now LIVE in `transformLlui`'s production pipeline:**

| Module                                         | Activation                                              | Replaces                                          |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `componentMetaModule`                          | `devMode` only                                          | inline `injectComponentMeta`                      |
| `stateSchemaModule({ stateSchema })`           | `shouldEmitAgentMetadata` + has stateSchema             | inline `injectStateSchema`                        |
| `msgAnnotationsModule({ msgAnnotations })`     | `shouldEmitAgentMetadata` + non-null map                | inline `injectMsgAnnotations`                     |
| `msgSchemaModule({ msgSchema, effectSchema })` | `shouldEmitAgentMetadata` + at least one schema         | inline `injectMsgSchema` + `injectEffectSchema`   |
| `schemaHashModule`                             | always (even non-agent — deterministic null-input hash) | inline `injectSchemaHash`                         |
| `maskLegendModule({ fieldBits, fieldBitsHi })` | `fieldBits.size > 0 \|\| fieldBitsHi.size > 0`          | inline `legendProp` build inside `tryInjectDirty` |

The `injectCompilerEmittedMarker` (emits `__lluiCompilerEmitted` + `__compilerVersion`) remains inline as the only umbrella-level always-on emission. A `compiler-shared` mandatory-module pattern could absorb it; not load-bearing for this push.

**Lines of `transform.ts` removed by the agent-pipeline migration:** ~300 (5 inline injectors + 2 literal-builder helpers + duplicate computeSchemaHash call site). The monolith now contains zero agent-schema emission logic; that work lives in `modules/{state,msg-annotations,msg-schema,schema-hash}.ts`.

**Bridge's reusable shape (for whoever picks up step 2/3/4/7).**

```ts
// In transformLlui setup:
const activeModules: CompilerModule[] = []
if (devMode) activeModules.push(componentMetaModule)
// future: if (emitAgentMetadata) activeModules.push(msgSchemaModule, ...)
const registry = new ModuleRegistry(activeModules)
const registryResult = registry.run(sourceFile)
const { emissionsByTarget, globalEmissions } = indexEmissions(registryResult.emissions)

// Inside the component() visitor branch, after the existing inject* chain:
result = applyRegistryEmissions(result ?? node, node)
```

When a future migration deletes an inline injector (e.g. `injectMsgSchema`), it does so AFTER registering the module that owns its field. The `applyRegistryEmissions` call site need not change — it picks up the new emission automatically.

The MODULE-MAPPING.md table is the contract — when a file leaves the monolith it goes to the destination named there. Disagreements are reflected in MAPPING amendments before code lands, not in code that drifts.

### 7.9.1 Earlier handover (v2c-partial commit, retained for history)

**Status at this commit:** the module-decomposition phases (1–4 above) are unstarted. The diagnostic schema (Phase 5) and MCP static-mode (Phase 6) shipped without it. The decision to defer was a scope call — module decomposition is the largest single piece of v2c and is genuinely independent of the schema + MCP work that _does_ ship in this push.

**What's actually there to refactor.** The engine today is `packages/compiler/src/` with one entry per concern: `collect-deps.ts`, `binding-descriptors.ts`, `msg-schema.ts`, `msg-annotations.ts`, `state-schema.ts`, `schema-hash.ts`, `accessor-resolver.ts`, `cross-file-resolver.ts`, `cross-file-walker.ts`, `manifest.ts`, `compiler-cache.ts`, `diagnostic.ts`, `version.ts`, plus the monolithic `transform.ts` (5.5 k lines). The decomposition pulls these into four module packages:

- **`@llui/compiler-core`** absorbs everything that isn't agent / ssr / devtools: `collect-deps`, `binding-descriptors`, `accessor-resolver`, `cross-file-walker`, `cross-file-resolver`, `manifest`, `compiler-cache`, `diagnostic`, `state-schema`, `version`, plus the ~80% of `transform.ts` that handles mask injection / element rewrites / `__update`-synthesis / template clone / row factory / per-statement edits.
- **`@llui/compiler-agent`** absorbs `msg-schema`, `msg-annotations`, `schema-hash`, plus the agent-specific emission paths in `transform.ts` (the `injectMsgSchema`, `injectMsgAnnotations`, `injectSchemaHash`, `__bindingDescriptors` work).
- **`@llui/compiler-ssr`** absorbs the SSR-specific bits in `transform.ts` (the `'use client'` directive handling, the `__renderToString` emission path).
- **`@llui/compiler-devtools`** absorbs the dev-only injection paths (the `_eachDiffLog` / `_disposerLog` / `_effectTimeline` / `_coverage` hooks).

A `MODULE-MAPPING.md` produced during Phase 1 paper-only would walk one fixture through each module's visitor — that's the validation gate before any code moves.

**Why it didn't ship in this push:** the refactor needs:

1. New `CompilerModule` interface design + visitor-registry implementation in `@llui/compiler` (or whatever the umbrella package becomes after the split). Phase 1.
2. Four new package skeletons + workspace + turbo wiring. Phase 2's setup.
3. The actual code move out of `transform.ts` — that monolith is what justifies the visitor-registry; doing it in-place without the registry produces two passes over the same AST (the original monolithic visitor and the per-module visitors).
4. `llui.config.ts` shape + factory-call enforcement + missing-config defaults + `modules: []` hard error. Phase 4.
5. Bundle-size goldens proving a `modules: [core()]` config strips agent/ssr/devtools emissions.

For a fresh agent: the visitor registry is the load-bearing primitive. Start by extracting one small visitor pattern (say, the `text()` mask injection) into a module shape, then validate the dispatcher routes correctly, _then_ decompose `transform.ts`. The reverse order (decompose first, register second) loses the test-net.

**v2c.md §2 is the authoritative design for that work — it has not changed.** This handover note is a status snapshot, not a redesign.

---

## 8. Failure paths

### 8.1 If module decomposition reveals shared state across modules

The shape in §2.1 assumes modules accumulate findings independently. If `agent`'s analysis turns out to require `core`'s path information, that's a module dependency, not a violation — `agent` declares `core` as a dependency per §2.4 and the activation graph enforces order.

But if `agent` needs to _modify_ `core`'s emissions (or vice versa), the §2.1 emission-conflict rule fires and the design is wrong. Resolution: introduce a single coordinator module that merges, or change the contract so each module owns disjoint output fields.

### 8.2 If a diagnostic ID needs to rename

This is a deprecation cycle, not a free edit. Add the new ID alongside the old; the old emits the new ID as `relatedInformation` for one minor version; remove the old in the next minor. This is the §3 "Stable IDs" commitment in action.

### 8.3 If `core()` defaults break an existing project

This means the project was implicitly depending on a non-default module being enabled. The codemod should detect the old plugin config's options and synthesize the right `modules: [...]` array. If a project was passing options the codemod doesn't recognize, the migration falls back to "explicitly enumerate the modules you need" with a guided error message.
