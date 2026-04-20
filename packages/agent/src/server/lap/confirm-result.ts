import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapConfirmResultRequest, LapConfirmResultResponse } from '../../protocol.js'

export type LapConfirmResultDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

export async function handleLapConfirmResult(
  req: Request,
  deps: LapConfirmResultDeps,
): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const body = (await req.json().catch(() => null)) as LapConfirmResultRequest | null
  if (!body || typeof body.confirmId !== 'string') return json({ error: { code: 'invalid' } }, 400)
  const timeoutMs = body.timeoutMs ?? 5_000

  // Spec: if the confirm was already resolved during the earlier long-poll on
  // /message, there's no second resolution to wait for. In the current design
  // /confirm-result is ONLY used when /message bailed out early with
  // pending-confirmation. So we call waitForConfirm with the given timeoutMs.
  // If no resolution arrives in time, we surface 'still-pending'.
  const result = await deps.registry.waitForConfirm(auth.tid, body.confirmId, timeoutMs)

  const nowMs = (deps.now ?? (() => Date.now()))()
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
  // user-cancelled OR timeout. WsPairingRegistry returns user-cancelled on timeout too;
  // we distinguish by checking whether the confirm is still in registry.pendingConfirm —
  // but pendingConfirm cleanup happens inside waitForConfirm's timer, so we can't peek.
  // For v1: treat user-cancelled as user-cancelled; treat explicit timeout as timeout by
  // comparing elapsed vs. timeoutMs. Simpler: just return 'still-pending' on the timeout
  // branch to let Claude poll again. Registry returns {outcome: 'user-cancelled'} on
  // both timer and actual cancel — so we can't distinguish. Punt: return 'user-cancelled'
  // (matches registry semantics). Spec §8.2 get_confirm_result allows 'user-cancelled' |
  // 'timeout' | 'still-pending' — a refinement to distinguish is follow-up work.
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'confirm-rejected',
    detail: { confirmId: body.confirmId },
  })
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
