# Improvement proposals — survey & index

Written after the 0.8.0 `signalEachDirect` + reconcile-perf release (June 2026) as a hand-off for future sessions. Each linked doc is grounded in real investigation (transforms, builds, CDP traces) — claims marked "verified" were measured this session; re-confirm before acting (code drifts).

**Guidelines for picking these up:** engineering excellence, DX-first, no shortcuts. Measure before optimizing (see `reference-perf-measurement` memory + `../v2-compiler/compiled-row-construction.md`).

## The proposals

| Doc                              | One-line                                                    | Highest-value item                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [perf.md](perf.md)               | Direct-row fast path reaches almost no real code            | **Lower `each` rows with item-referencing handlers** (todomvc-shape) — the universal list pattern currently falls to the verbatim path |
| [dx.md](dx.md)                   | Error-message clarity + API ergonomics, LLM-authoring-first | Lint messages that quote the fix; `.at()`-after-`.map()` as a compile error not a runtime throw                                        |
| [bundle-size.md](bundle-size.md) | Already healthy (minimal app 3.9 KB ≈ Solid)                | Mostly a correction — publish the minimal-app number; defer core work                                                                  |

## Cross-cutting VERIFIED facts (don't re-derive)

- **Two perf regimes:** jfb create/replace/append are **layout/paint-bound** (JS micro-opts sub-noise); ticker/streaming-update ops are **JS/reconcile-bound** (real headroom). Localize with a CDP `Performance.getMetrics` Script/Layout/Style split, paint-settled — not a CPU profile (idle-diluted).
- **Bench hygiene:** rebuild `dist` before benching (bundles from `dist/`); run LLui-only for LLui changes; machine drifts ~2× run-to-run → cross-framework needs one same-run pass; small-op numbers (swap/update) are cold-start-inflated. **Competitor numbers in saved baselines were re-measured between runs and DO drift** — to judge "did LLui regress," pull LLui's OWN absolute number per op across commits (`git show <c>:benchmarks/jfb-baseline.json`), not the relative gap to a competitor.
- **DOM-op count ≠ speed:** the browser coalesces write-only DOM mutations and lays out once per frame; the reconcile never reads layout mid-pass. So fragment-batched insert and `Range.deleteContents` bulk-remove are measured non-wins vs N `insertBefore`/`removeChild`. Isolate the mechanism in a real-Chromium A/B before assuming a DOM-op reduction helps.
- **Bundle:** minimal app = 3.9 KB gzip; the 8.2 KB headline is the `each`-machinery-included jfb number. Devtools IS tree-shaken in prod; structural primitives DO tree-shake per-use.
- **The A/B reconcile fast paths (0.8.0)** live in the shared `buildSignalEach`, so **all** `each` benefit (including the verbatim authoring path) — only _direct construction_ is gated behind lowering.

## Recorded DEAD-ENDS (verified non-opportunities — do NOT re-chase)

- ~~`cloneNode` templating (clone == createElement)~~ — **REFUTED + SHIPPED** (38% faster on a real multi-node row; see perf.md).
- ~~Lean per-row scope micro-opts — sub-noise~~ — **REFUTED + SHIPPED** (jsdom masked it); plus class-based scope (50% scope-create). See perf.md.
- **Fragment-batched insert / `Range.deleteContents` bulk-remove** — measured non-wins (browser coalesces DOM mutations + layout). (2026-06-07)
- **Slot-model** (no per-row binding objects/closures) — measured non-win (0.008 µs/row). (2026-06-07)
- **Restoring legacy specialized swap/remove/replace reconcile paths** — measured non-win (~54 µs/op ≈ 0.4% of the op). The reorder "regression" was competitor variance, not an LLui slowdown — LLui's absolute numbers improved on every jfb op across the signals migration. (2026-06-07)
- create-10k / append as JS targets — layout/paint-bound; at the noise floor after cloneNode + scope work.
- swap/update "regressions" — high-variance/cold-start (pre-signals swap ranged 8.6–13.9); don't read single-baseline deltas as regressions.
- "Devtools ships to prod" and "`dom.ts` monolith blocks tree-shaking" — both false (tree-shaking works).

## Not yet surveyed (open axes for a future pass)

- Correctness/edge-cases (SSR/hydration boundaries, `foreign`/`portal` lifecycle), test-coverage gaps, docs gaps. A `correctness.md` / `docs.md` could join this folder.
