# Dirty-Mask Precision Follow-Ups

> **Superseded in mechanism (2026-05).** The _goal_ (precise per-binding dirty
> masks, less over-firing) is adopted by [`../signals/`](../signals/README.md), but
> the concrete mechanisms here — the two-word `mask`+`maskHi` layout, runtime
> prefix-walk threshold, `precise` flag, popcount tuning, prefix memoization — are
> replaced by signals' **chunked masks + ref-equality lowering + output-equality
> check**. `03-implicit-each-children.md` is **fully superseded** (signals gives
> each row its own `Signal<T>` with per-row precision, no child-lifting). One
> residual survives: the wide-state immutable-spread cost is intrinsic and not
> framework-reducible. See the signals "Reconciliation" section.

Three optimization proposals that build on the
`feat(benchmarks): add jfb-ticker suite` +
`perf(dom): recompute precise dirty via __prefixes in _handleMsg fast path`
work landed on the `worktree-bench-ticker` branch.

Background: the jfb-ticker benchmark exposed that LLui's `__handlers`
fast path was using a compiler-emitted dirty mask that was
over-approximated at top-level-field granularity (`tryBuildHandlers`
unions `topLevelBits[field]` for every field a case body writes). When
a top-level field has many leaf sub-paths — e.g. `dashboard` with 32
fields in the ticker app — the emitted mask covered the field's entire
bit range, defeating Phase 2's per-binding gate for any commit that
touched only one sub-path.

The shipped runtime patch (`_handleMsg` in `update-loop.ts`) recovers
leaf-path precision at runtime by walking `__prefixes` when the
conservative mask exceeds a popcount threshold of 4. Measured on
jfb-ticker: `narrow×100` -14%, `burst-1k` -19%, no regressions.

This is a partial solution. Three follow-ups address remaining gaps:

| #   | Title                                                | Effort | Ceiling                            | Sequence |
| --- | ---------------------------------------------------- | ------ | ---------------------------------- | -------- |
| 1   | **Compiler-precise case dirty masks**                | weeks  | -12% burst-1k, -11% narrow×100     | high     |
| 2   | **Cross-commit prefix memoization**                  | 1-2 d  | -3% on prefix-walk-heavy workloads | mid      |
| 3   | **each() rows as implicit Level-2 child components** | months | -30%+ on wide-row workloads        | low      |

Each lives in its own file: `01-compiler-precise-dirty.md`,
`02-prefix-memo.md`, `03-implicit-each-children.md`.

## Why these and not others

I considered and ruled out several alternatives. They're not in this
folder because their ROI is negative or they require fundamental
architecture shifts:

- **Set-based dirty instead of bitmask** — `Set.has()` is ~30× slower
  than `&`; regresses everywhere.
- **Lazy binding-input memoization** — already covered by mask gating;
  doesn't add precision.
- **SIMD mask scanning in Phase 2** — JS SIMD is WebAssembly-only;
  layout change costs more than the scan it saves.
- **DOM-write short-circuit** — already implemented (`lastValue` compare
  inside text/attr/class binding application).
- **Immer-style proxies for state mutation** — adds per-read overhead
  on every binding access; net regression on read-heavy workloads.
- **`patch(state, path, value)` API** — splits the ecosystem; breaks
  the TEA "return new state" contract.

## Residual gap that no proposal closes

After all three follow-ups, narrow×100 in jfb-ticker would land at
~1.5ms vs Solid's 1.4ms. The remaining 0.1ms is the user-code 32-field
dashboard spread cost (`{ ...state.dashboard, ...patch }`), which is
intrinsic to immutable-update semantics. The framework cannot reduce
it without changing the user-facing API.

Mitigation is documentation, not framework: flat state stays cheap.
Update `docs/designs/01 Architecture.md` to recommend flat state shapes
when the component has > ~10 frequently-updated paths.
