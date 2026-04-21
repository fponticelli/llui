import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import { mintAndBind } from '../src/test-utils.js'

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup()
})
afterEach(async () => {
  await ctx.close()
})

describe('e2e: revoke', () => {
  it('after revoke, get_state tool call fails with an error result', async () => {
    const mint = await mintAndBind(ctx)

    // Confirm the session works before revoking.
    const before = await ctx.mcpClient.callTool({
      name: 'get_state',
      arguments: {},
    })
    expect(before.isError).toBeFalsy()

    // Revoke the token via the HTTP endpoint.
    const revokeRes = await fetch(`http://localhost:${ctx.httpPort}/agent/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: mint.tid }),
    })
    expect(revokeRes.status).toBe(200)
    const revokeBody = (await revokeRes.json()) as { status: string }
    expect(revokeBody.status).toBe('revoked')

    // Subsequent tool calls should fail: the token is revoked so the LAP
    // endpoint returns 403, and the bridge surfaces it as an error result.
    const after = await ctx.mcpClient.callTool({
      name: 'get_state',
      arguments: {},
    })
    expect(after.isError).toBe(true)
  })
})
