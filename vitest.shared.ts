import { defineConfig } from 'vitest/config'

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
    // (18-core M5 Max, 72 spinner processes, load average 400–640) rather than
    // picked as round numbers. Worst observed cases:
    //
    //   lexical-loro     harden.test.ts            33.0 s  (200-op 3-peer burst)
    //   @llui/mcp        playwright-e2e teardown   30.2 s  (see below)
    //   lexical-loro     harden.test.ts (sibling)  14.9 s  (multi-block pastes)
    //   @llui/mcp        doctor.test.ts            10.8 s  (spawns dist/cli.js)
    //   markdown-editor  typing-loop.test.ts        6.4 s  (480 keystrokes)
    //
    // testTimeout 30 s is the number four separate files had converged on
    // independently — but be honest about the headroom: it is NOT a multiple of
    // the heaviest test, it is AT PARITY with it. `harden.test.ts`'s 200-op
    // burst was measured at 33.0 s at load 520 (0.7 s idle, 10.0 s at load 200)
    // and FAILS with `Test timed out in 30000ms` there. That is pre-existing and
    // budget-identical to what `packages/lexical-loro` already set for itself,
    // so raising the shared number would not be a fix — by the rule stated at
    // the bottom of this comment, a test that approaches the budget wants to be
    // CHEAPER, not to be given more room. Tracked rather than actioned here.
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
    // THE PRICE, stated plainly because it is real and nothing here offsets
    // it: the 5 s default doubled as a PERFORMANCE CANARY. A unit test that
    // silently got 6x slower used to go red; at 30 s it passes in silence, and
    // this change adds no compensating signal. That is the deliberate trade —
    // the canary only ever fired on a saturated machine, where it could not
    // distinguish a regression from contention, so it was crying wolf on this
    // workspace far more often than it caught anything. A real slow-test
    // signal wants a per-test DURATION budget (a reporter threshold or a
    // `--slowTestThreshold`-style warning), which is orthogonal to a timeout
    // and not attempted here (#193).
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
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
