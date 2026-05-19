# Option D — Incremental squeeze (no rebuild)

## Summary

Don't rebuild. Continue the per-tier optimisation pattern from v0.4. Each
tier is independently shippable, measurable against the existing
`benchmarks/bundle-baseline.json`, and reversible if it doesn't pay off.
Realistic floor: ≈ 9–10 kB gz for the jfb bench shape, down from today's
11.0 kB. Beyond that, the architecture (Phase 2 binding-array + scope
tree + keyed-each) imposes a hard limit.

This is the **lowest-risk** option of the four. It's also the most
limited in payoff — it doesn't close the gap to Solid, and it doesn't fix
the `Select` op's outlier behaviour.

## Motivation

The v0.4 work showed that aggressive per-tier optimisation can extract
≈ 20 % from the bundle without rewriting anything. The pattern works:
identify a specific runtime feature → ablate it on a feature branch →
measure → decide → ship or revert.

Continuing this pattern has a clear ceiling. Specific opportunities that
remain (estimates from the v0.4 work's analyzer output):

| Tier         | Target                                                                                                  | Est. savings  | Risk                           |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------ |
| 8            | Extract `each.ts` enter/leave transitions                                                               | 0.3–0.7 kB    | Medium (build-flag complexity) |
| 9 (compiler) | Emit `setAttribute` etc. as a tighter format inside elTemplate's static HTML                            | 0.2–0.5 kB    | Low                            |
| 10           | Shorten internal `Binding` field names                                                                  | 0.1–0.5 kB gz | High (DX cost)                 |
| 11           | Inline the structural-block dispatch in `update-loop.ts` (apps with no `branch`/`show`/`scope` skip it) | 0.5–1.0 kB    | Medium                         |
| 12           | Per-app element-helper subset emission                                                                  | 0.3–0.5 kB    | Low                            |
| 13           | Drop `__cloneStaticTemplate` registry caching when only one app instance exists                         | 0.1–0.2 kB    | Low                            |

Total realistic: **2–3 kB gz** more, getting jfb to ≈ 8.5 kB gz. Lower
than Option A's 3–5 kB or Option B's 5–7 kB or Option C's 3–5 kB target,
but with **zero architecture changes**.

This is the option to pick when **the cost of architectural change
outweighs the bundle/perf wins** — for example, mid-release-cycle, or
when other LLui work is the higher priority.

## Target metrics

- **Bundle (jfb shape):** ≤ 9.5 kB gz; stretch 8.5 kB gz.
- **Bench all ops:** unchanged from v0.4. The `Select` +9–34 % regression
  is the architectural floor — Option D doesn't fix it.
- **Tests:** all 511 dom + 462 compiler + 505 agent tests continue to
  pass. Each tier is shipped as a self-contained commit; rollback is
  `git revert <commit>`.
- **DX:** no API changes. Internal refactors only.

## Architecture changes

**None.** This option is explicitly the no-architecture-change baseline.

Every tier listed below is a refactor within the existing modules. The
public API, the agent protocol, the lint rules, the TEA contract — all
unchanged.

## User-facing impact

**None.** Same as Option C in this respect — users notice nothing. Unlike
Option C, there's also no plugin requirement; the existing `@llui/dom`
npm-package model stays.

## Tier catalog

Each tier below is a concrete, scoped piece of work. They're independent
— you can ship any subset in any order. Estimates are based on the v0.4
audit data in `benchmarks/bundle-baseline.json` and the
`benchmarks/bundle-composition.json` snapshot.

### Tier 8 — Extract each.ts enter/leave transitions

**What:** Move the `removeEntry` leave-animation handling, the `fireEnter`
helper, and the `leaving: Entry<T>[]` queue from `each.ts` into a
separate code path that's only included when the app uses `each.opts.enter`
/ `each.opts.leave` / `each.opts.onTransition`.

Approach: add a vite-plugin `define`-level flag `__LLUI_TRANSITIONS__`
(modelled after `__LLUI_AGENT__`). When `false`, the transition branches in
`each.ts` get dead-code-eliminated.

**Risk:** the build-flag mechanism is documented but each-test interactions
need verification. Tests that exercise transitions need a way to override
the flag.

**Est. savings:** 0.3–0.7 kB gz. Ablation upper-bound measured in the v0.4
work was -334 bytes uncompressed; with the build-flag mechanism's
overhead, realistic net is ≈ -250 bytes uncompressed / -50 bytes gz.

**See:** `benchmarks/bundle-baseline.json#/abandoned/8` for the prior
attempt's measurement.

### Tier 9 (compiler) — Tighter `elTemplate` static-HTML emission

**What:** Today `buildStaticHTML` in `packages/compiler/src/modules/element-rewrite.ts`
emits attributes as space-padded strings: `class="foo"`. With many static
elements (jfb's jumbotron, the table row template), the repeated `=` and
`"` characters compound. Switching to single-quoted attrs and dropping
unneeded space saves bytes per emission.

Also: the static-template HTML uses `escapeAttr` / `escapeHTML` for
correctness, but for elements where the attr value is a hardcoded TS
literal, we can pre-escape at compile time and avoid the runtime helper.

**Risk:** low. Bench has lots of static markup; this tier directly targets
it.

**Est. savings:** 0.2–0.5 kB gz. Measure per emission shape change.

### Tier 10 — Shorten Binding field names

**What:** The Binding interface (`packages/dom/src/types.ts:417`) uses
descriptive field names (`mask`, `maskHi`, `accessor`, `lastValue`,
`kind`, `node`, `key`, `ownerLifetime`, `perItem`, `dead`). Minifiers
don't rename object properties (only locals). Each property access
(`binding.mask`, etc.) ships the full name in the bundle.

Renaming to single-char names (`m`, `h`, `a`, `l`, `k`, `n`, `y`, `o`, `p`,
`d`) saves bytes at every access. The cost is DX: `binding.k` instead of
`binding.kind` is unreadable. Multiple objects share the same field
names (`Binding`, `CreateBindingOpts`, `BindingTarget`) — all must rename
consistently.

**Risk:** high (DX cost, multi-interface rename, risk of overlapping field
names in unrelated types).

**Est. savings:** 0.1–0.5 kB gz. The v0.4 audit measured ~400 bytes
uncompressed potential, ~50–100 bytes gz.

**Recommendation:** skip unless we're under bundle-size pressure for a
specific release. The DX cost outweighs the win for routine releases.

### Tier 11 — Inline structural-block dispatch (apps with no structural primitives)

**What:** `genericUpdate` in `update-loop.ts:567` iterates
`inst.structuralBlocks` and dispatches to each block's `reconcile`. Apps
that don't use `branch` / `show` / `scope` have an empty
`structuralBlocks` array; the loop runs 0 iterations but the dispatch
code still ships.

A compiler-time check: if the app has no structural-primitive calls, emit
a `processMessages` variant that skips the Phase-1 loop entirely. Pair
with a `__hasStructuralBlocks` flag on the manifest.

**Risk:** medium. The flag is per-app, but `processMessages` is shared
runtime. Needs a build-flag mechanism similar to `__LLUI_AGENT__`. Could
also be done as a vite-plugin define.

**Est. savings:** 0.5–1.0 kB gz.

### Tier 12 — Per-app element-helper subset emission

**What:** Today `elements.ts` exports 68 HTML helpers. With the v0.4 work,
unused helpers are correctly tree-shaken from the bundle (only `button`
survived in jfb because of the bail in `action-button.ts`, fixed by
`__bindUncertain` in Tier 9). But the createElement factory itself —
about 1.5 kB of code in `elements.ts` lines ~30-150 — is shared by
helpers that ARE used.

For apps where all elements are compile-time-rewritten (no runtime
helper calls survive after element-rewrite), the factory itself can be
dropped. The bench app post-Tier-9 is exactly in this state.

A compiler-time check: if every element-helper call site was successfully
rewritten (none in `bailedHelpers`), don't import `createElement` /
`classifyKind` / `resolveKey` / `PROP_KEYS` from `elements.ts`. Those
helpers' export-only surface ships nothing.

**Risk:** low. The compiler already tracks `bailedHelpers`.

**Est. savings:** 0.3–0.5 kB gz.

### Tier 13 — Drop `__cloneStaticTemplate` registry caching for single-instance apps

**What:** `el-template.ts` caches `HTMLTemplateElement` instances keyed by
HTML string (per `DomEnv`), so cloning the same template multiple times
in `each.render` reuses the cached `<template>`. For an app with one
mount point and one each() call, the cache is over-engineered — a single
template element suffices.

For multi-mount apps, the cache is valuable. So this tier is gated by
"single mountApp call detected at compile time."

**Risk:** low for client-only apps. Higher for hydration / SSR apps where
the cache value comes from preserving identity across re-mounts.

**Est. savings:** 0.1–0.2 kB gz.

## Migration plan

There's no migration. Each tier is an independent commit. The pattern is:

1. Pick a tier from the catalog.
2. Make a feature branch.
3. Run `pnpm tsx benchmarks/measure-bundle.ts` to capture pre-tier
   numbers.
4. Implement the tier.
5. Run `pnpm tsx benchmarks/measure-bundle.ts --phase <N> --label
"Tier N: <name>" --save`.
6. Run `pnpm turbo test --force`. All 28 packages must stay green.
7. Run `pnpm bench --runs 3`. No regression on jfb timings (within
   ±10 % per op).
8. If all gates pass: commit, ship, move to next tier. If any gate
   fails: capture findings in `benchmarks/bundle-baseline.json#/abandoned`
   and move on.

The pattern is well-documented in commits `c946ea7`, `5defaa9`,
`50a5686`, `8d5c7e5`, `1a6aefe` (the v0.4 tier commits). Read those for
shape.

## Implementation surface

Each tier touches a small file set. See the tier catalog above for
specifics. Total LOC delta for all 6 tiers: probably −500 / +200 net.

## Open questions

1. **When to stop.** Once the bundle hits ≈ 8.5 kB gz, further tiers
   yield ≤ 100 bytes each. The cost-of-engineering exceeds the cost-of-
   bytes. We should commit to a stopping rule: "no tier worth <0.2 kB gz."

2. **What if a tier blocks future work.** E.g., Tier 10 (shorten field
   names) makes the next Tier harder because field names appear in
   compiler emissions. Sequence matters; pick low-risk first.

3. **Should we keep doing this indefinitely?** The honest answer is: the
   architectural ceiling makes Option D a 2026-shape strategy. For a
   v0.5 release, Option B or C delivers more. Option D is what we do
   **after** the next architecture move — to extract the remaining
   1–2 kB from whatever new architecture we land.

## Failure modes

1. **The tier ships but the bundle doesn't measurably shrink.** Bundler
   tree-shaking already did the work; no real win. **Mitigation:** the
   measurement gate catches this — revert the tier, document in
   `abandoned/`.

2. **A tier ships and a bench op regresses unexpectedly.** Tier 5's
   `__handlers` removal in v0.4 is the canonical example. **Mitigation:**
   the bench gate catches this — revert the tier, document.

3. **Cumulative complexity from many small tiers makes the codebase
   harder to maintain.** 6 build-flag-gated branches across the runtime
   = mental tax for future contributors. **Mitigation:** rigorously
   require each tier's gates to be unconditional once shipped; remove
   the gate's compile-time fallback after stabilising.

### Rollback plan

`git revert <commit>` per tier. Each tier is a single commit with a
measurement record in `benchmarks/bundle-baseline.json#/phases/<N>`.
Reverting restores the prior state cleanly; no cross-tier dependencies
exist (each tier is independent by design).

## Decision rubric

Pick Option D when:

- ✅ The cost-of-architectural-change exceeds the benefit right now.
- ✅ A v0.5 release without rebuilding is acceptable.
- ✅ The team's bandwidth is constrained; small, mergeable wins are
  preferred.
- ✅ Customers / consumers aren't asking for Solid-class bundle.
- ✅ The 9–10 kB gz floor is acceptable for the release window.

Don't pick Option D when:

- ❌ Bundle parity with Solid (≤ 5 kB gz) is a goal for v0.5.
- ❌ The `Select` op's +9–34 % vs baseline is a blocker (Option D
  doesn't fix it).
- ❌ Bigger architectural questions (signal model, closed runtime) are
  also valuable on their own merits.

This option **complements** the others rather than competing. Option B
plus a few Option D tiers is a reasonable v0.5 plan. Option A by itself
is enough work that adding D tiers is just noise.
