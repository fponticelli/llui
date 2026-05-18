# Compiler measurement procedure

Procedure for v2a Phase 1 baseline measurement and Phase 5 re-measurement (see `docs/proposals/v2-compiler/v2a.md` §4.2, §4.6, §5).

This file is the contract: re-measurement after the engine extraction must follow the same procedure against the same targets so the deltas are comparable.

## Targets

- **Vite dev cold-start, Vite build, idle RSS**: `benchmarks/js-framework-benchmark` — the realistic-scale Vite consumer in this repo. The single `src/main.ts` is small (~6 KB), so wall-clocks are short, but it exercises the full plugin transform path.
- **ESLint cold-start**: `site/` — it's the only in-repo consumer that lists `@llui/eslint-plugin` as a devDep. Acts as the lint-adapter wall-clock + RSS baseline.
- **Test suites**: `@llui/dom`, `@llui/vite-plugin`, `@llui/eslint-plugin` via `vitest run`. Smoke for any compile-engine regression that escapes the wall-clock instruments.

Why these three: v2a explicitly says (§2.1) the duplication win is between `@llui/vite-plugin`'s walker and `@llui/eslint-plugin`'s ~15 mirrored rules; the test suites cover that surface, plus the runtime tests catch any binding-descriptor regression that escapes static checks.

## Pre-conditions

```bash
git status --porcelain                    # working tree clean (or only proposal files)
pnpm -v && node -v                        # versions noted in §Environment below
pnpm install                              # node_modules present in every package
pnpm turbo build                          # all dist/ artifacts present
```

## Runner

The runner is `/tmp/llui-measure.mjs` (a single-file Node script committed only ephemerally). Each metric is sampled `N=5` times; the table records median + per-run samples. Wall-clock is `process.hrtime.bigint()` measured from `spawn()`. RSS is the **sum of the process tree rooted at the spawned PID** (recursive `ps -A -o pid,ppid,rss` aggregation), sampled at 100 ms intervals; the recorded value is the peak. Sampling the spawned PID alone undercounts by an order of magnitude — `pnpm exec` is a thin wrapper around the real workload.

Two task modes:

- `wait`: long-running process (Vite dev). Spawn, watch stdout/stderr for the readiness regex `/ready in/i`, record wall-clock at first match, hold a 2 s settle window while sampling RSS, then SIGTERM.
- `run`: bounded process (build, eslint, vitest). Spawn, sample RSS until exit, record wall-clock and exit code.

Each task uses `pnpm exec <tool> <args>` to match the call path a developer would use locally. ESLint passes `--max-warnings 999999` so a warning count doesn't fail the run mid-measurement.

To run:

```bash
cd /Users/franco/projects/llui                # must be repo root
MEASURE_N=5 node /tmp/llui-measure.mjs        # writes /tmp/llui-baseline-results.json
```

Override `MEASURE_N` for a smoke check (`MEASURE_N=1`) or a longer steady-state pass (`MEASURE_N=11`).

## Environment (recorded at baseline)

| Field           | Value                                                    |
| --------------- | -------------------------------------------------------- |
| OS              | macOS 26.5 (build 25F71)                                 |
| CPU             | Apple M5 Max                                             |
| Physical memory | 128 GB                                                   |
| Node            | v24.14.1                                                 |
| pnpm            | 10.33.0                                                  |
| Repo HEAD       | `13d97dc` (release: `@llui/{dom,vite-plugin,...}@0.2.0`) |

Re-measurement must record its own row here when v2a lands. Materially different hardware (lower-RAM developer machine, e.g. 16 GB MBP) is a separate scenario — re-measure there before declaring the RSS trigger satisfied on resource-constrained environments.

## Triggers (from v2a.md §4.2)

- **RSS**: post-v2a combined RSS (Vite dev idle + ESLint peak) must not exceed `min(1.5 × baseline, 2 GB absolute)`. The 2 GB absolute is a hard ceiling calibrated for a 16 GB developer machine; the 1.5× multiplier is the proximate trigger on the measured machine.
- **Cold-start**: post-v2a wall-clock for Vite dev cold-start and ESLint cold-start each must not exceed `1.25 × baseline`, median of 5.
- **Build**: post-v2a Vite build wall-clock must not exceed `1.10 × baseline`, median of 5.
- **Test wall-clock**: post-v2a `@llui/dom` test wall-clock must not exceed `1.10 × baseline`. (No formal trigger for the other two suites — regressions there are caught structurally by the engine extraction's "all tests green with zero test-file edits" exit gate.)

## Failure paths

If a trigger is exceeded, see v2a.md §6 — do not merge v2a; tighten the engine (defer `typescript` import until first `analyzeFile`, reduce cache retention, etc.), re-measure, or reopen the daemon design proposal. Never relax a trigger without a written rationale in v2a.md §5.
