# Proposal: performance — extend the direct-row fast path to real code

**Status:** proposed · **Owner:** perf · **Audience:** a future session picking this up cold.

Read [[../../../.claude]] memory `reference-perf-measurement` first (or the summary in `docs/proposals/v2-compiler/compiled-row-construction.md`). TL;DR of the methodology: **measure with a CDP categorized split (Script/Layout/Style), rebuild `dist` before benching, run LLui-only for LLui-change measurement, and trust LLui-vs-LLui deltas (the machine drifts ~2× run-to-run).** jfb create-ops are layout-bound (don't micro-opt JS there); ticker/streaming-update ops are JS/reconcile-bound (real headroom).

**Two methodology lessons added 2026-06-07 (read before chasing a "regression"):**

1. **Isolate the mechanism; don't trust DOM-op counts.** A change that reduces DOM mutations (fragment-batched insert, `Range.deleteContents` bulk-remove) is NOT automatically faster: the browser already coalesces write-only DOM mutations and lays out once per frame, and the reconcile never reads layout mid-pass — so N `insertBefore`/`removeChild` ≈ one batched op. Both measured non-wins (see dead-ends). Build the isolated real-Chromium A/B before assuming.
2. **A "we were faster before" claim is settled by the ABSOLUTE trajectory, not the relative gap.** Competitor numbers in the saved baselines were re-measured between runs and drift (Solid Remove 10.5→11.8→9.7 across baselines), so "LLui beat Solid on N/9 ops" shifts even when LLui doesn't change. Pull LLui's OWN absolute number per op across the relevant commits (`git show <c>:benchmarks/jfb-baseline.json`). Done 2026-06-07: **LLui improved on every jfb op across the signals migration** — no LLui regression; the relative shift was competitor variance.

## What already shipped (0.8.0) — and its reach

- `signalEachDirect` + compiler codegen: a static-skeleton `each` row lowers to a `RowFactory` (direct DOM + bindings by node ref). **But it only reaches rows the compiler actually lowers.**
- Two reconcile wins in `buildSignalEach` — **same-structure fast path** (skip the O(n) keyed scan for in-place updates) and **state-fanout gating** (skip the all-row sweep when read state-paths are unchanged). These live in the shared reconcile, so **every `each` benefits, including the verbatim authoring path**. (burst-1k 31.7→15.9.)

## Create-ops: cloneNode templating + lean per-row scope — ✅ SHIPPED (2026-06-06)

Closes the create-ops gap to Solid/vanilla. The root cause: `signalEachDirect`'s `RowFactory` built every row via ~23 per-node `createElement`/`setAttribute`/`appendChild` calls — while **both** frameworks LLui trailed on create (vanillajs `rowTemplate.cloneNode(true)` in `frameworks/keyed/vanillajs/src/Main.js`, Solid compiled `cloneNode`) clone a hoisted template.

- **cloneNode codegen** (`packages/compiler/src/signals/transform-view.ts` `lowerRowFactory`): the row now compiles to an IIFE caching a static **skeleton** (elements + static attrs + literal text, built once via `createElement`) and returns a `(doc, getCtx)` factory that does `_sk.cloneNode(true)` per row + a `childNodes`-index walk to the dynamic nodes (reactive/per-row text, elements with reactive attrs/handlers). The runtime `DirectRow` (`{nodes, bindings}`) contract is **unchanged** — only construction changed. Falls back unchanged for everything that already bailed. **Measured −38% / −0.41 µs/row** row construction (real-Chromium, isolated, 3 stable runs).
- **Lean per-row scope** (`packages/dom/src/signals/runtime.ts` `createSignalScope` + `dom.ts` `buildDirectRow`): `last` Map→position-indexed array; `children` Set→null-until-`addChild`; `dirty` Uint32Array→lazy; direct-row `descriptors`→shared frozen-empty; no per-row specs copy. **−0.17 µs/row** scope cost (V8), update path 3.8% faster, **−10% Run-1k memory** in the full bench.
- **Incidental bug fixed**: lowered `'aria-hidden': 'true'` emitted `setAttribute("'aria-hidden'", …)` (quoted-key not unquoted) — now `setAttribute("aria-hidden", …)`.
- **Same-session A/B** (drift-controlled, fresh OLD baseline): Create 10k 222.1→217.1 (−2%), Run-1k mem 2.9→2.6 (−10%), all other ops within ±1-3% noise, **no regressions**. The create win is ~2% because these ops are ~95% layout — but that ~2% JS slice is the entire inter-framework delta to Solid (see methodology note below). Tests: `transform-view.test.ts`, `transform-component.test.ts`, `each-direct-codegen.test.ts` (clone+walk dispatch-by-id / reactive / reorder, end-to-end in jsdom).

## Class-based per-row scope — ✅ SHIPPED (2026-06-07, commit `67c3ab73`)

`createSignalScope` returned a closure-captured object literal (object + 4 method closures = 5 allocations/row); `each` builds one scope per row, so a 10k create allocated 50k objects of scope plumbing. Now a class instance `SignalScopeImpl` (1 allocation/row, methods on the prototype), same behavior/lazy discipline. Isolated V8: **~50% faster scope create+mount (0.135→0.067 µs/row)** + proportionally less GC. Sub-noise on the layout-bound bench; a clean win with a memory benefit. 246 dom tests green.

## Final state & measured conclusion (2026-06-07) — create is at the noise floor; the regression was a phantom

Triggered by a "LLui used to beat Solid; the signals migration deteriorated it" pushback. Investigated against the git-history baselines (no re-benching) — and the conclusion **redirects all future jfb perf work**:

- **No LLui regression.** LLui's OWN absolute jfb numbers IMPROVED on every op across the signals migration (Apr-legacy→now): Create1k 23.9→21.1, Create10k 237→216, Replace 25.7→23.0, Update 13.6→11.1, Select 2.9→2.5, Remove 10.8→10.4, Append 27.3→25.3, Clear 11.1→10.0 (Swap 13.9→13.7, within its noise band). The signals migration sped LLui up.
- **The "we beat Solid before" snapshot was competitor variance.** The last pre-signals baseline (`a60cd678`, May) had LLui beating Solid on 5/9 ops — but that was a run where SOLID measured slow (Remove 11.8, Swap 14.2); the current run has Solid fast (9.7, 12.9). LLui's numbers barely moved. Same-run-within-a-baseline is valid; cross-baseline competitor numbers are not.
- **The legacy reconcile's techniques are measured non-wins at jfb scale.** The deleted legacy `each` (`6fcb5291^:packages/dom/src/primitives/each.ts`) had dedicated swap/remove/replace fast-paths (allocation-free parallel walks, `Range.deleteContents`, fragment insert, raw `string|number` keys, a `survivorsInOrder` gate). Measured: fragment-insert and `Range`-remove are coalesced-away (0% / non-win); the specialized-vs-general reconcile JS bookkeeping (`String(key)`×n + `newKeys`/`newRows`/`seen`/`oldPos`/`sources`/`lisIndices`) is only **~54 µs/op on 1000 rows (76→22 µs) ≈ 0.4 % of a ~13 ms op**. Restoring them recovers nothing visible.
- **What we can derive from Solid/Svelte:** their reconcile/DOM cleverness is exactly what's coalesced-away here; their real edge is fine-grained per-cell reactivity, which shows up only in the **ticker/streaming** suite — where LLui already LEADS (same-structure fast path + state-fanout gating beat Solid's stores on burst updates).
- **Compiler leverage (the one thing beyond Solid/Svelte):** the compiler can read the reducer and classify the array op (`filter`→remove, `[...,x]`→append, index-swap→swap) to make reconcile O(changed) instead of O(n) — legacy LLui had this (`79afaa05`). It's real architecture, but **also sub-noise for jfb** (append O(added) saves ~0.1 ms of a 25 ms op); it only pays off on huge, high-frequency, non-virtualizable lists — already covered by `virtualEach` + the same-structure fast path. Build it only behind a concrete such workload.

