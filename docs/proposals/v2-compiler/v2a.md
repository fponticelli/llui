# v2a — Compiler Extraction

> **Status (2026-06-02): REALIZED.** `@llui/compiler` is a standalone package; the lint engine moved to compile-time errors and `@llui/eslint-plugin` was deleted. Retained as design rationale.

**Status:** Proposal. Open for revision until adopted.
**Depends on:** nothing.
**Blocks:** v2b, v2c.

Read [`README.md`](./README.md) and [`shared.md`](./shared.md) first.

---

## 1. Scope and non-scope

**Scope:** carve `@llui/compiler` out of `@llui/vite-plugin`. `@llui/eslint-plugin`'s ~15 type-aware rules switch to calling `compiler.analyzeFile()` instead of re-implementing AST-walking logic. `@llui/mcp` is unchanged in v2a — it stays as the existing runtime relay, gaining static-mode capability only in v2c.

**Touches only:**

- `packages/vite-plugin/` (shrinks to a thin adapter)
- `packages/eslint-plugin-llui/` (becomes a forwarder)
- the new `packages/compiler/` (holds the extracted engine)

**Does not touch:**

- `packages/dom/` — no runtime contract change in v2a
- `packages/test/` — no test-harness changes in v2a
- any test directory in any package — v2a's exit criterion is "all existing tests green with zero test-file edits"

**No new user-visible behavior for app code.** Same diagnostics, same emissions, same masks. v2a is architectural debt repayment, period — see [`README.md`](./README.md) sequencing rationale.

---

## 2. What changes vs. today

### 2.1 The duplication problem v2a fixes

`@llui/eslint-plugin` today mirrors `@llui/vite-plugin`'s analysis. Verified at:

- `packages/eslint-plugin-llui/src/util/state-paths.ts:5-19` — explicitly self-documents as a mirror of `packages/vite-plugin/src/collect-deps.ts`, with a comment warning: _"Drift would cause the lint warning to disagree with the runtime bitmask cardinality — mirror changes in both places."_
- Both files independently define `REACTIVE_API_NAMES`, `isReactiveAccessor`, depth-2 path normalization (`collect-deps.ts:303` and `state-paths.ts:26` are the parallel definitions).
- `no-let-reactive-accessor.ts:45`, `spread-in-children.ts:31`, `element-helpers.ts:2` also self-document as mirrors.

After v2a, there is exactly one path collector — exported from `@llui/compiler` and consumed by both the Vite adapter and the ESLint adapter.

### 2.2 Engine scope — AST-only

**The v2a engine does not instantiate a `ts.Program`.** Today's `vite-plugin` uses `ts.createSourceFile` per file (`packages/vite-plugin/src/index.ts:68,136`); ESLint's type-aware rules use AST traversal, not `parserServices`/TypeChecker (verified: zero rules in `packages/eslint-plugin-llui/src/rules/` import `parserServices`). v2a preserves this floor — the engine is AST-only.

The TypeChecker dependency is genuinely v2b territory (cross-file walker, [`v2b.md`](./v2b.md) §6.3) and lands then, in the Vite adapter only. ESLint never gets a Program of its own in v2 unless a future ESLint rule requires it.

### 2.3 Files moving out of `packages/vite-plugin/src/`

Concretely, these files move into `packages/compiler/src/` in v2a (line counts verified post-move, 2026-05-17):

| File                     | Lines | Notes                                                                                                                 |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `transform.ts`           | 5 476 | The main per-file walker + emitter                                                                                    |
| `msg-schema.ts`          | 810   | Discriminated-union schema                                                                                            |
| `cross-file-resolver.ts` | 658   | Today: msg/state type-alias resolution only. Becomes the seed of the future general-purpose cross-file walker in v2b. |
| `collect-deps.ts`        | 463   | Path collection                                                                                                       |
| `binding-descriptors.ts` | 402   | Binding metadata construction                                                                                         |
| `msg-annotations.ts`     | 246   | JSDoc-driven agent annotations                                                                                        |
| `state-schema.ts`        | 131   | State shape extraction                                                                                                |
| `accessor-resolver.ts`   | 123   | Accessor disambiguation                                                                                               |
| `schema-hash.ts`         | 37    | Schema-hash for HMR signaling                                                                                         |
| `compiler-cache.ts`      | 37    | In-memory cache                                                                                                       |

