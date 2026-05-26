# Evaluation: Compiler-Precise Case Dirty Masks

**Re-evaluated against post-memo numbers.** The original proposal
(`01-compiler-precise-dirty.md`) was written before the memo patch
shipped. Updated cost/benefit follows.

## Revised win ceiling

Pre-memo, the proposal predicted -11% on burst-1k and -11% on
narrow×100 by eliminating the ~1.75μs/commit prefix-walk overhead. The
memo patch already halved walk cost to ~1μs/commit. So compiler-precise
can save at most:

| Op         | Current | Best-case w/ compiler-precise | Δ       |
| ---------- | ------- | ----------------------------- | ------- |
| burst-1k   | 14.7ms  | ~13.7ms                       | **-7%** |
| narrow×100 | 1.6ms   | ~1.5ms                        | **-6%** |
| tick×100   | 5.3ms   | ~5.2ms                        | **-2%** |

The win comes purely from skipping the walk; it cannot tighten Phase 2
precision beyond what the walk already recovers (the walk is in fact
_more_ precise in one corner case: paths the case writes but no binding
reads have a walk-dirty bit of 0, but the compiler-precise mask
would conservatively include them).

## Real-world applicability — better than I first thought

Surveying actual reducer patterns in `examples/`:

```ts
// form-validation/src/main.ts:77
{ ...state, qr: { ...state.qr, value: msg.value, matrix } }

// github-explorer/src/update.ts:178
{ ...state, agent: { ...state.agent, connect: next } }

// github-explorer/src/update.ts:198 — three-level nesting
{ ...state, agent: { ...state.agent, ui: { ...state.agent.ui, copied: true } } }
```

Most TEA reducers in this codebase ARE the fully-local-literal Case A
pattern. The compiler analyzer at `core-synthesis.ts:523` (`analyzeModifiedFields`)
already recognizes top-level field writes but does NOT descend into
nested literals — so today it emits `topLevelBits["agent"]` for any
write to `agent`, even when only `agent.ui.copied` actually changes.

For a component with many bindings reading sub-paths of `agent.*`,
this triggers the same over-approximation we saw with ticker's
`dashboard`. So Case A is genuinely useful — it would benefit any TEA
component with nested state and a handful of bindings per field.

## Real-world non-applicability — what won't work

Two patterns escape static analysis:

1. **Computed keys** — `{ ...state.values, [msg.field]: msg.value }`
   (form-validation:77). The compiler cannot know which key is written.
   Falls back to the conservative top-level mask. Same as today.

2. **Opaque patches** — `{ ...state.dashboard, ...patch }` where
   `patch` comes from a function call (e.g. ticker's
   `generateNarrowTick`). The compiler can't trace the patch's keys
   without cross-file analysis. Same as today.

Ticker's narrow case uses pattern #2, so compiler-precise wouldn't
help ticker's `narrow×100` measurement. It would help ticker's
`wide-toggle` (which writes `displayMode` as a literal:
`{ ...state, dashboard: { ...state.dashboard, displayMode: '...', tickCount: ... } }`).

So the numbers above (-7%/-6%/-2%) are upper bounds for components that
happen to write only literal-key fields. Ticker is partially in this
category (toggle/clear cases) and partially out (narrow/tick/churn).

## Scope of the compiler work

Implementing Case A only (descending into one level of nested literal):

- `analyzeModifiedFields` currently returns `string[] | null` — top-level
  field names. It needs to return `string[]` of leaf-path strings
  (`"agent.ui.copied"` etc).
- `tryBuildHandlers` (line 296) currently builds `caseDirty` from
  `topLevelBits[field]`. Needs to lookup leaf-path bits from `fieldBits`
  directly. Already available — `fieldBits` is the source of truth that
  `topLevelBits` is folded from.
- Recursive analysis: when a property value is itself an
  ObjectLiteralExpression with a `...state.<parent>` spread, descend
  with the parent prefix added.
- Bail correctly on spreads other than `...state.<chain>`, on computed
  keys, on conditionals, on call expressions.

Estimated effort: **3-5 days** for Case A (not weeks as the original
proposal claimed). The analysis is similar in structure to what
already exists, just recursive.

Case B (same-file generator tracing) adds another ~1 week and only
helps when the generator's return value is statically literal. For
ticker's `generateNarrowTick`, the keys come from `TICKABLE_PATHS`
indexed by a runtime random — even Case B can't recover precision
beyond "any of these 28 paths".

Case C (cross-file via `__llui_deps.json`) is genuinely months of work
and is blocked on v2-compiler.

## Risks

The proposal claimed mitigations via a runtime `precise` flag. On
closer look:

- **Under-approximation risk** (compiler misses a write): would
  silently corrupt apps. Mitigation in the proposal: opt-in flag,
  err-on-imprecise. This is sound but requires careful test coverage.
- **Over-approximation risk** (compiler emits more bits than necessary):
  equivalent to today's behavior, no regression.
- **Test surface**: every case in the new analyzer needs reducer-pattern
  tests. Realistic addition: ~20 new compiler tests.

## Real cost/benefit, revised

For the codebase's existing patterns (form-validation, github-explorer,
dashboard):

- Cases where Case A applies: most reducer branches
- Walk cost saved: ~1μs per commit per affected case
- Per-cycle cost in real apps: dwarfed by user-code allocation,
  framework dispatch, DOM write. Walk is ~5-10% of LLui-overhead-only
  time, which is ~5-10% of total time. So compiler-precise saves
  ~0.5-1% of wall time in real apps.

In benchmark-shaped workloads (high-frequency commits, many bindings
per nested field), the win is the 6-7% we predicted above.

## Recommendation

**Implement Case A only. Skip B and C.**

Rationale:

- Case A is the most common pattern in real reducers.
- Effort is bounded: ~3-5 days, fits in a normal feature-work week.
- The runtime walk + threshold + memo stays as a sound fallback for
  cases the compiler can't analyze. Belt-and-suspenders.
- Cases B and C have rapidly-diminishing returns and complicate the
  build graph. Defer until a real user reports a workload that needs
  them.

**Do not block on this for current bench numbers.** The 6-7% predicted
win on ticker burst-1k brings it from 14.7ms to 13.7ms — moves from
"clearly beats Solid" to "clearly beats Solid by more". The
narrow×100 win is 0.1ms, below measurement noise. No real user is
bottlenecked on either today.

**Sequence:** ship the current branch (PR), let it settle, do Case A
as a follow-up PR when there's appetite. The proposal docs already in
this branch (`01-compiler-precise-dirty.md`) capture the design.
