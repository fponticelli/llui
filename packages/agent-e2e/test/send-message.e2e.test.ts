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

describe('e2e: send_message', () => {
  it('inc dispatches successfully and state.count becomes 1', async () => {
    await mintAndBind(ctx)

    const result = await ctx.mcpClient.callTool({
      name: 'send_message',
      arguments: { msg: { type: 'inc' } },
    })
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{ status: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('dispatched')

    const stateVal = await ctx.page.evaluate(() => {
      // page.evaluate runs in the browser — inline all access to avoid
      // "ReferenceError: <helper> is not defined" (Node helpers can't be
      // serialised across the evaluate boundary).
      const h = (window as unknown as { __lluiE2eHandle: { getState: () => { count: number } } })[
        '__lluiE2eHandle'
      ]
      return h.getState()
    })
    expect(stateVal.count).toBe(1)
  })

  it('signOut is rejected with humanOnly', async () => {
    await mintAndBind(ctx)

    const result = await ctx.mcpClient.callTool({
      name: 'send_message',
      arguments: { msg: { type: 'signOut' } },
    })
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{ status: string; reason?: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('rejected')
    expect(body.reason).toBe('humanOnly')
  })

  it('sequence inc, inc, dec → count = 1', async () => {
    await mintAndBind(ctx)

    const send = (type: string) =>
      ctx.mcpClient.callTool({ name: 'send_message', arguments: { msg: { type } } })

    await send('inc')
    await send('inc')
    await send('dec')

    const stateVal = await ctx.page.evaluate(() => {
      const h = (window as unknown as { __lluiE2eHandle: { getState: () => { count: number } } })[
        '__lluiE2eHandle'
      ]
      return h.getState()
    })
    expect(stateVal.count).toBe(1)
  })
})