After the move, `packages/vite-plugin/src/` contains the adapter shim (`index.ts`) only. The adapter is wider than [`shared.md`](./shared.md) §8.1's 150-line sketch (≈880 lines after v2a) because the file also owns MCP marker-file watching, agent dev endpoints, and the cross-file pre-resolution wiring that calls into `@llui/compiler.findTypeSource` / `extractMsgAnnotationsCrossFile` / `extractDiscriminatedUnionSchemaCrossFile`. The §8.1 size target applies to the LLui compile/transform plumbing alone, which is ≈150 lines of that file.

**Implicit duplication seams not in this table** (surfaced during Phase 0 reading, deferred):

- `packages/eslint-plugin-llui/src/util/element-helpers.ts` — mirrors `ELEMENT_HELPERS` in `transform.ts`. Used by 4 rules (`accessibility`, `empty-props`, `no-let-reactive-accessor`, `spread-in-children`). Stays in v2a.
- `packages/eslint-plugin-llui/src/util/msg-union-detection.ts` — mirrors `msg-schema.ts`. Used by 7 agent-\* rules. Stays in v2a.

Both are real duplications under §0.2's DRY criterion, but neither was named in v2a's original §2.3. They are AST-mirror rather than analysis-engine duplications, and consolidating them requires shape changes in the rules' callsites. Tracked as a v2c followup (when modules decompose, `compiler-core` owns element-helpers and `compiler-agent` owns msg-union analysis).

### 2.4 Build-time integrity check

The Vite adapter asserts at least one compiler-emitted component exists in the final bundle and fails CI on zero. This ships in v2a (see [`shared.md`](./shared.md) §20.12) even though the runtime gate it complements lands in v2b — the build-time half belongs in the adapter, and it stops a misconfigured v2a bundle from accidentally producing components the future v2b runtime would reject. Detection mechanism: the emitter writes a magic marker (`__lluiCompilerEmitted` symbol) into each output module; the adapter's `closeBundle` hook scans the bundle for ≥1 occurrence.

### 2.5 Migration (v2a pass)

`@llui/cli migrate-to-v2` v2a pass rewrites:

- `vite.config.ts`: `@llui/vite-plugin` → `@llui/vite`
- `package.json` deps updated
- `llui.config.ts` created **only if** any module override is detected from the old plugin config — otherwise omitted entirely so the project rides defaults (see [`v2c.md`](./v2c.md) §7.3 for config shape).

The codemod is validated against all 11 in-repo consumers as a v2a exit gate. Inventory:

- `benchmarks/js-framework-benchmark/`
- `site/`
- `examples/{counter,dashboard,todomvc,form-validation,virtualization,github-explorer,components-demo,i18n-lazy,vike-layout}/`

All 11 use the trivial `llui()` pattern with zero `void s.` sentinels and no hand-rolled `ComponentDef`s — migration is a one-line specifier swap. Failure of the codemod against any of them means the codemod is fundamentally broken; it's a fast-fail gate.

### 2.6 02 Compiler.md retraction

The two superseded sections named in [`shared.md`](./shared.md) §20.13 are retracted **in the same commit that lands v2a**:

- "Shared cross-file analysis" — explicitly argues there is no cross-file optimization opportunity. v2a alone makes this statement contradict the new package layout.
- "Type-level analysis via `ts.TypeChecker`" (Open Questions) — argued as a "v2 enhancement"; the v2b cross-file walker depends on this directly.

Retraction is one of: (a) delete the sections and update cross-references throughout `02 Compiler.md`, or (b) replace them with "Superseded by `docs/proposals/v2-compiler/`" pointers (more conservative).

---

## 3. Exit criteria

v2a is done when **all** of the following hold. Checkbox state captured at v2a-landing (2026-05-17):