**Recommendation:** stop optimizing the nine jfb ops — LLui is at Solid parity within measurement noise, improved across the migration, and those ops are layout-dominated at the noise floor. The next _visible_ win lives in the suites contested on merit (ticker/streaming) or in DX/bundle, not here.

## The finding that drives this proposal

**Real list rows do not lower at all today** — not even to `signalEach`. Verified by transforming the examples:

- `examples/todomvc/src/main.ts:124` — the `each` stays **verbatim `each(`** in the compiler output (0 `signalEach`, 0 `signalEachDirect`).
- Cause: the row has **item-referencing event handlers** — `onClick: () => send({ type: 'toggle', id: item.at('id').peek() })`. `lowerArmArray` (`packages/compiler/src/signals/transform-view.ts`) detects the row param `item` leaking into a verbatim handler position and returns `null` → the whole `each` is emitted verbatim, so the runtime authoring `each` (real item handles) renders it.

This is the **universal** list pattern (toggle/remove/select by row id). So:

- The direct-construction fast path (`signalEachDirect`) currently benefits **almost no real code** — only rows with no item-referencing handlers (the jfb benchmark, after it was restructured to a delegated click).
- Real rows fall to the verbatim path: per-row authoring helpers + `pathHandle` allocation + `el`/`Mountable` + `populate` per node, per row. (They DO get the A/B reconcile wins on update, just not direct construction on create.)

