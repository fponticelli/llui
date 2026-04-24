import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapWaitRequest, LapWaitResponse } from '../../protocol.js'

export type LapWaitDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

export async function handleLapWait(req: Request, deps: LapWaitDeps): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as LapWaitRequest
  const timeoutMs = body.timeoutMs ?? 10_000
  const result = await deps.registry.waitForChange(auth.tid, body.path, timeoutMs)
  const out: LapWaitResponse = result

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/wait', outcome: result.status },
  })
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
