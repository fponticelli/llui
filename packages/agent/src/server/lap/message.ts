import { withLapGates, type LapGateDeps } from './gate.js'
import type { LapMessageRequest, LapMessageResponse } from '../../protocol.js'

/** @deprecated Use `LapGateDeps` from `./gate.js`. */
export type LapMessageDeps = LapGateDeps

export const handleLapMessage = withLapGates({ touchOn: 'completion' }, async (ctx) => {
  const body = ctx.body as LapMessageRequest | null
  if (!body || !body.msg || typeof body.msg.type !== 'string') {
    return ctx.json({ error: { code: 'invalid' } }, 400)
  }

  const timeoutMs = body.timeoutMs ?? 5_000

  // The browser-side drain loop caps at `timeoutMs`; give the outer
  // RPC a small buffer so a near-edge drain doesn't race the transport
  // timeout and come back as a false 504.
  const rpcTimeoutMs = timeoutMs + 1_000

  let initial: LapMessageResponse
  try {
    initial = (await ctx.deps.registry.rpc(ctx.tid, 'send_message', body, {
      timeoutMs: rpcTimeoutMs,
    })) as LapMessageResponse
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string }
    const status = err.code === 'paused' ? 503 : err.code === 'timeout' ? 504 : 500
    // Build a detail string that surfaces whatever info we have — the rpc-error
    // frame from the browser sometimes lacks `detail` (e.g., when a JS TypeError
    // bubbles out of the handler). Falling back to the code + any Error-like
    // fields gives Claude something actionable instead of an opaque 500.
    const detail =
      err.detail ??
      (e instanceof Error ? `${e.name}: ${e.message}` : undefined) ??
      (err.code ? `rpc rejected with code '${err.code}'` : 'rpc rejected without a code')
    // Mirror to the server console so operators see the real cause even when
    // the client just shows "internal".
    console.error(
      `[llui-agent] /lap/v1/message 500 — code=${err.code ?? 'internal'}, detail=${detail}`,
    )
    return ctx.json({ error: { code: err.code ?? 'internal', detail } }, status)
  }

  const nowMs = ctx.now()
  await ctx.markActive(nowMs)
  await ctx.touch(nowMs)

  if (
    initial.status === 'dispatched' ||
    initial.status === 'confirmed' ||
    initial.status === 'rejected'
  ) {
    await ctx.audit(
      initial.status === 'rejected' ? 'msg-blocked' : 'msg-dispatched',
      { variant: body.msg.type, status: initial.status },
      nowMs,
    )
    return ctx.json(initial, 200)
  }

  if (initial.status === 'pending-confirmation') {
    await ctx.audit(
      'confirm-proposed',
      { variant: body.msg.type, confirmId: initial.confirmId },
      nowMs,
    )
    const resolved = await ctx.deps.registry.waitForConfirm(ctx.tid, initial.confirmId, timeoutMs)
    const nowMs2 = ctx.now()
    if (resolved.outcome === 'confirmed') {
      await ctx.audit(
        'confirm-approved',
        { variant: body.msg.type, confirmId: initial.confirmId },
        nowMs2,
      )
      return ctx.json(
        { status: 'confirmed', stateAfter: resolved.stateAfter } satisfies LapMessageResponse,
        200,
      )
    }
    if (resolved.outcome === 'timeout') {
      // Honest: the confirm is still live in the browser — a later
      // approval may still fire. Return `pending-confirmation` so the
      // agent polls `get_confirm_result`. Do NOT audit a rejection here
      // (the earlier `confirm-proposed` entry stands) and do NOT expire
      // the browser entry — that would defeat a slow-but-genuine approval.
      return ctx.json(
        {
          status: 'pending-confirmation',
          confirmId: initial.confirmId,
        } satisfies LapMessageResponse,
        200,
      )
    }
    // user-cancelled: a real rejection. Record it AND expire the browser
    // entry so a late Approve can't fire the dispatch we just told the
    // agent was rejected.
    await ctx.audit(
      'confirm-rejected',
      { variant: body.msg.type, confirmId: initial.confirmId },
      nowMs2,
    )
    ctx.deps.registry.send(ctx.tid, { t: 'confirm-expire', confirmId: initial.confirmId })
    return ctx.json(
      { status: 'rejected', reason: 'user-cancelled' } satisfies LapMessageResponse,
      200,
    )
  }

  return ctx.json(
    {
      error: {
        code: 'internal',
        detail: `unexpected browser status: ${String((initial as { status?: unknown }).status ?? 'undefined')}`,
      },
    },
    500,
  )
})
