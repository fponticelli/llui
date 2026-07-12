import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import { buildPausedResponse } from './paused.js'
import { ensureActive } from './active.js'
import type { LapConfirmResultRequest, LapConfirmResultResponse } from '../../protocol.js'

export type LapConfirmResultDeps = {
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
  /** Sliding (inactivity) TTL in ms; folded into the verify path. */
  slidingTtlMs?: number
}

export async function handleLapConfirmResult(
  req: Request,
  deps: LapConfirmResultDeps,
): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.tokenStore, { slidingTtlMs: deps.slidingTtlMs })
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return buildPausedResponse(deps.tokenStore, auth.tid)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  // Refresh the sliding-TTL clock at request ARRIVAL — like `/wait`, this
  // route long-polls (`waitForConfirm`, default 5s, caller-controllable),
  // so touching only after it resolves would let the inactivity expiry kill
  // an agent that is actively polling while a human decides on the confirm.
  await deps.tokenStore.touch(auth.tid, (deps.now ?? (() => Date.now()))())

  const body = (await req.json().catch(() => null)) as LapConfirmResultRequest | null
  if (!body || typeof body.confirmId !== 'string') return json({ error: { code: 'invalid' } }, 400)
  const timeoutMs = body.timeoutMs ?? 5_000

  // This route is polled after `/message` bailed out with
  // `pending-confirmation`. Re-arm `waitForConfirm` for up to `timeoutMs`.
  // The three-way outcome maps cleanly to the response contract now:
  //   confirmed      → { status: 'confirmed', stateAfter }
  //   user-cancelled → { status: 'rejected', reason: 'user-cancelled' } (+ expire)
  //   timeout        → { status: 'still-pending' } — the agent polls again.
  const result = await deps.registry.waitForConfirm(auth.tid, body.confirmId, timeoutMs)

  const nowMs = (deps.now ?? (() => Date.now()))()
  await ensureActive(deps.tokenStore, deps.registry, auth.tid, rec, nowMs)
  if (result.outcome === 'confirmed') {
    await deps.auditSink.write({
      at: nowMs,
      tid: auth.tid,
      uid: rec.uid,
      event: 'confirm-approved',
      detail: { confirmId: body.confirmId },
    })
    return json(
      { status: 'confirmed', stateAfter: result.stateAfter } satisfies LapConfirmResultResponse,
      200,
    )
  }
  if (result.outcome === 'timeout') {
    // No resolution yet — the confirm is still live in the browser. Report
    // `still-pending` (not a fabricated rejection) so the agent can poll
    // again; do NOT expire the browser entry.
    return json({ status: 'still-pending' } satisfies LapConfirmResultResponse, 200)
  }
  // user-cancelled: a real rejection. Record it and expire the browser
  // entry so a late Approve can't fire a dispatch we reported as rejected.
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'confirm-rejected',
    detail: { confirmId: body.confirmId },
  })
  deps.registry.send(auth.tid, { t: 'confirm-expire', confirmId: body.confirmId })
  return json(
    { status: 'rejected', reason: 'user-cancelled' } satisfies LapConfirmResultResponse,
    200,
  )
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