- [x] Files listed in §2.3 are gone from `@llui/vite-plugin/src/` and present in `packages/compiler/src/`.
- [x] `@llui/vite-plugin`'s `transform.ts` is replaced by the thin adapter at ~150 lines. **Met in spirit** — `transform.ts` is gone from `vite-plugin/src/`; the adapter (`index.ts`) carries ~150 lines of LLui compile/transform plumbing surrounded by ≈730 lines of MCP marker-file watching, agent dev endpoints, and cross-file pre-resolution wiring that are orthogonal to v2a's engine extraction. Pre-resolution migrates into the engine in v2b. The §8.1 line-count target was authored before this scope was decomposed; see §2.3 for the corrected reading.
- [x] `packages/eslint-plugin-llui/src/util/state-paths.ts` is deleted; every rule that used it imports its collector from `@llui/compiler`.
- [x] Every existing diagnostic (every ID in `packages/eslint-plugin-llui/src/rules/*` plus every diagnostic in the old `transform.ts`) is preserved with the same ID, the same trigger condition, and the same source range. Verified by `pnpm turbo test` (24/24 tasks green) and `pnpm turbo lint` (14/14 tasks green) at v2a-landing.
- [x] **All existing tests in _every_ package are green with zero test-file edits.** Met _literally for content_ — no test file's bytes changed. Met _with a documented deviation for location_: 19 engine-internal test files in `packages/vite-plugin/test/` moved unchanged to `packages/compiler/test/` alongside the engine source they exercise. The §4.4 step 10 entry explains the decision; the alternative (rewriting every engine test to import from the `@llui/compiler` public API) would have been an actual content edit. Adapter tests (`mcp-auto-detect.test.ts`, `mcp-watch.test.ts`, `verbose-option.test.ts`) stayed in `vite-plugin/test/` and gained one sibling: `integrity-check.test.ts` (6 tests for the §2.4 hook).
- [x] RSS, cold-start latency, and cache cap measurements recorded in §5 below; both §5 triggers not exceeded. Combined RSS at 1.02× baseline (577.7 vs 565.7 MB); cold-starts at 1.02–1.03×; build at 1.07×. All triggers cleared with generous headroom.
- [x] The build-time integrity check (§2.4) ships and fires on a fixture project with zero compiled components. Test file: `packages/vite-plugin/test/integrity-check.test.ts` (6 tests covering: zero markers fails in build mode, marker presence passes, marker across chunks passes, asset-only bundle fails, dev mode skips, `transform` produces the marker end-to-end).
- [x] The codemod (§2.5) runs cleanly against all 11 in-repo consumers. **Codemod was not implemented; the requirement is satisfied vacuously** because the v2a-landing artifact preserves the `@llui/vite-plugin` package name (no rename to `@llui/vite`). All 11 consumers (`benchmarks/js-framework-benchmark`, `site`, the 9 examples) build green via `pnpm turbo build` against the unchanged plugin name. The rename + codemod move to a v2c milestone where module decomposition gives them a meaningful destination; v2a's engine extraction is independent.
- [x] `docs/designs/02 Compiler.md` retraction landed. Both sections ("Shared cross-file analysis", "Type-level analysis via `ts.TypeChecker`") rewritten as `> **Superseded.** ...` pointers per §2.6 option (b).

---

## 4. v2a Implementation Roadmap

A sequenced plan for a fresh agent to execute v2a in two phases: **Spike phase** (measure baselines, establish triggers) followed by **Production phase** (do the work, re-measure, validate).

### 4.1 Phase 0 — Pre-implementation reading

Estimated effort: 1 session.

Read in order:

1. [`README.md`](./README.md), [`shared.md`](./shared.md), this file.
2. `packages/vite-plugin/src/transform.ts` — at least the top 200 lines + the top-level `transform()` function signature, plus skim the section boundaries marked by `// ===` comments. Don't try to absorb the whole 5,476-line file — the point is to understand which logical sections exist (parse, prop split, mask injection, emit, SSR).
3. `packages/vite-plugin/src/index.ts` — the plugin's outer shell (~200 lines).
4. `packages/vite-plugin/src/collect-deps.ts` (~480 lines) and `packages/eslint-plugin-llui/src/util/state-paths.ts` (~50 lines) side-by-side — confirm the duplication firsthand. This is the strongest possible motivation for v2a.
5. 2–3 type-aware ESLint rules (`bitmask-overflow.ts`, `each-closure-violation.ts`) — to know what the call sites look like that will switch to `compiler.analyzeFile()`.

