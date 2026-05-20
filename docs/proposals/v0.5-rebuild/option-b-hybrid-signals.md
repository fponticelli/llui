# Option B — Hybrid: TEA preserved, signals as the binding mechanism

> **Empirical update (2026-05-19).** Phase 1 + Phase 2 of this option
> landed (commits `32175e8`, `5d68931`) behind a per-component
> `__bindingModel: 'registry'` opt-in. Two findings invalidate the
> doc's perf pitch below:
>
> 1. **Flat and registry dispatch are tied within ±5 %** on a
>    synthetic 16–1024-binding microbench
>    (`packages/dom/test/binding-registry-perf.test.ts`). The doc's
>    "7 µs floor at 1000 bindings" claim is correct for the AND-gate
>    scan in isolation, but V8 inline-caches the gate so the floor is
>    invisible against the rest of Phase 2's per-binding work.
> 2. **jfb's Select bypasses Phase 2 entirely.** Verified: `__handlers`
>    is emitted in the bench bundle, Select routes through `_handleMsg`
>    → `each.reconcileChanged`, never touching `_runPhase2`'s scan.
>    Replacing the scan therefore cannot fix Select.
>
> See `select-perf-investigation.test.ts` for the jfb-shape breakdown:
> at N=1000 in jsdom, steady-state Select is 0.057 ms (framework total).
> jfb measures 3.8 ms in Chrome; the 67× gap is browser
> style/layout/paint, not framework dispatch.
>
> Phase 2's runtime is correct and tested but isn't a perf win. The
> bundle pitch below (5–7 kB gz) is also unverified — Phase 2 alone
> adds +417 gz vs the flat-only state; the doc's projected net savings
> assume Phase 4 (drop flat path) actually pays off. Before continuing
> to Phase 3, revisit whether Option B is the right v0.5 direction at
> all given these findings.

## Summary

