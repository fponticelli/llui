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

## Opportunity A (highest value) — lower rows with item-referencing handlers/reads

Bring the direct-construction path to the common list row by emitting handlers that bind the row's item. This subsumes the old "handler slots" + "lowering coverage" items — they're the same blocker.

- **Compiler:** when a render callback leaks `item`/`index` only into event handlers (and otherwise lowers), don't bail — emit those handlers into the `RowFactory`, reading the row item through a row-ctx accessor instead of the free `item` handle.
- **Runtime contract:** extend `RowFactory` so the factory (or its handler closures) can reach the live row ctx — e.g. `(doc, getCtx) => DirectRow` where `getCtx().item` is the current row item (mirrors how the verbatim path's `pathHandle(getCtx, 'item')` already works). `item.at('id').peek()` in a handler compiles to a read off `getCtx()`.
- **Scope:** start with handlers that reference `item`/`index` via `.peek()` (the toggle/remove pattern). Reactive props + text already lower (0.8.0).
- **Gate (measure first):** the verbatim path already gets A/B on update, so the win here is **create/replace of handler-bearing lists**. Confirm with a categorized trace on a todomvc-shaped create that the per-row authoring/`pathHandle` cost is material before building the codegen — create may be partly layout-bound even here.

## Opportunity B — `send()` coalescing for burst/streaming

`burst-1k`/`tick-100` are N **synchronous** `send()`s = N reconciles + N commits (LLui `send()` applies immediately, no batching). A/B made each reconcile cheap, but there are still N of them. Coalescing a burst into one reconcile/commit would help `burst-1k` further.

- **Tradeoff:** `send()` being synchronous is a documented contract (CLAUDE.md). Don't silently change it. Options: an opt-in `batch(() => { send(); send(); … })` that coalesces into one update, or a microtask-batched `sendAsync`. Design + DX review required.
- **Value:** only streaming/bulk-dispatch workloads (real-time feeds). Lower priority than A.

## Verified dead-ends — do NOT re-chase (measured this session)

- **`cloneNode` templating** — clone == `createElement` (~1.1 ms/1000 rows). No win.
- **Lean per-row scope** (Map→array, lazy Set, cheaper Mountable repr) — sub-noise; create is layout-bound.
- **create-10k / append** — layout/paint at scale, not JS-addressable.
- **swap/update "regressions"** — cold-start/harness artifacts; reconcile is optimal (swap = 2 LIS moves, ~4.8 ms warm).

## Suggested order

1. **A** — the real-app unlock (item-handler lowering + factory ctx). Biggest reach.
2. **B** — `batch()` for streaming, if a real consumer needs it.
