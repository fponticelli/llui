# Shared Architecture & Principles

Material common to all three sub-proposals (v2a, v2b, v2c). Read this before reading any sub-proposal file.

---

## 0. Engineering Principles (read first)

Everything in this proposal is subordinate to these. If a design decision conflicts with one of these principles, the principle wins and the design changes.

### 0.1 Test-driven development is not optional

For every module, function, runtime invariant, or diagnostic added:

1. **Define the shape first.** Type signatures, schema, public API. No code without a contract.
2. **Write one or more failing tests** that capture the intended behavior, including edge cases the contract implies. Tests live in a sibling `test/` folder, never alongside source.
3. **Implement until tests pass.** Don't add code that isn't covered by a failing-then-passing test.
4. **Refactor under the test net.** Tests stay green; internal shape may change freely.

Tests are how we know the system works. They are also the documentation that survives every refactor. A change that doesn't update or extend tests is incomplete by definition.

### 0.2 DRY is enforced at the architectural boundary, not at the line level

The current packages duplicate analysis engines (path walkers, mask reasoning, exhaustiveness checks) because the boundaries are wrong. The new architecture's primary correctness criterion: **no analytical question has more than one implementation in this repo.** If the Vite adapter, the ESLint adapter, the MCP server, and any future LSP all want to know "what paths does this component read?", there is exactly one function that answers it, in `@llui/compiler`. Adapters consume the answer; they never recompute it.

This is the test for DRY: when adding a new diagnostic or a new emitted field, ask _where does this reasoning live?_ If the answer is "in two places," the architecture is broken before the code is.

**One explicit carve-out:** the _runtime_ will carry a denormalized copy of some compiler outputs (`__msgSchema`, `__msgAnnotations`, `__prefixes`) on every `ComponentDef`. This is intentional, not a violation. The agent must be able to introspect a deployed app where the compiler isn't reachable. At build time the compiler is authoritative; at runtime the denormalized copy is authoritative. The compiler is the only writer of those fields, and the runtime never re-derives them — so the DRY principle holds for the _reasoning_, even though the _data_ is replicated. See §6.6.

### 0.3 Engineering excellence over engineering cost

Cost is real. It is not a deciding factor. When the correct design is harder, slower to ship, or requires more refactoring, we do the harder thing. The user-facing contract is the language; everything supporting it has to be load-bearing under any reasonable usage we can imagine. Shortcuts compound in this domain because reactivity bugs are silent — a hack today is a wrong-update tomorrow that someone wastes a day debugging.

Specifically reject:

