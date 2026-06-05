# Proposal: performance — extend the direct-row fast path to real code

**Status:** proposed · **Owner:** perf · **Audience:** a future session picking this up cold.

Read [[../../../.claude]] memory `reference-perf-measurement` first (or the summary in `docs/proposals/v2-compiler/compiled-row-construction.md`). TL;DR of the methodology: **measure with a CDP categorized split (Script/Layout/Style), rebuild `dist` before benching, run LLui-only for LLui-change measurement, and trust LLui-vs-LLui deltas (the machine drifts ~2× run-to-run).** jfb create-ops are layout-bound (don't micro-opt JS there); ticker/streaming-update ops are JS/reconcile-bound (real headroom).

## What already shipped (0.8.0) — and its reach

- `signalEachDirect` + compiler codegen: a static-skeleton `each` row lowers to a `RowFactory` (direct DOM + bindings by node ref). **But it only reaches rows the compiler actually lowers.**
- Two reconcile wins in `buildSignalEach` — **same-structure fast path** (skip the O(n) keyed scan for in-place updates) and **state-fanout gating** (skip the all-row sweep when read state-paths are unchanged). These live in the shared reconcile, so **every `each` benefits, including the verbatim authoring path**. (burst-1k 31.7→15.9.)

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

## Verified dead-ends — do NOT re-chase (measured this session)

- **`cloneNode` templating** — clone == `createElement` (~1.1 ms/1000 rows). No win.
- **Lean per-row scope** (Map→array, lazy Set, cheaper Mountable repr) — sub-noise; create is layout-bound.
- **create-10k / append** — layout/paint at scale, not JS-addressable.
- **swap/update "regressions"** — cold-start/harness artifacts; reconcile is optimal (swap = 2 LIS moves, ~4.8 ms warm).
- **Default microtask/rAF auto-batching** — rejected (see Opportunity B): breaks the synchronous contract for no paint saving; only viable as an opt-in mode (option 4).

## Suggested order

1. ~~**A** — the real-app unlock (item-handler lowering + factory ctx). Biggest reach.~~ ✅ shipped.
2. ~~**B** — `batch()` for streaming + substrate coalescing + compiler auto-wrap.~~ ✅ shipped.
3. **Option 4** — opt-in frame-scheduled mode, only if a high-frequency consumer needs it.