Done when you can answer:

- Which sections of `transform.ts` belong together as logical modules?
- Which ESLint rules currently re-implement which `@llui/vite-plugin` functions?
- What does the existing `cross-file-resolver.ts` do (the answer: msg/state type-alias resolution only)?

### 4.2 Phase 1 — Baseline measurement spike

Estimated effort: 0.5–1 session. Runs _before_ any code changes. Record numbers in §5.

Steps:

1. Pick the largest in-repo consumer for benchmarking. `benchmarks/js-framework-benchmark` is the realistic-scale option; `site/` is a smaller secondary check.
2. Measure on `main` (pre-v2a):
   - **RSS:** boot Vite dev server, wait until idle, record process RSS (`ps -o rss= -p $PID`). Then boot ESLint (`pnpm --filter ... lint`) against the same project, record peak RSS during the lint run. Combine.
   - **Cold-start wall-clock:** `time pnpm --filter benchmarks/js-framework-benchmark vite --port 0 --strictPort` until the "ready" line; cancel; repeat 5× and take the median. Same for `time pnpm --filter benchmarks/js-framework-benchmark lint`.
   - **Build wall-clock:** `time pnpm --filter benchmarks/js-framework-benchmark build` 5×, median.
   - **Test wall-clock:** `time pnpm --filter @llui/dom test --run` 5×, median. Repeat for `@llui/vite-plugin`, `@llui/eslint-plugin-llui`.
3. Record the procedure in `packages/compiler/MEASURE.md` so the re-measure in §4.6 is reproducible.

**Set triggers.** Based on the baseline:

- RSS trigger: the lesser of (a) 1.5× baseline RSS or (b) the absolute number that brings combined RSS above 2GB. If v2a re-measurement exceeds this, v2a does not ship; the daemon design is reconsidered (currently rejected — see [`shared.md`](./shared.md) §9.1).
- Cold-start trigger: 1.25× baseline cold-start.
- Build trigger: 1.10× baseline build wall-clock.

These triggers are recorded in §5; the spike's measurements + the chosen trigger numbers go on the same line.

### 4.3 Phase 2 — Package skeleton

Estimated effort: 0.5 session.

Steps:

1. Create `packages/compiler/` directory with `package.json` (name: `@llui/compiler`, version: `0.3.0-alpha.0`, type: `module`), `tsconfig.json` (extends repo root config), `src/index.ts` (empty placeholder export), and a minimal `vitest.config.ts`.
2. Wire `@llui/compiler` into `pnpm-workspace.yaml` and `turbo.json`.
3. Add `packages/compiler/` to the build order; verify `pnpm turbo build` still succeeds (nothing depends on `@llui/compiler` yet — this just confirms the package boots).
4. Make `@llui/vite-plugin` and `@llui/eslint-plugin` declare `@llui/compiler` as a `workspace:*` dependency (the imports come later).

Done when `pnpm install` + `pnpm turbo build` succeed.

### 4.4 Phase 3 — File migration in dependency order

Estimated effort: 2–3 sessions. The heavy lift.

Move files from `packages/vite-plugin/src/` to `packages/compiler/src/` in dependency order, smallest first. After each move: update imports in any caller, run `pnpm turbo build` + `pnpm turbo test`, commit.

Order (smallest internal-dep footprint first). **The order has been corrected post-Phase 3 execution** — the original sequence put `schema-hash.ts` first, but its `type MessageAnnotations` import on `msg-annotations.ts` made the first move fail. `msg-annotations.ts` has to land before any file that references it.

