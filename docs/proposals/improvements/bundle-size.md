# Proposal: bundle size — the real picture (and why the "easy wins" aren't)

**Status:** proposed (mostly a correction + low-priority levers) · **Audience:** future session.

## Headline: bundle health is already good — measured, not assumed

| App                                                   |       gzip | note                                                           |
| ----------------------------------------------------- | ---------: | -------------------------------------------------------------- |
| **Minimal** (counter: `component`/`el`/`text`/`show`) | **3.9 KB** | ≈ Solid (4.5), < Svelte (12.2)                                 |
| jfb keyed (uses `each` + keyed reconcile)             |    ~8.2 KB | the README's headline number — **includes the list machinery** |

The "8.2 KB vs Solid 4.5" framing (README Performance) is **apples-to-oranges**: jfb exercises `each` (keyed reconcile + LIS + the A/B fast paths + `signalEachDirect`), which adds ~4 KB. A real app that doesn't render keyed lists ships ~3.9 KB. **First action: add the minimal-app number to the README so the comparison is honest.**

## Two surveyed "opportunities" that are FALSE — verified, do not pursue

1. **"Devtools (~3–4 KB) ships to prod."** Refuted. `benchmarks/bundle-composition.json` has no `devtools` entry, and the jfb prod bundle has 0 `installSignalDebug` refs. The `import.meta.env.DEV → false` DCE works (see the comment at `packages/dom/src/signals/component.ts:19`); devtools is fully tree-shaken. No action.
2. **"The `dom.ts` monolith blocks per-primitive tree-shaking."** Refuted. An unminified counter build drops `buildSignalEach`/`buildSignalBranch`/`buildSignalVirtualEach`/`lisIndices` (unused) and keeps only `buildSignalShow` (because counter uses `show`). Rollup tree-shakes by export within a module; the single-file layout is fine. Splitting `dom.ts` for tree-shaking would be churn for ~no gain. (Splitting for _readability_ is a separate, optional call.)

## Real (low-priority) levers

The only meaningful weight is the **`each` machinery (~4 KB)** — paid only by list-using apps. It's load-bearing: keyed reconcile + LIS move-minimization + the same-structure/state-fanout fast paths + `signalEachDirect`/`RowFactory`. Possible trims, all small and to be measured before doing:

- **`virtualEach` / `lazy` / `foreign` / `portal`** already tree-shake when unused (verified for counter). Confirm each one is genuinely independent (no shared helper drags a sibling in) — if one pulls another, fixing that is free bytes for apps that use only one.
- **`signalEachDirect` + `RowFactory` path** adds to the `each` cost. It's only emitted by the compiler when a row lowers, but the runtime `buildDirectRow`/`scopeFromSpecs`/`ElementMountable` code ships whenever `each` is imported. If perf-proposal Opportunity A broadens lowering, this becomes universally used (so worth keeping); if not, it's near-dead weight for most apps — measure its standalone byte cost.
- **Core (`mask.ts` chunked reconciler, `runtime.ts`, `populate`/`applyAttr`)** — fundamental to every app's 3.9 KB. Reducing it is an architectural change to the reactive engine; **not worth it** given the minimal app is already ≈ Solid.

## Recommendation

Bundle is **not a problem** — minimal apps are already in the Solid range. The honest action is documentation (publish the minimal-app number), plus a one-time audit that each structural primitive tree-shakes independently. Defer any core-size work; there's no payoff. Re-run `pnpm bench` (bundle columns) + an unminified minimal-app build to re-confirm before acting — numbers above are from a single build (June 2026).
