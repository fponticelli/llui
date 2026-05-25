# Compiler-Precise Case Dirty Masks

**Status:** proposal
**Effort:** weeks (compiler work + cross-file analysis)
**Ceiling:** -12% on `burst-1k`, -11% on `narrow×100`, eliminates the
runtime prefix-walk overhead for cases the compiler can analyze precisely
**Sequence:** high — but blocked by the v2-compiler proposal's
`__llui_deps.json` library-manifest mechanism for cross-file precision

## The root cause this addresses

In `packages/compiler/src/modules/core-synthesis.ts`, `tryBuildHandlers`
walks each `case '<msgType>':` body's return-value expression via
`analyzeModifiedFields(stateExpr, stateName, topLevelBits, topLevelBitsHi)`.
It tracks which **top-level state fields** the case writes. The emitted
case dirty mask is the union of `topLevelBits[field]` for those fields.

When a top-level field has many leaf sub-paths bound by the view, the
emitted mask covers the field's entire bit range — defeating Phase 2's
per-binding gate.

For example, jfb-ticker's `narrow` case:

```ts
case 'narrow': {
  const tick = generateNarrowTick(rng, state.dashboard.tickCount)
  return [{ ...state, dashboard: { ...state.dashboard, ...tick.dashboardUpdates } }, []]
}
```

`analyzeModifiedFields` sees the spread pattern and emits `dirty =
topLevelBits["dashboard"]` — which is `0x7FFFFFFF` because dashboard has
32 leaf paths. The runtime prefix walk patch recovers precision at a
~1.75μs/commit cost. The compiler should do this analysis up-front and
emit precise masks directly.

## The fix

`analyzeModifiedFields` should descend into nested object-literal
patterns and resolve opaque patches by tracing their definition. Cases:

### Case A — fully-local literal

```ts
return [{ ...state, dashboard: { ...state.dashboard, tickCount: 5 } }, []]
```

Compiler sees a string-keyed property. Resolves `tickCount` to its
leaf-path bit. Emits `caseDirty = bit("dashboard.tickCount")`.

**Status:** straightforward. Implement first.

### Case B — same-file generator call

```ts
case 'narrow': {
  const tick = generateNarrowTick(rng, state.dashboard.tickCount)
  return [{ ...state, dashboard: { ...state.dashboard, ...tick.dashboardUpdates } }, []]
}
```

Compiler sees `tick.dashboardUpdates` — opaque at the case-body level
but defined in the same file or imported source. Lift analysis to the
generator's return-value statically: trace what keys
`generateNarrowTick` puts on `dashboardUpdates`.

For ticker's `generateNarrowTick` in `benchmarks/jfb-ticker/shared/operations.ts`:

```ts
export function generateNarrowTick(rng: () => number, seq: number): Tick {
  const idx = Math.floor(rng() * TICKABLE_PATHS.length)
  const key = TICKABLE_PATHS[idx]!
  const dashboardUpdates: Partial<Dashboard> = { tickCount: seq + 1 }
  ;(dashboardUpdates as Record<NumericDashboardKey, number>)[key] = ...
  return { dashboardUpdates, symbolUpdates: [] }
}
```

The compiler can statically see:

- `dashboardUpdates` has key `tickCount` (literal)
- Plus one key picked from `TICKABLE_PATHS` (a typed `ReadonlyArray<keyof Dashboard>`)

If the analysis can prove the dynamic key is bounded to the union
`'tickCount' | 'indexValue' | ... | 'connectedFeeds'`, emit
`caseDirty = bit("dashboard.tickCount") | bit("dashboard.indexValue") | ...`

That's still 29 bits — much wider than the actual single-bit precision
recovered by the runtime walk. So compile-time can't fully match
runtime-walk precision when the dynamic choice itself is data-driven.

**Status:** implement for the literal-keys case (compiler can detect
`{ tickCount: ..., indexValue: ... }` constant literals). For the
dynamic-key case, defer to runtime walk (already handled by the shipped
patch). Threshold gate decides when to walk.

### Case C — cross-file imported helper

```ts
case 'something': {
  const patch = libraryFunction(args)  // imported from @some/library
  return [{ ...state, foo: { ...state.foo, ...patch } }, []]
}
```

Cross-file analysis requires the v2-compiler proposal's
`__llui_deps.json` library manifest mechanism. Out of scope for this
proposal; will land alongside v2b.

**Status:** blocked. Fall back to runtime walk via the existing
threshold gate.

## Runtime contract

Compiler emits a third per-handler arg signalling whether the dirty
mask is precise:

```ts
// Before:
"narrow": (inst, msg) => _handleMsg(inst, msg, 0x7FFFFFFF, 0, 5)

// After:
"narrow": (inst, msg) => _handleMsg(inst, msg, bit("dashboard.tickCount"), 0, 5, /* precise */ true)
```

Runtime `_handleMsg` uses the `precise` flag to skip the runtime prefix
walk entirely:

```ts
if (!precise && prefixes !== undefined && popcount32(dirty) + popcount32(dirtyHi) > 4) {
  // runtime walk for over-approximated masks
} else {
  // use compiler mask directly
}
```

For cases where the compiler proves precision, the runtime never walks.
For cases where the compiler can't prove (Case B dynamic-key or Case C),
the runtime walks under the threshold gate.

## Measurement plan

Re-run jfb-ticker after compiler change:

| Op         | Current (runtime walk) | Predicted (compiler precise) | Δ    |
| ---------- | ---------------------- | ---------------------------- | ---- |
| burst-1k   | 14.9ms                 | ~13.2ms                      | -11% |
| narrow×100 | 1.8ms                  | ~1.6ms                       | -11% |
| tick×100   | 5.3ms                  | ~5.0ms                       | -6%  |

The deltas come from eliminating the 1.75μs/commit walk cost on cases
that are compile-time precise. For burst-1k that's 1000 × 1.75μs = 1.75ms.

## Risks

- **Compiler analysis bugs that under-approximate the dirty mask**
  would silently break apps (binding misses an update). Mitigation: the
  precision flag is opt-in per-case. The compiler errs on the side of
  emitting `precise: false` whenever analysis is uncertain. Runtime
  walk catches the imprecision.
- **Compiler analysis bugs that over-approximate** are equivalent to
  today's behavior — extra binding evaluations, no correctness break.
- **Cross-file analysis** complicates the build graph. v2-compiler
  proposal already addresses this.

## Implementation milestones

1. **M1: literal-key precision** — handle `case ... return [{ ...state,
foo: { ...state.foo, key1: v1, key2: v2 } }, []]` patterns. Emit
   precise leaf-bit union. ~1 week.
2. **M2: same-file generator tracing** — trace return-value literal of
   functions called from a case body, if defined in the same file. ~1
   week.
3. **M3: precise flag in `_handleMsg`** — runtime gate. ~half day.
4. **M4: cross-file via `__llui_deps.json`** — blocked on v2b.

## What gets removed

The runtime prefix walk in `_handleMsg` stays as the fallback. The
threshold gate also stays — it protects compile-time-imprecise cases.
Nothing is deleted; the win is making the precise path more common.