Keep the public TEA contract intact — `state` is a JSON-serializable
object, `update(state, msg) → [newState, effects]` is pure, agent protocol
unchanged. **Internally**, replace the Phase 2 flat-binding-array + bitmask
scan with signal-subscription on path prefixes. The compile-time path
analysis (today's `__prefixes` emission) stays; the runtime publishes
path-change events to per-prefix signals, and bindings subscribe to the
signals they need.

Smaller scope than Option A. Preserves DX, agent protocol, lint rules. Net
bundle target: 5–7 kB gz. Net `Select` regression: gone (single-path
update fires only subscribed bindings, no Phase 2 scan).

This is the **lowest-risk** path to closing the perf gap while keeping
everything else.

## Motivation

Phase 2 today costs O(`bindings.length`) gate checks per update, even when
one path changes. The bitmask gate is cheap per binding (~7 ns), but at
1000 bindings the floor is ~7 µs that no amount of mask-precision can
remove.

The fix without rewriting TEA: keep the path-table the compiler already
emits (`__prefixes`), but **stop scanning a flat binding array**. Instead,
maintain a `Map<prefixId, Set<binding>>` registry. When `update()` returns
a new state, walk the prefix table (same as today's
`computeDirtyFromPrefixes`), identify which prefixes changed, and fire the
binding sets registered against those prefixes.

This is mechanically the same model as Solid — except subscriptions are
keyed by compile-time-extracted **path identity**, not runtime reactive
reads. The path-extraction work is already in the compiler; we just
replace the storage / dispatch model on the runtime side.

## Target metrics

- **Bundle (jfb shape):** ≤ 7 kB gz. Stretch: 5.5 kB gz.
- **Bench `Select`:** ≤ 2.5 ms median (the +9–34 % regression today
  disappears).
- **Bench other ops:** within ±5 % of v0.4 (we don't expect regressions on
  Create/Replace/etc. — those weren't Phase-2-bound).
- **Tests:** all 511 dom tests continue to pass, with maybe 10–20
  rewrites in tests that assert the flat-array shape (`inst.allBindings`).

## Architecture changes

### What stays (no change)

- `update(state, msg) → [newState, effects]` — public API, unchanged.
- `state: S` is a JSON-serializable object — unchanged.
- The `__prefixes` table — unchanged (still emitted by the compiler,
  same shape).
- `computeDirtyFromPrefixes` — unchanged (still walks prefixes,
  reference-compares prev vs next).
- `__handlers` per-Msg-variant fast path — unchanged.
- `__view` per-component bag factory — unchanged.
- All 41 lint rules — unchanged.
- Agent protocol, `getState()`, devtools — unchanged.

### What changes

| Concept (v0.4)                                                | Concept (Option B)                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `inst.allBindings: Binding[]` — flat array                    | `inst.bindingsByPrefix: Map<number, Set<Binding>>` — per-prefix subscriber sets                                               |
| Phase 2 loop: scan all bindings, AND their mask against dirty | Path-change dispatch: for each set bit in the dirty mask, iterate `bindingsByPrefix.get(bitPosition)` and fire those bindings |
| `binding.mask` / `binding.maskHi` (per-binding bitmask)       | `binding.prefixIds: number[]` — list of prefix-table positions the binding reads (compile-time)                               |
| `setCurrentDirtyMask` / `getCurrentDirtyMask` (for `memo()`)  | `getCurrentChangedPrefixes(): Set<number>`                                                                                    |
| `_runPhase2` (flat-array iteration with mask gate)            | `_dispatchPrefixChanges` (set-based fan-out)                                                                                  |

### What's added

A new module — `packages/dom/src/binding-registry.ts` — with:

- `bindingsByPrefix: Map<number, Set<Binding>>` — registered per
  `ComponentInstance`.
- `registerBinding(scope, binding, prefixIds)` — replaces `addBinding`
  in `lifetime.ts`.
- `unregisterBinding(binding)` — called on disposal.
- `dispatchChangedPrefixes(inst, dirty, dirtyHi)` — iterates the dirty
  bits, fires all bindings registered to each changed prefix.

The compiler emits `prefixIds` instead of `mask`/`maskHi` on each binding
tuple. Today's `[mask, kind, key, accessor, maskHi?]` becomes
`[prefixIds, kind, key, accessor]` where `prefixIds` is a packed
representation (a `number` for ≤30 prefixes, or a small `Int32Array` for
overflow).

### Per-item bindings (`each.render` zero-arg accessors)

These already bypass Phase 2 today via `addCheckedItemUpdater`. They keep
the same model in Option B — direct updaters tied to the row's scope, not
registered in the prefix map. So `each` doesn't blow up to 1000+ rows ×
signals.

## User-facing impact

**None at the user API.** This is the key win of Option B.

- `component({...})` shape unchanged.
- `update`/`view`/`init` signatures unchanged.
- State is still JSON; `AppHandle.getState()` still returns the JSON
  snapshot.
- Lint rules unchanged.
- Agent protocol unchanged.
- HMR unchanged (swap `def.update` / `def.view`; the binding registry is
  rebuilt from the new view, same as today).

The only thing that changes is the compiler's emit shape for binding
tuples and the runtime's Phase 2 implementation. Users notice nothing.

## Migration plan

**Phase 1 — Prototype the binding-registry on a feature branch.** (3 days)

Create `packages/dom/src/binding-registry.ts` with the new data structures
and dispatch. Don't wire it into `processMessages` yet. Write unit tests
covering register/unregister/dispatch + scope disposal.

Measurement gate: registry module ≤ 0.5 kB gz.

**Phase 2 — Swap the runtime, behind a compile-time flag.** (4 days)

Modify `processMessages` (in `update-loop.ts`) and `_runPhase2`. Add a
`__bindingModel: 'flat' | 'registry'` field on `ComponentInstance`. When
`'registry'`, use the new dispatch; when `'flat'`, use today's Phase 2.
Both code paths live in parallel during the migration.

The compiler emits `__bindingModel: 'registry'` on new compilation; old
compiled bundles emit nothing → runtime defaults to `'flat'`.

Measurement gate: all 511 dom tests pass under both modes (test fixtures
opt in to either model).

**Phase 3 — Compile-time emission change.** (5 days)

`packages/compiler/src/modules/element-rewrite.ts` and the binding tuple
emission in `core-synthesis.ts`: change from `[mask, kind, key, accessor,
maskHi?]` to `[prefixIds, kind, key, accessor]`. The prefix-id list comes
from the same accessor analysis that produces `mask`/`maskHi` today —
just stored differently.

Measurement gate: bench app compiles and runs cleanly with
`__bindingModel: 'registry'`. `pnpm bench` shows no regressions vs v0.4
on Create/Replace/etc., and `Select` ≤ 3 ms (we expect a clear win here).

**Phase 4 — Remove the flat path.** (3 days)

Once everything is on `'registry'`, delete the `'flat'` branches:
`_runPhase2`'s mask-AND loop, `Binding.mask` / `Binding.maskHi` fields,
`computeDirtyFromPrefixes`'s overflow handling (still need a way to
detect changed prefixes; that part stays).

Measurement gate: bundle ≤ 7 kB gz. Bench `Select` ≤ 2.5 ms.

**Phase 5 — Docs + release.** (2 days)

Update `docs/designs/03 Runtime DOM.md` Phase 2 section. Other design
docs reference Phase 2 model conceptually; update those mentions. No
migration guide needed for users — the API didn't change.

**Total: ~2.5 weeks** for a single full-time implementer.

## Implementation surface

| File / area                                        | Action                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dom/src/binding-registry.ts`             | New. ~150 lines.                                                                                                                |
| `packages/dom/src/update-loop.ts`                  | `_runPhase2` rewrite (~50 lines net change). `processMessages` minor changes to thread the new dispatch.                        |
| `packages/dom/src/binding.ts`                      | `createBinding` now also calls `registerBinding(scope, binding, prefixIds)`. Field rename `mask`/`maskHi` → `prefixIds`.        |
| `packages/dom/src/lifetime.ts`                     | `addBinding` → `addBinding(scope, binding, prefixIds)`. Scope disposal walks `bindings` and calls `unregisterBinding` for each. |
| `packages/dom/src/types.ts`                        | `Binding` interface: `mask`/`maskHi` → `prefixIds: number \| Int32Array`.                                                       |
| `packages/dom/src/el-split.ts` / `el-template.ts`  | Binding tuple unpacking changes from mask-tuple to prefix-ids-tuple.                                                            |
| `packages/compiler/src/modules/element-rewrite.ts` | Tuple emission shape changes. ~50 lines of diff.                                                                                |
| `packages/compiler/src/modules/core-synthesis.ts`  | `__prefixes` emission unchanged; per-binding mask emission becomes per-binding prefix-id list.                                  |
| `packages/dom/test/*.test.ts`                      | Tests reading `inst.allBindings` need to read `inst.bindingsByPrefix` or use a test helper. ~10–20 files.                       |

**LOC delta estimate:** −800 / +400 net (the new registry costs lines; the
Phase 2 scan loop + mask fields net out smaller).

## Open questions

1. **Prefix-id packing format.** For ≤30 prefixes, a single `number`
   bitmask works (compact, gate is `if (mask & (1 << prefixId))`). For
   31+ prefixes, an `Int32Array` would be smaller than a `number[]`. Where's
   the crossover? Probably keep the single-number form for ≤30 (covers most
   apps) and only escalate to `Int32Array` for overflow. Same threshold
   logic as today's `maskHi`.

2. **Memo() with prefix-id reactivity.** Today `memo()` uses
   `currentDirtyMask` to detect "did any of my deps change?" In Option B,
   the analog is "did any prefix-id in my dep list fire?" The runtime
   needs to expose a way for `memo()` to check this efficiently. Two
   approaches:
   - Per-update, build a `Set<number>` of changed prefix-ids; `memo`
     checks set intersection.
   - Reverse-index: memo subscribes via the same `bindingsByPrefix`
     registry, recomputes on fire.

3. **Dispatch order within a prefix's binding set.** Today Phase 2
   iterates `allBindings` in mount order. In Option B, a `Set` doesn't
   preserve insertion order across deletes. If user code relies on mount
   order (e.g., one binding mutates state another reads — should be a
   lint error today but might exist in practice), this could surface
   regressions. Resolution: use an array with manual dedup, or accept
   `Set` insertion-order (V8 preserves it; not spec-guaranteed but
   reliable in practice).

4. **Per-item bindings interaction with the registry.** Per-item updaters
   (zero-arg accessors via `addCheckedItemUpdater`) live outside the
   prefix registry. The registry only needs to handle state-level
   bindings. Confirm in Phase 3 that nothing gets double-registered.

## Failure modes

1. **The `Map<number, Set<Binding>>` allocation cost outweighs the
   scan-floor savings.** At 1000 bindings, `Phase 2` scans an array of
   1000 in ~7 µs. The registry does 1 map lookup + 1 set iteration. If
   the average prefix has many subscribers, the set iteration is the same
   work; if there's allocation cost from set churn (binding registration
   on every mount cycle), Option B regresses.

   Mitigation: pool the sets (similar to scope pooling in `lifetime.ts`).
   Use `Array<Binding>` instead of `Set` if dedup isn't needed.

2. **Compile-time prefix-id packing balloons the binding-tuple size.**
   Today's `[mask, kind, key, accessor, maskHi?]` is 4–5 elements. If the
   new tuple is `[prefixIds, kind, key, accessor]` and `prefixIds` is an
   `Int32Array` literal, the source bytes per binding may grow.

   Mitigation: stay with the single-number form for ≤30 prefixes. Most
   apps don't need overflow.

3. **The `memo()` deps-check needs a per-update changed-prefix snapshot,
   which costs O(prefixCount) to build.** If we don't build it, `memo()`
   can't tell if it needs to recompute.

   Mitigation: lazily build the set. Or eagerly build on every update —
   the cost is bounded by `prefixCount` (typically 5–30), trivially small.

### Rollback plan

The two paths (`'flat'` and `'registry'`) coexist after Phase 2. If Phase
4's measurement-gate fails (bundle didn't shrink, or perf regressed),
revert Phase 4 — the codebase stays on `'flat'` mode (the v0.4 path) with
the registry available behind a flag for experimentation.

The compiler always emits the registry shape after Phase 3; old runtimes
fall back to the flat scan when they see no `__bindingModel`. So a
rollback at the runtime level doesn't require a compiler rollback.

## Decision rubric

Pick Option B when:

- ✅ Closing the perf gap on `Select` (single-path dispatch) is the
  primary goal.
- ✅ Preserving the v0.4 user API and the TEA contract is a hard
  requirement.
- ✅ A 2.5-week implementation budget is feasible.
- ✅ ≤ 7 kB gz is acceptable (vs Solid's ~4.5 kB) for v0.5.
- ✅ The agent protocol and 41 lint rules must remain stable.

Don't pick Option B when:

- ❌ The goal is Solid-class bundle (~3–5 kB gz). Option B's floor is
  ~5–7 kB because it still ships the prefix-walk + registry + JSON state
  abstractions.
- ❌ TEA's "pure update returning JSON state" is itself the problem and
  needs rethinking (then it's Option A).
- ❌ Compiler complexity is the constraint; Option B does add a registry
  emission but it's contained.

For maximum perf/bundle wins at the cost of breaking TEA, see Option A.
For bundle wins without runtime changes, see Option C.
