# Proposal: cross-function `each`-row lowering (helper / block-body rows)

**Status:** **phases 1–2 + transform-coverage SHIPPED**; phase 3 (cross-file) deferred · **Owner:** perf/compiler

## Shipped

- **Phase 1 — block-body rows** (`(item) => { const x = item.peek()…; return [...] }`): leading `const`/`let` locals emit once per row (`.peek()` → live ctx); static values computed from a local lower too. Bails on a handle-valued local (`const n = item.at('x')`), a non-decl statement before the return, a data-conditional return, or a leaked handle.
- **Transform coverage — `each` in view-helper functions** (`fileTree(routeSig): Renderable { … each(…) }`): the compiler walks view helpers (pass 2), keeps the items handle verbatim, and emits the handle-consuming `eachDirect(items, key, factory)` — only the ROW compiles. A guard bails a static slot reading a non-root handle reactively.
- **Phase 2 — same-file helper rows** (`(item) => [rowHelper(item, …)]`): `rowHelper`'s body is inlined (params → call args, conservative hygiene) → a normal row the factory lowers. Bails on cross-file/unknown helpers, arg/param mismatch, spread props, or any hygiene risk.
- **Two bugs fixed while validating:** peeked-value locals (`const v = item.peek()`) were wrongly bailed (now only handle aliases bail); `loweredLeaksIdent` false-positived on string literals containing the param name (`class: 'activity-item'`) — rewritten as an AST walk (this also fixed the already-shipped item-handler lowering).

Validated on real examples: `examples/github-explorer` (file-row via transform coverage) and `examples/dashboard` (`activityItem` via phase-2 inlining; `priorityItem` stays authoring — spread props). **Phase 3 (cross-file/cross-package helpers) remains deferred** — see below.

---

**(original scoping below, retained for the phase-3 decision)**

## TL;DR

`signalEachDirect` (the direct-construction fast path) only fires for `each` rows whose render callback is a **concise array of static-skeleton elements written inline** (after the item-handler + reactive-IDL work in [[../improvements/perf.md]] Opportunity A). Two common real-world row shapes still fall to the **authoring** path (per-row `pathHandle` + `Mountable` + `populate` + `runBuild`), which is measurably costlier on **create**:

1. **Helper rows** — `render: (item) => [activityItem(item, locale)]` (the documented "view function" composition default; used in `examples/dashboard`).
2. **Block-body rows** — `render: (item) => { const x = item.peek(); return [...] }` (used in `examples/github-explorer/repo.ts`).

Closing this needs the compiler to lower a row whose body lives in (or is produced by) a **separate function** — cross-function analysis. This doc scopes that work, having measured the win and validated the cheaper alternative.

## Measured motivation (real browser, Chrome via jfb-ticker `mount-200`)

| mount-200 (200 reactive rows)          | total | script (JS) | paint |
| -------------------------------------- | ----: | ----------: | ----: |
| direct (lowered `signalEachDirect`)    |   5.4 |     **1.0** |   4.3 |
| authoring (helper row)                 |   7.2 |     **2.7** |   4.3 |
| authoring + scope-shape memo (shipped) |   6.6 |     **2.3** |   4.1 |

- The direct path costs **2.7× less JS** than the authoring path; **paint is identical** (same DOM). So the gap is pure JS create cost: **~1.7 ms / 200 rows (~8.5 µs/row)**, scaling ~linearly (a 1000-row create sheds ~8.5 ms). It is **create-only** — updates use the shared `buildSignalEach` reconcile, identical for both paths.
- The cheap mitigation already shipped — **authoring scope-shape memoization** (reuse the per-template `PathTable` + masks across rows; commit `4ef76dc4`) — recovers only **~24%** of the gap (0.4 ms). The remaining **~76% (1.3 ms)** is irreducible per-row DOM construction (`pathHandle`×2, `Mountable` allocations, `populate`, `runBuild`), which **only direct construction avoids**.

**Conclusion:** the only way to recover that 76% is to make these rows emit a `RowFactory` — i.e. cross-function lowering. The win is real but **create-only and confined to the helper/block-body subset**, so this is **deferred** until a real consumer hits a create-perf wall on a large such list. LLui is already benchmark-competitive (`mount-200` 5.4 ms direct; ticker leads/ties on update ops), and Opportunity A already lowers the common inline rows.

## What lowering must produce

Today (A) the compiler lowers an inline row body to a `RowFactory` — `(doc, getCtx) => DirectRow` — with direct `createElement`/`setAttribute`/`appendChild`/`createTextNode` + a flat `bindings` list (compile-time `deps`/`produce`/`commit`), and emits `signalEachDirect(source, key, factory)` (see `packages/compiler/src/signals/transform-view.ts` `lowerRowFactory`).

Cross-function lowering must do the same when the row body is **reached through a function** — either a helper call (`(item) => [helper(item, …)]`) or a block body (`(item) => { …; return [...] }`).

## Design

### Phase 1 — block-body rows (same function, easiest)

