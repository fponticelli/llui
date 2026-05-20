# v0.5 Rebuild — Architectural Options

This directory captures four design directions for a v0.5 rebuild of LLui. Each
is a self-contained proposal; an implementer can pick any one and execute
without reading the others. The companion `comparison.md` highlights the
differences and offers a recommended decision rubric.

The goal of these docs is **leave-behind artifacts** — written so a future
contributor (with no access to this conversation) can pick up and ship the
work.

---

## Read this first: state of `docs/proposals/v2-compiler/`

The v2-compiler proposal (`docs/proposals/v2-compiler/`, three phases
v2a / v2b / v2c) is **largely landed as of 2026-05-18** — one day before
this v0.5 doc set was authored. Anyone picking up v0.5 must read
`docs/proposals/v2-compiler/README.md` first to know what's already in
the runtime; many of the options below describe work that has either
shipped under different framing or has been done in part.

### Landed (and how it affects v0.5)

- **v2a (compiler extraction)** — `@llui/compiler` is a standalone
  package at `packages/compiler/src/`; `@llui/vite-plugin` is a thin
  adapter. _Effect on v0.5:_ Options A/B/C land on top of an extracted
  compiler. The "new compiler pass" lines in those options refer to
  modules added to `@llui/compiler/src/modules/`, not work inside
  `vite-plugin`.
- **v2b (cross-file walker + runtime contract):**
  - `track({ deps })` primitive **shipped** at
    `packages/dom/src/primitives/track.ts:59` — runtime stub throws
    `LluiCompilerSkippedError`; compiler folds declared paths into
    `__prefixes` and erases the call to zero bytes.
  - `__compilerVersion` runtime gate **shipped** in
    `packages/dom/src/update-loop.ts:30–88`. `RUNTIME_MIN_COMPILER_VERSION
= '0.3.0'`; `assertCompilerCompatibility` + `warnUncompiledOnce`
    are live.
  - Cross-file walker **shipped** at
    `packages/compiler/src/cross-file-walker.ts` (in-repo validated;
    external-repo gate skipped per v2b §11.0).
  - Manifest schema **defined** at `packages/compiler/src/manifest.ts`.
  - `defineTestComponent()` **shipped** at
    `packages/dom/src/internal/test-component-builder.ts` +
    `packages/dom/test/helpers/defineTestComponent.ts`.
- **v2c (module system + diagnostics + MCP-as-adapter):**
  - Module decomposition **feature-complete**. Three sibling packages
    exist in addition to `@llui/compiler`:
    `@llui/compiler-introspection`, `@llui/compiler-devtools`,
    `@llui/compiler-ssr`.
  - Normalized diagnostic schema **shipped** at
    `packages/compiler/src/diagnostic.ts`.
  - MCP static-mode tools (`llui_static_show_compiled`,
    `llui_static_diagnostics`) **shipped**.

### Deferred from v2b/v2c (relevant to v0.5)

- **Test migration to `defineTestComponent` is targeted, not bulk.**
  2 of ~84 mount-using tests in `packages/dom/test/` have moved; the
  other ~82 lean on `warnUncompiledOnce` dedup. Any v0.5 option that
  touches the test harness inherits this debt.
- **`@llui/cli` does not exist.** This blocks: v2b §7 codemod,
  v2c `publish-deps` manifest auto-generator. Three cross-package
  manifests for `@llui/components` / `@llui/router` / `@llui/transitions`
  are therefore unwritten. Option C's "cross-package manifest" story
  (its §5 Phase 5) is much closer to shippable than the option doc
  implies — the schema exists; the generator doesn't.
- **`llui/prefer-static-deps` lint rule** for `track()` not shipped;
  natural v2c home.
- **Vite-adapter HMR Program refresh** still deferred.
- **`packages/dom/test/fallback/` explicit-FULL_MASK suite** deferred.

### Reframed dependency direction

The v0.5 options need to be re-read against this baseline. The headline
shifts:

- **Option B** (binding registry). v2b's `track()` already gives users
  declarative path-dependency at the source level, and the runtime
  already gates on `__compilerVersion`. Option B reduces from "ship a
  parallel `__bindingModel` flag + new registry + compiler emission
  change" to **"replace the flat-array Phase 2 scan with the
  bindings-by-prefix map; the compiler already emits the prefix table
  the registry would key on."** Effort estimate in the option doc
  (~2.5 weeks) is probably high by 30–50 % now. Open questions #1
  (prefix-id packing) and #2 (memo deps reactivity) shrink — `track()`
  - the existing two-word mask are the answers.
