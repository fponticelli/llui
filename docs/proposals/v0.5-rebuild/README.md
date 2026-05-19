# v0.5 Rebuild — Architectural Options

This directory captures four design directions for a v0.5 rebuild of LLui. Each
is a self-contained proposal; an implementer can pick any one and execute
without reading the others. The companion `comparison.md` highlights the
differences and offers a recommended decision rubric.

The goal of these docs is **leave-behind artifacts** — written so a future
contributor (with no access to this conversation) can pick up and ship the
work.

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
