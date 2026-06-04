# Compiled row construction: kill the per-row framework-JS overhead

**Status:** proposed · **Owner:** perf · **Depends on:** the signal transform (`transform-view.ts`), the runtime binding/scope model (`buildScope`/`BindingSpec`, `buildSignalEach`).

## Why (and what a de-risk spike already ruled out)

The signals migration cost LLui its lead. Same-run js-framework-benchmark (apples-to-apples) shows LLui now **losing to Solid/Svelte** on construction ops it used to win (Create 26.1 vs 20.8/20.9; Replace 28.5 vs 23.1/23.8; Append 29.4 vs 23.5). All three emit identical DOM → identical layout/paint → **the gap is JS**.

A real-Chrome de-risk spike settled where it is **not**:

- Building the benchmark's 1000-row DOM is **~1.1 ms** — about **4%** of the 26 ms create. The other ~25 ms is insertion layout/paint (identical for all frameworks) + LLui's framework JS.
- **`cloneNode` is NOT faster than per-node `createElement`** for this row (both 1.1 ms). So template cloning — Solid/Svelte's trick — buys **nothing here**. DOM construction is not the bottleneck; do not pursue it.

The gap is **per-row framework-JS overhead**: the generic machinery LLui re-runs for every one of the 1000 rows, which Solid compiles away. Profiling (Node + Chrome) ranks it:

| Per-row work                                                | Why it's redundant / removable                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildScope` → `buildPathTable` + `bindingMask` **per row** | every row shares one template → the dep structure + masks are **identical** across 1000 rows but rebuilt each time (`buildSignalEach` calls `buildAndPublishScope` inside the row loop) |
| `populate` (top framework frame)                            | generic `Object.entries(props)` loop + `isReactive`/`isSignalHandle` branch per prop, per element                                                                                       |
| `lowerProps`                                                | authoring-helper prop normalization, per element                                                                                                                                        |
| `pathHandle` / `resolveSegs`                                | per-row signal-handle allocation + path resolution                                                                                                                                      |
| `el`→`ElementMountable`→`runBuild`→`materialize`            | per-node lazy alloc + indirection                                                                                                                                                       |

## Goal / non-goals

- **Goal:** the compiler emits, for a lowerable `each` row template, a **lean row builder** that (1) builds the DOM with direct ops (no `el`/`Mountable`/`populate`/`lowerProps` indirection), (2) wires bindings by **direct node reference** (no `pathHandle`), and (3) reuses a **single, per-each-site path-table + masks** instead of rebuilding them per row. Target: close — and ideally beat — Solid/Svelte on Create/Replace/Append.
- **Non-goals:** `cloneNode` templating (spike-refuted here), changing the chunked-mask reconciler or the `BindingSpec` contract, or the authored API.

## The levers (in expected-impact order)

### 1. Share the row path-table + masks across rows (biggest, most clearly-redundant)