## Opportunity A (highest value) — lower rows with item-referencing handlers/reads — ✅ SHIPPED

Brought the direct-construction path to the common list row by emitting handlers that bind the row's item. Subsumed the old "handler slots" + "lowering coverage" items.

- **Compiler** (`packages/compiler/src/signals/transform-view.ts`): the `each` branch now tries `lowerRowFactory` FIRST. The factory emits `(doc, getCtx) => …`; an `on*` handler that is a plain arrow/function is attached via `addEventListener`, with its `item`/`index`/`state` `.peek()` reads rewritten to live-row-ctx reads (`item.at('id').peek()` → `getCtx().item.id`) by `rewriteHandlerReads`. Reactive props — including IDL props (`checked`/`value`/`selected`/`indeterminate`) and `style.*` — bind through the exported runtime `applyAttr`, so the canonical `input({ checked: item.at('done'), onClick: … })` row lowers fully. A leak guard (`loweredLeaksIdent`) bails to `signalEach`/verbatim if a row param survives as a free identifier (a non-peek handle use); a `tagSend(...)` handler also bails (its agent-variant registration needs the authoring path).
- **Runtime contract** (`packages/dom/src/signals/dom.ts`): `RowFactory = (doc, getCtx) => DirectRow`; `buildSignalEach` passes `() => holder.ctx` (the live `{ item, state, index }` box the reconcile keeps current). `applyAttr` is now exported from `@llui/dom` and listed in the compiler's `RUNTIME_HELPERS`. Handler closures read `getCtx()` at event time, so dispatch-by-id stays correct across keyed reorders.
- **Result:** the real `examples/todomvc` `each` lowers to `signalEachDirect` (was 100% verbatim). Measured **~20% less JS create cost** for 10k handler-bearing rows (142→113 ms, JS-only in jsdom; a real browser dilutes this with shared layout cost, but the JS reduction is real). Update path is the shared reconcile — unchanged. Tests: `transform-view.test.ts` (handler/index/state lowering, leak + tagSend fallback) and `each-direct-codegen.test.ts` (todomvc-shaped dispatch-by-id, reactive `checked`, dispatch-correct-after-reorder).

## Opportunity B — `send()` coalescing for burst/streaming — ✅ SHIPPED

`burst-1k`/`tick-100` are N **synchronous** `send()`s = N reconciles + N commits (LLui `send()` applies immediately, no batching). A/B made each reconcile cheap, but there were still N of them.

**Key insight that shaped the design:** frame-deferral's apparent benefit (batching DOM writes to avoid layout thrash) is largely illusory here — the browser already coalesces write-only DOM mutations and paints once per frame, and LLui's reconcile never forces layout. So a burst's real cost is the redundant **JS reconcile work** (N passes) + overwritten property writes, not N layouts. Coalescing eliminates that **synchronously, with no deferral** — so we keep the synchronous contract instead of trading it away.

**What shipped (this session):**

