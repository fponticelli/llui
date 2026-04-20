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

describe('e2e: describe_app', () => {
  it('llui_connect_session succeeds and reports connected', async () => {
    // mintAndBind retries until the WS hello frame is ready, then returns the
    // MintResult. bindClaude (called internally) also validates via /describe.
    // After mintAndBind, /describe is already confirmed to return 200, so a
    // second llui_connect_session call will also succeed — but we can just
    // verify the return value from mintAndBind's internal connect call by
    // calling bindClaude one more time on a fresh mint.
    const mint = await ctx.mintToken()

    // Retry llui_connect_session until the WS hello frame arrives.
    let connected = false
    const deadline = Date.now() + 5_000
    let lastBody: { status?: string; appName?: string } = {}
    while (Date.now() < deadline) {
      const result = await ctx.mcpClient.callTool({
        name: 'llui_connect_session',
        arguments: { url: mint.lapUrl, token: mint.token },
      })
      if (!result.isError) {
        lastBody = parseToolResult<{ status: string; appName: string }>(
          result as { content: Array<{ type: string; text?: string }> },
        )
        connected = true
        break
      }
      // 'paused' means the WS hello hasn't arrived yet — retry
      const msg = (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
      if (!msg.includes('paused')) break
      await new Promise<void>((r) => setTimeout(r, 150))
    }

    expect(connected).toBe(true)
    expect(lastBody.status).toBe('connected')
    expect(lastBody.appName).toBe('TestApp')
  })

  it('describe_app returns app name and docs.purpose', async () => {
    await mintAndBind(ctx)

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
