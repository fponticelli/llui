import { defineConfig, type ViteUserConfig as VitestUserConfig } from 'vitest/config'
import { relative, resolve, join } from 'node:path'

// ── Per-test duration capture (#193) ─────────────────────────────────────────
// Off unless `LLUI_TEST_DURATIONS` names a directory, so a normal `pnpm test`
// behaves exactly as before and no run acquires a side effect it did not ask
// for. When it IS set, every package's vitest additionally emits vitest's stock
// `json` report there; `scripts/check-test-durations.mjs` aggregates the lot and
// diffs it against the committed baseline. Using the BUILT-IN reporter rather
// than a bespoke one is deliberate — the reporter API is a moving target across
// vitest majors and a custom reporter that silently stops emitting is worse than
// no signal, which is the whole complaint #193 records.
//
// If you drive this through turbo, note that turbo 2 runs tasks in STRICT env
// mode: an undeclared variable does not reach the task and nothing says so. Root
// `turbo.json` therefore lists `LLUI_TEST_DURATIONS` under the `test` task's
// `env` (in `env`, not `passThroughEnv` — it changes what the task emits, so it
// belongs in the cache key). Measured the hard way: the first attempt to record
// a baseline was a green 11-minute run that produced zero reports.
// Resolved against the REPO ROOT, not each package's cwd: every package's
// vitest runs from its own directory, and a relative value would scatter the
// reports instead of collecting them.
const durationsDir = process.env['LLUI_TEST_DURATIONS']
  ? resolve(import.meta.dirname, process.env['LLUI_TEST_DURATIONS'])
  : undefined
// One file per package, named for its path from the repo root — package
// BASENAMES are not unique enough to bet a silent overwrite on.
const durationsSlug = relative(import.meta.dirname, process.cwd()).replace(/[/\\]/g, '__')
// NOT `as const`: vitest types `reporters` as `ReporterName | Reporter | [name,
// options]`, and a `readonly` tuple is not assignable to that mutable pair — so
// the `as const` that looks like ordinary hygiene here is a type error at every
// call site that type-checks this file. It went unnoticed because nothing DID:
// the site was the only package whose `check` reaches this file, and it gained
// that script in the same batch (#176) that added this reporter (#193).
type Reporters = NonNullable<NonNullable<VitestUserConfig['test']>['reporters']>
const durationReporters: Reporters | undefined = durationsDir
  ? ['default', ['json', { outputFile: join(durationsDir, `${durationsSlug || 'root'}.json`) }]]
  : undefined