- **Option A** (signals). The "drop the mask compiler passes" line
  items in §"Architecture changes" refer to modules that now live in
  `@llui/compiler/src/modules/`. Cleaner to attack, but no shorter.
  The 12-week estimate stands.
- **Option C** (closed runtime / templated). v2c's module decomposition
  already split the compiler into four packages, but the user-runtime
  (`@llui/dom`) is still a single npm package; Option C's templating
  of the **runtime** is orthogonal to v2c's templating of the
  **compiler**. The Phase 5 cross-package manifest story is closer to
  shippable than the option doc shows — the schema exists, only the
  generator is missing. The 5-week estimate may be tight but is
  defensible.
- **Option D** (incremental tiers) is unchanged in framing — still
  parallel-safe and the only option that doesn't need to integrate
  with v2 work.

### What this means for picking an option

The original "wait for v2b" recommendation is wrong; v2b is largely
done. The honest question now is whether v0.5's bundle/perf goals
justify any of A/B/C **given the deferred-but-cheap items above are
also on the table**:

- The 82-test migration + `publish-deps` tool + manifest generation
  collectively land most of v2b/v2c's "deferred" surface in 1–2 weeks.
- Pairing that cleanup with a few Option D tiers gets to ≈ 9 kB gz
  with no architectural risk.
- Option B becomes a viable third sub-cycle (≈ 1.5 weeks given
  shrinking scope) only if the post-v2b Select baseline confirms the
  regression vs LLui's own history persists.

This README and `comparison.md` should be revised once a real v0.5
roadmap is picked — both currently describe v2-compiler work as if it
were future, which it isn't.

---

## Why a rebuild

After the v0.4 bundle-size cut work, the jfb bench bundle settled at:

| Metric       | Value        | vs Phase 0 (43,417 / 13,479 / 11,869) |
| ------------ | ------------ | ------------------------------------- |
| Uncompressed | 34,889 bytes | -19.6 %                               |
| Gzipped      | 10,958 bytes | -18.7 %                               |
| Brotli       | 9,695 bytes  | -18.3 %                               |

(See `benchmarks/bundle-baseline.json` for the per-phase history.)

The remaining bytes are concentrated in two modules — `packages/dom/src/primitives/each.ts`
(~16 kB raw) and `packages/dom/src/update-loop.ts` (~12 kB raw) — and the
architecture (Phase 2 flat-binding-array + bitmask gating) imposes a floor.
Realistic v0.4-shape incremental wins are 1–2 kB more before hitting the
floor.

Competitive context (jfb keyed-framework bundle sizes, measured under the
same harness):

| Framework     | Uncompressed | Gzipped     |
| ------------- | ------------ | ----------- |
| vanillajs     | 11.3 kB      | 2.5 kB      |
| solid         | 11.5 kB      | 4.5 kB      |
| svelte        | 34.3 kB      | 12.2 kB     |
| elm           | 31.7 kB      | 10.4 kB     |
| react         | 190.3 kB     | 51.4 kB     |
| **LLui v0.4** | **34.9 kB**  | **11.0 kB** |

LLui sits in the Svelte/Elm cluster — competitive with mature compile-time
frameworks, but 4× Solid's gzipped floor. The 4× gap is architectural: Phase 2
binding-array + scope-tree + keyed-each combined.

Bench timings vs the saved baseline (median-of-3, post-v0.4): 8 of 9 ops
faster, only `Select` shows a sustained +9–34 % outlier (3–4 ms op — at jfb's
measurement-noise floor for that particular operation).

A v0.5 rebuild is justified if **the goal is closing some or all of the gap
to Solid** (≈4× bundle, ≈2× single-msg dispatch perf). If the goal is
"continue tuning the current arch," **Option D** is what we already do — no
new proposal needed beyond noting the diminishing-returns ceiling.

---

## Goals

All four options target the same three axes; they differ in how much of each
they prioritise and how much rewrite cost they accept.

1. **Bundle size.** Concrete target: **≤ 8 kB gz** for the jfb bench shape.
   Stretch: ≤ 5 kB gz (Solid-class).
2. **Per-update perf.** Concrete target: jfb's `Select` op (today's outlier
   at 3–4 ms) within ±10 % of Solid. Other ops already meet or beat Solid in
   our measurements.
3. **DX.** Concrete target: preserve the TEA mental model (`init` / `update`
   / `view` / `effects`) for the **user API**. Compile-time errors via lint
   rules stay (41 rules, all severity `error`). Agent protocol stable.

A proposal that ships against (1) and (2) at the cost of breaking (3) (e.g.,
giving up TEA at the user API) needs to make that tradeoff explicit; see
Option A.

