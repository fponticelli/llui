---
description: Run js-framework-benchmark for LLui, measure speed/memory/bundle, compare against saved baselines
user_invocable: true
---

# /bench — Run benchmarks and report results

Run the js-framework-benchmark (jfb) for LLui, collect speed/memory/bundle results, compare against saved baselines and competitor frameworks, and optionally update the baseline.

## Arguments

- No arguments: run LLui only, compare against saved baselines
- `--all`: also re-run all competitor frameworks (vanillajs, solid, svelte, react, elm)
- `--save`: save new LLui results as the baseline after running
- `--framework <name>`: also re-run a specific competitor (e.g., `--framework solid`)

## Prerequisites

The jfb repo must be cloned at `benchmarks/js-framework-benchmark-repo/`. If missing, tell the user:

```
git clone https://github.com/krausest/js-framework-benchmark.git benchmarks/js-framework-benchmark-repo
cd benchmarks/js-framework-benchmark-repo && npm ci && cd webdriver-ts && npm ci && npm run compile
```

The jfb server must be running on port 8080. Check with `curl -sf http://localhost:8080/ls`. If not running, start it:

```
cd benchmarks/js-framework-benchmark-repo && npm start &
sleep 3
```

## Steps

### 1. Build the LLui benchmark app

```bash
pnpm -w run bench:build
```

Report the bundle size from the build output (raw + gzip). Compare against the baseline bundle size.

### 2. Copy built files to jfb repo

```bash
cp benchmarks/js-framework-benchmark/dist/*.js /private/tmp/js-framework-benchmark/frameworks/keyed/llui/dist/
cp benchmarks/js-framework-benchmark/index.html /private/tmp/js-framework-benchmark/frameworks/keyed/llui/index.html
```

Ensure `package.json` exists in the jfb framework dir. If not, create one with `build-prod: "echo 'pre-built'"`.

### 3. Run the benchmark

Run ONLY LLui by default:

```bash
cd /private/tmp/js-framework-benchmark/webdriver-ts
node dist/benchmarkRunner.js --framework keyed/llui --headless
```

If `--all` was passed, also run each competitor:

```bash
for fw in vanillajs solid svelte react-hooks elm; do
  node dist/benchmarkRunner.js --framework keyed/$fw --headless
done
```

If `--framework <name>` was passed, run only that competitor additionally.

### 4. Collect results

Read result JSON files from `webdriver-ts/results/`:

**Speed benchmarks** (read `values.total.median`):

- `01_run1k` — Create 1k
- `02_replace1k` — Replace 1k
- `03_update10th1k_x16` — Update 10th
- `04_select1k` — Select
- `05_swap1k` — Swap 1↔998
- `06_remove-one-1k` — Remove
- `07_create10k` — Create 10k
- `08_create1k-after1k_x2` — Append 1k
- `09_clear1k_x8` — Clear

**Memory benchmarks** (read `values.DEFAULT.median`):

- `21_ready-memory` — Ready (MB)
- `22_run-memory` — After 1k rows (MB)
- `25_run-clear-memory` — After run+clear (MB)

**Bundle size**: read from the build output (step 1).

Result files are named `<framework>-v<version>-keyed_<benchmark>.json`. Use `ls results/<fw>-*_<id>.json` to find them.

### 5. Display comparison table

Show absolute timings for all frameworks (LLui + saved baselines):

```
=== js-framework-benchmark — Absolute Timings (ms, median) ===

Operation          LLui  vanilla    Solid   Svelte    React      Elm
---------------------------------------------------------------------
Create 1k          23.2     21.2     22.7     23.6     26.7     38.2
...
```

Show relative comparison (negative = faster than LLui):

```
=== Relative to LLui ===

Operation       vanilla    Solid   Svelte    React      Elm
------------------------------------------------------------
Create 1k          -9%      -2%      +2%     +15%     +65%
...
```

Show memory comparison if available.

Show bundle size comparison:

```
=== Bundle Size (gzip) ===

Framework       Gzip
---------------------
vanilla       2.5 KB
Solid         4.7 KB
LLui          5.5 KB
...
```

### 6. Compare against baseline

Read `benchmarks/jfb-baseline.json` for the previous LLui results. Show delta:

```
=== LLui: Current vs Baseline ===

Operation      Baseline   Current    Delta
-------------------------------------------
Create 1k         23.8      23.2      -3%
...
```

### 7. Save baseline (if --save)

If `--save` was passed, update `benchmarks/jfb-baseline.json` with the new LLui results (and competitor results if they were re-run). Report that the baseline was saved.

### 8. Update ROADMAP (if results changed significantly)

Read `ROADMAP.md`. If the jfb results section exists, update the numbers to reflect the latest run. Only update if the results have changed meaningfully (>5% on any operation).

## Important notes

- NEVER run competitor frameworks unless explicitly asked via `--all` or `--framework`
- The jfb benchmark takes ~2-3 minutes per framework
- Results have natural variance (±5-10%) — don't report small changes as improvements
- Memory results require the full benchmark run (including memory benchmarks)
- Bundle sizes for competitors are stored in the baseline file — only re-measure if competitors are re-run
