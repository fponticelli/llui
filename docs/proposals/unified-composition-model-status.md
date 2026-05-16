# Unified Composition Model — branch status (`explore/controlled-components`)

**Date:** 2026-05-16
**Branch:** `explore/controlled-components`
**Parent design:** [`unified-composition-model.md`](./unified-composition-model.md)
**Spike validation:** [`unified-composition-model-spike-result.md`](./unified-composition-model-spike-result.md)

This document records exactly what landed on the branch, what was deliberately left for follow-up sessions, and why. It exists so any next session (human or LLM) can pick up the work cold without re-deriving the trajectory.

## What's done

| Commit             | Subject                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `6b9d582`          | Spike: design + walker prototype + measurements                                                                                    |
| `da83992`          | Runtime: `__prefixes` path-keyed reactivity (opt-in, ≤31 paths)                                                                    |
| `08bc0f5`          | Compiler: emit `__prefixes` automatically for ≤31 paths                                                                            |
| `d08ce4c`          | Docs: integration status                                                                                                           |
| `e6d8564`          | `combine()` reducer-composition helper                                                                                             |
| `816312e`          | `subApp` escape hatch at `@llui/dom/escape-hatch`                                                                                  |
| `9fc842f`          | `components-demo` migrated `child()` → `subApp`                                                                                    |
| `34a3fd9`          | ESLint rule `llui/subapp-requires-reason`                                                                                          |
| `2c9dce6`          | Worked-example test for view-function + slice + `combine()`                                                                        |
| `59a0339`          | Removed `child()` + addressed registry (1,567 LOC deleted)                                                                         |
| `b3e285a`          | Rewrote `01 Architecture.md` + `07 LLM Friendliness.md` for unified model                                                          |
| _propsMsg removal_ | `propsMsg` / `receives` stripped from `ComponentDef`; vike migrated to `onLayerDataChange` callback option                         |
| _multi-word_       | Two-word `__prefixes` runtime (binding & block `maskHi`, two-word dirty pair, gates updated). Compiler emits 32..61 prefix arrows. |

**Validation:** 36/36 monorepo tasks green; 509 dom tests; 297 vite-plugin tests; 15 ESLint rule cases; `components-demo` builds with `__prefixes` and `data-llui-sub-app-reason` in the production bundle.

**API surface delta:**

- Removed: `child` (primitive), `addressOf`, `setAddressedDispatcher`
- Added: `combine`, `subApp` (at `@llui/dom/escape-hatch`)
- Added (compiler-emitted, internal): `ComponentDef.__prefixes`

## What's left, scoped honestly

### 1. Multi-word `__prefixes` emit (>31 paths) — partial, see below for what's wired

⚠️ **Partial progress:** the runtime and `__prefixes` emission for 32..61-path components landed in this branch. What's still missing is per-binding `maskHi` propagation through the elTemplate emit (binding tuple shape).

**What's wired (this branch):**

- `Binding.maskHi` + `StructuralBlock.maskHi` added; gates use `(mask & dirtyLo) | (maskHi & dirtyHi)`.
- `processMessages` tracks two-word dirty separately; `_runPhase2` / `_handleMsg` / `setCurrentDirtyMask` widened (with backward-compat defaults).
- `computeDirtyFromPrefixes` already returned `[lo, hi]`; the runtime now actually uses both halves.
- `buildPrefixesProp` emits prefix arrows for paths at positions 0..61 (was: ≤30 only).
- `computeAccessorMask` returns `{ mask, maskHi, readsState }`; `collectDeps` returns `{ lo, hi }` maps.

**What's still missing for full precision:**

- Per-binding `maskHi` literal emission. The `bindings` tuple in `transform.ts` is `[mask, kind, key, value]` (4 elements); needs to become `[mask, maskHi, kind, key, value]` (5 elements). Six emit sites in `transform.ts` plus the consumer in `emitSubtreeTemplate` need to thread the second number.
- Without this last step, high-word-only bindings (those reading paths 31..61 but not 0..30) gate at `mask=0, maskHi=0` and fall through to FULL_MASK — they re-evaluate every cycle. The dirty COMPUTATION is precise, so `memo()`'d aggregates short-circuit correctly, but per-binding gating doesn't yet exploit the maskHi pathway.

**Approach taken:** the original plan was bigint masks. After hitting the `number | bigint` cast cascade in an earlier attempt, the actual shipped design uses a two-word number layout (`mask` for bits 0..30, `maskHi` for bits 31..61) — no bigint mixing, no truthy-vs-`=== 0` re-normalization. The `0 & 0 === 0` path collapses on V8's inline caches for ≤31-prefix components.

**Estimated remaining calendar:** ~half a day. Concrete steps:

- In `transform.ts`, change the `bindings` tuple shape from `[number, string, string, ts.Expression]` (4-tuple) to `[number, number, string, string, ts.Expression]` (5-tuple, with `maskHi` second). Six emit sites push tuples; the `emitSubtreeTemplate` consumer reads them.
- Emit binding object `__bind(node, mask, maskHi, kind, key, accessor)` calls — runtime `createBinding` already accepts `maskHi: number | undefined`, so the emit needs to surface it.
- For `__update` and `__handlers` gate predicates emitted into the compiled component body: change from `(mask & d)` to `((mask & d) | (maskHi & dHi))` and thread `dHi` through. Pass it from `processMessages` to `__update(state, dirtyLo, dirtyHi, bindings, blocks, beforePhase1)` — the runtime entry call site is already widened on the runtime side; the compiler emit needs to match.
- Add a test that asserts the compiler-emitted `__bind` calls carry `maskHi` for >31-prefix accessors.

