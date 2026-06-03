---
description: Run LLui benchmarks (standard jfb + ticker suites) and compare against saved baselines
user_invocable: true
---

# /bench — Run benchmarks and report results

LLui has **two** benchmark suites, both driven through jfb's `webdriver-ts` harness:

| Suite        | Command             | Runner                     | Baseline               | Measures                                                                              |
| ------------ | ------------------- | -------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| **Standard** | `pnpm bench`        | `benchmarks/run-jfb.ts`    | `jfb-baseline.json`    | krausest keyed ops: create/replace/update/swap/remove/select (9 CPU + 3 mem + 2 size) |
| **Ticker**   | `pnpm bench:ticker` | `scripts/run-ticker.ts`    | `ticker-baseline.json` | 8 fine-grained "ticker" ops (see `benchmarks/jfb-ticker/SPEC.md`)                     |
| **Both**     | `pnpm bench:all`    | `scripts/run-bench-all.ts` | both of the above      | runs Standard then Ticker, passing CLI args through to each                           |

All three honor the same flags: `--runs N`, `--save`, `--headful`, `--framework <name>`, `--all`, and the `JFB_REPO=…` env override. Each suite reads/writes **its own** baseline — a `--save` to one never touches the other.

Each runner:

1. Builds the LLui benchmark app
2. Copies the dist into the jfb repo (auto-detects the active install via `lsof` on port 8080, falling back to the workspace-embedded repo)
3. Starts the jfb server if needed
4. Runs the LLui benchmark (and optionally competitors)
5. Collects result JSONs
6. Prints tables (Absolute Timings + Relative to LLui; Memory; Bundle Size; plus Current vs Baseline delta)
7. Optionally overwrites the suite's baseline

## Running it

```bash
# Standard jfb suite
pnpm bench                        # LLui only, 1 pass, headless; compare vs saved baseline
pnpm bench --runs 3               # 3 passes, median-of-medians (~3x slower but ±5% noise)
pnpm bench --headful              # visible Chrome window (default: headless)
pnpm bench --save                 # save results as new baseline
pnpm bench --all                  # also re-run all competitor frameworks (~15 min)
pnpm bench --framework solid      # also re-run a specific competitor

# Ticker suite
pnpm bench:ticker                 # all frameworks, all 8 ticker ops
pnpm bench:ticker --framework llui --runs 3
pnpm bench:ticker --save          # write to ticker-baseline.json

# BOTH suites in one run
pnpm bench:all                    # full comparison: both suites + competitors (~slow)
pnpm bench:all --framework llui   # LLui only, both suites — fast "did my change regress?" check
pnpm bench:all --framework llui --runs 3 --save   # both suites, persist to both baselines
```

Note: `bench:all` defaults the standard runner to `--all` (include competitors) unless you pass `--framework`. For a quick LLui-only regression check across both suites, always pass `--framework llui`.

Single runs have ±15% variance. Use `--runs 3` or `--runs 5` before saving a baseline or making perf claims.

## How to use this skill

**No arguments / "standard":** Run `pnpm bench`. Relay all output tables verbatim. Stop.

**"both" / "all suites" / "ticker and standard":** Run `pnpm bench:all --framework llui` (LLui only, both suites) unless the user also asks for competitors — then drop `--framework` or add `--all`. Relay both suites' tables verbatim, clearly labeled STANDARD JFB and TICKER. Stop.

**"ticker":** Run `pnpm bench:ticker --framework llui`. Relay the ticker tables verbatim. Stop.

**Save a new baseline:** Append `--save`. Report which baseline file(s) were updated (`jfb-baseline.json`, `ticker-baseline.json`, or both for `bench:all`).

**Run competitors:** Only when the user explicitly asks. Append `--all` or `--framework <name>`.

**Empty competitor columns in Memory/Bundle tables** mean the saved baseline predates those metrics. Repopulate with `--all --save` (LLui + competitors, ~15 min) or just `--save` (LLui only).

## Prerequisites

Both suites require a local clone of `js-framework-benchmark`. If a run fails, tell the user to run:

```bash
pnpm bench:setup            # one-time: clone jfb-repo + compile webdriver-ts (both suites need this)
pnpm bench:ticker:setup     # one-time, TICKER ONLY: symlink ticker apps + apply jfb patches
```

`bench:setup` clones the repo into `benchmarks/js-framework-benchmark-repo/` and compiles `webdriver-ts` (gitignored). The **ticker** suite additionally needs `bench:ticker:setup`, which symlinks the ticker apps and applies the jfb patches managed by `scripts/setup-ticker.ts`. `pnpm bench:all` will fail on the ticker leg if `bench:ticker:setup` hasn't been run.

If manual setup is needed:

```
git clone https://github.com/krausest/js-framework-benchmark.git benchmarks/js-framework-benchmark-repo
cd benchmarks/js-framework-benchmark-repo && npm ci && cd webdriver-ts && npm ci && npm run compile
```

The runners auto-detect a running jfb server on port 8080 but validate it before use — stale/broken repos are skipped in favor of the workspace copy.

## Do NOT

- Do NOT `cp` files into the jfb framework dir yourself
- Do NOT `cd` into `webdriver-ts` and invoke `benchmarkRunner.js` directly
- Do NOT read individual result JSONs manually
- Do NOT hardcode paths like `/private/tmp/js-framework-benchmark/`
- Do NOT run competitor frameworks unless explicitly asked
- Do NOT report small changes (<5%) as real improvements/regressions — they're noise

All of that is done by the `pnpm bench` / `pnpm bench:ticker` / `pnpm bench:all` scripts.
