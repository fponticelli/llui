import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import { mintAndBind, parseToolResult } from '../src/test-utils.js'

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup()
})
afterEach(async () => {
  await ctx.close()
})

describe('e2e: wait_for_change', () => {
  it('returns {status: "timeout"} when no state change occurs within the window', async () => {
    await mintAndBind(ctx)

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

  it('returns {status: "changed"} with updated state when inc is dispatched concurrently', async () => {
    await mintAndBind(ctx)

    // Start the long-poll first, then dispatch a change from the browser.
    const waitPromise = ctx.mcpClient.callTool({
      name: 'wait_for_change',
      arguments: { timeoutMs: 5_000 },
    })

    // Give the long-poll a moment to register server-side before dispatching.
    await new Promise<void>((r) => setTimeout(r, 100))

    // Dispatch inc directly from the browser to trigger a state change.
    // All access is inlined — Node helpers are not available inside page.evaluate.
    await ctx.page.evaluate(() => {
      const h = (
        window as unknown as { __lluiE2eHandle: { send: (m: unknown) => void } }
      )['__lluiE2eHandle']
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
})
