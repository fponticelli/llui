import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setup, type E2EContext } from '../src/harness.js'
import { mintAndBind, parseToolResult, remainingBudget } from '../src/test-utils.js'
import type { WaitContext } from '../../../scripts/lib/wait-until.mjs'
import { useHermeticBrowser } from '../../../scripts/lib/hermetic-browser.mjs'
import type { State } from '../src/host.js'

const hermetic = useHermeticBrowser()

/**
 * Confirm-flow tests.
 *
 * factory.ts's pollConfirms() fires wsClient.resolveConfirm() whenever a
 * ConfirmEntry transitions from 'pending' → 'approved' | 'rejected'.
 * This means the send_message long-poll DOES resolve once the user acts.
 *
 * host.ts routes AgentForwardMsg effects through onEffect → client.effectHandler,
 * so an approved delete actually re-dispatches the delete Msg to the app and
 * lastDelete reflects the approved payload.
 */

let ctx: E2EContext
beforeEach(async () => {
  ctx = await setup(hermetic)
})
afterEach(async () => {
  await ctx.close()
})

/** A pending-confirmation entry, typed from the page's real state. */
type ConfirmEntry = State['agent']['confirm']['pending'][number]

// All page.evaluate callbacks must be self-contained (no Node-side helpers).
// Playwright serialises the function body as a string and evaluates it in the
// browser context where nothing from this file is in scope.

async function waitForPending(
  page: E2EContext['page'],
  testCtx: WaitContext,
): Promise<ConfirmEntry[]> {
  await page.waitForFunction(
    () => {
      const h = window.__lluiE2eHandle
      if (!h) throw new Error('__lluiE2eHandle is not installed')
      return h.getState().agent.confirm.pending.length > 0
    },
    undefined,
    { timeout: remainingBudget(testCtx) },
  )
  return page.evaluate(() => {
    const h = window.__lluiE2eHandle
    if (!h) throw new Error('__lluiE2eHandle is not installed')
    return h.getState().agent.confirm.pending
  })
}

describe('e2e: confirm flow', () => {
  it('delete proposes a pending-confirmation entry that resolves on reject', async (testCtx) => {
    await mintAndBind(ctx, testCtx)

    // Start the long-polling send_message call — it will park at the server
    // until the user approves or rejects.
    const sendPromise = ctx.mcpClient.callTool({
      name: 'send_message',
      arguments: { msg: { type: 'delete', id: '42' }, reason: 'e2e test' },
    })

    const pending = await waitForPending(ctx.page, testCtx)

    expect(pending).toHaveLength(1)
    const first = pending[0]
    expect(first).toBeDefined()
    expect(first!.variant).toBe('delete')
    expect(first!.payload).toMatchObject({ id: '42' })
    expect(first!.status).toBe('pending')

    const pendingId = first!.id

    // Reject the confirm to close the long-poll cleanly.
    await ctx.page.evaluate((id: string) => {
      const h = window.__lluiE2eHandle
      if (!h) throw new Error('__lluiE2eHandle is not installed')
      h.send({ type: 'agent', sub: 'confirm', msg: { type: 'Reject', id } })
    }, pendingId)

    // The send_message long-poll should now resolve.
    const result = await sendPromise
    expect(result.isError).toBeFalsy()
    const body = parseToolResult<{ status: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    // Bridge maps user-cancelled (reject path) to a non-error status.
    expect(['user-cancelled', 'rejected']).toContain(body.status)
  })

  it('delete approved by the user resolves with confirmed and re-dispatches the Msg', async (testCtx) => {
    await mintAndBind(ctx, testCtx)

    const sendPromise = ctx.mcpClient.callTool({
      name: 'send_message',
      arguments: { msg: { type: 'delete', id: '99' }, reason: 'e2e approve test' },
    })

    const pending = await waitForPending(ctx.page, testCtx)
    const first = pending[0]
    expect(first).toBeDefined()
    const pendingId = first!.id

    // Approve
    await ctx.page.evaluate((id: string) => {
      const h = window.__lluiE2eHandle
      if (!h) throw new Error('__lluiE2eHandle is not installed')
      h.send({ type: 'agent', sub: 'confirm', msg: { type: 'Approve', id } })
    }, pendingId)

    // pollConfirms() fires resolveConfirm with 'confirmed' once status → approved.
    const result = await sendPromise
    expect(result.isError).toBeFalsy()
    const body = parseToolResult<{ status: string }>(
      result as { content: Array<{ type: string; text?: string }> },
    )
    expect(body.status).toBe('confirmed')

    // AgentForwardMsg effect from the confirm reducer is routed via onEffect →
    // client.effectHandler → handle.send, re-dispatching {type: 'delete', id: '99'}
    // to the root update() which sets lastDelete = '99'.
    await ctx.page.waitForFunction(
      () => {
        const h = window.__lluiE2eHandle
        if (!h) throw new Error('__lluiE2eHandle is not installed')
        return h.getState().lastDelete === '99'
      },
      undefined,
      { timeout: remainingBudget(testCtx) },
    )
    const lastDelete = await ctx.page.evaluate(() => {
      const h = window.__lluiE2eHandle
      if (!h) throw new Error('__lluiE2eHandle is not installed')
      return h.getState().lastDelete
    })
    expect(lastDelete).toBe('99')
  })
})