`render: (item) => { <stmts>; return [<array>] }`. Today `arrowReturnArray` returns `null` for block bodies → bail. To lower:

- Accept a block body whose statements are **lowering-safe**: `const`/`let` bindings of pure expressions (no DOM reads, no `send`), then a single `return [<array>]`. Inline the locals' values where referenced in the returned array (or hoist them into the factory body verbatim — they run once per row at construction, which matches authoring semantics).
- A local computed from `item.peek()` (e.g. `const isDir = item.peek().type === 'dir'`) is the common case. It must read the **live row ctx** at construction → emit it as `const isDir = getCtx().item.type === 'dir'` (the same `getCtx()` rewrite the handler path already uses via `rewriteHandlerReads`).
- **Data-conditional structure** (`return isDir ? [a] : [b]`) is the hard sub-case: the row's element skeleton differs by data, so a single static factory can't build it. Options: (a) bail (keep authoring) when the returned array isn't a single static array literal; (b) lower each arm to a factory and pick at construction — but then the **scope shape differs per row**, breaking the shared-shape assumption (the runtime would need per-row shapes, losing part of the win). Recommend **(a) bail on conditional structure** in phase 1.

### Phase 2 — same-file helper rows

`render: (item) => [rowHelper(item, <args>)]` (or `=> rowHelper(item, …)`), with `rowHelper` defined in the same module as a function returning `Renderable`.

- **Resolve + inline**: find `rowHelper`'s declaration, confirm it's a pure arrow/function returning a concise array (recurse into phase-1 block-body handling), and **inline its body** into a `RowFactory`, binding its parameters: the param that receives `item` → the row ctx (`getCtx().item` / `ctx.item`); other args (e.g. `state.at('locale')`, `parts`) → captured from the enclosing view scope (emit them as factory closure references, like the inline path already captures `send`).
- **Specialization, not replacement**: `rowHelper` must stay a normal exported/local function for its other call sites; the each-site gets a specialized inlined factory. Accept the code duplication (one inlined copy per lowering each-site).
- **Index**: `(item, index) => [rowHelper(item, index, …)]` → bind `index` to `getCtx().index` for `.peek()` reads (reactive index reads still bail, as today).

### Phase 3 — cross-file helper rows (hardest, likely skip)

`rowHelper` imported from another module/package. Requires either (a) the compiler to follow the import and inline across files (it already does cross-file Msg/State analysis via the manifest — `packages/compiler/src/signals/cross-file-walker.ts` — but inlining a function _body_ is a larger step), or (b) the precompiled-library ABI to ship a **row-factory form** of the helper alongside its narrowing metadata (`__llui_deps.json`). Both are substantial. **Recommend skipping** unless phase 2 proves high-value and cross-file helpers are common.

## Feasibility / blockers

| Case                                                              | Phase | Tractable?                                                                              |
| ----------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| Block body, locals from `item.peek()`, single static array return | 1     | Yes (extend `lowerRowFactory` to inline safe statements + `getCtx()` rewrite)           |
| Block body, **data-conditional** returned structure               | —     | No — bail (per-row shape divergence)                                                    |
| Same-file helper, concise/array body, extra args from view scope  | 2     | Yes (resolve decl + inline + bind params)                                               |
| Helper reused across sites / recursive / returns a helper         | —     | Bail (inline only direct, non-recursive helpers)                                        |
| Cross-file / cross-package helper                                 | 3     | Hard — defer                                                                            |
| Helper with its own structural children (show/each)               | 1–2   | Inherit the existing `lowerRowFactory` bail (structural child → `signalEach`/authoring) |

Safety net already exists: `lowerRowFactory` returns `null` on anything it can't wire, and `loweredLeaksIdent` guards a leaked row param — so a partial implementation that bails conservatively is always correct, just unoptimized.

## Risks

- **Code-size**: inlining duplicates each helper per lowering site → larger bundles for big helper-row apps. Measure bundle delta; gate behind the existing fall-back if a helper is large.
- **Correctness of inlining**: locals with side effects, closures over mutable view state, `peek` vs reactive reads — the `getCtx()` rewrite must be exact (reuse `rewriteHandlerReads`/`signalToProduce`). Heavy test coverage required (mirror the A test matrix).
- **Maintenance**: cross-function lowering meaningfully grows the compiler's surface and coupling to TS binding resolution.

## Recommendation

**Defer.** Build **phase 1 (block-body)** first if/when needed — it's the smallest, self-contained extension of `lowerRowFactory` and unblocks `examples/github-explorer`-shaped rows. Consider **phase 2 (same-file helper)** only if a real consumer profiles a create bottleneck on a large helper-row list. **Skip phase 3** absent strong demand. Until then, the shipped scope-shape memoization gives a small broad mitigation, and Opportunity A covers the common inline rows.

See also: [[../improvements/perf.md]] (Opportunities A/B, shipped) and [[compiled-row-construction.md]] (the `RowFactory` runtime contract).
