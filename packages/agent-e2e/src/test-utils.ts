import type { Page } from '@playwright/test'
import type { E2EContext, MintResult } from './harness.js'
import { reportingDeadline, type WaitContext } from '../../../scripts/lib/wait-until.mjs'

/**
 * How long a Playwright wait inside the running test may take: the rest of the
 * TEST's own budget, less the reporting margin `scripts/lib/wait-until.mjs`
 * derives. A named Playwright timeout (naming the predicate) then beats
 * vitest's anonymous `Test timed out`, and no private deadline shadows the
 * workspace budget. `0` (no Playwright deadline) when the context carries no
 * budget, so vitest's own timeout still bounds it.
 */
export function remainingBudget(test: WaitContext): number {
  const deadline = reportingDeadline(test)
  return deadline === null ? 0 : Math.max(1, deadline - Date.now())
}

/** How many frames of type `t` the agent server has sent this page so far. */
export function serverFrameCount(page: Page, t: string): Promise<number> {
  return page.evaluate(
    (type: string) => (window.__lluiE2eFrames ?? []).filter((f) => f.t === type).length,
    t,
  )
}

/**
 * Wait until the agent server has sent this page MORE than `seen` frames of
 * type `t` — i.e. the next one after a count taken with `serverFrameCount`.
 * Counting (rather than "any frame of this type") keeps a frame from an
 * earlier step in the same test from satisfying the wait.
 */
export async function waitForServerFrame(
  page: Page,
  test: WaitContext,
  t: string,
  seen: number,
): Promise<void> {
  await page.waitForFunction(
    ([type, n]: [string, number]) =>
      (window.__lluiE2eFrames ?? []).filter((f) => f.t === type).length > n,
    [t, seen] as [string, number],
    { timeout: remainingBudget(test) },
  )
}

/**
 * Mint a token, open the WS in the browser, and wait until the server has
 * PAIRED it — observed as the `hello-ack` frame, which the pairing registry
 * sends in the same synchronous step that records the client's `hello`
 * (`PairingRegistry.dispatch`). After it, `/describe` and every other LAP call
 * are served on the first request.
 *
 * This used to poll `connect_session` every 150 ms against a private 10 s
 * deadline, retrying on `paused`, under a package-wide `retry: 2`.
 */
export async function mintAndPair(ctx: E2EContext, test: WaitContext): Promise<MintResult> {
  const acks = await serverFrameCount(ctx.page, 'hello-ack')
  const mint = await ctx.mintToken()
  await waitForServerFrame(ctx.page, test, 'hello-ack', acks)
  return mint
}

/**
 * `mintAndPair`, then bind the in-process MCP bridge to the app — once: the
 * pairing is already known to be ready, so any failure here is real.
 *
 * Returns the MintResult so tests can access tid, token, lapUrl, wsUrl.
 */
export async function mintAndBind(ctx: E2EContext, test: WaitContext): Promise<MintResult> {
  const mint = await mintAndPair(ctx, test)
  await ctx.bindClaude(mint.lapUrl, mint.token)
  return mint
}

/**
 * Parse the first content item of an MCP tool call result as JSON.
 * Throws if the result has no content or the text is not valid JSON.
 */
export function parseToolResult<T = unknown>(r: {
  content: Array<{ type: string; text?: string }>
}): T {
  const text = (r.content[0] as { text?: string } | undefined)?.text
  if (text === undefined) throw new Error('tool result has no content text')
  return JSON.parse(text) as T
}
