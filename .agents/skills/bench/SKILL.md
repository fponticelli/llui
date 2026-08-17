---
description: Run LLui benchmarks (standard jfb + ticker suites) and compare against saved baselines
user_invocable: true
---

# /bench — Run benchmarks and report results

LLui has **two** benchmark suites, both driven through jfb's `webdriver-ts` harness:

| Suite        | Command             | Runner                     | Baseline                 | Measures                                                               |
| ------------ | ------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| **Standard** | `pnpm bench`        | `benchmarks/run-jfb.ts`    | `baseline.json#standard` | krausest keyed ops: 9 CPU + 3 memory + 2 size                          |
| **Ticker**   | `pnpm bench:ticker` | `scripts/run-ticker.ts`    | `baseline.json#ticker`   | 9 fine-grained ticker operations (see `benchmarks/jfb-ticker/SPEC.md`) |
| **Both**     | `pnpm bench:all`    | `scripts/run-bench-all.ts` | `baseline.json`          | runs Standard then Ticker, passing CLI arguments through exactly       |

All three honor `--runs N`, `--headful`, `--framework <name>`, `--all`, and the `JFB_REPO=…` override. Ticker also honors `--only`. `--save` is valid only on a complete `bench:all` run: subset and single-suite runs are diagnostic and cannot replace the canonical baseline.

For reproducible or authoritative measurements, run the same combined suite inside the pinned
one-shot Docker environment with `pnpm bench:container -- <bench:all args>`. It pins Node, pnpm,
Chrome, Debian packages, JFB, and the workspace lockfile; setup and measurement run unprivileged,
and `docker run --rm` leaves no benchmark service behind.

## ⚠️ ALWAYS rebuild changed `@llui/*` packages before benching