// Shared vitest base for every package. Packages import this and `mergeConfig`
// it with ONLY their real deltas (environment, coverage, …) so the common bits —
// the test glob, the timeout budgets and the build-time `__LLUI_*` define flags
// — stay in exactly one place and can't silently diverge between packages.
//
// `__LLUI_AGENT__` / `__LLUI_TRANSITIONS__` are compile-time defines that
// `@llui/vite-plugin` substitutes in real bundles based on the consumer's
// options. Vitest never runs through that plugin, so without a `define` these
// globals would be `undefined` (runtime guards read that as "off"). Pinning them
// to `'true'` here gives every package's tests the same, agent-active view of
// the runtime — the alternative (per-package defines) is exactly the silent
// divergence this base exists to prevent.
export default defineConfig({
  define: {
    __LLUI_AGENT__: 'true',
    __LLUI_TRANSITIONS__: 'true',
  },
  test: {
    include: ['test/**/*.test.ts'],

    // See the block at the top of this file. `mergeConfig` concatenates arrays,
    // and no package sets `reporters` of its own — if one ever does, it appends
    // rather than replaces, which is the harmless direction.
    ...(durationReporters ? { reporters: [...durationReporters] } : {}),

    // Timeout budgets are workspace-wide ON PURPOSE (issue #147). `turbo test`
    // fans ~40 vitest processes across the workspace at once, and the failures
    // that produces are not owned by any one package — the same starvation was
    // reported four times in one PR batch, on branches that touched none of the
    // affected code. Capping the file that happened to surface is how this
    // repo ended up with four separate one-file patches for one cause, each of
    // which then SHADOWS this base (a local literal always beats the merged
    // config), so the next central change silently misses that file. State the
    // budget once, here, and let packages state only their real deltas.
    //
    // Both numbers are measured against a deliberately saturated machine
    // (18-core M5 Max, CPU spinners + filesystem churn, load average 200–1000)
    // rather than picked as round numbers. Worst observed cases, at load ~400:
    //
    //   @llui/mcp        playwright-e2e teardown   30.2 s  (see below)
    //   @llui/mcp        doctor.test.ts            10.8 s  (spawns dist/cli.js)
    //   markdown-editor  typing-loop.test.ts        6.4 s  (480 keystrokes)
    //   lexical-loro     harden.test.ts             1.4 s  (heaviest burst trial)
    //
    // testTimeout 30 s is the number four separate files had converged on
    // independently. It did NOT have headroom when this comment was first
    // written: `harden.test.ts`'s burst was one 200-operation run measured at
    // 33.0 s at load 520 (0.7 s idle, 10.0 s at load 200) and it FAILED there
    // with `Test timed out in 30000ms`. That was budget-identical to what
    // `packages/lexical-loro` had already set for itself, so raising the shared
    // number was never the fix — by the rule at the bottom of this comment, a
    // test that approaches the budget wants to be CHEAPER. #197 made it cheaper,
    // in two independent steps, and both are worth copying:
    //
    //   1. the burst's cost is QUADRATIC in its own length (the CRDT's, not the
    //      document's), so the same total operation count split across six
    //      independent SEEDED runs costs ~4x less and samples more — see the
    //      rationale block in `harden.test.ts`;
    //   2. `testTimeout` is a PER-TEST budget, so those six trials are six
    //      `it()`s rather than one loop. Six trials in one test is a single test
    //      whose duration is the sum of independent work, which is the shape
    //      that ran out of budget in the first place.
    //
    // Together: 23–25 s at load 390 became 1.1–1.4 s per trial at load 220, and
    // 4.1–5.9 s per trial at load 830–960.
    //
    // Two honest caveats on that table. It is a snapshot of a SHARED machine, so
    // treat the numbers as a band, not a constant. And contention has no
    // ceiling, so no budget and no amount of trimming makes a CPU-bound test
    // load-proof — beyond load ~850 the thing that fails in that file is a
    // hand-picked `expect(elapsed).toBeLessThan(5000)` regression guard, which
    // is the #189 mistake wearing an assertion instead of a poll deadline
    // (tracked as #218).
    //
    // hookTimeout 60 s is sized by a hard upstream floor, not by our own work:
    // under CPU saturation Chromium never completes a graceful shutdown, so
    // `browser.close()` always burns playwright's non-configurable 30 s
    // deadline (`DEFAULT_PLAYWRIGHT_TIMEOUT`, playwright-core
    // lib/server/browserType.js `closeOrKill`) and then SIGKILLs the process
    // group. Reproduced at 30.01–30.02 s on a bare launch/close with no LLui
    // code involved, and `browser.close({ timeout })` does not reach it. Any
    // hook that closes a browser therefore CANNOT fit in vitest's 10 s default
    // on a loaded machine, whatever we do to it. 60 s gives that floor 2x
    // headroom and matches what `@llui/agent-e2e` had already measured for its
    // own browser fixtures.
    //
    // THE PRICE these numbers used to carry: the 5 s default doubled as a
    // PERFORMANCE CANARY. A unit test that silently got 6x slower went red; at
    // 30 s it passes in silence. That trade was right on its own terms — the
    // canary only ever fired on a saturated machine, where it could not
    // distinguish a regression from contention, so it cried wolf far more often
    // than it caught anything — but it left the workspace with no duration
    // signal at all.
    //
    // THAT IS NOW PAID (#193), and deliberately NOT as a timeout. A timeout is a
    // single cliff that conflates "too slow" with "hung", and no absolute number
    // can serve a workspace spanning 33 s browser bursts and sub-millisecond
    // unit files. The signal is a per-file duration BASELINE instead:
    //
    //   pnpm test:durations         record a fresh baseline from a full run
    //   pnpm check:test-durations   run and diff against the committed one
    //
    // Setting `LLUI_TEST_DURATIONS` to a directory makes every package emit
    // vitest's stock `json` report there (see the top of this file);
    // `scripts/check-test-durations.mjs` folds those into per-file totals and
    // compares them AFTER dividing out a same-run load factor, so a uniformly
    // slower machine reports nothing while one file that got 6x slower still
    // does. That is the property a wall-clock budget cannot have, and it is why
    // the two mechanisms are orthogonal rather than redundant.
    //
    // It REPORTS, it does not gate (`--gate` opts in, and CI does not pass it).
    // That is measured, not cautious: two runs of IDENTICAL code back to back on
    // this machine produced 39 "regressions" at a naive noise floor, and an
    // earlier revision that gated reddened on unchanged code.
    //
    // AND THE PRICE IS STILL NOT FULLY PAID, so do not read the paragraph above
    // as settled: at the calibrated thresholds only 145 of 618 files are within
    // resolution (76 against the current quiet baseline), and "a 5 ms unit test becoming 30 ms" — named right here as the
    // thing #193 wants — is NOT detected. Precisely: +25 ms sits around the p97
    // edge of this workspace's run-to-run drift (p50 2.1 ms, p90 26.3 ms), so a
    // much tighter `6x / +25 ms` does catch it on a QUIET machine at 0-2 false
    // positives — but not at zero cost, not stably across run order, and not at
    // all under load, where that floor produced 39 false positives. What the tool
    // does give is a real signal on the ~145 files that cost enough to resolve,
    // and an explicit count of its own coverage on every run instead of a silent
    // gap.
    //
    // These are flake guards, not licence to be slow: the browser IS reaped
    // (playwright kills the process group and awaits cleanup), so this covers
    // work that is slow-but-bounded. A test that HANGS still fails — just less
    // promptly, so a raised budget makes an unbounded wait MORE EXPENSIVE to
    // report, never safe: an actual hang is a bug to fix at the source.
    //
    // The specific hang to know about, because THREE instances were found in
    // this repo (#191): a teardown that AWAITS `server.close()` while a
    // connection is still live. `close()` withholds its callback until every
    // connection is IDLE, so that wait is UNBOUNDED and the budget only decides
    // how long the bill runs. Non-idle means an upgraded WebSocket, an
    // SSE/streaming response, or an in-flight long-poll — NOT merely "a
    // WebSocket"; the SSE instance is the one an upgrade-only reading missed.
    // A test that throws before releasing one leaves it live.
    //   - plain HTTP (streams, long-polls): call `server.closeAllConnections()`
    //     before the await. `closeIdleConnections()` does NOT work.
    //   - UPGRADED sockets: `closeAllConnections()` cannot reach those either
    //     (the server stops tracking them at upgrade), so the teardown must
    //     track and destroy the sockets itself.
    //
    // If a test starts approaching either number for reasons other than the
    // floor above, the fix is a cheaper test, not a bigger budget.
    //
    // And the budget only binds a test that lets it: a test that polls against
    // its OWN `Date.now() + n` deadline is immune to everything stated here, so
    // it flakes under contention no matter what these numbers say. That is #189,
    // and the fix is `packages/vite-plugin/test/wait-until.ts` — wait on the
    // condition, bounded by the test's `ctx.signal`, so `testTimeout` really is
    // the one budget. Copy that pattern, not a millisecond literal.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