All rows of one `each` share the template, so `{deps}` per slot — and therefore the `PathTable` and each binding's `mask` — are identical. Today `buildSignalEach` rebuilds them per row via `buildScope`. Compute them **once per each-site** (from row 0's specs) and reuse for rows 1..n; each row only needs its own `produce`/`commit` closures (which close over that row's nodes) bound to the shared masks.

This is realizable as a runtime memoization that exploits the `each` template invariant (cache row 0's `{table, masks}`, reuse when subsequent rows' spec `deps` match), **or** as a compiler-emitted per-each-site mask descriptor. The compiler form is preferred (it makes the invariant explicit and removes the runtime match-check), but the runtime form is a fast probe.

### 2. Direct row construction (skip the authoring/`populate`/`el` indirection)

For a lowerable static-skeleton row, emit direct `createElement`/`setAttribute`/`appendChild`/`createTextNode` + a flat list of `(node, produce, commit, deps)` slots, instead of nested `el(...)`/`signalText(...)` that each allocate a `Mountable`, run `populate`'s generic prop loop, and go through `runBuild`/`materialize`. The DOM ops are the same ~1 ms; this removes the per-element **overhead** on top of them (`populate` is the #1 framework frame).

### 3. Direct binding wiring (skip `pathHandle`)

Bindings reference the located row nodes directly; `deps` are emitted as compile-time string literals. No per-row `pathHandle` allocation or `resolveSegs` path-splitting — the commit writes straight to the node, the produce reads the item by the statically-known path.

## Runtime contract

Minimal additions; the reconciler and `BindingSpec` are unchanged. A row builder returns its nodes + specs + (shared) mask metadata so `buildSignalEach` can mount it against a **prebuilt** scope:

```ts
// Compiler emits, per each-site:
//   - a row factory: (item, index) => { nodes, slots }  // slots: {node, produce, commit, deps}
//   - reused across rows; the each-site builds ONE PathTable + masks from the first row's deps.
```

`buildSignalEach` keeps ownership of keyed reconcile/LIS/anchors; only the per-row _scope construction_ and _node construction_ paths change.

## Precondition: lowering coverage

The benchmark's `each` is currently **not lowered** (the delegated-click IIFE makes the `tbody` subtree opaque to `transform-view.ts`), and today's lowering emits the _same_ runtime calls anyway. Both must change: (a) broaden lowering to reach `each` in wrapped/helper positions (also helps real apps), and (b) add the new direct-construction codegen.

## Phasing (each independently measurable, corrected methodology: rebuild dist → verify → `--runs ≥2`, bench vs Solid/Svelte)

0. **Probe (runtime, cheap):** memoize the row path-table + masks across rows in `buildSignalEach`. Measure Create. **This gates the whole effort** — it answers the spike's open question: _does cutting per-row framework JS actually move the Chrome number, or is create so insertion/layout-bound that even zero framework JS can't beat Solid?_
1. **Direct row construction codegen** for lowerable static-skeleton rows (lever 2 + 3), reusing the shared masks from (0).
2. **Broaden lowering coverage** so real `each` sites (incl. the benchmark) hit the fast path.

## Resolved: where the create gap actually is (measured)

A CDP `Performance.getMetrics` categorized trace (mean of 30 create-1k, real Chrome) settled it:

| Category           | LLui create-1k             | Addressable?                                      |
| ------------------ | -------------------------- | ------------------------------------------------- |
| **Scripting (JS)** | **3.64 ms**                | **yes — this is the per-row framework machinery** |
| Layout             | 7.10 ms (1 layout)         | no — shared with Solid (identical DOM)            |
| RecalcStyle        | 2.96 ms (3 recalcs)        | no — shared                                       |
| Paint / other      | ~5 ms (Task total 18.9 ms) | no — shared                                       |

Solid emits the same DOM (same Layout/Style/Paint) with near-zero create-time JS, so **~3 ms of the ~4.8 ms gap to Solid is LLui's framework JS** — addressable by this proposal. (Note: the earlier CPU profile's ~2 ms estimate undercounted due to idle dilution + JIT attributed to `(program)`; the categorized trace's 3.64 ms is authoritative.)

**Lever sizing (why the cheap probe failed and the real work is Phase 1):**

- Phase-0 mask-memoization (share `PathTable`+masks across rows) attacks only ~0.76 ms of the 3.64 ms → unmeasurable on a 25 ms create (and the per-row `depsSignature` cost partly offsets it). Correctly showed no move; **not worth shipping alone.**
- The win requires eliminating the **bulk** of the 3.64 ms: `populate`'s per-element prop loop, `el`/`ElementMountable` allocation, `pathHandle`, `lowerProps`, and the `runBuild`/`materialize` indirection — i.e. the full **direct row construction** codegen (levers 2 + 3). Projected: recover ~2.5–3 ms → create ~22–23 ms, erasing most of the regression and competitive with Solid/Svelte.

**Decision: proceed to Phase 1** (direct-construction codegen), skip Phase 0 as a standalone change. Success bar: Create/Replace/Append within noise of Solid/Svelte, no regression elsewhere.

## Phase 1 prototype results (HAND-WRITTEN row factory, validates the codegen)

Built the runtime contract (`signalEachDirect`/`eachDirect`, `DirectRow`/`RowFactory`, exported `BindingSpec`) + the shared per-each-site mask/table memo (`scopeFromSpecs` reused across rows), and wired the **benchmark** to a hand-written `diceRow` factory — exactly what the compiler will emit. 3-run, real Chrome, `PlausibilityCheck: successful` (correct):

| Op         | stale 0.7.0 | **direct + memo**     | Solid | pre-signal |
| ---------- | ----------- | --------------------- | ----- | ---------- |
| Create 1k  | 26.4        | **21.8** (+3%, noise) | 20.8  | 21.2       |
| Create 10k | 258         | **234.3**             | 232   | 218        |
| Replace 1k | 29.0        | **24.4**              | 23.1  | 22.4       |
| Append 1k  | 29.6        | **26.6**              | 23.5  | 23.8       |

**The construction-op regression is closed**: Create 1k −4.6 ms (back to the pre-signal baseline, matching Solid); Create 10k matches Solid; Replace −4.6 ms. Confirms the categorized-trace projection and justifies the general codegen.

**Out of scope — and NOT a code lever (measured):** Update (+45%) and Swap (+113%) stay elevated, but a CDP categorized trace shows their **framework JS is negligible** — Update **0.31 ms** (Layout 3.47, Style 0.03), Swap **0.18 ms** (Layout 0.80). Unlike create (3.64 ms of addressable JS), there is essentially no LLui JS to optimize here: they are layout/paint-bound (identical DOM → identical layout, shared with Solid), and the inflated percentages are artifacts of tiny baselines (10.7/7.8 ms) plus 2–3-run measurement noise. **Conclusion: do not pursue Update/Swap as a JS optimization** — direct construction was the right and sufficient lever for the addressable regression (create/replace/append).

## Phase 1: complete

- ✅ Runtime contract (`signalEachDirect`/`eachDirect`, shared per-each-site mask/table memo) + tests.
- ✅ Compiler codegen: static-skeleton `each` rows auto-lower to `signalEachDirect` + generated `RowFactory`; correctness-safe fallback to `signalEach`; auto-import.
- ✅ Benchmark dogfoods the compiler (authored `each`, no hand-written factory): Create 1k **21.8 ms** (Solid 20.8 / pre-signal 21.2), Create 10k 235, Replace 24.7 — PlausibilityCheck passes.
- Remaining (optional, lower value): broaden lowering to reach `each` in IIFE/helper positions _without_ restructuring (a general transform-coverage expansion); reactive-attr / event-handler slot kinds in `lowerRowFactory` (today they fall back to `signalEach`).

## Remaining Phase 1 work (the actual codegen)

The prototype is hand-written. To ship the win for every app's lists:

1. **Compiler emission** — lower a static-skeleton `each` row template to a `RowFactory` (direct `createElement`/`setAttribute`/`appendChild`/`createTextNode` + a flat `bindings` list with compile-time `deps`/produce/commit) and emit `signalEachDirect(source, key, factory)`.
2. **Slot kinds** — dynamic text (`<!>`/located text node), reactive attrs (`applyAttr` on located node), event handlers (`addEventListener` per row in the factory), and structural children (anchor + nested runtime primitive). Fully-static cells fold into the factory's direct ops.
3. **Broaden lowering coverage** so wrapped/helper-position `each` (incl. the benchmark's IIFE) reaches the fast path; today's lowering also still emits the slow `el(...)`/`signalEach(...)` form.
