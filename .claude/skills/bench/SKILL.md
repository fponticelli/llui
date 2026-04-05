---
description: Run js-framework-benchmark for LLui, compare against saved baselines
user_invocable: true
---

# /bench — Run benchmarks and report results

Everything is wrapped in `pnpm bench`. The script:

1. Builds the LLui benchmark app
2. Copies the dist into the jfb repo (auto-detects the active install via `lsof` on port 8080, falling back to the workspace-embedded repo)
3. Starts the jfb server if needed
4. Runs the LLui benchmark (and optionally competitors)
5. Collects result JSONs
6. Prints three tables: Absolute Timings, Relative to LLui, Current vs Baseline
7. Optionally overwrites `benchmarks/jfb-baseline.json`

## Running it

```bash
pnpm bench                        # LLui only, 1 pass, headless; compare vs saved baseline
pnpm bench --runs 3               # 3 passes, take median-of-medians (~3x slower but ±5% noise)
pnpm bench --headful              # run with a visible Chrome window (default: headless)
pnpm bench --save                 # save results as new baseline
pnpm bench --all                  # also re-run all competitor frameworks (~15 min)
pnpm bench --framework solid      # also re-run a specific competitor
JFB_REPO=/path/to/repo pnpm bench # override the jfb repo location
```

Single runs have ±15% variance. Use `--runs 3` or `--runs 5` before saving a baseline
or making perf claims.

## How to use this skill

**Default (no arguments):** Run `pnpm bench`. Relay the three output tables (Absolute, Relative, Current vs Baseline) verbatim to the user. Stop.

**Save a new baseline:** Append `--save`. Report that the baseline file was updated.

**Run competitors:** Only when the user explicitly asks. Append `--all` or `--framework <name>`.

## Prerequisites

If `pnpm bench` errors with "js-framework-benchmark repo not found", tell the user to clone it:

```
git clone https://github.com/krausest/js-framework-benchmark.git benchmarks/js-framework-benchmark-repo
cd benchmarks/js-framework-benchmark-repo && npm ci && cd webdriver-ts && npm ci && npm run compile
```

The script handles everything else: server startup, file copying, results collection, baseline comparison.

## Do NOT

- Do NOT `cp` files into the jfb framework dir yourself
- Do NOT `cd` into `webdriver-ts` and invoke `benchmarkRunner.js` directly
- Do NOT read individual result JSONs manually
- Do NOT hardcode paths like `/private/tmp/js-framework-benchmark/`
- Do NOT run competitor frameworks unless explicitly asked
- Do NOT report small changes (<5%) as real improvements/regressions — they're noise

All of that is done by `pnpm bench`.