- "Good enough for now" framing on anything user-visible
- Type assertions (`as`, `as unknown as`) where a real type would do
- `any` anywhere it isn't strictly unavoidable
- Eager API surface (adding options for cases that don't have a user yet)
- Bundle-size or runtime workarounds that paper over architectural smells

Accept:

- Slower initial ship to land the right shape
- Larger initial PRs when the change crosses architectural seams
- Breaking changes where the alternative is wrong-by-default
- Re-doing recently-shipped work when better information arrives

### 0.4 The runtime is the source of truth

Every invariant the system enforces should be enforced by the runtime where physically possible. Compiler diagnostics, lint rules, and IDE feedback are **earlier signals of the same invariants**, not separate enforcement layers. A team that disables every tool should still get a working, correct LLui app — just with less helpful feedback during development.

Concretely: if you find yourself writing a lint rule that catches a problem the runtime should reject, the work goes into the runtime, and the lint rule becomes a "warn earlier" wrapper around the same condition.

### 0.5 Explicit over implicit, especially for LLMs

LLui's authoring story targets LLMs as primary writers. Explicit syntactic shapes (function calls, arrow accessors, plain objects for messages) outperform implicit ones (decorators, templates, special files) for LLM accuracy. Every API choice should preserve this property. When in doubt, the more verbose-but-regular form wins.

---

## 1. Problem Statement

LLui today has two analytical artifacts that overlap in unhealthy ways, plus a third tool that is currently a thin relay but would need to grow an analyzer to gain offline ("static") capability:

- **`@llui/dom` (runtime)** — the source of truth for behavior. Correct.
- **`@llui/vite-plugin` (compiler)** — does AST transformation, mask analysis, code emission. The package today is roughly 9,200 lines across `transform.ts` (5,476 lines; the main per-file walker + emitter), `collect-deps.ts` (path collection), `binding-descriptors.ts`, `accessor-resolver.ts`, `cross-file-resolver.ts` (629 lines, scoped to msg/state type-alias resolution — _not_ general view-helper walking), `msg-schema.ts`, `state-schema.ts`, `schema-hash.ts`, `msg-annotations.ts`, `compiler-cache.ts`. Per-file for reactive analysis; cross-file _only_ for msg/state schemas. Tied to Vite.
- **`@llui/eslint-plugin` (lint, folder: `packages/eslint-plugin-llui/`)** — 41 rule files (~14,000 lines total). The ~15 type-aware rules (`bitmask-overflow`, `each-closure-violation`, `exhaustive-update`, `no-let-reactive-accessor`, ...) re-implement analysis that already exists in the Vite plugin. Tied to ESLint.
- **`@llui/mcp`** — today already a relay; tools call into the running runtime via `ctx.relay!.call(...)` (see `packages/mcp/src/tools/`). No TypeScript AST walking exists in `@llui/mcp` source. It needs a compiler dependency only if it gains a _static_ mode (analysis without a running app). The v2 architecture makes that mode possible; it does not remove existing analyzer code from this package.

Both plugins are optional. Teams that don't use Vite lose the compiler's transformations. Teams that don't run ESLint lose enforcement. The same per-file analytical questions ("what paths does this accessor read?", "is this view helper exhaustive?", "is this binding overflowing?") are answered twice across the Vite plugin and the type-aware ESLint rules. (The cross-file resolver in `vite-plugin/src/cross-file-resolver.ts` is _not_ duplicated in ESLint today — it only handles type-alias composition for Msg/State, and it stays inside the engine in v2; the duplication problem v2a fixes is the per-file walking.)

Concrete consequences observed in the field:

- Helpers defined in separate files can't have their state reads merged into the host component's `__prefixes` table. Workaround in user code: a "sentinel `show()`" with a `when` that `void`s every path the helper reads, registering them with the walker. The canonical example is dicerun2's `apps/web/src/pages/my-rolls/+Page.ts:2406` — a 50-line block voiding 38 state paths, plus two smaller sibling blocks at lines 2393 and 2401. dicerun2 contains roughly 30 `void s.X` occurrences across two files (`my-rolls/+Page.ts` and `studio/+Page.ts`).
- Lint rules drift from compiler behavior because they're reimplementations rather than queries against the engine.
- New tools (agent diagnostics, MCP static mode, future LSP) would require building yet another analyzer if the engine isn't extracted first.

The fix is not to add more rules or more adapters. It is to **factor the architecture so analysis lives in exactly one place, and every tool consumes its outputs.**

---

## 2. Vision

LLui is a language. Languages have compilers. The compiler is the source of truth for what counts as valid LLui code and for what gets emitted. Build tools and lint tools integrate with the compiler; they do not replace it.

The compiler:

- Is a library with a build-tool-agnostic core API
- Owns all static analysis (single-file and cross-file)
- Owns all code transformation
- Owns the diagnostic stream
- Is configurable via opt-in modules (agent, SSR, devtools)
- Stays in TypeScript, reading TypeScript source via the TypeScript Compiler API

The build-tool adapter (Vite first, others later) and the lint adapter (ESLint) become thin shims: they call the compiler's API from their host plugin hooks and translate its outputs into their respective host APIs. They contain zero analytical logic.

---

## 3. Non-Goals

To bound the scope of this work:

- **Not changing user syntax.** The component / view / update / element-helper shape stays. No JSX, no decorators, no template literals, no `.llui` files.
- **Not replacing TypeScript.** The compiler is written in TypeScript and reads TypeScript source via the public Compiler API.
- **Not building our own type-checker.** We consume TypeScript's. Reimplementing 200kloc of typechecker is years of work that delivers no end-user value.
- **Not making any package optional for correctness.** The runtime enforces. The compiler enforces. Adapters surface diagnostics. Teams that skip adapters lose feedback, never correctness.
- **Not rewriting in Rust or Go.** Native rewrites lose access to the TypeScript type-checker, which is load-bearing for cross-file analysis.
- **Not building a sidecar on-disk cache or a separate compiler process.** The compiler is a library invoked in-process by the host adapter's existing transform hook.
- **Not shipping an LSP, an `llui-compile` CLI, or additional bundler adapters in v2.** These are §17 phase-3 work, gated on a documented user need.

---

## 4. System Architecture

Three layers, organized by **kind of work**, not by host tool:

```
LANGUAGE LAYER
  @llui/dom              runtime; ships to browsers; always required
  @llui/compiler         static analysis + emission; build-tool-agnostic library;
                         invoked in-process by adapters

OPT-IN COMPILER MODULES (introduced in v2c)
  @llui/compiler-core      always on (reactivity, masks, prefixes, lifetimes)
  @llui/compiler-agent     opt-in (msg schemas, annotations, agent diagnostics)
  @llui/compiler-ssr       opt-in (__renderToString emission, hydration checks)
  @llui/compiler-devtools  opt-in (instrumentation hooks, defaults to on in dev)

INTEGRATION ADAPTERS
  @llui/vite               wires compiler into Vite (transform hook + HMR)

PRESENTATION ADAPTERS
  @llui/eslint-plugin      forwards compiler diagnostics into ESLint
  @llui/mcp                adapter; consumes compiler outputs (no AST walking)
```

The runtime stays in TS and ships as JS to browsers. The compiler stays in TS but runs only at build time and inside lint/MCP processes. Adapters are 100–300 line shims that translate.

---

## 5. Data Flow

For one source file going from user editor to running code:

```
src/Counter.ts                                user authors this
       │
       ▼  (Vite's transform hook calls compiler.compileFile)
@llui/compiler (in-process)                   reads source, queries type-checker,
       │                                       returns transformed TS + map + diagnostics
       ▼
Vite                                           sees transformed TS as the module's
       │                                       contents; bundles normally
       ▼
dist/                                          ships to browser
       │
       ▼
@llui/dom (runtime)                            executes
```

Critical properties:

- **The build tool's transform hook is the integration point.** No sidecar files on disk, no `tsconfig.json` path mappings, no parallel module graph. Vite's existing module-graph and HMR machinery are reused as-is. This is how Svelte, Vue SFC, Astro, MDX, and Solid all integrate; we follow the same pattern for the same reasons.
- **The compiler is a library, not a process.** It's instantiated once per Vite dev server (or once per ESLint process). It holds a per-file analysis cache; queries are synchronous after init.
- **In-memory cache only.** Analysis and emission are keyed by `(file-path, content-hash, config-hash)`. Cache lives in the compiler instance's memory; it dies with the process. There is no on-disk artifact for builds to "trust" or invalidate.
- **The IDE sees user source, not a transformed copy.** Go-to-definition, hover types, and TS errors land on the file the user is editing. The compiler never inserts itself between the editor and the source.
- **HMR is the build tool's HMR.** When user source changes, Vite calls `transform` again; the compiler emits a new module; Vite's module graph propagates. The compiler additionally exposes `getDependents(file)` so the adapter can invalidate downstream modules when a helper changes.
- **Source maps compose normally.** Compiler emits a map from transformed code → user source. Vite composes it with its own map. One source map composition, the same one every tool ecosystem already does.

Enforcement that the compiler ran isn't a build-time artifact check; it's a runtime check (introduced in v2b — see [`v2b.md`](./v2b.md) §14.1). A `ComponentDef` mounted by `@llui/dom` without the compiler-emitted fields fails fast with a clear error.

---

## 6. Compiler Internals

`@llui/compiler` exposes a small, pure-functional core API. Adapters call this API; the API does not call back into adapters.

### 6.1 Core API shape (illustrative, not prescriptive)

```ts
interface Compiler {
  // Boot: read llui.config.ts, build TS Program, register modules
  init(config: CompilerConfig): Promise<void>

  // Per-file query: full analysis for a source file. Synchronous after init.
  analyzeFile(path: string): FileAnalysis

  // Emit: produce the transformed source for a file (returns code + map + diagnostics)
  compileFile(path: string): EmittedFile

  // Reverse-deps query: which files transitively depend on this one
  // (used by build adapters for HMR cascade)
  getDependents(path: string): Set<string>

  // Diagnostics for the whole project, or for a single file
  getDiagnostics(scope?: string): Diagnostic[]

  // Watch hooks (called by adapter when host tool sees a file change)
  onFileChanged(path: string): void
  subscribe(listener: (change: CompilerChange) => void): () => void
}
```

The actual shape will evolve. The constraint: every adapter consumes through this API; no adapter reaches into the compiler's internals.

### 6.2 Compilation phases (per file)

1. **Parse + type-check** (delegated to TypeScript Compiler API).
2. **Single AST walk with module dispatch.** One traversal per file. Modules register handlers per `ts.SyntaxKind`; the walker dispatches each node to the union of registered handlers. Modules never re-walk.
3. **Analysis accumulation.** Each module accumulates findings into a per-file `FileAnalysis`. Results from independent modules merge by key (paths, diagnostics, emissions).
4. **Diagnostics.** Each module emits diagnostics for problems in its domain. Diagnostics are normalized into a single stream.
5. **Emission.** Each module declares its emissions (property additions to `ComponentDef`, helper imports, etc.). The emitter merges them into a single transformed source.
6. **Return.** Emitted source + source map + diagnostics returned to the caller. No disk I/O on the hot path.

### 6.3 Cross-file analysis

The cross-file walker and its view-helper termination rule are v2b territory. See [`v2b.md`](./v2b.md) §6.3.

### 6.4 Determinism

The compiler must be deterministic. Same inputs → same outputs, byte-for-byte. This is non-negotiable. Reproducible builds, source map stability, and CI cache correctness all depend on it.

Critical constraints:

- Bit positions in `__prefixes` are assigned by **sorted path order**, not iteration order over a `Map` or `Set`.
- File ordering inside cross-file aggregations is sorted by absolute path.
- Diagnostic ordering is by (file, line, column, message-id), sorted.
- Source map `sources[]` entries are **project-relative**, never absolute. Hostname, `$HOME`, and absolute `cwd` must not leak into emitted artifacts. The project root is determined by the location of `llui.config.ts`.
- No `Date.now()`, no random seeds, no environment variables read during emission. The compiler reads `llui.config.ts` once at init; everything downstream is a pure function of source + config.

Golden-file tests assert byte-equality with a committed expected output. Any nondeterminism breaks the test. A separate "double-emit" test compiles the same fixture twice in one process and asserts the two outputs are identical byte-for-byte (catches Map/Set ordering escapes).

### 6.5 Incremental updates

Watch mode maintains:

- A file-content hash map (skip re-analysis if hash unchanged)
- A type-Program checkpoint (reused across file changes when possible)
- A reverse-deps graph (when file X changes, re-emit X plus everything that transitively depends on X)

When a helper changes, the compiler:

1. Re-analyzes the helper file
2. If its exported path set changed, finds all transitively dependent components
3. Re-emits each dependent component (their `__prefixes` may have grown/shrunk)
4. Pushes invalidation events through `subscribe()` to all listening adapters

Vite adapter receives the events, calls `ctx.server.moduleGraph.invalidateModule()` for each, triggers HMR.

### 6.6 Runtime denormalization

Some compiler outputs are copied onto each `ComponentDef` at emission time so the runtime and agent can read them without re-querying the compiler:

- `__prefixes` (path bitmask table) — already exists today
- `__handlers` (fast-path update dispatch) — already exists today
- `__update` (merged update function) — already exists today
- `__msgSchema` and `__msgAnnotations` — already exist today
- `__compilerVersion` — **new in v2b**, used for the version check in [`v2b.md`](./v2b.md) §14.1

The runtime never recomputes any of these; it only reads them. The MCP server's "live" mode reads them from the running app. The MCP server's "static" mode (analyzing source without a running app) reads them from the compiler. Both paths return the same shape. This is the carve-out called out in §0.2 — the same data exists in two places by design, with the compiler as the sole writer.

---

## 7. Module System

Introduced in v2c. See [`v2c.md`](./v2c.md) §7 for the full design.

---

## 8. Build-Tool Integration

The compiler is invoked in-process by the host adapter. There is no on-disk cache, no parallel module graph, and no tsconfig surgery. The runtime version check ([`v2b.md`](./v2b.md) §14.1) is what guarantees the compiler ran; the integration is otherwise as plain as any other bundler plugin.

### 8.1 What the Vite adapter does

```ts
// Roughly 150 lines
export default function llui(): VitePlugin {
  let compiler: Compiler
  return {
    name: 'llui',
    async configResolved() {
      compiler = await createCompiler(readConfig())
      await compiler.init()
    },
    async transform(code, id) {
      if (!isLluiSource(id)) return null
      const result = compiler.compileFile(id)
      reportDiagnostics(result.diagnostics)
      return { code: result.code, map: result.map }
    },
    async handleHotUpdate(ctx) {
      compiler.onFileChanged(ctx.file)
      const dependents = compiler.getDependents(ctx.file)
      for (const dep of dependents) {
        const mod = ctx.server.moduleGraph.getModuleById(dep)
        if (mod) ctx.modules.push(mod)
      }
    },
  }
}
```

That's it. No AST manipulation, no transformation, no diagnostic logic. The compiler does everything; the adapter wires it into Vite's hooks.

### 8.2 In-memory caching

The compiler keeps a per-file cache keyed by `(absolute-path, content-hash, config-hash)`. A second `compileFile(path)` call on unchanged content returns the cached result without re-running TypeScript. Cache eviction is by least-recent-use under a configurable size cap (`cache.maxBytes` in `CompilerConfig`). No on-disk persistence — process restart re-warms.

**Default cap is measure-first.** The v2a spike (see [`v2a.md`](./v2a.md)) was intended to report cache size and hit rate against `dicerun2` (~49k LOC) and `decisive.space-2` (~28k LOC) under a representative editor session (cold start, 30 minutes of normal editing, ESLint adapter active). The default `maxBytes` was meant to be set to **2× the steady-state working set** measured on the larger project, rounded to a sensible MB number, and recorded back into [`v2a.md`](./v2a.md)'s measurement section.

**v2a status (as of 2026-05-17):** the cache measurement is **deferred to v2c**. v2a's engine extraction did not introduce a new per-file analysis cache — the existing `compiler-cache.ts` is a 37-line content-hash store unchanged from v0.2.0, and the engine remains AST-only ([`v2a.md`](./v2a.md) §2.2) so there is no TS Program retention to bound. The real per-file cache lands when v2c's `compiler-core` module replaces the monolithic walker with module-dispatched per-file analysis; its working set is the right thing to measure. Until then, the implementation accepts the user's `cache.maxBytes` if provided and otherwise treats the cache as unbounded — without the startup warn-once originally specified, because there is no v2a-era cache to undersize. Restore the warn-once when v2c lands the cache.

### 8.3 Other adapters (later)

Vite is the only build-tool adapter in v2. Other bundlers (esbuild, rollup, webpack), a standalone `llui-compile` CLI, and an LSP are phase-3 work, added only when a real user need is documented. The compiler API is build-tool-agnostic from day one, so adding adapters later is mechanical; we just don't pay the maintenance cost upfront.

---

## 9. Adapters

### 9.1 Memory and latency model

**Important correction to the cost framing.** Today's `@llui/vite-plugin` uses `ts.createSourceFile` per file (verified at `packages/vite-plugin/src/index.ts:68,136`); it does **not** hold a `ts.Program`. ESLint likewise does not use `parserServices`/the TypeChecker — every type-aware ESLint rule in the repo is in fact an AST-mirror rule (see `packages/eslint-plugin-llui/src/util/state-paths.ts:5-19`, which explicitly self-documents as a mirror of `vite-plugin/src/collect-deps.ts`). So a Program is not being _redistributed_ by v2a; it would be _introduced_ in two processes that do not have one today.

This narrows the engine design space. v2a does not need a Program at all to capture the duplication win — collapsing two AST scanners into one engine is the goal, and the engine can be AST-only just like today's vite-plugin. **v2a commits to that floor:** the v2a engine is AST-only; the ESLint adapter does not instantiate a Program. The TypeChecker dependency is genuinely v2b territory (cross-file walker, [`v2b.md`](./v2b.md) §6.3) and lands when the cross-file walker does — in the Vite adapter only, where it is already paid for by the per-file compilation. ESLint never gets a Program of its own in v2 unless a future ESLint rule requires it, at which point the cost goes in front of an open proposal.

**The remaining cost in v2a is process resident set + cold-start latency from holding the engine's per-file caches** (not a Program). v2a records two measurements (full procedure in [`v2a.md`](./v2a.md) implementation roadmap):

- **Resident set.** ESLint + Vite dev server (combined and individually) against `dicerun2`, before and after the engine split. The trigger for reopening the daemon design — a thing rejected for v2 as overengineering — is set in [`v2a.md`](./v2a.md) after the spike using the procedure: the lesser of (a) 1.5× the pre-split RSS or (b) an absolute number that brings combined RSS above 2GB on a 16GB developer machine.
- **Cold-start wall-clock.** `eslint <repo>` cold and `vite dev` cold, against `dicerun2`, before and after. Threshold: post-split cold-start must not exceed 1.25× the pre-split cold-start, measured median-of-5.

### 9.2 `@llui/eslint-plugin` as adapter

Every type-aware rule becomes a forwarder. Pure-AST style rules (`forgotten-spread`, `controlled-input`, `no-let-reactive-accessor`, ...) stay as before; they don't need the compiler. Each rule is honest about its category.

ESLint configs survive unchanged. Rule names, message IDs, and reported locations are stable. The implementation switches; the contract doesn't.

### 9.3 `@llui/mcp` as adapter

v2c work; see [`v2c.md`](./v2c.md) §9.3.

---

## 12. Diagnostic Schema

Will be lifted into `@llui/compiler` as the canonical shape in v2c. See [`v2c.md`](./v2c.md) §12. v2a-era diagnostics use the existing ad-hoc shapes; v2b adds its new diagnostics in the same ad-hoc shapes; v2c normalizes.

---

## 13. Source Maps

Two transformations sit between the user's source and the running browser code:

1. User source `src/Counter.ts` → compiler emission (in-memory, returned from `compileFile`)
2. Compiler emission → bundle output (Vite / future adapters)

Each stage produces a source map. Vite composes the maps the same way it composes any other plugin's output. The runtime's stack traces map back to the bundle; the bundler's source map maps to the compiler's emission; the compiler's source map maps to user source. Composition is standard SourceMap merge — the same path every other transform plugin uses.

Constraints already covered in §6.4:

- `sources[]` paths are project-relative.
- Map ordering and content are deterministic.

Stack-trace normalization for production runtime errors uses the same composed map; no LLui-specific source-map composition layer is introduced.

---

## 14. Versioning & Compatibility

### 14.1 Runtime vs. compiler

The runtime contract change (`__compilerVersion`, the `createInstance` versioning gate, `genericUpdate` fallback warn-once, `defineTestComponent()` for test fixtures, and the `track()` runtime stub) ships in **v2b**, not v2a. See [`v2b.md`](./v2b.md) §14.1 for the full design.

### 14.2 Cache invalidation

The in-memory cache (§8.2) is keyed by content hash and config hash. Process restart re-warms; there is no stale-cache risk by construction.

### 14.3 Module compatibility

v2c work; see [`v2c.md`](./v2c.md) §14.3.

### 14.4 Library manifest compatibility

`__llui_deps.json` carries a `version` field. The compiler reads only manifest versions it understands. Forward-incompatible manifest versions degrade differently depending on mode:

- **Dev mode** (Vite dev server, ESLint editor integration): FULL_MASK fallback at the import boundary, plus `llui/library-manifest-version-skew` as a warning. The app still runs; the developer sees the warning and upgrades their compiler.
- **CI / production build mode** (Vite build, ESLint `--max-warnings 0`): the same condition is a hard error. A production bundle that silently degrades to FULL_MASK because the consumer's compiler is stale would be a §0.5 "wrong-by-default" outcome — the build fails fast instead.

Mode is detected from the host adapter (Vite's `command === 'build'`, ESLint's process exit code policy) and is overridable in `llui.config.ts` via `versionSkewPolicy: 'error' | 'warn'`. The same dev/CI split applies to missing manifests (`llui/library-no-manifest`) and malformed manifests (`llui/library-manifest-malformed`).

This section is v2b-relevant; the manifest format itself is defined in [`v2b.md`](./v2b.md) §10.

---

## 15. Resilience and Blast Radius

The v2 architecture concentrates analytical logic into one engine. The upside is correctness via single-source-of-truth. The downside is that a compiler bug now breaks every adapter at once — Vite, ESLint, MCP. This section is the explicit design for failure modes.

### 15.1 Failure isolation within the compiler

- **Module exceptions are caught at the module boundary.** If a single module throws while analyzing a file, the compiler marks that file as _partially analyzed_, attaches an `llui/internal-module-error` diagnostic with the module name and stack, and continues with the remaining modules. Other files in the project are unaffected.
- **Per-file analysis is independent.** A throw inside one file does not stop analysis of unrelated files. The throwing file is reported as poisoned; its module is excluded from the build with a hard diagnostic. CI mode escalates poisoned files to build failure; dev mode keeps the rest of the app live.
- **Cross-file walker exceptions** (a malformed manifest, a type-checker crash on a generic) are caught at the walker boundary. The walker contributes FULL_MASK for the affected helper and emits a diagnostic; the consuming file still emits.

### 15.2 Manifest robustness

- Missing `__llui_deps.json` on an imported package → FULL_MASK at the boundary + `llui/library-no-manifest` warning. Not a build failure.
- Malformed manifest → same as missing, with a different diagnostic ID (`llui/library-manifest-malformed`).
- Manifest version too new → same as missing (`llui/library-manifest-version-skew`), with remediation to upgrade the consumer's compiler.

### 15.3 Adapter ↔ compiler version mismatch

The adapter declares the compiler API range it requires. At adapter init, if the loaded `@llui/compiler` is out of range, the adapter throws with a clear error message naming the conflict and the required upgrade. No silent fallback — the alternative is wrong-by-default behavior.

### 15.4 Dogfooding and beta channel

- The compiler ships on a beta tag for one minor cycle before being promoted to latest. Internal packages (`@llui/components`, the examples, any reference apps) consume the beta and surface regressions before public release.
- Every released compiler version is gated on a green run of:
  - Unit + golden-file + property tests
  - Full build and runtime test of every package in this repo
  - Full build and runtime test of the reference apps
  - Migration codemod against `dicerun2` (largest known consumer at ~49k LOC; carries the sentinel `show()` pattern in §1) **and** `decisive.space-2` (~28k LOC; secondary consumer with no sentinel usage today, exercises the migration path on a clean codebase)

### 15.5 Soak tests

Watch mode and the ESLint adapter both hold long-lived `Compiler` instances. A leak (TS Program retention, file-handle leaks, observer accumulation) shows up over hours, not minutes. CI runs a 4-hour soak against a fixture project on every release branch. Hard memory ceiling enforced; breaches block the release.

### 15.6 What we accept as residual risk

- A bug that only triggers under specific real-world type shapes we don't have in our fixtures. Mitigation: beta channel + reference apps.
- A `tsc` version interaction we haven't tested. Mitigation: declare a supported TS version range; CI runs against the whole range.
- A diagnostic whose message wording is misleading. Mitigation: stable IDs + documented messages; wording can change without breaking consumers.

---

## 16. Testing Strategy

### 16.1 Compiler

- **Unit tests per module.** Each compiler module has a test suite covering analysis, diagnostics, and emission. Fixtures live in `packages/compiler-<name>/test/fixtures/`.
- **Golden file tests.** For each fixture, the test compiles the fixture and asserts byte-for-byte equality with a committed expected output. Determinism is verified by this layer.
- **Double-emit tests.** Compile the same fixture twice in one process; assert byte-identical output. Catches Map/Set iteration-order escapes.
- **Property tests.** Generators produce random valid LLui components; the compiler must emit valid TS that parses cleanly and (when run) produces expected reactive behavior.
- **Cross-file fixtures.** Fixtures with multiple files exercise the cross-file analyzer. Includes circular imports, transitive helpers, library-boundary cases, and every `viaParams` shape from [`v2b.md`](./v2b.md) §10.4.
- **Integration with runtime.** A subset of compiled fixtures gets mounted in a real (jsdom) runtime and asserted against expected DOM updates after state changes.

### 16.2 Runtime test migration

Detailed in [`v2b.md`](./v2b.md) §16.2 — the migration of ~84 mount-using test files in `packages/dom/test/` ships with v2b alongside the `__compilerVersion` gate.

### 16.3 Adapters

- **Vite adapter:** integration tests that spin up a Vite dev server against a fixture project, dispatch a code change, assert HMR fires and dependent modules invalidate.
- **ESLint adapter:** rule tests using `RuleTester`. Compiler infrastructure is shared (one `Compiler` instance per `RuleTester` run); no per-rule re-implementations.
- **MCP adapter:** tool-level tests against fixture projects, both with a live runtime (via `@llui/agent-bridge`) and against static source. Assert tool outputs match expected schemas.

### 16.4 End-to-end

- A fixture monorepo with multiple packages exercises workspace + library-boundary scenarios.
- A "real app" test: a maintained ~10kloc reference app gets re-built on every commit, asserts no behavioral regression.

### 16.5 TDD discipline

For every new module, new diagnostic, or new emission output:

1. Write the test first. It must fail.
2. Implement until it passes.
3. Refactor freely while tests stay green.

A PR that adds production code without adding (or extending) tests does not merge.

---

## 18. Migration from 0.2.0

This is a major version bump (0.x → 1.0). There is no compat mode — the alternative is maintaining two code paths and the bugs that hide between them. We invest in a codemod and clear release notes instead.

**Migration cost is honest about its floor and its ceiling.** [`v2b.md`](./v2b.md) §6.3 commits to a _measurement_ (the validation gate) before locking the cross-file walker's rule; [`v2b.md`](./v2b.md) §10 commits to a _schema validation_ against three real `@llui/components` shapes before freezing the manifest format. Both of those measurements feed the migration story: the floor is "trivial codemod" (verified against all 11 in-repo consumers, see [`v2a.md`](./v2a.md)); the ceiling is "annotate dozens of helpers with explicit return types before the diagnostic flood clears CI" — [`v2b.md`](./v2b.md) §6.3 sets which of those a given consumer codebase sees.

The full migration plan is split: [`v2a.md`](./v2a.md) §18 covers the v2a-pass migration (vite.config.ts rewrite, package.json, optional `llui.config.ts`); [`v2b.md`](./v2b.md) §18 covers the v2b-pass migration (sentinel marking, optional return-type annotations).

### 18.1 What stays the same for users

Across v2a and v2b combined:

- The source-code shape of components, views, updates: identical.
- Runtime imports from `@llui/dom`: identical.
- Element helpers, primitives, View bag: identical.
- ESLint rule names and message IDs: identical.

A user who runs the v2a codemod and updates their `vite.config.ts` ships unchanged source code on top of the v2a architecture. The v2b codemod is additive (annotations + sentinel markers) — still no behavioral changes in user source.

### 18.2 Release sequencing

- Beta channel for one minor cycle (§15.4). Internal packages and reference apps migrate first.
- Codemod runs cleanly against all 11 in-repo consumers as a v2a-day-one exit gate. Against `dicerun2` and `decisive.space-2` before the stable v2b release.
- The old `@llui/vite-plugin` package is published with a deprecation notice at v1.0 release, then deleted from the monorepo one minor version later.

---

## 19. Open Questions

These are deferred to implementation. Decisions made here should be documented in follow-up PRs that update the relevant phase doc.

### 19.1 Workspace handling

A monorepo with many `package.json`s might want one shared `Compiler` instance covering the whole workspace or one per package. Per-package is simpler; shared catches cross-package errors faster. Implementor picks based on the actual workspace shape we encounter; document the choice.

### 19.2 Cycle detection messaging

When `A.ts` calls helper from `B.ts` which calls helper from `A.ts`: the walker terminates by `visited` set, and emits `llui/helper-cycle` ([`v2b.md`](./v2b.md) §6.3). Question is whether the diagnostic is `info` or `warning` by default. Lean `warning`; cycles are usually a code-smell even when the walker handles them safely.

### 19.3 `tsconfig.json` interaction

The compiler reads the project's `tsconfig.json` to build the TS Program. Edge cases (project references, `extends` chains, mid-watch `tsconfig.json` edits) need a tested path. Spike against a realistic monorepo before committing to an approach.

### 19.4 Error recovery granularity

§15.1 commits to per-file isolation. Open question: should the compiler also attempt per-component isolation within a file (one broken component doesn't poison the file)? Probably yes for dev, no for CI. Implementor decides post-v2a based on observed failure modes.

### 19.5 Manifest auto-generation in development

[`v2b.md`](./v2b.md) §10.5 says workspace packages get manifests auto-generated by the Vite adapter. The trigger (on file save? on package boundary detection?) and the lifecycle (in-memory vs. written to `dist/` for sibling packages to read) need concrete answers. Lean on in-memory + watch graph; written-to-`dist/` is only required at publish time.

### 19.6 The exact module activation API

`defineConfig({ modules: [core(), agent({...})] })` is illustrative. The real API needs to handle:

- Per-environment module activation (devtools off in production)
- Module configuration with sensible defaults
- Module dependencies (agent might require core's path analysis to be enabled)

Resolved in [`v2c.md`](./v2c.md) §7.3–§7.4 in principle; exact ergonomics decided during v2c implementation.

---

## 20. What We Haven't Fully Considered

Explicit gap section. Anything below is an honest "we should think about this before implementation."

### 20.1 Watch mode resource limits

`fs.watch` on macOS has known issues with deep trees and many files. Vite's existing watcher abstracts this on the build side; the compiler's _cross-file invalidation_ needs to subscribe to host-tool file events, not run its own watcher. Confirm Vite exposes the events we need before v2a.

### 20.2 Stack trace mapping in production

Browser console shows an error from a binding accessor. Today: the source map maps to the user's source. After v2: same number of source-map composition steps (compiler emit + Vite emit). Sentry's source map ingestion, Datadog's, etc. should work as-is, but test against real prod-error pipelines before claiming end-to-end support.

### 20.3 The `@llui/test` package's role — **resolved; ships with v2b**

Originally framed as an open question, then briefly promoted to a v2a blocker, now resolved with the v2a/v2b descope: the primary migration surface is _not_ `@llui/test`'s `testComponent` (which is a pure-reducer harness that never mounts), but **~84 test files in `packages/dom/test/`** that mount raw `ComponentDef` literals through `mountApp`. The resolution mechanism is a `defineTestComponent()` builder duplicated between `packages/dom/test/helpers/` and `@llui/test` (sharing a private internal builder to avoid `@llui/dom` → `@llui/test` dependency inversion). See [`v2b.md`](./v2b.md) §14.1 for the runtime contract and §16.2 for the test-suite migration.

### 20.4 Module-emitted runtime helpers

If a module emits code that requires a runtime helper (e.g., `agent` module needs an agent runtime), that helper has to be importable from somewhere. Each opt-in module ships a runtime sibling package (`@llui/agent-runtime`, etc.) and declares it as a `runtimeImports` field; the emitter injects the imports. The exact packaging (peer dep vs. transitive) is decided during v2c.

### 20.5 Path-set serialization for the library boundary — **largely resolved**

The three previously-flagged shape categories — send-callback (`carousel.connect`), options-bag forwarding (`popover.overlay`), and context-provider reads (`pagination.connect` with `LocaleContext`) — are each given a worked manifest entry in [`v2b.md`](./v2b.md) §10.3. The schema in [`v2b.md`](./v2b.md) §10.2 was extended to support them: `param-result-path`, `options-bag`, `contextReads`, and the `parts-helper`/`view-helper` `kind` split.

Remaining open work: v2b's prototype substitution algorithm must round-trip the §10.3 worked examples against fixture consumers and confirm correct `__prefixes`. If the round-trip surfaces a fourth shape the schema can't express, extend the schema once before v1 freezes. Likely fourth-shape candidates worth pre-flighting: higher-order helpers that _return_ view-helpers; helpers with mutually-recursive accessor parameters.

### 20.6 Compiler version skew across workspace packages

`@llui/components` and `@llui/router` may be compiled by different compiler versions (published independently). The consumer's compiler validates manifest version compatibility (§14.4). Define the version-skew matrix explicitly; document supported and unsupported skew.

### 20.7 Build-time security

The compiler reads user source and emits derived source. It doesn't execute user code, but the type-checker evaluates type-level computation. Conditional types can do non-trivial work. Is there a DoS vector where a malicious source file makes the type-checker infinite-loop? Probably not (TS has built-in recursion limits), but audit the type-checker's safety guarantees against our usage.

### 20.8 Telemetry

Should the compiler emit anonymous usage telemetry (which modules are enabled, what diagnostic IDs fire most, where users opt out of static analysis)? Genuinely useful for prioritizing future work. Also a trust burden. **Default no; revisit if usage patterns become a real gap.**

### 20.9 Plugin authoring docs

Per [`v2c.md`](./v2c.md) §7.5, the module ABI is internal-only at v1 — so the `docs/extending.md` deliverable is _not_ required for v2. It becomes required when the ABI promotes to public (i.e., when a named third-party module is in development). At that point: the guide must be written _and_ tested against at least one real third-party module attempt before the API is declared stable. "Look at our source" is not adequate as public guidance.

### 20.10 The agent's `track()` awareness

If `track({ deps: [...] })` declares paths the compiler couldn't infer, the agent layer (which uses the compiler's outputs for things like `whyDidUpdate`) sees those paths as deps. Does it surface them differently? Does it know they're declared rather than inferred? Decide what the agent UX should be for tracked-only paths during v2c.

### 20.11 Documentation as user-facing surface

The diagnostic schema includes a `documentation` URL. Where do those URLs live? Who maintains them? Are they versioned with the diagnostic ID? A real docs site, not Markdown files in the repo. The current `docs/designs/` is internal-facing; user-facing docs are a separate surface.

### 20.12 Silent FULL_MASK in production builds — **resolved; build-time check ships in v2a**

The build-time integrity step ships as part of v2a (see [`v2a.md`](./v2a.md)). Resolution: the Vite adapter asserts at least one compiler-emitted component exists in the final bundle and fails CI on zero. Cheap, deterministic, fails closed. v2a is the right home because the check lives in the adapter, not the runtime — even though the runtime gate it complements lands in v2b, the build-time half can ship earlier and stops a misconfigured v2a bundle from accidentally producing components the future v2b runtime would reject.

The check does _not_ catch the partial-bypass case (a bundle where some components were compiled and some weren't). That residual is documented in [`v2b.md`](./v2b.md) §18.3 risk axis (2) and is the user's responsibility to audit during migration.

### 20.13 Retracting superseded sections of `docs/designs/02 Compiler.md`

`02 Compiler.md` currently contains two sections that this proposal supersedes:

- "Shared cross-file analysis" — explicitly argues there is no cross-file optimization opportunity. v2b inverts this, but v2a _also_ re-frames the compiler as a stand-alone engine, which contradicts the section's framing immediately.
- "Type-level analysis via `ts.TypeChecker`" (Open Questions) — argued as a "v2 enhancement"; the v2b cross-file walker depends on `ts.TypeChecker` directly, so the section's framing is now history.

These sections are retracted **in the commit that lands v2a** — not v2b. The reasoning: the moment v2a lands, the "compiler is a Vite-plugin thing" framing in `02 Compiler.md` contradicts the repo's reality, and the "no cross-file opportunity" section pre-emptively contradicts v2b's direction.

The retraction is one of:

- delete the sections and update cross-references throughout `02 Compiler.md`, or
- replace them with "Superseded by `docs/proposals/v2-compiler/`" pointers (more conservative; preserves history).

The promotion of this proposal to `docs/designs/14 v2 Compiler Architecture.md` happens at v2c's completion (when all three sub-proposals have landed).

---

## 21. Definition of Done

This proposal is "done" when:

1. The package layout in §4 exists in the repo.
2. The runtime's contract is unchanged from a user's POV (compiled apps run identically).
3. Every currently-shipped diagnostic is preserved (same IDs, same conditions, same locations).
4. The cross-file analysis case from §1 (sentinel `show()` workaround in dicerun2) is no longer necessary — the compiler picks up helper reads automatically, and `track()` is not needed for the deleted block. (v2b exit criterion.)
5. The migration codemod from §18 runs against all 11 in-repo consumers (v2a exit criterion), and against `dicerun2` and `decisive.space-2` (v2b release gate).
6. Quality is established by the test gates that actually detect regressions, not by coverage percentages:
   - Golden-file fixtures cover every emission shape (`__prefixes`, `__handlers`, `__update`, `__msgSchema`, `__renderToString`, `elSplit`/`elTemplate` rewrites) and every diagnostic ID currently shipping. (v2a baseline.)
   - Cross-file fixtures cover every `viaParams` shape from [`v2b.md`](./v2b.md) §10.4 — the four shape categories worked through in [`v2b.md`](./v2b.md) §10.3 plus any fourth shape surfaced in v2b's `@llui/components` round-trip per §20.5.
   - Double-emit test passes on every fixture (determinism).
   - Property tests generate random valid components and assert the emitted code parses and behaves correctly under random state transitions.
   - The [`v2b.md`](./v2b.md) §6.3 case-1 subset goldens (one per documented subset) and the §6.3 `connect()`-parts-bag golden pass.
   - The [`v2b.md`](./v2b.md) §6.3 termination-rule validation gate has been run against `dicerun2`/`decisive.space-2` and its results recorded.
7. The resilience commitments in §15 are verified by tests (per-file isolation, manifest fallback, soak test).
8. A worked example of writing a third-party compiler module is documented and tested. _(Per [`v2c.md`](./v2c.md) §7.5, this becomes required only when a named third-party module enters development; v2 itself ships with internal-only modules and does not block on this item.)_
9. This proposal is promoted to `docs/designs/14 v2 Compiler Architecture.md` and all questions in §19 have a documented resolution.
10. The two superseded sections of `docs/designs/02 Compiler.md` listed in §20.13 ("Shared cross-file analysis", "Type-level analysis via `ts.TypeChecker`") are retracted or rewritten in the commit that lands **v2a**. No conflicting design statement remains in `docs/designs/`.
11. **v2a-specific:** the §20.12 build-time integrity check passes (≥1 compiler-emitted component in every production bundle); RSS and cold-start latency measurements recorded in [`v2a.md`](./v2a.md) with both triggers not exceeded; the codemod runs cleanly against all 11 in-repo consumers. v2a does _not_ require [`v2b.md`](./v2b.md) §14.1 plumbing, the cross-file walker, `track()`, or the test migration — those are v2b's responsibility.
12. **v2b-specific:** [`v2b.md`](./v2b.md) §14.1's `createInstance` versioning gate and `warnUncompiledOnce` are in place; `__compilerVersion` is on `ComponentDef`, `AnyComponentDef`, and `LazyDef<D>`; `packages/dom/test/helpers/defineTestComponent.ts` exists and all ~84 mount-using tests in `packages/dom/test/` have been migrated to it; `testView` in `@llui/test` adopts the builder internally with no public API change.

---

## Appendix A: The dicerun2 sentinel-`show()` case, resolved

Today:

```ts
// 70+ lines of `void s.foo` to manually register helper reads
...show({
  when: (s) => {
    void s.fromCommunityOpen
    void s.communityResults
    // ... 65 more lines
    return false
  },
  render: () => [],
})
```

After v2b:

```ts
// Nothing. The compiler picks up helper reads automatically via [`v2b.md`](./v2b.md) §6.3.
```

If any helper genuinely needs declaration (plugin registry, dynamic dispatch), it uses `track()`:

```ts
track({ deps: (s) => [s.pluginRegistry, s.activePluginName] })
```

This is the load-bearing concrete win and the exit criterion for v2b.

---

## Appendix B: What this doc does NOT specify

By design, this proposal does not specify:

- Exact file layouts inside packages (implementors decide)
- The exact compiler API surface beyond the shape sketch in §6.1 (will evolve during v2a)
- Specific TypeScript Compiler API entry points to use
- Specific bundler integration patterns beyond Vite (phase-3 work)
- The exact `track()` ergonomics under edge cases like inside helpers themselves
- Diagnostic message wording (UX work, separate from architecture)

The architecture is the contract. The implementation is open.
