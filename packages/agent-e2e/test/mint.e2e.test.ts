import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup()
})
afterEach(async () => {
  await ctx.close()
})

describe('e2e: mint + WS pairing', () => {
  it('mintToken() returns well-shaped {token, wsUrl, lapUrl, tid}', async () => {
    const mint = await ctx.mintToken()

    expect(typeof mint.token).toBe('string')
    expect(mint.token.length).toBeGreaterThan(0)

    expect(typeof mint.tid).toBe('string')
    expect(mint.tid.length).toBeGreaterThan(0)

    // wsUrl must be a valid ws:// URL
    expect(mint.wsUrl).toMatch(/^ws:\/\//)

    // lapUrl must be a valid http:// URL pointing to /agent/lap/v1
    expect(mint.lapUrl).toMatch(/^http:\/\//)
    expect(mint.lapUrl).toContain('/agent/lap/v1')
  })

  it('after mintToken(), the server accepts /lap/v1/describe with 200', async () => {
    const mint = await ctx.mintToken()

    // Wait briefly for the WS to connect before calling describe.
    // mintToken() already calls effectHandler to open the WS in the browser,
    // so a short poll is sufficient.
    let status = 0
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const res = await fetch(`${mint.lapUrl}/describe`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${mint.token}`,
          'content-type': 'application/json',
        },
        body: '{}',
      })
      status = res.status
      if (status === 200) break
      // 503 means the WS hasn't sent the hello frame yet — retry
      await new Promise<void>((r) => setTimeout(r, 200))
    }

    expect(status).toBe(200)
  })
})