The benchmark app bundles each workspace package from its built **`dist/`** (`@llui/dom`'s `exports["."]` → `./dist/index.js`), **not** from source. The bench runner builds the _app_, never the libraries. So if you edited a package's source and only ran `check`/`test` (`tsc --noEmit` — these do **not** emit `dist/`), the bench will silently measure the **stale previously-built bundle**, and your change will look like it did nothing.

**Before every bench run that is meant to measure a source change, rebuild the changed packages:**

```bash
pnpm turbo build && pnpm bench --runs 2     # robust: rebuilds @llui/dom + any other changed package (turbo-cached, cheap)
pnpm --filter @llui/dom build && pnpm bench  # when only @llui/dom changed
```

Verify the change actually landed in `dist/` before trusting the numbers, e.g. `grep -c '<a string from your edit>' packages/dom/dist/signals/<file>.js`. When iterating A/B on a runtime change, treat "rebuild → verify dist → bench" as one inseparable step — a missed rebuild produces a byte-identical bundle and a false "no effect" result.

Each runner:

1. Builds the LLui benchmark app
2. Copies the dist into the pinned jfb checkout
3. Starts an invocation-owned jfb server and always terminates its process tree
4. Runs the LLui benchmark (and optionally competitors)
5. Collects result JSONs
6. Prints tables (Absolute Timings + Relative to LLui; Memory; Bundle Size; plus Current vs Baseline delta)
7. For a complete `bench:all --save`, transactionally replaces the single canonical baseline

## Running it

```bash
# Standard jfb suite
pnpm bench                        # LLui only, 3 passes, headless; compare vs saved baseline
pnpm bench --runs 3               # 3 passes, median-of-medians (~3x slower but ±5% noise)
pnpm bench --headful              # visible Chrome window (default: headless)
pnpm bench --all                  # also re-run all competitor frameworks (~15 min)
pnpm bench --framework solid      # also re-run a specific competitor

# Ticker suite
pnpm bench:ticker                 # all frameworks, all 9 ticker ops
pnpm bench:ticker --framework llui --runs 3

# BOTH suites in one run
pnpm bench:all                    # full comparison: both suites + competitors (~slow)
pnpm bench:all --framework llui   # LLui only, both suites — fast "did my change regress?" check
pnpm bench:all --runs 5 --save    # complete authoritative capture; atomically replace baseline.json

# Pinned one-shot container (Docker must be running)
pnpm bench:container:smoke
pnpm bench:container -- --framework llui --runs 1
pnpm bench:container -- --runs 5 --save
```

Note: `bench:all` defaults the standard runner to `--all` (include competitors) unless you pass `--framework`. For a quick LLui-only regression check across both suites, always pass `--framework llui`.

Single runs have ±15% variance. Use `--runs 3` or `--runs 5` before saving a baseline or making perf claims.

## How to use this skill

**No arguments / "standard":** Run `pnpm bench`. Relay all output tables verbatim. Stop.

**"both" / "all suites" / "ticker and standard":** Run `pnpm bench:all --framework llui` (LLui only, both suites) unless the user also asks for competitors — then drop `--framework` or add `--all`. Relay both suites' tables verbatim, clearly labeled STANDARD JFB and TICKER. Stop.

**"ticker":** Run `pnpm bench:ticker --framework llui`. Relay the ticker tables verbatim. Stop.

**Save a new baseline:** Prefer the pinned environment:
`pnpm bench:container -- --runs 5 --save`. Use local
`pnpm bench:all --runs 5 --save` only when the user explicitly wants a local-machine capture.
Report that `benchmarks/baseline.json` and its generated site data were updated. `--save` requires
a clean checkout and cannot be combined with `--framework` or `--only`.

**Homelab authoritative capture:** From the PVE host, use the on-demand `homelab-ops` action:
`llui-benchmark --branch main --commit -- --runs 5 --save`. Options before `--` configure the
action; argv after it is forwarded unchanged. The action waits for shared runners to become idle,
pauses them while measuring, verifies and retains reports, and `--commit` may push only the three
canonical generated outputs from a complete save. This is on-demand infrastructure, not CI.

**Run competitors:** Only when the user explicitly asks. Append `--all` or `--framework <name>`.

**Empty competitor columns in Memory/Bundle tables** mean the baseline is invalid or predates those metrics. Replace it only with a complete `pnpm bench:all --runs 5 --save` capture.

## Prerequisites

Both suites require a local clone of `js-framework-benchmark`. If a run fails, tell the user to run:

```bash
pnpm bench:setup            # one-time: clone jfb-repo, install it, compile webdriver-ts, build the ticker apps (both suites need this)
pnpm bench:ticker:setup     # one-time, TICKER ONLY: symlink ticker apps + apply jfb patches
```

`bench:setup` (`scripts/setup-bench.ts`) clones the repo into `benchmarks/js-framework-benchmark-repo/` (gitignored), installs its three trees (repo root, `server/`, `webdriver-ts/`), compiles `webdriver-ts`, and builds the five ticker apps. On a fresh clone the `server/` tree is actually produced by upstream's own root `postinstall` (`cd server && npm install`), so that step usually only VERIFIES it and runs `npm ci` when it doesn't match the lockfile. It is idempotent — a re-run reuses the clone, skips an install whose tree still matches its `package-lock.json`, and skips apps that already have a `dist/main.js` (`--force` redoes everything; `--skip-ticker-apps` stops after the harness). The **ticker** suite additionally needs `bench:ticker:setup`, which symlinks the ticker apps and applies the jfb patches managed by `scripts/setup-ticker.ts`. `pnpm bench:all` will fail on the ticker leg if `bench:ticker:setup` hasn't been run.

**Do NOT hand-run the install chain** (issue #81). Upstream's own root manifest does not resolve under npm's strict peer checking (`eslint@^10` vs `eslint-plugin-react`'s `<=9` peer), so a plain `npm ci` at the jfb repo root aborts with ERESOLVE — and in a `&&` chain it takes the `server/` and `webdriver-ts/` installs down with it. `bench:setup` retries the root with `--legacy-peer-deps` (only on a genuine `npm error code ERESOLVE`), then VERIFIES each install against its `package-lock.json` — every declared `node_modules/...` path must exist, transitive deps included — and fails naming the step that broke. npm's exit code is not evidence: `npm ci --omit=dev` exits 0 on a tree with no devDependencies, and a missing transitive (`fastify`'s `find-my-way`) leaves every direct dep in place while still breaking the server at boot. If you ever see `Cannot find module 'yargs'`, a missing `@types/node`, or `jfb server failed to start on port 8080`, the cause is an install that never ran — the fix is `pnpm bench:setup`, not a manual `npm ci`.

`bench:setup` checks out the exact commit in `benchmarks/jfb-revision.txt`, and every runner verifies it before measuring. The runners refuse an already-running server on port 8080; measured runs own their server lifecycle and leave no listener behind.

The container entrypoint performs its own frozen install and verified JFB setup, so do not run the
host `bench:setup` prerequisite before `bench:container`. Named Docker volumes cache downloads and
the JFB checkout, but they are disposable data caches, not services. See
`benchmarks/container/README.md` for the pinned versions and operational details.

## Do NOT

- Do NOT `cp` files into the jfb framework dir yourself
- Do NOT `cd` into `webdriver-ts` and invoke `benchmarkRunner.js` directly
- Do NOT read individual result JSONs manually
- Do NOT hardcode paths like `/private/tmp/js-framework-benchmark/`
- Do NOT run competitor frameworks unless explicitly asked
- Do NOT report small changes (<5%) as real improvements/regressions — they're noise
- Do NOT bench a source change without first rebuilding the changed `@llui/*` package(s) — the app bundles from `dist/`, so an un-rebuilt edit is measured stale (see the ⚠️ section above)

All of that is done by the `pnpm bench` / `pnpm bench:ticker` / `pnpm bench:all` scripts.
