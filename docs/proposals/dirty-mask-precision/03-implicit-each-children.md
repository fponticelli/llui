# `each()` Rows as Implicit Level-2 Child Components

**Status:** proposal (large; depends on unified-composition-model)
**Effort:** months
**Ceiling:** -30%+ on wide-row workloads; brings LLui's narrow-update
performance to parity with Solid's natural per-row granularity
**Sequence:** low — depends on resolution of
`docs/proposals/unified-composition-model.md`

## The cost being addressed

Today, an `each()` block flattens every row's reactive bindings into
the parent component's `allBindings` array. For jfb-ticker (200 rows ×
~7 bindings/row = 1400 row bindings) Phase 2 walks all of them on
every commit. The mask gate skips ~99% of them when the dirty mask
doesn't cover row-relevant paths, but the iteration cost itself is
~1ns × 1400 = ~1.4μs per commit. Across 100 narrow ticks: ~0.14ms — a
real but bounded floor that the existing patches cannot remove.

More importantly: the _parent state read_ pattern in row bindings
(e.g. `class: (s) => \`mode-${s.dashboard.displayMode}\``) makes every
row's class binding mask-overlap with the dashboard's displayMode bit.
When narrow ticks touch displayMode-adjacent paths (the same 31-bit
range under the over-approximation that the runtime patch addresses),
every row's class binding still fires its closure. Even with the patch,
genuinely-narrow dashboard updates that _do_ touch displayMode would
spike row work.

Solid's natural shape is: each row is its own component with its own
reactive scope. Parent state changes that don't flow into the row's
read graph don't trigger any row work at all. LLui's `child()`
primitive offers the same — but as an opt-in.

## The fix

Make `each()` rows implicit Level-2 child components when:

- the row count is unbounded or large (>~10 rows), AND
- per-row bindings exist that don't depend on parent state, AND
- the user hasn't already wrapped rows in an explicit `child()` /
  `scope()`.

The compiler statically analyzes the row render to determine if
lifting is beneficial. The runtime gives each row a tiny `child()`
component scope:

- own `allBindings` array (only this row's bindings)
- own `__prefixes` (only the paths this row reads)
- own dirty mask, updated on parent commit by walking _just this
  row's_ prefixes

Parent's Phase 2 no longer iterates row bindings. Each row's Phase 2
runs only when the row's prefix walk shows a dirty bit.

## Why this isn't just `child()` today

`child()` works but requires the user to:

1. Decide the per-row state slice
2. Lift the row's render into a separate component definition
3. Pass parent props in via a slice prop

For ergonomic each() this is too much friction. The compiler should
recognize the pattern and lift automatically, with the user opting
_out_ via an `each({ inline: true })` flag if they want the current
behavior.

## Measurement

For jfb-ticker:

| Op          | Current | Predicted (implicit children) | Δ      |
| ----------- | ------- | ----------------------------- | ------ |
| narrow×100  | 1.8ms   | ~1.3ms                        | -28%   |
| tick×100    | 5.3ms   | ~4.0ms                        | -25%   |
| burst-1k    | 14.9ms  | ~10ms                         | -33%   |
| wide-toggle | 3.4ms   | ~3.4ms                        | 0      |
| churn-50    | 4.5ms   | ~6ms                          | +33% ⚠ |

`wide-toggle` is unchanged because every row legitimately needs to
react (displayMode change → all 200 row classes update). `churn-50`
_regresses_ because mounting/unmounting 50 children is more expensive
than mounting/unmounting 50 sets of flat bindings. The mount cost
of a child component is real overhead.

So this is a tradeoff: narrow update perf vs row-mount/unmount perf.

## Hard problems

1. **When does the compiler lift?** Heuristic: lift if estimated rows >
   N (parameterizable) AND the row body has > M reactive bindings.
   Wrong on either side regresses some workload.

2. **Parent state reads from rows.** Currently rows access parent state
   via the View bag's accessor pattern. With implicit children, parent
   state has to flow through as props or a context. The render closure
   capture has to be analyzed to determine what flows.

3. **Disposal cost.** `child()` instances register disposers per row.
   Churning 1000 rows means 1000 instance lifecycles. The mount/unmount
   cost dominates short-lived row scenarios.

4. **Backward compatibility.** Existing apps using `each()` would
   suddenly see different memory + perf shapes. The flag opt-out is
   essential.

## Dependencies

- `docs/proposals/unified-composition-model.md` describes a unified
  model where `each()` rows, `child()` instances, and `scope()`
  delimiters all share the same lifetime infrastructure. This proposal
  is essentially a compiler+runtime application of that model
  specifically to `each()` blocks.
- `__llui_deps.json` library manifests (v2-compiler-proposal) needed
  for cross-file row-render functions.

## Why not now

The runtime patch + threshold gate + compiler-precise masks (proposals
01 + the shipped patch) deliver most of the recoverable win at a
fraction of the cost. This proposal targets a residual ~0.5ms gap on
narrow×100 and adds risk on churn workloads.

Should be reconsidered if:

- A user reports a workload with >>200 rows where narrow updates are
  hot
- The unified-composition-model proposal lands and provides the
  primitives
- A profiler shows the row-binding scan is the dominant cost in a real
  app
