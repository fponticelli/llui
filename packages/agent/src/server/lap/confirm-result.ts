import { withLapGates, type LapGateDeps } from './gate.js'
import type { LapConfirmResultRequest, LapConfirmResultResponse } from '../../protocol.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type LapConfirmResultDeps = LapGateDeps

export const handleLapConfirmResult = withLapGates({ touchOn: 'arrival' }, async (ctx) => {
  // Note: the sliding-TTL clock was refreshed at request ARRIVAL by the
  // gate (`touchOn: 'arrival'`) — like `/wait`, this route long-polls
  // (`waitForConfirm`, default 5s, caller-controllable), so touching only
  // after it resolves would let the inactivity expiry kill an agent that
  // is actively polling while a human decides on the confirm.
  const body = ctx.body as LapConfirmResultRequest | null
  if (!body || typeof body.confirmId !== 'string')
    return ctx.json({ error: { code: 'invalid' } }, 400)
  const timeoutMs = body.timeoutMs ?? 5_000

  // This route is polled after `/message` bailed out with
  // `pending-confirmation`. Re-arm `waitForConfirm` for up to `timeoutMs`.
  // The three-way outcome maps cleanly to the response contract now:
  //   confirmed      → { status: 'confirmed', stateAfter }
  //   user-cancelled → { status: 'rejected', reason: 'user-cancelled' } (+ expire)
  //   timeout        → { status: 'still-pending' } — the agent polls again.
  const result = await ctx.deps.registry.waitForConfirm(ctx.tid, body.confirmId, timeoutMs)

  const nowMs = ctx.now()
  await ctx.markActive(nowMs)
  if (result.outcome === 'confirmed') {
    await ctx.audit('confirm-approved', { confirmId: body.confirmId }, nowMs)
    return ctx.json(
      { status: 'confirmed', stateAfter: result.stateAfter } satisfies LapConfirmResultResponse,
      200,
    )
  }
  if (result.outcome === 'timeout') {
    // No resolution yet — the confirm is still live in the browser. Report
    // `still-pending` (not a fabricated rejection) so the agent can poll
    // again; do NOT expire the browser entry.
    return ctx.json({ status: 'still-pending' } satisfies LapConfirmResultResponse, 200)
  }
  // user-cancelled: a real rejection. Record it and expire the browser
  // entry so a late Approve can't fire a dispatch we reported as rejected.
  await ctx.audit('confirm-rejected', { confirmId: body.confirmId }, nowMs)
  ctx.deps.registry.send(ctx.tid, { t: 'confirm-expire', confirmId: body.confirmId })
  return ctx.json(
    { status: 'rejected', reason: 'user-cancelled' } satisfies LapConfirmResultResponse,
    200,
  )
})
