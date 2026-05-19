# Option A — Fine-grained signals (Solid-class)

## Summary

Replace the Phase 2 binding array + bitmask gates with per-path signal
subscriptions. The compiler extracts each state path into a signal; every
binding becomes an effect that subscribes to exactly the signals it reads.
Targets Solid-class bundle size (3–5 kB gz) and Solid-class single-message
perf, at the cost of breaking the TEA `update(state, msg) → [newState,
effects]` contract.

This is the **largest** rewrite of the four options. Pick this only if the
v0.5 thesis is "best-in-class compile-time-reactive framework" and you're
willing to redesign the agent protocol, the lint surface, and the public
API.

## Motivation

The bitmask Phase 2 model imposes a per-update floor of O(`bindings.length`)
gate-check work even when only one path changes. Solid avoids this by making
every reactive read a direct subscription: when path `selected` changes,
only the effects that read `selected` re-run.

Today on jfb, this shows up as the `Select` op's 3–4 ms wall-clock
(microscopically slow vs Solid's ~2 ms). Across an app with 1000 bindings,
even when only one fires, Phase 2 still iterates 1000 binding objects and
does 1000 mask AND-ORs.

Removing Phase 2 also removes:

- `__prefixes` emission and `computeDirtyFromPrefixes` (`update-loop.ts:107`).
- The flat `allBindings` array on `ComponentInstance`.
- The two-31-bit-word mask threading throughout the runtime.
- The mask-injection compiler passes (`structuralMaskModule`, `textMaskModule`,
  `bitmask-overflow`, et al — `packages/compiler/src/modules/*-mask*.ts`).

Net bundle reduction in `packages/dom/dist/`: ~5–8 kB raw / ~2–3 kB gz of
runtime that simply doesn't exist anymore.

## Target metrics

- **Bundle (jfb shape):** ≤ 5 kB gz. Stretch: 3 kB gz (parity with Solid).
- **Bench `Select`:** ≤ 2.5 ms median.
- **Bench other ops:** within ±5 % of Solid (we're already there or close).
- **511 → ? dom tests.** Many existing tests assume Phase 2 semantics; some
  will be deleted, some rewritten. Expect 300–400 tests after migration.

## Architecture changes

### What's removed

| File                                       | What goes                                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dom/src/update-loop.ts`          | `computeDirtyFromPrefixes`, `_runPhase2`, `genericUpdate`, `processMessages`'s mask threading, `_handleMsg`'s `method`-discriminated dispatch, `setCurrentDirtyMask` plumbing through `memo()`. The file shrinks to maybe 30 % of current size. |
| `packages/dom/src/binding.ts`              | Most of `createBinding`/`applyBinding` machinery. The "binding" concept becomes a thin wrapper over `effect(() => …)`.                                                                                                                          |
| `packages/compiler/src/modules/*-mask*.ts` | `bitmask-overflow.ts`, `structural-mask.ts`, `text-mask.ts`, `accessor-side-effect.ts`'s mask-related parts. The path-prefix table emission (`core-synthesis.ts`'s `__prefixes`) is replaced with signal-extraction emission.                   |
| `packages/dom/src/primitives/memo.ts`      | Replaced by signal-based memoisation (a computed signal subscribes once, recomputes on dep change).                                                                                                                                             |

### What's replaced

| Concept (today)                            | Concept (Option A)                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `state: S` (plain JSON object)             | A signal-tree object: every leaf path is a `Signal<T>`.                                          |
| `binding.mask` / Phase 2                   | Per-binding `effect()` subscribed to the signals its accessor reads.                             |
| `each.reconcile` keyed-diff                | Signal-backed list reconcile (Solid's `<For>` model).                                            |
| `branch.reconcile` / `show`                | Signal-backed conditional (subscribes to the discriminant signal).                               |
| `update(state, msg) → [newState, effects]` | `update(msg) → effects`. State mutation happens via signal setters. **TEA contract changes.**    |
| `__prefixes`                               | Compile-time signal-graph extraction. Each `s.foo.bar` read becomes `signals.foo.bar.get()`.     |
| `__handlers` per-Msg-variant fast-path     | Not needed — signal subscriptions are the fast path.                                             |
| `__view` per-component bag factory         | Either kept (for the destructure-only-what-you-use win) or made redundant (signals are imports). |

### What's added

A new runtime module — call it `packages/dom/src/signal.ts` — with:

- `createSignal<T>(initial)` → `{ get(): T; set(v: T): void; subscribe(fn): unsubscribe }`.
- `createMemo<T>(fn)` → derived signal; `fn` runs once, subscribes to read
  signals; result cached, recomputed on any dep change.
- `effect(fn)` → run `fn` once, subscribe to its reads, re-run on any dep
  change. Returns a dispose handle.
- `batch(fn)` → defer subscriber notifications until `fn` returns. Used for
  `update()` so a single message that mutates multiple paths fires
  subscribers once at the end.

A new compiler pass — `packages/compiler/src/modules/signal-graph.ts` — that:

- Scans `init()` to extract the state shape.
- Emits `createSignal` calls per leaf path.
- Rewrites every `s.foo.bar` read in accessors / structural-primitive driver
  fns to `signals.foo.bar.get()`.
- Rewrites `update()` bodies that return `[newState, effects]` into a
  sequence of signal setter calls + an effects array.

A new structural-primitive set in `packages/dom/src/primitives/`:

- `each.ts` becomes a thin Solid-`<For>`-style reconciler that subscribes to
  a list signal and produces per-row scope + signal-bound rows.
- `branch.ts` / `show.ts` collapse — both become a `branch()` that
  subscribes to a discriminant signal and swaps DOM.

## User-facing impact

**This is the breaking change.** The public API shifts in two places.

### `update()` shape

```ts
// Today (v0.4):
update: (state, msg) => {
  switch (msg.type) {
    case 'inc':
      return [{ ...state, count: state.count + 1 }, []]
  }
}

// Option A:
update: (msg) => {
  switch (msg.type) {
    case 'inc': {
      state.count++
      return []
    }
  }
}
```

`state` is no longer a plain object passed in/out. It's a signal-tree the
runtime owns. `update()` becomes imperative against `state`'s signal
setters, and only returns effects.

This breaks **41 lint rules** (every one that assumes the spread-return
pattern). Most can be rewritten to assert the new pattern; some (e.g.,
`no-mutation-in-update`) become _inverted_ (mutation is now the only path).

### `view()` accessors

```ts
// Today:
view: ({ text }) => [text((s) => String(s.count))]

// Option A — pick one:
// (a) Implicit tracking: same signature, runtime tracks reads.
view: ({ text }) => [text((s) => String(s.count))]
// (b) Explicit signal API: drop the `s` param, signals are imports.
view: ({ text }) => [text(() => String(state.count))]
```

(a) preserves the user API but requires the compiler to detect `s.x` reads
and rewrite to `signals.x.get()`. (b) is more honest about the model but is
a louder migration. Decision pending in the implementation phase.

### Agent protocol

`AppHandle.getState()` today returns the JSON state. In Option A, "state"
is a signal tree. Either:

- `getState()` walks the tree and produces a JSON snapshot (every read is
  cheap; the cost is the walk). Existing agent protocol unchanged.
- Or: agent protocol learns to read signals directly. Bigger change but
  enables live subscription.

The first option (snapshot via walk) is recommended for v0.5 to preserve
agent stability.

### Effects, msg routing, HMR

- **Effects:** unchanged. `update()` still returns an `E[]`. The handler
  chain in `@llui/effects` is untouched.
- **Msg routing:** `send(msg)` still queues to a microtask. The runtime
  drains the queue, calls `update()` per msg (which mutates signals + emits
  effects), then dispatches effects.
- **HMR:** more complex. Today, HMR swaps `def.update` / `def.view` /
  `def.__prefixes`. With signals, the signal graph IS part of the
  instance's state. Swapping the def means deciding how to preserve the
  signal graph across the swap. Likely path: keep the existing signal-tree
  shape from `init()` and re-bind effects.

## Migration plan

**Phase 1 — Build the signal runtime in parallel.** (1 week)

Create `packages/dom/src/signal.ts` with `createSignal` / `createMemo` /
`effect` / `batch`. Write 30–50 unit tests covering subscription, dep
tracking, batching, disposal. Validate against
`packages/dom/test/strategies/` patterns. **Don't touch existing code yet.**

Measurement gate: signal module ≤ 1 kB gz on its own.

**Phase 2 — Signal-graph compiler pass.** (2 weeks)

Implement `packages/compiler/src/modules/signal-graph.ts`. Inputs: a
`component({...})` literal. Outputs: an `init()` rewrite that builds a
signal tree, plus accessor rewrites that read via `signals.foo.bar.get()`.
Add per-test fixtures under `packages/compiler/test/signal-graph/`.

Measurement gate: 10 representative test fixtures compile cleanly and
produce signal-tree code that matches hand-written reference output.

**Phase 3 — Build a new runtime entry alongside the old one.** (2 weeks)

`packages/dom/src/mount-v5.ts` mounts a component using the signal-runtime
path (no Phase 2). The existing `mount.ts` stays. Components opt in via a
sentinel field (`__v5: true` emitted by the new compiler pass).

Measurement gate: a small `examples/v5-counter/` runs and passes a
correctness suite (events, state mutation, view re-render on signal change).

**Phase 4 — Port primitives.** (3 weeks)

`each-v5.ts`, `branch-v5.ts`, `show-v5.ts`. Each subscribes to its
discriminant signal. Hard part: `each-v5.ts`'s keyed-diff needs to match
the perf of the existing keyed-each AND handle insert/delete/swap without
re-running all child effects. Reference: Solid's `<For>` (publicly
available source). Implement against the same jfb-bench suite to keep the
perf bar honest.

Measurement gate: `pnpm bench` on a v5-bench-app (clone of the jfb bench
app, ported) ≥ Solid parity on every keyed op.

**Phase 5 — Port the bench app to v5.** (1 week)

Update `benchmarks/js-framework-benchmark/src/main.ts` to use the v5
compiler. Run `pnpm bench` and confirm Solid parity. Verify bundle ≤ 5 kB
gz.

**Phase 6 — Migrate the rest of the codebase.** (2 weeks)

`@llui/components`, `@llui/router`, `@llui/agent-bridge`, `@llui/vike`,
`@llui/mcp`, every example. Update or rewrite the 41 lint rules. Delete
v0.4 dead code (`update-loop.ts`'s mask logic, `binding.ts`'s flat-array
machinery, the mask compiler passes).

Measurement gate: full turbo test green, all examples build and run.

**Phase 7 — Docs + release.** (1 week)

Rewrite `docs/designs/01 Architecture.md`, `02 Compiler.md`, `03 Runtime
DOM.md`, `09 API Reference.md`. Migration guide for v0.4 → v0.5.

**Total: ~12 weeks** for a single full-time implementer. Half that with
two people working in parallel after Phase 3.

## Implementation surface

| File / area                                                                      | Action                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/dom/src/signal.ts`                                                     | New. ~300 lines.                                                                   |
| `packages/dom/src/mount.ts`                                                      | Replaced entirely. ~200 lines (vs 772 today).                                      |
| `packages/dom/src/update-loop.ts`                                                | Deleted or shrunk to ~50 lines (just the message queue).                           |
| `packages/dom/src/binding.ts`                                                    | Replaced. ~80 lines (vs 175 today).                                                |
| `packages/dom/src/primitives/each.ts`                                            | Rewritten. ~400 lines (vs 901 today).                                              |
| `packages/dom/src/primitives/branch.ts` / `show.ts` / `scope.ts`                 | Rewritten or merged into one.                                                      |
| `packages/dom/src/primitives/memo.ts`                                            | Deleted (computed signals replace it).                                             |
| `packages/dom/src/primitives/selector.ts`                                        | Replaced by computed signals.                                                      |
| `packages/compiler/src/modules/signal-graph.ts`                                  | New. ~600 lines.                                                                   |
| `packages/compiler/src/modules/core-synthesis.ts`                                | Most of `__prefixes` / `__handlers` emission goes away. ~300 lines (vs 700 today). |
| `packages/compiler/src/modules/{structural,text,each-memo,bitmask-overflow}*.ts` | Deleted.                                                                           |
| All 41 lint rules in `packages/compiler/src/modules/*.ts`                        | Audit; rewrite or delete each.                                                     |
| `docs/designs/01–09`                                                             | Rewrite.                                                                           |

**LOC delta estimate:** −5,000 / +3,000 net.

## Open questions

1. **Implicit vs explicit signal tracking** (see "user-facing impact"
   above). Pick one before Phase 2.

2. **`state` snapshot for agent / devtools.** Eager walk every time
   `getState()` is called, or memoised snapshot invalidated on any signal
   change? Memoised is faster but adds a subscriber to every signal.

3. **HMR semantics.** When `def.update` changes, does the signal graph
   survive? Probably yes (init shape didn't change), but the
   subscriber-list-rebind is non-trivial.

4. **Effect cancellation.** Today `@llui/effects`' `cancel` is keyed to
   the effect's identity. With signals, an effect that no longer has any
   subscribers should auto-dispose its emitted side effects. Or should it?
   Decide before Phase 4.

5. **`memo()` migration.** Today `memo()` is used inside `each.items`
   accessors to avoid re-allocating arrays. With computed signals, this is
   the default behaviour, but the API isn't 1:1. User code that calls
   `memo()` explicitly needs a migration codemod.

6. **Per-item signals vs per-row scope.** `each.render`'s zero-arg
   accessors (`item.label`) today bypass Phase 2 via `addCheckedItemUpdater`.
   In the signal model, per-row data becomes per-row signals. 1000 rows ×
   5 fields = 5000 signals — is that allocation cost acceptable? If not,
   the row factory has to use the same fine-grained-prop approach Solid
   uses (one signal per row, projected per-field via memos).

## Failure modes

1. **The `each.ts` rewrite ends up bigger than today.** Keyed-diff is
   intrinsically complex; if the signal-backed version needs special-case
   paths for insert/swap/remove that don't exist in Solid (because Solid's
   bench numbers come from `<For>` AND extensive V8-specific tuning), we
   end up shipping more `each.ts` bytes than today. Rollback: revert to
   v0.4's keyed-each, keep the rest of the signal runtime.

2. **Phase 2 disposal is harder than expected.** Signal subscriptions need
   to be torn down when scopes dispose. The lifetime-tree pattern doesn't
   cleanly map onto subscriber lists. Either re-introduce a lifetime tree
   for subscriptions (giving back some of the bytes we saved) or accept
   memory leaks on early disposal.

3. **`update()` API rewrite breaks too many user-code call sites.** Worst
   case: an existing app does `update: (s, m) => recursivelyCompute(s,
m)`. With Option A, `s` doesn't exist as a snapshot anymore. Either
   keep a "v0.4-compat" wrapper that synthesises a JSON snapshot from
   signals on every `update()` call (perf cost — defeats the purpose), or
   reject the pattern at compile time and force a refactor (DX cost).

### Rollback plan

The v0.5 work happens on a long-lived branch (`v0.5-signals`). Until Phase
5 lands and the bench app builds against the new runtime with Solid
parity, `main` stays on v0.4. If any of the failure modes above land, the
work is parked on the branch and `main` continues with Option D
(incremental). No data loss; the new compiler modules and the signal
runtime stay reusable for a future attempt.

## Decision rubric

Pick Option A when:

- ✅ The v0.5 thesis is **best-in-class bundle + perf**, not stability.
- ✅ A 12-week timeline is acceptable.
- ✅ Breaking the TEA `update(state, msg) → [newState, effects]` contract
  at the user level is acceptable (or the implicit-tracking variant solves
  it).
- ✅ The agent protocol's `getState()` returning a JSON snapshot is the
  authoritative model going forward (no live signal subscription needed).
- ✅ HMR's "preserve state across def swaps" semantics can be relaxed
  during the migration.

Don't pick Option A when:

- ❌ The user base / consumer-app surface is too entrenched in the v0.4
  shape to migrate within the release window.
- ❌ The TEA contract (pure `update` returning new state) is a hard
  requirement (e.g., for testing, replay, time-travel debugging).
- ❌ Implementation budget < 8 weeks.

For "preserve TEA but get most of the perf/bundle win," see Option B.
