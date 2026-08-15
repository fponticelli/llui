/**
 * Wait for a CONDITION, bounded by the test's own budget and nothing else.
 *
 * ── Why this exists (#95, #189) ─────────────────────────────────────────────
 *
 * A fixed `await setTimeout(n)` in front of a positive assertion is a race by
 * construction: the duration is calibrated on one machine and nothing ties it
 * to the event it stands in for. #95 replaced several of those with polling —
 * but polling against a HAND-PICKED deadline (`Date.now() + 2000`) only moves
 * the calibration, it does not remove it. #189 is that residue: on a machine
 * saturated by workspace-wide `turbo test`, three mock-spawner tests in
 * `notes-router.test.ts` / `notes-security.test.ts` blew a 2 s poll deadline and
 * a 50 ms sleep — `expected 2 to be >= 3`, `expected 3 to be >= 5` — while
 * passing 18/18 when run alone. Nothing was hung: the same tests complete in
 * tens of milliseconds unloaded, and the router's pipeline is a dozen filesystem
 * round-trips per task, every one of which stretches with contention.
 *
 * A private deadline is also IMMUNE to the workspace budget. `vitest.shared.ts`
 * states the timeouts once, on purpose, so a central change reaches every file;
 * a literal inside a test silently shadows it exactly the way a per-package
 * `testTimeout` does (#147).
 *
 * ── How the budget is derived, and the one number in here ───────────────────
 *
 * The wait ends when the TEST's budget ends. `ctx.signal` is aborted by vitest
 * at `testTimeout`, and that alone is enough to bound the wait — but it is NOT
 * enough to REPORT it. Vitest's own rejection is already in flight by the time
 * the abort reaches us, so it wins the race and the failure reads
 * `Test timed out in 30000ms` with no mention of what was awaited. Measured, and
 * a diagnosability REGRESSION against the #95 helper this replaced, which did
 * surface its message.
 *
 * So the deadline is computed from the SAME budget, a sliver early:
 *
 *     ctx.task.result.startTime + ctx.task.timeout - margin
 *
 * `ctx.task.timeout` IS the merged `vitest.shared.ts` value, so this tracks a
 * central change automatically and shadows nothing — that is the whole
 * difference from the `Date.now() + 2000` this replaced, which was calibrated
 * to the awaited work rather than derived from the budget. `startTime` is the
 * TEST's start, not this call's, so time spent in setup before the wait counts
 * against the same budget vitest is counting it against.
 *
 * `margin` is the one literal, and it is a REPORTING margin, not a calibration:
 * `max(250 ms, 5% of the budget)` — 1.5 s against the workspace's 30 s. Getting
 * it wrong costs message quality and nothing else. Too small and vitest wins the
 * race again, which is exactly today's behaviour; too large and a genuine hang
 * is reported slightly sooner. Neither can fail a passing test, because the
 * predicate is checked before the clock on every iteration. If the context does
 * not carry a budget, the deadline is dropped and `signal` alone bounds the wait.
 *
 * ── When NOT to use this ────────────────────────────────────────────────────
 *
 * A genuine hang still fails, it just costs the budget to report — the
 * documented trade in `vitest.shared.ts`. **Use it only where the condition is
 * one the code under test is actively driving toward** — a status the router
 * will write, an event the middleware will broadcast, a counter a spawner will
 * increment. That is what makes "wait longer" the right answer to contention.
 *
 * Where the condition can simply never arrive, a short deadline is the better
 * instrument, and the arithmetic says so plainly: a test carrying `{ retry: 2 }`
 * pays THREE attempts, so converting an 8 s deadline to this helper turns a
 * 24 s failure into a 90 s one. `mcp-watch.test.ts` waits for the OS to deliver
 * an `fs.watch` event — nothing in our code drives it, and there is no bound on
 * when the OS must — so it keeps its literal on that arithmetic alone. (An
 * earlier version of this comment claimed the converted test had been observed
 * failing at load ~790. Review could not reproduce that: six runs at load
 * 840–1020 delivered the event in 8–241 ms, 6/6. The observation is withdrawn;
 * the arithmetic is the reason.)
 */

/**
 * The slice of vitest's `TestContext` this helper reads. Structural on purpose,
 * so a call site can pass `ctx` straight through.
 */
export interface WaitContext {
  readonly signal: AbortSignal
  readonly task: {
    readonly timeout?: number | undefined
    readonly result?: { readonly startTime?: number | undefined } | undefined
  }
}

/** Reporting headroom, so the named error beats vitest's anonymous one. */
const MARGIN_RATIO = 0.05
const MIN_MARGIN_MS = 250

/**
 * Poll `predicate` until it holds, or until the test's budget runs out.
 *
 * @param ctx  the running test's context — `it('…', async (ctx) => …)`
 * @param what human-readable description of the condition, used in the error
 * @param predicate polled until it returns `true`
 */
export async function waitUntil(
  ctx: WaitContext,
  what: string,
  predicate: () => boolean,
  intervalMs = 2,
): Promise<void> {
  const deadline = reportingDeadline(ctx)
  while (!predicate()) {
    if (ctx.signal.aborted || (deadline !== null && Date.now() >= deadline)) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await sleep(intervalMs, ctx.signal)
  }
}

/** The test's own deadline, less a reporting margin. `null` if unavailable. */
function reportingDeadline(ctx: WaitContext): number | null {
  const budget = ctx.task.timeout
  const startedAt = ctx.task.result?.startTime
  if (budget === undefined || budget <= 0) return null
  if (startedAt === undefined) return null
  return startedAt + budget - Math.max(MIN_MARGIN_MS, budget * MARGIN_RATIO)
}

/** `setTimeout` that also resolves the moment the test is aborted. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

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
 */
export function settle(ms = 25): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