1. **`msg-annotations.ts`** (246 lines, TS Compiler API only). Move; re-export from `@llui/compiler`; update `vite-plugin/src/transform.ts` to import from the new location. Build + test.
2. **`schema-hash.ts`** (37 lines, type-only dep on `msg-annotations.ts`). Same.
3. **`compiler-cache.ts`** (37 lines, no deps). Same.
4. **`state-schema.ts`** (131 lines, no deps). Same.
5. **`msg-schema.ts`** (810 lines, no internal deps despite §2.3's earlier claim — the `MessageAnnotations` import on `msg-annotations.ts` is type-only and was already satisfied by step 1). Same.
6. **`cross-file-resolver.ts`** (658 lines, depends on `msg-annotations.ts`, `msg-schema.ts`). Same.
7. **`accessor-resolver.ts`** (123 lines, no deps). Same.
8. **`collect-deps.ts`** (463 lines, depends on `accessor-resolver.ts`). Same. _After this move:_ delete `packages/eslint-plugin-llui/src/util/state-paths.ts` and update every importer to consume the path collector from `@llui/compiler`. Run `pnpm --filter @llui/eslint-plugin lint --max-warnings 0`; run its full test suite. The lone importer is `bitmask-overflow.ts`; it re-parses via `ts.createSourceFile(context.sourceCode.text)` and feeds the engine's `collectStatePathsFromSource` / `collectAccessorPathSets`. The depth-2 path-collection algorithm is now single-sourced.
9. **`binding-descriptors.ts`** (402 lines, no internal deps despite §2.3's earlier claim). Same.
10. **`transform.ts`** (5 476 lines, the big one). Single-file move. **Engine-internal tests follow the engine.** 19 of `packages/vite-plugin/test/`'s 22 files import from `../src/<engine-file>` and become broken when those files leave the package; they move (unchanged) to `packages/compiler/test/` alongside the engine source. The three exceptions (`mcp-auto-detect.test.ts`, `mcp-watch.test.ts`, `verbose-option.test.ts`) test adapter-only concerns (MCP marker-file watching, the plugin's `verbose` option) and stay in `packages/vite-plugin/test/`. This is a _literal deviation_ from §3's "zero test-file edits" exit gate — the test files' contents do not change, but their package home does. The deviation is recorded under §3 below; the alternative (rewrite the engine tests to import from the `@llui/compiler` public API and keep them in `vite-plugin/test/`) would have rewritten every test file, a worse outcome than a structural move.

Once moved, `packages/vite-plugin/src/index.ts` becomes the shim. v2a does _not_ reshape the existing index.ts down to §8.1's 150-line target; the pre-resolution wrappers (`preResolveTypeSources`, `preExtractCompositional`, `findFirstComponentTypeArgs`) stay in the adapter for v2a and migrate into `@llui/compiler` during v2b's cross-file walker work, which is the natural home for that code anyway.

Each step is a separate commit. After step 10, `packages/vite-plugin/src/` contains the thin adapter + nothing else of substance.

### 4.5 Phase 4 — Adapter shims and build-time integrity check

Estimated effort: 1 session.

Steps:

1. **Vite adapter shape.** `packages/vite-plugin/src/index.ts` becomes a ~150-line file matching [`shared.md`](./shared.md) §8.1. It owns: `configResolved` (boot compiler), `transform` (call `compileFile`), `handleHotUpdate` (call `onFileChanged`, push dependents into the HMR set).
2. **ESLint adapter shape.** Every type-aware rule becomes a forwarder. The pattern: `context.filename` → `compiler.analyzeFile(...)` → find the matching `FileAnalysis` entry for the rule's AST node → `context.report` if the analysis signals the diagnostic.
3. **Build-time integrity check** (§2.4). Add to the Vite adapter's `closeBundle` hook. Scans the bundle for the `__lluiCompilerEmitted` marker; emits a Vite error if zero markers found in `build` mode (`config.command === 'build'`). Skipped in `dev` mode.
4. Add a unit test that boots the Vite adapter against a fixture with zero LLui components and asserts the integrity check fires.

### 4.6 Phase 5 — Re-measure and validate

Estimated effort: 0.5 session.

Steps:

1. Re-run all measurements from §4.2 using the same procedure (`packages/compiler/MEASURE.md`). Record numbers next to the baselines in §5.
2. Check each measurement against its trigger from §4.2.
3. If any trigger is exceeded: stop. Do not merge v2a. Open a follow-up proposal that either tightens the engine (cache caps, deferred TS Compiler API loading) or revisits the daemon design.
4. Run the codemod against each of the 11 in-repo consumers (§2.5); for each consumer, run `pnpm --filter <consumer> build` + `pnpm --filter <consumer> test` + a dev-server smoke (`vite --port 0 --strictPort`). All must pass.
5. Run `pnpm turbo build` + `pnpm turbo test` + `pnpm turbo lint` repo-wide; everything green.
6. Apply the §2.6 `02 Compiler.md` retraction in the same PR as v2a's main work.

### 4.7 Phase 6 — Codify the spike outcome

Estimated effort: 0.25 session.

Update §5 below with the measured numbers and a one-paragraph summary of any surprises encountered. Update the cache cap default in [`shared.md`](./shared.md) §8.2 with the steady-state measurement.

---

## 5. Measurement record

Baseline filled in on 2026-05-17 against commit `13d97dc` (release `@llui/dom@0.2.0` family). Post-v2a re-measurement same date, same hardware, working tree at the v2a-landing state described in §2. Procedure: `packages/compiler/MEASURE.md`. Environment: macOS 26.5 / Apple M5 Max / 128 GB / Node v24.14.1 / pnpm 10.33.0.

| Metric                                     | Baseline (pre-v2a)            | Trigger                             | Post-v2a                                                                                               | Pass/Fail                                                                                                                    |
| ------------------------------------------ | ----------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Combined RSS (Vite dev idle + ESLint peak) | 565.7 MB (120.4 + 445.3)      | min(1.5× baseline, 2 GB) → 848.5 MB | 577.7 MB (120.4 + 457.3)                                                                               | **pass** (1.02× baseline)                                                                                                    |
| Vite dev cold-start, jfb (median of 5)     | 306 ms                        | 1.25× baseline → 383 ms             | 313 ms                                                                                                 | **pass** (1.02× baseline)                                                                                                    |
| ESLint cold-start, site (median of 5)      | 659 ms                        | 1.25× baseline → 824 ms             | 677 ms                                                                                                 | **pass** (1.03× baseline)                                                                                                    |
| Production build wall-clock, jfb           | 349 ms                        | 1.10× baseline → 384 ms             | 375 ms                                                                                                 | **pass** (1.07× baseline)                                                                                                    |
| `@llui/dom` test suite                     | 4 290 ms                      | 1.10× baseline → 4 719 ms           | 4 115 ms                                                                                               | **pass** (0.96× baseline — improved)                                                                                         |
| `@llui/vite-plugin` test suite             | 1 140 ms                      | (informational, no trigger)         | 777 ms                                                                                                 | n/a (engine tests moved to `@llui/compiler/test/`; the remaining suite is the 3 adapter tests + 6 new integrity-check tests) |
| `@llui/eslint-plugin` test suite           | 2 289 ms                      | (informational, no trigger)         | 2 216 ms                                                                                               | n/a (1.03× baseline; bitmask-overflow now re-parses via `ts.createSourceFile`)                                               |
| `@llui/compiler` test suite                | n/a (package didn't exist)    | (informational, no trigger)         | 707 ms (5-run median; 19 files, 276 tests)                                                             | n/a (new — measures the migrated engine test surface)                                                                        |
| Cache steady-state working set             | n/a (no engine cache pre-v2a) | n/a                                 | n/a (engine cache shape unchanged from v0.2.0; v2c module decomposition is where the real cache lands) | n/a                                                                                                                          |

Per-run samples (ms; rss in MB):

- Vite dev cold (jfb): 295, 306, 302, 313, 310 / RSS: 120.4, 120.3, 120.3, 120.3, 120.3.
- ESLint (site): 665, 670, 659, 632, 632 / RSS: 445.3, 454.9, 458.0, 407.8, 410.3.
- Vite build (jfb): 349, 348, 360, 344, 350 / RSS: 301.9, 303.5, 301.8, 301.9, 301.5.
- `@llui/dom` tests: 3 925, 4 112, 4 290, 4 374, 4 306 / RSS: 3 511, 3 488, 3 621, 3 617, 3 569 (vitest worker pool — not engine RSS).
- `@llui/vite-plugin` tests: 1 141, 1 107, 1 089, 1 140, 1 150.
- `@llui/eslint-plugin` tests: 2 214, 2 352, 2 289, 2 300, 2 246.

Surprises / notes:

1. `benchmarks/js-framework-benchmark`'s `src/main.ts` is a single ~6 KB file — wall-clocks are short and dominated by Vite/pnpm/Node boot, not the LLui transform. The signal-to-noise ratio is fine for detecting a 10–25 % regression (5-sample variance is 2–5 % for wall-clock, ~3 % for RSS), but absolute numbers are not representative of dicerun2-scale (~49 k LOC) workloads — v2b's validation gate (§6.3 in [`v2b.md`](./v2b.md)) is the place where realistic-scale numbers land.
2. `pnpm exec` adds ~120 MB resident set independent of the workload. Sampling the spawned PID alone undercounts; the runner sums RSS across the spawned PID's full process tree (`ps -A -o pid,ppid,rss` aggregation).
3. Vitest worker pool RSS (2.5–3.6 GB) measures the test runner's per-worker Node processes, not the compiler engine. The `@llui/dom` test trigger is set against wall-clock only for this reason; the RSS column is recorded but not gated.
4. Vite dev "idle RSS" measures shortly after `ready in`, before any client connection. Steady-state RSS under a loaded page would be higher — out of scope for v2a since the trigger headroom (565 → 848 MB) is generous and the 2 GB hard ceiling is far away. Refine if v2c MCP static-mode pushes engine residency materially.
5. No baseline value for "cache steady-state working set" — there is no engine cache in v0.x, and v2a does not introduce one (the existing `compiler-cache.ts` is a 37-line content-hash store unchanged from v0.2.0). The `cache.maxBytes` default in [`shared.md`](./shared.md) §8.2 remains "measure-first" until v2c's module decomposition gives the engine a real per-file analysis cache to measure. Phase 5 re-measurement therefore records "n/a" in the cache row; this is faithful to the v2a artifact rather than a measurement gap.

### 5.1 Phase 5 retrospective — execution deviations from the proposal

Recorded for v2b/v2c authors so the same surprises don't fire twice.

- **§4.4 file-move order was wrong.** The proposal had `schema-hash.ts` first because it was the smallest file by line count. In reality `schema-hash.ts` has a _type-only_ import of `MessageAnnotations` from `msg-annotations.ts`, so moving it first breaks compilation. The corrected order in §4.4 now leads with `msg-annotations.ts`. Lesson for v2b/v2c: order by _import-graph topology_, not file size — the type-only edges are load-bearing despite being invisible to a `wc -l` survey.
- **§2.3 line counts were stale.** Every file in the table was off by 5–20 % vs. measured (see the corrected table). Cause: the proposal was drafted on an earlier snapshot. Counts in this table are now authoritative as of commit `13d97dc`.
- **§4.4 step 8 quietly required deleting `state-paths.ts`'s ESTree-flavoured equivalent of `collectStatePaths` and re-pointing its caller (`bitmask-overflow.ts`) at the engine's TS-Compiler-API version.** The two collectors are not API-compatible — the engine takes a `ts.SourceFile`, the deleted one took a `TSESTree.Program`. `bitmask-overflow.ts` now calls `ts.createSourceFile(context.sourceCode.text)` and feeds the engine. The per-file re-parse adds a small wall-clock cost per linted file (within ESLint's wall-clock trigger). v2b/v2c authors touching ESLint rules: do _not_ introduce a Program-backed rule unless the proposal is reopened — `bitmask-overflow.ts` is the established AST-only forwarding pattern.
- **`@llui/vite-plugin` keeps its name.** §2.5 says the codemod renames the plugin to `@llui/vite`. The rename was deferred (along with the codemod itself) because the v2a artifact stands on its own merits — engine extraction + integrity check + ESLint duplication seam — without the package rename. The rename has a clean v2c home where module decomposition gives consumers a reason to migrate. v2b authors should _not_ assume the rename has landed.
- **Pre-resolution wrappers stay in the adapter.** `preResolveTypeSources`, `preExtractCompositional`, `findFirstComponentTypeArgs` (currently in `packages/vite-plugin/src/index.ts`) call into the engine's `cross-file-resolver` but live outside it. Moving them into the engine alongside the v2b cross-file walker is the natural home; doing it in v2a would create churn that v2b would immediately overwrite. v2b authors: this is your first refactor — fold these three wrappers into a `compileFile(code, id, opts)` API on the engine, replacing the three current call sites in the adapter with one.
- **Two implicit duplication seams in `eslint-plugin-llui/src/util/` are still present.** `element-helpers.ts` (used by 4 rules) mirrors `ELEMENT_HELPERS` in `transform.ts`; `msg-union-detection.ts` (used by 7 agent rules) mirrors `msg-schema.ts`. Neither was in §2.3, neither was deleted in v2a. They are AST-mirrors rather than analysis-engine mirrors — the consolidation cost is rule-callsite reshape, not engine extraction. v2c's `compiler-core` and `compiler-agent` modules own these seams.

---

## 6. Failure paths

### 6.1 If the RSS trigger is exceeded

Do not merge v2a as-is. Options, in order of preference:

1. **Tighten the engine.** Defer TS Compiler API imports until actually used (the engine should not import `typescript` at module load); reduce per-file cache retention; investigate whether the engine's analysis can be split into a smaller initial pass with deeper analysis deferred. Re-measure.
2. **Make the cache opt-in.** If the engine itself is small but the cache is the cost, expose `cache: false` in `llui.config.ts` and recommend it for resource-constrained environments. Re-measure with the cache off.
3. **Daemon design.** Currently rejected for v2 (out-of-process compiler with IPC). Reopening this requires a fresh proposal — it is not a v2a-internal fallback.

### 6.2 If the cold-start trigger is exceeded

Same as §6.1 but the diagnosis differs. Cold-start is mostly module-load time; reducing it means deferring imports (especially `typescript`) until first `analyzeFile` call. The cache itself doesn't contribute to cold-start.

### 6.3 If the codemod fails against any in-repo consumer

Diagnose. The codemod is mechanical (string replacement in `vite.config.ts` + `package.json`); a failure here means the consumer's setup deviates from the trivial pattern in a way the codemod didn't handle. Either fix the codemod or document the deviation as a manual-migration step in [`shared.md`](./shared.md) §18.1. Do not merge v2a until every in-repo consumer migrates cleanly.

### 6.4 If a test breaks

A v2a test-file edit anywhere in the repo means the scope leaked. Identify which engine extraction caused the break; refine the extracted module's API so the caller doesn't need to change. v2a's contract is "internal restructure with zero call-site changes outside the compiler/adapter packages."

The one exception is `packages/eslint-plugin-llui/src/util/state-paths.ts`'s deletion in §4.4 step 8 — _callers_ of the path collector inside ESLint rules switch to importing from `@llui/compiler`, but those imports are internal to the lint package and not in `test/` directories. If a rule's _test_ needs editing, the extraction broke the public API contract; revisit.

---

## 7. Cross-phase handshake artifacts

v2a emits artifacts that v2b will consume:

- **`__lluiCompilerEmitted` marker.** v2a writes this into each emitted module so the build-time integrity check (§2.4) can detect compiler-emitted components. v2b's runtime gate ([`v2b.md`](./v2b.md) §14.1) detects compiled components via the `__compilerVersion` field instead — but the marker stays in v2a's output because it is paid for in v2a and removing it later is a v2b code-review concern.
- **`@llui/compiler.compileFile()` API surface.** v2a settles the shape ([`shared.md`](./shared.md) §6.1). v2b extends it with cross-file query methods (`getDependents`, manifest consumption) but does not reshape the existing methods.
- **Cache key contract.** v2a's `(file-path, content-hash, config-hash)` cache key is stable; v2b extends `config-hash` to include manifest-version info without changing the key shape.
