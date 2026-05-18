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

v2c is done when **all** of the following hold:

- [ ] `@llui/compiler` internals refactored into four packages: `@llui/compiler-core`, `@llui/compiler-agent`, `@llui/compiler-ssr`, `@llui/compiler-devtools`.
- [ ] The §2.1 `CompilerModule` interface is in place. Visitor + emission ordering deterministic per §2.1.
- [ ] `llui.config.ts` shape per §2.3 honored. `defineConfig` enforces the factory-call convention. `modules: []` is a hard error.
- [ ] `core()` defaults work — a project without any `llui.config.ts` still compiles correctly with `[core(), devtools()]` enabled.
- [ ] `@llui/compiler-agent` ships disabled-by-default; existing projects don't gain agent emissions unless they enable the module. Conversely, a project that _had_ `__msgSchema` emission today (via the legacy code in `packages/vite-plugin/src/msg-schema.ts`) keeps it after the codemod adds `agent()` to its config.
- [ ] §3 diagnostic schema applied to all v2a + v2b + v2c diagnostics. Every diagnostic has stable ID, severity, category, location, optional fixes. ESLint, MCP, and CLI translators consume the same shape.
- [ ] §4 MCP static-mode: every existing tool in `packages/mcp/src/tools/` that's answerable from source has a `llui_static_*` variant; the live/static dispatch is wired so tools available in both modes prefer live. No live-mode tool is removed.
- [ ] §2.5 module-ABI public-API decision recorded: internal-only at v1, no `extending.md` shipped. The decision is documented in this file plus [`shared.md`](./shared.md) §20.9.

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

---

## 8. Failure paths

### 8.1 If module decomposition reveals shared state across modules

The shape in §2.1 assumes modules accumulate findings independently. If `agent`'s analysis turns out to require `core`'s path information, that's a module dependency, not a violation — `agent` declares `core` as a dependency per §2.4 and the activation graph enforces order.

But if `agent` needs to _modify_ `core`'s emissions (or vice versa), the §2.1 emission-conflict rule fires and the design is wrong. Resolution: introduce a single coordinator module that merges, or change the contract so each module owns disjoint output fields.

### 8.2 If a diagnostic ID needs to rename

This is a deprecation cycle, not a free edit. Add the new ID alongside the old; the old emits the new ID as `relatedInformation` for one minor version; remove the old in the next minor. This is the §3 "Stable IDs" commitment in action.

### 8.3 If `core()` defaults break an existing project

This means the project was implicitly depending on a non-default module being enabled. The codemod should detect the old plugin config's options and synthesize the right `modules: [...]` array. If a project was passing options the codemod doesn't recognize, the migration falls back to "explicitly enumerate the modules you need" with a guided error message.
