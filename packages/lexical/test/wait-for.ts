/** Poll until `pred` holds, yielding to timers/microtasks between checks.
 *
 * Tests that assert on the editor's DEBOUNCED `onChange` (a real `setTimeout`)
 * must not race it with a fixed `wait(N)`: under a parallel full-monorepo test
 * run the event loop is CPU-starved and a 5ms debounce can fire well after
 * 20ms of wall-clock — the flake that intermittently failed
 * `foreign.test.ts` only when the whole suite ran in CI. Waiting for the
 * CONDITION makes the test deterministic w.r.t. scheduling; the timeout exists
 * only to fail loudly instead of hanging. */
export async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}
