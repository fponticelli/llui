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

### 1. Multi-word `__prefixes` emit (>31 paths) ✓ landed

The two-word reactivity ceiling raised from 31 to 62 prefixes. Components reading more than 62 paths still fall back to `FULL_MASK` and trigger the `bitmask-overflow` lint warning.

**Runtime (`@llui/dom`):**

- `Binding.maskHi` + `StructuralBlock.maskHi` added; gates use `(mask & dirtyLo) | (maskHi & dirtyHi)`.
- `processMessages` tracks two-word dirty separately; `_runPhase2` / `_handleMsg` / `setCurrentDirtyMask` widened (with backward-compat defaults so stale compiled bundles continue to gate correctly).
- `computeDirtyFromPrefixes` returns `[lo, hi]` for >31-prefix components; the runtime fans both halves into `combinedDirty` + `combinedDirtyHi`.

**Compiler (`@llui/vite-plugin`):**

- `collectDeps` returns `{ lo, hi }` maps. Positions 0..30 → `lo`, positions 31..61 → `hi`.
- `buildPrefixesProp` emits prefix arrows for all paths up to position 61 (was: ≤30 only).
- `computeAccessorMask` returns `{ mask, maskHi, readsState }`.
- Binding-emit sites push a 5-element tuple `[mask, kind, key, accessor, maskHi]` when the accessor reads a high-word prefix; for the common ≤31-prefix case the emit stays byte-identical (4-tuple). `elSplit` and `elTemplate`'s `__bind` callback both auto-detect the optional `maskHi` slot.
- `tryInjectDirty` skips `__update` and `__handlers` emission for >31-prefix components — those inlined gate predicates are single-word and would silently skip high-word bindings. Falling through to the runtime's two-word-aware `genericUpdate` keeps reactivity correct.

**Tests added:**

- `prefix-reactivity.test.ts` — hand-built 35-prefix component verifies that a `maskHi`-gated binding fires only on its high-word prefix change.
- `prefixes-emit.test.ts` — asserts `__prefixes` is emitted for >31-prefix components and the compiler fast path (`__update` / `__handlers`) is deliberately suppressed.

**ESLint rule update:** `bitmask-overflow` threshold raised 31 → 62. Test fixtures updated.

**Approach taken:** the original plan was bigint masks. After hitting a `number | bigint` cast cascade in an earlier attempt, the shipped design uses a two-word number layout (`mask` for bits 0..30, `maskHi` for bits 31..61) — no bigint mixing, no truthy-vs-`=== 0` re-normalization. For ≤31-prefix components the `0 & dirtyHi` branch collapses on V8's inline caches.

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

### 4. Compiler emit consistency for `__update` / `__handlers` ✓ no-op

Audited: the new `__prefixes` emission already uses "prefix" terminology. The legacy `__dirty` emission was removed entirely (see #6 below).

### 5. Migration doc ✓ landed

`docs/designs/13 Migration from v0.0.x.md` shipped — covers the seven concrete migrations downstream apps need:

- `child()` → view function (the big one)
- `propsMsg` → `onLayerDataChange` (vike) or direct slice ownership
- `receives` / addressed effects → shared parent state
- `mergeHandlers` / `sliceHandler` → `combine()`
- User-authored `__dirty` → delete (compiler emits `__prefixes`)
- `subApp` for genuine isolation
- A mechanical sweep checklist for large migrations (dicerun2 has 62 sites)

### 6. Compiler fast path for >31-prefix components ✓ restored

The compiler now emits `__update` and `__handlers` for ALL prefix counts (not just ≤31). Both carry two-word gate predicates:

- `__update`'s Phase 1 block gate emits as `!((bk.mask & d) | (bk.maskHi & dHi))`. The arrow gains a trailing `dHi = 0` parameter — old runtimes that pass 5 args still work, new runtimes pass `combinedDirtyHi` as the 6th arg.
- `__handlers` passes `caseDirtyHi` as the 5th positional arg of `_handleMsg` only when the case touches a high-word field (emit is byte-identical for the common ≤31-prefix case).
- `block.reconcile` and `__runPhase2` calls thread `dHi` through.

### 7. User-authored `__dirty` ✓ rejected at mount

Removed from `ComponentDef`. The compiler no longer emits it (replaced entirely by `__prefixes`); the runtime throws at `createComponentInstance` if any user code sets `def.__dirty`. The throw message points migrators at `__prefixes` and the migration doc.

75 test fixtures across the dom package were swept from `__dirty` to `__prefixes` via a one-shot AST migration.

## What "fully resolved" actually means

The branch is reviewable and mergeable. Every commit passes the full monorepo (62/62 turbo tasks). The unified model is functioning end-to-end. All seven items considered on this branch:

- **#1 multi-word `__prefixes` emit** — ✓ done with full two-word precision
- **#2 propsMsg/receives removal** — ✓ done
- **#3 doc rewrites of Architecture + LLM Friendliness** — ✓ done
- **#4 compiler-emit polish** — ✓ no-op after audit
- **#5 migration doc (`13 Migration from v0.0.x.md`)** — ✓ done
- **#6 compiler fast path for >31-prefix components** — ✓ restored
- **#7 user-authored `__dirty` rejection** — ✓ done, with test sweep
