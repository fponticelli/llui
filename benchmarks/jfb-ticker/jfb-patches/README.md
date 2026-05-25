# jfb-patches

These files are injected into the local `js-framework-benchmark-repo`
clone by `scripts/setup-ticker.ts`. They:

1. Register the 8 ticker operations as new CPU benchmarks in jfb's
   measurement runner.
2. Surface the new benchmarks via the existing webdriver-ts CDP path so
   they're measured with the same paint-event accuracy as the standard
   keyed benchmarks.

The patches are idempotent — the setup script wraps each insertion in
matched `// === ticker-bench:begin === / // === ticker-bench:end ===`
markers and replaces between them on subsequent runs. Patches survive
`pnpm bench:setup` because the setup script re-applies them after the
upstream clone is refreshed.

## Files

- `benchmarksCommon.append.ts` — `CPUBenchmarkInfo` entries appended to
  `webdriver-ts/src/benchmarksCommon.ts`. Defines id, label, warmup
  count, and description for each ticker op. Mutates the existing
  `cpuBenchmarkInfosArray` and `cpuBenchmarkInfos` exports at module
  init.

- `benchmarksWebdriverCDP.append.ts` — 8 `CPUBenchmarkWebdriverCDP`
  subclass instances appended to `webdriver-ts/src/benchmarksWebdriverCDP.ts`.
  Each clicks a known button id and waits on a deterministic DOM
  mutation (the `tickCount` cell, the tbody row count, or a row's class
  attribute, depending on the op).

## Synchronization signals

Each ticker op produces a deterministic DOM mutation the harness can
wait on without knowing the exact result of the op:

| Op            | Signal                                                |
| ------------- | ----------------------------------------------------- |
| `mount`       | `tbody/tr[200]` exists                                |
| `tick-1`      | `#tick-count .v` text differs from pre-click value    |
| `tick-100`    | `#tick-count .v` text differs from pre-click value    |
| `burst-1k`    | `#tick-count .v` text differs from pre-click value    |
| `narrow-100`  | `#tick-count .v` text differs from pre-click value    |
| `wide-toggle` | `tbody/tr[1]` class differs from pre-click class      |
| `churn-50`    | `tbody/tr[1]/td[1]` text differs from pre-click value |
| `clear`       | `tbody/tr[1]` not located                             |
