// The type surface of `wait-until.mjs`, for the package test suites that import
// it (their tsconfigs have no `allowJs`). The implementation is annotated
// AGAINST these declarations, so `pnpm check:scripts` fails if the two drift.

/**
 * The slice of vitest's `TestContext` the helper reads. Structural on purpose,
 * so a call site can pass `ctx` straight through.
 */
export interface WaitContext {
  readonly signal: AbortSignal
  readonly task: {
    readonly timeout?: number | undefined
    readonly result?: { readonly startTime?: number | undefined } | undefined
  }
}

/**
 * Poll `predicate` until it holds, or until the test's budget runs out.
 *
 * @param ctx  the running test's context — `it('…', async (ctx) => …)`
 * @param what human-readable description of the condition, used in the error
 * @param predicate polled until it returns `true`
 * @param intervalMs poll interval (default 2 ms)
 */
export declare function waitUntil(
  ctx: WaitContext,
  what: string,
  predicate: () => boolean,
  intervalMs?: number,
): Promise<void>

/** The test's own deadline, less a reporting margin. `null` if unavailable. */
export declare function reportingDeadline(ctx: WaitContext): number | null

/**
 * Wait `ms`, then let the caller assert that NOTHING happened. Never use it in
 * front of a positive assertion.
 */
export declare function settle(ms?: number): Promise<void>
