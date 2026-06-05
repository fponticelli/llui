# jfb-ticker — High-Frequency Partial Update Benchmark

## Why this exists

krausest's `js-framework-benchmark` measures flat-list throughput at scale, but
its operations are coarse: replace 1k rows, update every 10th row, swap two
rows. None of these exercise the case LLui's bitmask is designed for — a
component with many distinct state paths where only a small subset changes
per update.

A stock-ticker board is the canonical real-world example: dozens of independent
scalar metrics (market index, advancers, decliners, sector totals, time) plus a
list of symbols where individual cells tick at high frequency.

This benchmark adds operations that stress that shape, and is built to slot
into the jfb harness so cross-framework numbers stay comparable.

## Scene

A single-page ticker board with two regions:

**Dashboard (top-level, wide-component)** — ~32 scalar state paths in one
component (kept ≤62 so we stay inside the lo+hi bitmask range without falling
back to `FULL_MASK`):

| Group        | Count  | Examples                                          |
| ------------ | ------ | ------------------------------------------------- |
| Headline     | 4      | indexValue, indexChange, indexChangePct, lastTick |
| Breadth      | 4      | advancers, decliners, unchanged, newHighs         |
| Sectors      | 11     | tech, financials, healthcare, energy, …           |
| Currencies   | 4      | usd_eur, usd_jpy, usd_gbp, usd_cny                |
| Commodities  | 4      | oil, gold, silver, copper                         |
| Display mode | 1      | 'price' \| 'change' \| 'volume' (cross-cutting)   |
| Tick counter | 1      | total ticks applied this session                  |
| Status       | 3      | marketState, latencyMs, connectedFeeds            |
| **Total**    | **32** |                                                   |

Why 32 specifically: it crosses the 31-path lo-mask boundary, forcing the
compiler to emit `maskHi`. This is exactly the case we want measured —
component just barely needing two-word masks.

**Symbol list (each-loop, 200 rows)** — each row renders symbol, price,
change, change-pct, volume, last-update-time. Per-row state is keyed by
symbol id. Display mode (a dashboard path) determines which two columns are
visible; flipping it is the "wide fan-out" test.

## Operations (jfb-clickable buttons)

Each operation runs **synchronously** (uses `flush()` in LLui, equivalent
synchronous-commit in competitors) so jfb's DOM-stable detection fires
immediately after.

| ID            | Label       | What it does                                                                  | Targets                 |
| ------------- | ----------- | ----------------------------------------------------------------------------- | ----------------------- |
| `mount`       | Mount 200   | Initial render: 200 symbols + dashboard                                       | mount cost              |
| `tick-1`      | 1 tick      | One random tick: flip 2 dashboard paths + update 5 random symbols             | single-cycle baseline   |
| `tick-100`    | 100 ticks   | 100 ticks applied as one batched update (single message? or 100 messages?)    | amortized batch         |
| `burst-1k`    | Burst 1k    | 1000 ticks in one batched update                                              | sustained churn         |
| `narrow-100`  | 100 narrow  | 100 ticks that touch ONLY 1 dashboard path each (no symbol updates)           | mask gating efficiency  |
| `wide-toggle` | Toggle mode | Flip `displayMode` once                                                       | fan-out to every row    |
| `churn-50`    | Churn 50    | Remove first 50 symbols, append 50 new ones                                   | each() reconciliation   |
| `clear`       | Clear       | Reset all rows + dashboard to zero                                            | unmount cost            |
| `batch-1k`    | Batch 1k    | 1000 ticks **coalesced into ONE commit** via each framework's idiomatic batch | streaming/bulk-dispatch |

**Sequential vs. coalesced — `burst-1k` and `batch-1k` are the two ends:**

- `burst-1k` — _forced-synchronous_: 1000 ticks, each flushed to the DOM
  individually (LLui synchronous `send()`, React `flushSync` per dispatch,
  Svelte `flushSync()` per tick, Solid sync `setState`, vanilla direct DOM per
  tick). Measures the per-cycle reconcile path under sustained churn.
- `batch-1k` — _idiomatic coalesced_: the same 1000 ticks, but committed as ONE
  reconcile using each framework's native batching: LLui `batch(() => …)`, React
  18 auto-batch (dispatch loop without `flushSync`), Solid `batch(() => …)`,
  Svelte's scheduler (mutate `$state` ×N then one `flushSync`), vanilla
  (mutate the model ×N, then one DOM render pass). Measures the streaming /
  bulk-dispatch fast path — draining a frame of N updates as a single re-render.

Both bump `tickCount` by +1000, so the harness uses the identical `#ticker-counter`
post-condition for each; the only difference is how many DOM commits happen in
between. Comparing the two columns shows each framework's coalescing headroom.

## What we expect to measure

`narrow-100` is the canonical mask-gating test. A framework that re-runs every
row on any state change pays O(rows) per tick even when no row-relevant path
changed. LLui should be O(1)-per-tick here. The delta between `narrow-100` and
`tick-100` × 5-row-touches tells us the gating cost itself.

`wide-toggle` is the inverse: a single state path change must reach every row.
This is the worst case for fine-grained reactivity systems that subscribe
per-cell — they pay subscription bookkeeping. LLui's path-based mask + scope
tree should handle this without per-row indirection.

`churn-50` keeps an each-reconciliation signal in the suite so we catch
regressions in the keyed-list path.

## Framework matrix

Implementations live under `benchmarks/jfb-ticker/frameworks/<id>/`, each a
self-contained Vite app following jfb conventions. Same DOM structure, same
button IDs, same operation semantics. (Specific set TBD with Franco.)

## Measurement integration

jfb's runner clicks a button, waits for DOM stability, records the duration.
Each operation above fits that model because it's synchronous-commit.

**Custom benchmarks** are added to the local jfb-repo via its
`webdriver-ts/src/benchmarksLocal.ts` mechanism. `scripts/run-jfb.ts` learns
to invoke a separate `--suite ticker` mode that runs only these benchmarks
against the registered framework set.

The existing `jfb-baseline.json` stays untouched; ticker baselines live in
`benchmarks/ticker-baseline.json` so the two suites are independently
versioned.

## Open questions (resolved)

1. **Framework set** — vanillajs, Solid, React 19, Svelte 5 (runes), plus LLui.
   Vue/Preact deferred.
2. **Symbol count** — 200. Revisit if signal is weak.
3. **Determinism** — `mulberry32` seeded with `0xC0FFEE`, reset by every `mount`
   click. Each framework consumes the same tick sequence.

## Running

```bash
pnpm bench:ticker:setup    # one-time: symlink apps into jfb-repo + apply patches
pnpm bench:ticker          # all 5 frameworks × 9 ops
pnpm bench:ticker --framework llui
pnpm bench:ticker --runs 3 --save
```

Patches under `jfb-patches/` are reapplied by `setup-ticker.ts` on every run
(idempotent), so re-running `pnpm bench:setup` (which refreshes the upstream
clone) doesn't lose the ticker wiring.

## Synchronization

Every operation bumps `state.dashboard.tickCount` by +1 per flushed iteration.
The harness reads `#ticker-counter`'s pre-click value, clicks, then waits for
the value to reach `pre + N`. `mount` and `clear` use tbody row count instead
(`tbody/tr[200]` exists / `tbody/tr[1]` doesn't).