- **Substrate** (`packages/dom/src/signals/component.ts`): the `send` drain now runs all queued reducers to quiescence, then reconciles + notifies **once** per settle (re-looping if the commit enqueues, e.g. a `blur` from a node removal). Behavior-preserving for normal sends (each top-level send still commits once); it's the substrate `batch` builds on.
- **`batch(fn)`** — opt-in, on the handle AND in the view/`onEffect` bag (alongside `send`, per author request). Holds the single commit across a burst of top-level sends; reducers run in order and effects fire per message; the DOM commit + subscriber notification fire once against the final state at the outermost `batch` exit (flushes on throw too). Sync contract holds at the boundary. **~13× on a 1k-tick burst against a 200-row table (7.8→0.6 ms, JS-only jsdom), identical final DOM.**
- **Compiler auto-wrap (the A-style automatic slice)** (`transform-view.ts` + `transform-component.ts`): a straight-line handler that does nothing but call `send(...)` ≥2 times is auto-wrapped in `batch(() => …)` (provably safe — no statement between the sends can observe interim DOM), and `batch` is injected into the bag destructuring when used. Conservative: any non-`send` statement, `tagSend`, async, or renamed-`send`-not-found → left verbatim.

**Decision recorded — NO default microtask/rAF auto-batching.** Considered and rejected as a _default_: it would redefine `send` from synchronous to deferred, breaking the agent protocol's synchronous state frames, the test/`flush` ergonomics, the `send(a); el.offsetHeight` read-after-write guarantee, and — most importantly — LLui's synchronous **predictability** (a core LLM-friendliness value). It also buys no paint saving over synchronous writes (see the insight above).

### Option 4 (future, opt-in only) — a frame-scheduled mode

If a genuinely high-frequency consumer appears (a game loop, a 144 Hz feed) that _wants_ DOM-lags-state-by-a-frame for max throughput, add an **opt-in** scheduler — e.g. `mountSignalComponent(…, { scheduler: 'raf' })` or a `sendAsync` that coalesces all sends in a frame and reconciles at the next `requestAnimationFrame`. Requirements if pursued: a non-browser fallback (SSR/jsdom/headless agent have no rAF → microtask or synchronous), a real `flush()` to force a synchronous commit (tests/agent), and explicit docs that `getState()` and the DOM diverge between frames. **Not a default**; only build it when a real workload needs it.

## Opportunity C — cross-function `each`-row lowering — ✅ SHIPPED (phases 1–2 + coverage)

Block-body rows, `each` inside view-helper functions, and same-file helper-row inlining all lower now. Full writeup + the remaining **phase 3 (cross-file/precompiled-library)** notes live in `docs/proposals/v2-compiler/cross-function-row-lowering.md`. TL;DR for a future session: phase 3 is blocked by (a) the lowering transform having no `Program`/checker and (b) cross-file source-inlining breaking scope (the helper body's free refs aren't importable into the consumer) — so the only sound path is a precompiled-library row-factory ABI, worth it only if shipping precompiled component packages.

## Opportunity D (analyzed — NOT recommended) — element-level dirty tracking

The chunked-mask reconcile is path-level; a future idea was element/row-level dirty tracking to make a partial-list update O(changed) instead of O(rows). **Measured evidence says don't:**

