import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import { mintAndBind, mintAndPair, parseToolResult } from '../src/test-utils.js'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup(hermetic)
})
afterEach(async () => {
  await ctx.close()
})

describe('e2e: describe_app', () => {
  it('connect_session succeeds and reports connected', async (testCtx) => {
    // Wait for the server to pair the WS (its `hello-ack`), then call
    // connect_session ONCE and read what it reports. It used to be retried on
    // `paused` against a private 10 s deadline.
    const mint = await mintAndPair(ctx, testCtx)

    const result = await ctx.mcpClient.callTool({
      name: 'connect_session',
      arguments: { url: mint.lapUrl, token: mint.token },
    })
    expect(result.isError).toBeFalsy()
    const body = parseToolResult<{ status: string; appName: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('connected')
    expect(body.appName).toBe('TestApp')
  })

  it('describe_app returns app name and docs.purpose', async (testCtx) => {
    await mintAndBind(ctx, testCtx)

    const result = await ctx.mcpClient.callTool({
      name: 'describe_app',
      arguments: {},
    })
    expect(result.isError).toBeFalsy()

    const body = parseToolResult<{
      name: string
      docs?: { purpose?: string; overview?: string }
    }>(result as { content: Array<{ type: string; text?: string }> })

    expect(body.name).toBe('TestApp')
    expect(body.docs).toBeDefined()
    expect(typeof body.docs?.purpose).toBe('string')
    expect(body.docs!.purpose!.length).toBeGreaterThan(0)
  })
})
