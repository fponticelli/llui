import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import { buildPausedResponse } from './paused.js'
import { ensureActive } from './active.js'
import type { LapWaitForUserInputRequest, LapWaitForUserInputResponse } from '../../protocol.js'

export type LapWaitForUserInputDeps = {
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

/**
 * Long-poll for the user's next chat-composer submission. Mirrors the
 * shape of `/lap/v1/wait` (the state-change long-poll) — same auth,
 * same paused/revoked gating, same rate-limit class — but waits on a
 * different in-registry channel. The two endpoints are functionally
 * independent: an agent can have both parked simultaneously (one for
 * "watch state change", one for "wait for user to chime in"), and
 * each resolves on its own signal.
 *
 * Default timeout 30s — chat replies don't always arrive quickly,
 * and the agent's calling pattern is "park → react → park again",
 * so keeping the default high reduces churn. The agent can shorten
 * it per call when impatient.
 */
const DEFAULT_TIMEOUT_MS = 30_000

export async function handleLapWaitForUserInput(
  req: Request,
  deps: LapWaitForUserInputDeps,
): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.tokenStore)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return buildPausedResponse(deps.tokenStore, auth.tid)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const body = ((await req.json().catch(() => null)) ?? {}) as LapWaitForUserInputRequest
  const timeoutMs = body.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const result = await deps.registry.waitForUserInput(auth.tid, timeoutMs)
  const out: LapWaitForUserInputResponse = result

  const nowMs = (deps.now ?? (() => Date.now()))()
  await ensureActive(deps.tokenStore, deps.registry, auth.tid, rec, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/wait-for-user-input', outcome: result.status },
  })
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