---

## Current architecture (one-paragraph orient)

LLui is a compile-time-optimised TEA framework. State is a JSON-serialisable
object; `update(state, msg)` returns `[newState, effects]`. The vite plugin
runs a 3-pass TypeScript transform that emits, per `component({...})` call:

- `__prefixes` — an array of `(state) => unknown` accessors, one per minimal
  reference-stable path the component's bindings read. Position in the array
  IS the bit position used by per-binding masks.
- `__view` — a factory `($send) => ({ send: $send, ...primitives })`
  containing only the View-bag primitives the view callback destructures
  (added in v0.4 Tier 1.2 to close the all-primitives import-chain leak).
- `__handlers` — per-Msg-variant specialised dispatchers that bypass Phase 1
  for single-message updates by calling specialised `each` reconcile methods
  directly (`reconcileItems` / `reconcileClear` / `reconcileRemove` /
  `reconcileChanged`).

At runtime, `processMessages` (in `packages/dom/src/update-loop.ts`) drains
the message queue, computes a dirty mask via `computeDirtyFromPrefixes` (two
31-bit words, up to 62 paths), then runs:

- **Phase 1** — `genericUpdate` iterates `inst.structuralBlocks` (each /
  branch / show) and calls `block.reconcile` when `(block.mask & dirty) |
(block.maskHi & dirtyHi)` is non-zero.
- **Phase 2** — `_runPhase2` iterates `inst.allBindings` (a flat array) and
  re-evaluates accessors whose per-binding mask intersects the dirty mask.
  Per-row updaters (`each.render` callbacks with zero-arg accessors) bypass
  Phase 2 entirely via `addCheckedItemUpdater`.

The bench's hot paths land in `each.ts` (keyed-diff + row factory) and the
Phase 2 loop. Everything goes through `getInstanceViewBag` (added in v0.4)
which memoises the view bag on the `ComponentInstance` so the per-row bag
allocation pre-v0.4 (which caused a +31 % regression on `Select`) is gone.

---

## The four options

|                            | Bundle target (gz) | Perf shift   | API impact           | Rewrite scope            | Doc                                |
| -------------------------- | ------------------ | ------------ | -------------------- | ------------------------ | ---------------------------------- |
| **A** Fine-grained signals | **3–5 kB**         | Solid-class  | Breaks TEA contract  | Whole runtime + compiler | `option-a-fine-grained-signals.md` |
| **B** Hybrid TEA + signals | **5–7 kB**         | Phase-2-free | None at the user API | Runtime binding model    | `option-b-hybrid-signals.md`       |
| **C** Closed runtime       | **3–5 kB**         | Identical    | None                 | Compiler templating      | `option-c-closed-runtime.md`       |
| **D** Incremental squeeze  | 8–9 kB             | Today's perf | None                 | None — continued tuning  | `option-d-incremental-squeeze.md`  |

`comparison.md` lays the four side-by-side with a decision rubric.

---

## Reading order if you're new

1. **`README.md`** (this file) — context + targets.
2. **`comparison.md`** — the trade-off matrix and the recommendation. If you
   only read one option doc after that, you'll know which.
3. **Per-option doc** — pick the one matching your goal.

Each per-option doc is self-contained. You can ship any option without
having read the others or this README beyond §"Current architecture".

---

## Out of scope for v0.5

- **VDOM.** LLui's value prop is real DOM + compile-time gating. A VDOM
  rebuild abandons the perf story and isn't considered here.
- **Multi-runtime support** (Node-only, Deno-only, etc.). The dom-env
  abstraction stays as-is.
- **Server components / streaming SSR rebuild.** SSR via `ssr.ts` +
  `linkedom` / `jsdom` adapters remains the model. Hydration semantics may
  change _as a consequence_ of a chosen option but aren't a goal in
  themselves.

---

## How to use these docs as an implementer

Each option doc has the same shape:

1. **Summary** — one paragraph, the one-line pitch.
2. **Motivation** — what problem this option solves better than the others.
3. **Target metrics** — concrete numbers (bundle, bench ops).
4. **Architecture changes** — what's removed, replaced, added. File-by-file.
5. **User-facing impact** — API changes (or "none"), migration burden.
6. **Migration plan** — concrete phased steps with measurement gates between
   phases.
7. **Implementation surface** — files affected, key new modules, lines of
   code estimate.
8. **Open questions** — research items the doc can't pre-answer.
9. **Failure modes** — what could go wrong + the rollback story.
10. **Decision rubric** — under which constraints this option wins.

The intent is that an implementer can read one doc end-to-end and know what
to write, in what order, with what measurement gates.