- **Fine-grained reactivity loses here.** Solid (the per-cell exemplar, which does exactly granular path-tracking via stores) is SLOWER than LLui on both ticker burst ops: `burst-1k` 21.4 vs **16.0**, `batch-1k` 12.0 vs **6.0** (real-browser medians, this branch's `batch-1k` run).
- **The row scan isn't the cost.** The same-structure fast path's per-row `Object.is(item, row.ctx.item)` is ~ns and only the changed rows do work (the reducer's `slice()` keeps unchanged element refs `===`). The ~6 µs/tick gap to hand-written **vanilla (9.6)** is immutable-TEA reducer allocation (slice + per-row spreads) + mask-gating bookkeeping — element-level tracking removes neither.
- **The large-list niche is already covered.** The only place an O(rows)-per-tick scan bites is a huge (10k+) high-frequency list, and `virtualEach` already makes that O(visible). Beating O(n) on a non-virtualized huge list would require granular setState-by-path mutation, which breaks the immutable-state contract central to TEA (and Solid's store model, which does that, still loses at 200 rows).

Revisit ONLY with a concrete workload that (a) isn't virtualizable and (b) profiles the row scan (not reducer allocs) as the bottleneck. Absent that, this is a net regression risk.

## Methodology correction (2026-06-06) — "layout-bound" ≠ "JS doesn't matter"

The old framing ("jfb create-ops are layout-bound; don't micro-opt JS there") confused two things. Create's _absolute_ time IS ~95% layout/paint. But the _inter-framework delta_ (LLui vs Solid vs vanilla, identical DOM ⇒ identical layout) lives 100% in the ~5% JS slice — so JS is the **only** lever on rank. The two items below were marked dead-ends on that flawed reasoning + a mis-measurement; both were refuted with isolated real-Chromium measurement and shipped (see "Create-ops" section above). When measuring a small create-ops JS win, the full jfb bench is too noisy (~±15% run-to-run drift swamps a ~2% op-level change) — use an isolated detached-fragment construction bench, or trust a same-session A/B + the memory metric.

## Verified dead-ends — do NOT re-chase (measured)

- ~~**`cloneNode` templating** — clone == `createElement`.~~ **REFUTED + SHIPPED** — `cloneNode(deep)` of a hoisted template is 38% faster than per-node createElement for a real multi-node row. See "Create-ops" above.
- ~~**Lean per-row scope** — sub-noise.~~ **REFUTED + SHIPPED** (jsdom had masked the JS delta). See "Create-ops" above.
- **Fragment-batched row insertion** (one `DocumentFragment` insert vs N `insertBefore`) — **measured non-win** (3-8% SLOWER): the browser coalesces layout for consecutive inserts; the fragment adds extra node-moving. (2026-06-07)
- **`Range.deleteContents` bulk-remove vs N `removeChild`** — **measured non-win** (0%): removal is coalesced too. (2026-06-07)
- **Slot-model** (shared per-template produce/applier + per-row `targets[]`, no per-row binding objects/closures) — **measured non-win** (0.008 µs/row ≈ 0.08 ms on create-10k): V8 already optimizes loop-allocated closures + small monomorphic binding objects, and `directShape` shares masks. Not worth a new `DirectRow` contract + 2nd scope impl. (2026-06-07)
- **Restoring the legacy specialized swap/remove/replace reconcile paths** — **measured non-win** (~54 µs/op on 1000 rows ≈ 0.4 % of the op). The reorder/remove/replace "regression" was competitor variance, not an LLui slowdown (see Final state above).
- **create-10k / append as JS targets** — layout/paint at scale; JS slice is the only inter-framework lever but it's at the noise floor (cloneNode + scope work already landed it).
- **swap/update "regressions"** — high-variance/cold-start (pre-signals swap itself ranged 8.6–13.9); LLui's absolute numbers are stable/improved across the migration. Don't read single-baseline swap/remove deltas as regressions.
- **Default microtask/rAF auto-batching** — rejected (see Opportunity B): breaks the synchronous contract for no paint saving; only viable as an opt-in mode (option 4).
- **Element-level dirty tracking** — see Opportunity D: measured net-negative (Solid slower; gap is reducer allocs, not scan; large lists use `virtualEach`).

## Lowering-coverage telemetry + inlining lifts — ✅ SHIPPED (2026-06-09)

Real-app coverage measurement (dicerun2 ~0.11, dungeonlogs ~0.10, llui examples) found the
fast path reaches a minority of real `each` sites (dicerun2: 15/75 direct), and that the
dominant verbatim cause is the **documented helper-composition style**, not exotic bails.

- **`onLowerBail` hook** (`SignalTransformOptions.onLowerBail`, `LowerBail` in
  `transform-view.ts`): every lowering ATTEMPT that gives up reports a stable kebab-case
  reason + position. Events are attempt-facts (a factory bail may still lower via
  `signalEach`); they feed coverage tooling and are the seed of the reserved `perf`
  diagnostics channel. Tests: `test/signals/lower-bail.test.ts`.
- **Three inlining lifts** (`inlineHelperRender`): bare-call delegation
  `(item) => helper(args)` (no array wrap needed), helpers returning the documented
  `Renderable` ARRAY (elements become the row's roots — multi-root rows clone `_sk[1]`),
  and leading render-side decls (capture-guarded: a render-decl name the pre-substitution
  helper body mentions → `decl-capture-risk` bail; helper params excluded since they
  shadow module scope). E2E: `each-direct-codegen.test.ts` (grantRow shape: bare call +
  peeked local + 2-root array + dispatch-by-id).
- **Measured corpus result after the lifts:** +1 direct site (the canonical grantRow). The
  remaining mass is behind harder walls, exact post-lift ranking: `row-child-unsupported`
  27 (rows with structural/helper children), `row-body-not-array` 20 (imperative render
  bodies), `row-top-not-element` 14 (cross-file delegation targets), `helper-body-not-
inlinable` 11 (imperative helper bodies — `children.push` style), spread-props 6
  (connect-part bags).
- **Key structural finding — pass 2 has NO mid-tier.** A component-view `each` whose row
  has a structural child falls back to `signalEach` (compiled render arm); a HELPER each
  has only factory-or-verbatim, so `signalEach` is 0 across the entire corpus. A pass-2
  render-arm equivalent (authoring `each` with a compiled row) is the single biggest
  remaining coverage lever short of the cross-file ABI; it needs a runtime contract
  decision (the helper row's reads root in call-site handles, not component state).

## Plugin routing fix + `perf` diagnostics — ✅ SHIPPED (2026-06-09, follow-up session)

Two more findings/fixes on top of the telemetry session:

- **Routing fix (the big production win).** The vite-plugin pre-check required `component(`
  in the file, so HELPER-ONLY modules (no component call) never entered the transform at
  all — pass-2 helper-each lowering was unreachable for them in real builds. Real apps
  keep most eaches there: **29 of 50** each-bearing files in dicerun2 and **4 of 5** in
  dungeonlogs were skipped entirely; all corpus coverage numbers measured by calling the
  transform directly OVERSTATED production. The pre-check now routes dom-importing files
  with `each(` too (`hasComponentCall` still solely arms the build-integrity scan).
  **Measured production impact: dicerun2 +9, dungeonlogs +7, examples +5 each sites now
  compile to the direct factory in real builds** (previously verbatim regardless of
  lowerability). Routing widened LINT to helper files too, exposing a rule-vs-compiler
  contradiction: `peek-in-slot` flagged the documented render-once row-local idiom
  (`const isDir = item.peek().type === 'dir'` in a block-body render) that the factory
  itself compiles as per-row wire decls (it broke `examples/github-explorer`). The rule
  was refined (`rules.ts` `visitRender`): block-body render DECLARATIONS allow peek;
  peeks in returned-array SLOTS stay errors.
- **`llui/each-verbatim` perf diagnostics.** `SignalTransformOptions.onPerfDiagnostic`
  emits one canonical `perf`-category warning Diagnostic per `each` site that ends fully
  verbatim, naming the deduped bail reason(s) with actionable hints
  (`packages/compiler/src/signals/perf-diagnostics.ts`). Verbatim-ness is decided by
  "success event AND covering edit" — neither alone suffices (pass 1 rewrites the view
  array as ONE edit embedding verbatim survivors; a success can come from a discarded
  arm). The vite-plugin surfaces them via `this.warn` — `perfDiagnostics` option,
  default ON in dev / OFF in build. Verbatim `show`/`branch` intentionally not surfaced
  (toggle-time-only cost). Volume on the corpus: dicerun2 50, dungeonlogs 19, examples 6.
  Tests: `test/signals/perf-diagnostics.test.ts`, `vite-plugin test/signal-routing.test.ts`.

## The `eachArm` mid-tier + leaked-handle prelude + each state-fanout fix — ✅ SHIPPED (2026-06-09)

The pass-2 mid-tier from the corpus ranking, plus two lifts and a latent correctness bug
the design work exposed:

- **Staleness bug found & fixed (authoring `each`).** The structural each binding fired
  only on the items handle's deps, so a row-nested arm reading an UNRELATED state path
  (`show(state.at('flag'),…)` inside a row, connect parts, …) was silently frozen out of
  state-only changes — the doc promise "a row reacts to its item AND component state" was
  broken on the authoring path (probe: a row-nested show never toggled). Fix:
  `signalEach`/`signalEachDirect` accept `extraDeps` appended to the structural spec ONLY
  (items resolution unaffected); authoring `each` passes `['']` (whole state — rows can
  read state through code invisible at runtime), compiled `eachDirect` passes the PRECISE
  collected `stateDeps` (4th arg), legacy 3-arg emissions degrade to `['']`
  (correct-but-conservative; old runtime ignores the new arg — compat both ways). The
  reconcile's probe/gating keeps per-change cost proportional to changed rows; jfb/ticker
  are fully compiled with precise deps — bench unaffected.
- **`eachArm` (the mid-tier).** `eachArm(items, key, (getCtx) => [...], stateDeps?)` —
  compiled render arm over a verbatim items handle: producers read the combined ctx (no
  per-row handle allocation), un-lowerable children stay verbatim INSIDE the arm,
  handlers' `.peek()` reads rewrite to `getCtx()` reads (dispatch-by-id, ambient
  `armHandlerRoots`). Defaults to whole-state deps (its raison d'être is verbatim
  residue).
- **Leaked-handle prelude (the big coverage lift, pass 1 AND pass 2).** A row param
  leaking into a verbatim helper call (`pill(item)` — the dominant post-arm blocker, 20
  sites) no longer bails: the arm binds it to a REAL runtime handle
  (`const item = rowHandle(getCtx, 'item')`, the same pathHandle authoring `each`
  creates), so the helper receives a genuine `Signal<T>`. Pass-1 leaked rows add `''` to
  source deps (residue may read state invisibly). `rowHandle` = `pathHandle` re-export.
- **Block-body arms.** `lowerArmArray` accepts `decls + return [...]` (decls verbatim,
  render-once per row — same semantics as factory wire decls); applies to each AND
  show/branch arms. A signal-alias local (`const n = item.at('x')`) is now legal on the
  arm path (the alias becomes a genuine sub-handle of the bound rowHandle).
- **Measured corpus coverage (each sites, direct/arm/signalEach vs verbatim):**
  examples **17/17 compiled (verbatim 0**, was 6); dungeonlogs **44/47 (94%**, was 60%);
  dicerun2 **42/75 (56%**, was 20%). Remaining verbatim: imperative render bodies +
  non-object opts shapes.
- Tests: `each-state-fanout-deps.test.ts` (staleness fix + eachArm contract + eachDirect
  stateDeps), `each-direct-codegen.test.ts` (arm e2e: structural child reacting to
  state-only change + dispatch-by-id; leaked-handle e2e: live updates + reorder),
  `transform-view/component/lower-bail/perf-diagnostics` compiler suites.

## Row-machinery allocation cuts + per-send fixed-cost cuts — ✅ SHIPPED (2026-06-10)

Two micro-measured runtime optimizations targeting the memory / create-JS / burst axes,
validated by an isolated jsdom A/B (3 runs/leg, old-vs-new dist) AND a same-environment
real-Chromium A/B (see methodology note below):

- **~8 fewer machinery allocations per each-row** (`dom.ts` `buildSignalEach`,
  `runtime.ts`): the `holder` live-ctx box is gone (the Row IS the box; closures read
  `row.ctx` — also removes a duplicate pointer write per row update); `spare` is lazy
  (first update, not create — a create-10k never pays it); the direct-row `buildDirectRow`
  wrapper (+host box + 2 always-empty arrays) is inlined away with shared empties; and
  `SignalScopeImpl` takes the specs as-is with a PARALLEL `masks` array instead of
  per-binding `{mask, produce, commit}` wrappers.
- **Per-send fixed costs** (`component.ts`, `dom.ts`): the drain's effects buffer is lazy
  (no empty array per send), `commitPending` skips the `withBindingErrors` closure when no
  handler is installed and the subscriber sweep when empty, and the same-structure fast
  path indexes rows via a `rowsInOrder` array maintained lockstep with `order` instead of
  a `Map.get` per row per send (200k lookups on a 1k-burst × 200 rows).
- **Isolated jsdom A/B:** burst-1k @200 rows 4.2 → 3.2 ms (**−24% JS**); create-10k
  80.1 → 78.1 ms (−2.5%); heap after create-10k −0.69 MB (~−70 bytes/row).
- **Real-Chromium same-env A/B (3-run medians):** every jfb op improved old→new —
  Update −9%, Swap −9%, Clear −10%, Append/Remove/Select −5-6%, Create10k/Replace −3%,
  Run-1k memory 2.5 → 2.4 MB. Ticker burst-1k 14.8 → 14.3 (paint dilutes the JS win).

**Methodology addendum (2026-06-10) — the environment moved; baselines re-saved.**
A fresh `bench:setup` clone (jfb HEAD) + Chrome 149 + headless shifted several ops vs the
June-7 baselines (Select +26%, Remove/Clear +12-13% ON UNCHANGED CODE — measured via an
old-code A-leg). Conclusions: (1) compare against a same-environment anchor leg, never a
baseline from another harness/Chrome; (2) jfb HEAD's server silently EXCLUDES frameworks
without a `package-lock.json` — every benchmark then "succeeds" in 0.00 ms with no
results and the comparison echoes the baseline back as Current (all +0%); `run-jfb.ts`
now writes the lockfile. Baselines now hold the 2026-06-10 environment (Chrome 149,
headless, jfb HEAD); the competitor entries are still June-7 — refresh with
`pnpm bench --all --save` (~15 min) before making cross-framework claims.

## RowFactory codegen: hoist row-invariant deps + produce — ✅ SHIPPED (2026-06-10)

The factory emitted `{ deps: ['item.label'], produce: (ctx) => ctx.item.label, commit: … }`
INSIDE the per-clone section — the deps array literal and the produce closure are
row-INDEPENDENT, so that was 2 extra allocations per binding per row (40k on a jfb
create-10k). They now hoist to per-each-site consts next to the cached skeleton
(`const _bd0 = […]; const _bp0 = (ctx) => …`), deduped by source; a produce that reads a
per-row block-body local stays inline (pinned to the row); only the node-capturing
`commit` is inherently per-row. **Isolated jsdom A/B (mechanism, 3 runs/leg): create-10k
71.6 → 67.9 ms (~−5% JS).** Retained heap unchanged — the old allocations died young; the
win is allocation/GC churn. Same lever still open for the ARM tier (signalText/react args
re-created per row build inside the arm closure — hoistable via an IIFE around the arm).

**Baseline provenance (2026-06-10, current files):** both baselines were re-saved from a
SINGLE-pass all-frameworks run (Chrome 149, headless, jfb HEAD) so every column is
same-environment-comparable. Single-pass medians carry ±10-15% drift on the volatile ops —
LLui's more reliable 3-run same-env values from the same day: Create1k 21.1, Replace 23.2,
Update 11.7, Select 3.0, Swap 14.2, Remove 11.0, Create10k 219.6, Append 24.6, Clear 10.1.
Judge LLui-change deltas against a fresh anchor leg, not these point estimates.

## Suggested order (remaining)

1. ~~**A** — item-handler + reactive-IDL row lowering.~~ ✅ shipped.
2. ~~**B** — `batch()` + drain-coalescing substrate + compiler auto-wrap.~~ ✅ shipped.
3. ~~**C** — cross-function row lowering (block-body, view-helper coverage, same-file inlining).~~ ✅ shipped.
4. ~~**Pass-2 mid-tier**~~ ✅ shipped (`eachArm` + leaked-handle prelude + block-body arms, see above). Remaining verbatim is imperative render bodies — statement-level lowering territory, likely not worth it.
5. ~~**Surface `onLowerBail` as `perf` diagnostics**~~ ✅ shipped (`llui/each-verbatim`, see above).
6. **Phase 3 of C** — precompiled-library row-factory ABI. The corpus showed the trigger is real (dicerun2 consumes published `@llui/components`; `row-top-not-element` 14 ≈ cross-file delegation). See cross-function-row-lowering.md.
7. **Option 4** — opt-in frame-scheduled (`scheduler:'raf'`/`sendAsync`) mode, only if a high-frequency consumer needs it.
8. ~~Element-level dirty tracking~~ — analyzed, **not recommended** (Opportunity D).
