import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import {
  mintAndBind,
  parseToolResult,
  serverFrameCount,
  waitForServerFrame,
} from '../src/test-utils.js'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup(hermetic)
})
afterEach(async () => {
  await ctx.close()
})

describe('e2e: wait_for_change', () => {
  it('returns {status: "timeout"} when no state change occurs within the window', async (testCtx) => {
    await mintAndBind(ctx, testCtx)

    const result = await ctx.mcpClient.callTool({
      name: 'wait_for_change',
      arguments: { timeoutMs: 500 },
    })
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{ status: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('timeout')
  })

  it('returns {status: "changed"} with updated state when inc is dispatched concurrently', async (testCtx) => {
    await mintAndBind(ctx, testCtx)

    // Start the long-poll first, then dispatch a change from the browser — but
    // only once the page has the server's `watch` frame. The browser takes its
    // baseline when the watch ARRIVES, so a change dispatched before that is
    // not a change to it, and the poll would time out. This used to sleep
    // 100 ms and hope the frame had landed. `timeoutMs` is the long-poll's own
    // window, not a wait of ours: it only has to outlast the dispatch round
    // trip below, so it takes most of the test budget instead of a tight 5 s.
    const watches = await serverFrameCount(ctx.page, 'watch')
    const waitPromise = ctx.mcpClient.callTool({
      name: 'wait_for_change',
      arguments: { timeoutMs: 20_000 },
    })
    await waitForServerFrame(ctx.page, testCtx, 'watch', watches)

    // Dispatch inc directly from the browser to trigger a state change.
    // All access is inlined — Node helpers are not available inside page.evaluate.
    await ctx.page.evaluate(() => {
      const h = (window as unknown as { __lluiE2eHandle: { send: (m: unknown) => void } })[
        '__lluiE2eHandle'
      ]
      h.send({ type: 'inc' })
    })

    const result = await waitPromise
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{ status: string; stateAfter?: { count?: number } }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('changed')
    // stateAfter reflects the state after the inc was applied.
    expect(body.stateAfter?.count).toBe(1)
  })

  it('a PATH-scoped wait on /count resolves when count changes', async (testCtx) => {
    await mintAndBind(ctx, testCtx)

    // Regression (finding 3): a path-scoped wait could never match under
    // the old `/`-broadcast + prefix scheme. It must resolve now.
    const watches = await serverFrameCount(ctx.page, 'watch')
    const waitPromise = ctx.mcpClient.callTool({
      name: 'wait_for_change',
      arguments: { path: '/count', timeoutMs: 20_000 },
    })
    await waitForServerFrame(ctx.page, testCtx, 'watch', watches)
    await ctx.page.evaluate(() => {
      const h = (window as unknown as { __lluiE2eHandle: { send: (m: unknown) => void } })[
        '__lluiE2eHandle'
      ]
      h.send({ type: 'inc' })
    })

    const result = await waitPromise
    expect(result.isError).toBeFalsy()
    const body = parseToolResult<{ status: string; stateAfter?: { count?: number } }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('changed')
    expect(body.stateAfter?.count).toBe(1)
  })
})
