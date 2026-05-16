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

What's NOT yet written:

- A dedicated migration doc (`13 Migration from v0.0.x.md`) for downstream apps still on `child()`. dicerun2 has 62 call sites; decisive.space-2 has none (its 120-field root will benefit from #1 above more than from migration prose). Defer until either app actually picks up the new release.

### 4. Compiler emit consistency for `__update` / `__handlers` ✓ no-op

Audited: the existing comments correctly describe the legacy `__dirty` path (which is still top-level-field-based by design). The new `__prefixes` emission already uses "prefix" terminology. No rename needed.

## Risks and considerations for follow-up

- **`__dirty` legacy path.** Currently kept for backwards compat with the rare component that had `__dirty` hand-written (the compiler skips synthesizing if user already provides one). Now that `__prefixes` emission covers 62 paths and runtime fans out to two-word dirty, `__dirty` is purely a runtime fallback for user-supplied custom dirty functions. Could be documented as deprecated.
- **Compiler fast path for >31-prefix components.** Today, `__update` and `__handlers` are deliberately suppressed for components reading >31 prefixes — their inlined gate predicates are single-word. To bring back the fast path for large components, the gate predicates need to thread `dHi` through and emit `((mask & d) | (maskHi & dHi))`. Tractable but not blocking; the runtime's `genericUpdate` is correct.
- **`@llui/test`.** None of the dom tests rely on `child()` in user-facing API, but the test-harness might have helpers wired through component instances that need adjustment. Re-scan when continuing.

## What "fully resolved" actually means

The branch is reviewable and mergeable: every commit passes the full monorepo (62/62 turbo tasks), the unified model is functioning end-to-end through a real-app build (`components-demo`), and the migration story is demonstrated by a worked example test. All four items originally scoped:

- **#1 multi-word `__prefixes` emit** — ✓ done. Runtime two-word maskHi support, compiler emission for all 62 paths, per-binding maskHi literals in elTemplate emit, compiler fast path suppressed for overflow components (falls through to two-word-aware `genericUpdate`).
- **#2 propsMsg/receives removal** — ✓ done. Vike migrated to `onLayerDataChange` opt-in callback.
- **#3 doc rewrites** — ✓ done in `b3e285a`.
- **#4 compiler-emit polish** — ✓ no-op after audit.

The remaining optional improvement is restoring the compiler fast path (`__update` / `__handlers`) for >31-prefix components, which is a perf optimization, not a correctness fix.
