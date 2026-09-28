// Wait for a CONDITION, bounded by the test's own budget and nothing else.
//
// Shared by every package suite that has to wait on something asynchronous
// (`@llui/vite-plugin`, `@llui/devmode-annotate`, …). It lived in
// `packages/vite-plugin/test/wait-until.ts` until a second package needed it;
// one copy, so the reasoning below binds every caller.
//
// ── Why this exists (#95, #189, loose-h) ─────────────────────────────────────
//
// A fixed `await setTimeout(n)` in front of a positive assertion is a race by
// construction: the duration is calibrated on one machine and nothing ties it
// to the event it stands in for. That includes the SHORT ones. `setTimeout(r, 5)`
// is a faithful "drain the microtasks" — but only when every remaining step of
// the awaited work IS a microtask. A step that is I/O (a module load, a file
// read, a socket), a timer of its own, or a chain of hops across event-loop
// iterations is ordered against the test's timer by WALL CLOCK, and load
// stretches exactly those steps. The wait then reads the state before the work
// finished. Nothing hung in that failure; the ORDER changed.
//
// #95 replaced several sleeps with polling — but polling against a HAND-PICKED
// deadline (`Date.now() + 2000`) only moves the calibration, it does not remove
// it. #189 is that residue: on a machine saturated by workspace-wide
// `turbo test`, three mock-spawner tests blew a 2 s poll deadline while passing
// 18/18 alone. Nothing was hung.
//
// A private deadline is also IMMUNE to the workspace budget. `vitest.shared.ts`
// states the timeouts once, on purpose, so a central change reaches every file;
// a literal inside a test silently shadows it exactly the way a per-package
// `testTimeout` does (#147). And a test that wraps such a wait in `retry` pays
// the private deadline once per attempt while hiding the race it is losing —
// which is why `retry` is banned outright (`scripts/test/no-test-retry.test.ts`).
//
// ── How the budget is derived, and the one number in here ───────────────────
//
// The wait ends when the TEST's budget ends. `ctx.signal` is aborted by vitest
// at `testTimeout`, and that alone is enough to bound the wait — but it is NOT
// enough to REPORT it. Vitest's own rejection is already in flight by the time
// the abort reaches us, so it wins the race and the failure reads
// `Test timed out in 30000ms` with no mention of what was awaited.
//
// So the deadline is computed from the SAME budget, a sliver early:
//
//     ctx.task.result.startTime + ctx.task.timeout - margin
//
// `ctx.task.timeout` IS the merged `vitest.shared.ts` value, so this tracks a
// central change automatically and shadows nothing. `startTime` is the TEST's
// start, not this call's, so time spent before the wait counts against the same
// budget vitest is counting it against.
//
// `margin` is the one literal, and it is a REPORTING margin, not a calibration:
// `max(250 ms, 5% of the budget)` — 1.5 s against the workspace's 30 s. Getting
// it wrong costs message quality and nothing else: the predicate is checked
// before the clock on every iteration, so it cannot fail a passing test. If the
// context does not carry a budget, the deadline is dropped and `signal` alone
// bounds the wait.
//
// ── When NOT to use this ────────────────────────────────────────────────────
//
// Use it where the condition is one the code under test is actively driving
// toward — a status the router will write, an event the middleware will
// broadcast, a request a submit will make. A genuine hang still fails, it just
// costs the budget to report. Where there is an EVENT to await (a WebSocket
// frame, a console line, a `'connection'`), await the event instead of polling
// for its side effect. And for "nothing happened", see `settle` below.

/** Reporting headroom, so the named error beats vitest's anonymous one. */
const MARGIN_RATIO = 0.05
const MIN_MARGIN_MS = 250

/**
 * Poll `predicate` until it holds, or until the test's budget runs out.
 *
 * @type {typeof import('./wait-until.mjs').waitUntil}
 */
export const waitUntil = async (ctx, what, predicate, intervalMs = 2) => {
  const deadline = reportingDeadline(ctx)
  while (!predicate()) {
    if (ctx.signal.aborted || (deadline !== null && Date.now() >= deadline)) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await sleep(intervalMs, ctx.signal)
  }
}

/**
 * The test's own deadline, less a reporting margin. `null` if unavailable.
 *
 * @type {typeof import('./wait-until.mjs').reportingDeadline}
 */
export const reportingDeadline = (ctx) => {
  const budget = ctx.task.timeout
  const startedAt = ctx.task.result?.startTime
  if (budget === undefined || budget <= 0) return null
  if (startedAt === undefined) return null
  return startedAt + budget - Math.max(MIN_MARGIN_MS, budget * MARGIN_RATIO)
}

/**
 * `setTimeout` that also resolves the moment the test is aborted.
 *
 * @param {number} ms
 * @param {AbortSignal} signal
 * @returns {Promise<void>}
 */
const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })

/**
 * Give an asynchronous pipeline a chance to do something, then assert it did
 * NOT — the negative counterpart to {@link waitUntil}.
 *
 * A duration is legitimate here in a way it is not for a positive assertion:
 * waiting LONGER can only make a spurious side effect more likely to be caught,
 * so contention cannot turn this into a false failure. It can turn it into a
 * VACUOUS pass, though (the pipeline never got far enough to misbehave), so
 * prefer `waitUntil` on an observable the code emits when it takes the branch
 * you expect — a decision log line, a status transition — and use this only
 * where the correct behaviour is to produce nothing observable at all.
 *
 * @type {typeof import('./wait-until.mjs').settle}
 */
export const settle = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms))
