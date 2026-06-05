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

## Real (low-priority) levers — now MEASURED

The two levers below were the only candidates. Both were measured empirically (Rollup tree-shake of `@llui/dom`, min+gzip, marginal cost per primitive, plus a stripped-rebuild coupling probe — June 2026). **Result: neither yields an actionable byte win above single-build noise.**

### Per-primitive marginal cost (gzip, vs an `el`+`text` core of 1,224 gz)

| import         | Δgz vs core | siblings dragged in   |
| -------------- | ----------: | --------------------- |
| `+show`        |      +1,732 | none                  |
| `+branch`      |      +1,741 | none                  |
| `+each`        |      +3,101 | **eachDirect**        |
| `+eachDirect`  |      +3,103 | **each**              |
| `+virtualEach` |      +2,208 | none                  |
| `+lazy`        |      +2,912 | none                  |
| `+foreign`     |        +367 | none                  |
| `+portal`      |        +146 | none                  |
| `+provide`     |        +175 | none                  |
| `+unsafeHtml`  |        +323 | none                  |
| ALL primitives |      +6,547 | (≪ sum → shared core) |

- **Tree-shake independence — CONFIRMED CLEAN.** Every structural primitive _except_ `each`/`eachDirect` retains **only its own build path** with zero sibling drag (`show`/`branch`/`virtualEach`/`lazy`/`foreign`/`portal`/`provide`/`unsafeHtml`). The hoped-for "one primitive pulls another → free bytes" yields **nothing** — they're already independent. No action.
- **`signalEachDirect` + `RowFactory` path — NOT separable weight.** `signalEach` and `signalEachDirect` both funnel into a single merged `buildSignalEach` (render branch + direct branch via `buildDirectRow`/`directShape`), so importing either ships both — but the direct path is **~8 bytes uncompressed** of marginal cost. A stripped-rebuild probe (delete the direct branch, recompile) confirmed render-only `each` drops only **~108 bytes gz / ~360 bytes uncompressed**. The remaining **~2,900 bytes gz is the shared keyed-reconcile core** (LIS move-minimization, the Row map, same-structure/state-fanout fast paths, scope build) — irreducible and load-bearing. Splitting `buildSignalEach` to decouple the paths would refactor a hot, subtle reconciler for **~100 bytes gz**. **Not worth it.** (`scopeFromSpecs` is shared core, not direct-exclusive — it also backs `buildScope`/`el`/`populate`.)
- **Core (`mask.ts` chunked reconciler, `runtime.ts`, `populate`/`applyAttr`)** — fundamental to every app's 3.9 KB. Reducing it is an architectural change to the reactive engine; **not worth it** given the minimal app is already ≈ Solid.

### Cross-primitive sharing — already high (so little duplication to factor)

Combination probes (Δgz vs the same `el`+`text` core) show the per-primitive costs are NOT additive — shared arm-swap / scope-swap / keyed-reconcile helpers are already factored:

- `show` (+1,731) + `branch` (+1,740) → together only **+1,945** gz (**44% shared**).
- `each` (+3,099) + `virtualEach` (+2,209) → together only **+3,832** gz (**28% shared** — `virtualEach` reuses `each`'s keyed reconcile, adding ~733 gz on top).
- `show` + `branch` + `each` together → **+3,620 gz ≈ `each` alone**. The common primitive set costs barely more than the list machinery by itself. There is almost no remaining duplication to merge.

### `lazy` weight is inherent, not trimmable

`lazy` is +2,911 gz because it **pulls in the component runtime** (`mountSignalComponent`/`buildSignalSubApp`) — it loads and mounts a child component, so it _needs_ the mount path. That cost is shared with any app that already uses a child component, so its isolated number overstates real-world weight. Not a lever.

### Error/warning strings — negligible + load-bearing for DX

The signal runtime ships ~468 raw bytes (~250 gz) of descriptive `throw`/`console` strings. React-style prod replacement (descriptive message → numeric code + external lookup) is the only way to strip them, and it would gut the LLM-first debugging DX for ~250 gz. Not worth it.

## Code-splitting (≠ tree-shaking) — the one conditional "lazy" lever

These two are different and the survey conflated them. **Tree-shaking** (drop unused exports) works fine on the single `dom.js` module — refuted point #2 stands. **Code-splitting** (place a _used_ export into an async chunk) does NOT work within one module, and that's a real, distinct limitation:

> Measured: an entry that statically imports only `el`/`text` and then `import()`s a "route" using `each`/`virtualEach`/`lazy` emits a **68-byte** route chunk — the route-only primitives are **hoisted into the main bundle**. Rollup can't split one module across chunks, so the moment the entry touches `@llui/dom` (every app does, via `el`/`text`), the whole `dom.js` module — including route-only primitives — lands in main.

What this would enable IF `dom.ts` were split into per-primitive modules over a shared core: an app that code-splits its routes (`lazy()`/router) and keeps heavy list primitives off the **initial** route could push `each`'s ~3 KB gz (and `virtualEach`/`lazy`) into the async route chunk, trimming the **initial** download. Caveats that decide worth:

- **Defers bytes, doesn't remove them.** Total shipped is unchanged; only the initial bundle shrinks.
- **Only the primitive-_exclusive_ code moves** (~3 KB gz for `each`). The shared core (`buildScope`/`scopeFromSpecs`/`populate`/`runtime`) stays in main because `el` uses it; the route chunk imports it cross-chunk.
- **Only helps apps that (a) code-split routes AND (b) confine heavy primitives to non-initial routes.** A list on the landing page gains nothing.
- **It's a real refactor** of a hot file: drawing a clean shared-core / per-primitive-module boundary.

**Verdict: defer** unless a concrete app in hand route-splits _and_ has a list-heavy secondary route — the only profile where it pays (~2–3 KB off initial load for that profile). For a typical small LLui app it's churn with no benefit. Sharper than the levers above because the enabling mechanism (per-module code-splitting) is real and measured — worth revisiting only when such an app exists. Lazy-loading errors/warnings or view-time primitives is NOT viable: both run synchronously (throw sites / sync `view()` mount), so `await import()` can't apply without an async-mount rewrite.

## Recommendation

Bundle is **not a problem** — minimal apps are already in the Solid range, and the per-primitive audit is now done: primitives tree-shake independently, and the only coupling (`each`↔`eachDirect`) is by-design with a sub-100-byte-gz separable payoff. The single payoff-positive action is documentation (publish the minimal-app number). Defer all core-size and `each`-split work; there's no payoff. To re-confirm, re-run the per-primitive audit (reference each runtime `signalX` export in an isolated entry, Rollup min+gzip, diff vs an `el`+`text` core) + `pnpm bench` bundle columns — numbers above are from a single build (June 2026).