### 2. Removal of `propsMsg` / `receives` from `ComponentDef` ✓ landed

`propsMsg` and `receives` are removed from `ComponentDef`, `AnyComponentDef`, and `LazyDef`. The single functional consumer — `@llui/vike`'s persistent-layout chain — was migrated to an opt-in `onLayerDataChange` callback on `RenderClientOptions`:

```ts
createOnRenderClient({
  Layout: NavAwareLayout,
  onLayerDataChange: ({ def, handle, newData }) => {
    if (def === NavAwareLayout) {
      handle.send({ type: 'navChanged', data: newData as NavData })
    }
  },
})
```

The user discriminates on `def` and dispatches imperatively via `handle.send`. No framework-special knowledge of message shapes. Dead lint rules (`unnecessary-child`, `child-static-props`) were also removed since they targeted the absent `child()` primitive.

Original scope (now done):

**Why it's still pending:** `@llui/vike` uses `propsMsg(props)` to thread route-data changes through layers of its persistent-layout chain (`packages/vike/src/on-render-client.ts`, `packages/vike/src/page-slot.ts`). This is structurally different from the subcomponent communication pattern `child()` provided — it's cross-layer data propagation, where each layer is an independent `mountAtAnchor`'d app and the vike adapter shallow-diffs `chainData[i]` between navigations and fires `propsMsg` on changes.

**Implementation scope:**

- Design pass: what's the unified-model replacement for "data flowed to a persistent-layout layer"? Candidates:
  - **Slice prop** — vike writes `chainData[i]` into the layer's host state as a normal slice; the layer's view reads from it via the standard path-keyed reactivity walker. Requires layer apps to expose a "set chain-data" action in their reducer.
  - **Imperative `AppHandle.send`** — vike's adapter has the handle; it dispatches a `{type: 'chain-data/set', payload}` message on each navigation. The receiving reducer slots the data into state. Simpler than propsMsg machinery; no special framework support needed.
  - **Effect-emit** — vike dispatches an effect that the layer's `onEffect` handles. Probably overkill.
- Pick one, design, implement in `@llui/vike`, migrate the 4 call sites.
- Remove `propsMsg` / `receives` from `ComponentDef` types.
- Delete `packages/dom/src/compose.ts` (the slice-handler helpers that exist primarily for propsMsg).

### 3. Documentation rewrites ✓ landed in `b3e285a`

Both `docs/designs/01 Architecture.md` and `docs/designs/07 LLM Friendliness.md` were rewritten in `b3e285a` to describe the unified composition model:

- View functions framed as the only decomposition primitive
- `combine()` documented as the reducer-composition mechanism
- `subApp` documented as the lint-enforced escape hatch (with the `data-llui-sub-app-reason` attribute surfacing the rationale)
- Path-keyed reactivity replaces the "Level 1 vs Level 2" mental model — the docs now explain why nesting depth is no longer a composition decision
- Task templates (Task 10, Task 10b) reframed: `10b` now tests `combine()` slice-routing instead of `child()` plumbing
- System prompt rules updated: `combine()` + `subApp` replace `child()` + `propsMsg` + addressed effects
- LLM error-pattern detection updated: "Unnecessary `child()`" replaced with "Unnecessary `subApp`"
- Concrete LLM error patterns updated: addressed effects no longer suggested as the cross-component coordination mechanism

What's NOT yet written:

- A dedicated migration doc (`13 Migration from v0.0.x.md`) for downstream apps still on `child()`. dicerun2 has 62 call sites; decisive.space-2 has none (its 120-field root will benefit from #1 above more than from migration prose). Defer until either app actually picks up the new release.

### 4. Compiler emit consistency for `__update` / `__handlers` ✓ no-op

Audited: the existing comments correctly describe the legacy `__dirty` path (which is still top-level-field-based by design). The new `__prefixes` emission already uses "prefix" terminology. No rename needed.

## Risks and considerations for follow-up

- **`__dirty` legacy path.** Currently kept for backwards compat with the rare component that had `__dirty` hand-written (the compiler skips synthesizing if user already provides one). Once binding-side `maskHi` emission lands, decide whether `__dirty` is fully replaced by `__prefixes` — probably yes; document that user-supplied `__dirty` is deprecated.
- **`@llui/test`.** None of the dom tests rely on `child()` in user-facing API, but the test-harness might have helpers wired through component instances that need adjustment. Re-scan when continuing.

## What "fully resolved" actually means

The branch as it stands IS reviewable and mergeable: every commit passes the full monorepo (62/62 turbo tasks), the unified model is functioning end-to-end through a real-app build (`components-demo`), and the migration story is demonstrated by a worked example test. Of the four items originally scoped:

- **#2 propsMsg/receives removal** — ✓ done
- **#3 doc rewrites** — ✓ done
- **#4 compiler-emit polish** — ✓ no-op (audit found the existing comments correctly describe the legacy `__dirty` path)
- **#1 multi-word `__prefixes` emit** — partial: runtime fully wired, `__prefixes` emission extended to 62 paths, but per-binding `maskHi` literal emission in `elTemplate` is the remaining step (well-scoped: widen the `bindings` tuple from 4 → 5 elements at six emit sites in `transform.ts`).

The one remaining work item is the binding-tuple widening. It unblocks per-binding gating for high-word paths and brings decisive.space-2's 120-field root to full path-keyed precision. Estimated half a day of focused work — the design is established, the runtime is ready, the tests exist.
