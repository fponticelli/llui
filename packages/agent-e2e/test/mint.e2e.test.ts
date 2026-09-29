import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import { mintAndPair } from '../src/test-utils.js'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup(hermetic)
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

  it('after mintToken(), the server accepts /lap/v1/describe with 200', async (testCtx) => {
    // mintToken() opens the WS in the browser; the server then has to receive
    // and record its hello, and acknowledges it in the same step. Once the ack
    // is on the page, ONE describe must succeed — this used to poll for the
    // 200 against a private 10 s deadline.
    const mint = await mintAndPair(ctx, testCtx)

    const res = await fetch(`${mint.lapUrl}/describe`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${mint.token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    expect(res.status).toBe(200)
  })
})
