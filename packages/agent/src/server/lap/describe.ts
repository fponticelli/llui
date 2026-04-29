import { tokenHashOf } from '../token.js'
import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { buildPausedResponse } from './paused.js'
import type { LapDescribeResponse, MessageSchemaEntry } from '../../protocol.js'

export type LapDescribeDeps = {
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

export async function handleLapDescribe(req: Request, deps: LapDescribeDeps): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.tokenStore)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return buildPausedResponse(deps.tokenStore, auth.tid)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const hello = deps.registry.getHello(auth.tid)
  if (!hello) return buildPausedResponse(deps.tokenStore, auth.tid)

  const messages: Record<string, MessageSchemaEntry> = hello.msgSchema as Record<
    string,
    MessageSchemaEntry
  >
  const out: LapDescribeResponse = {
    name: hello.appName,
    version: hello.appVersion,
    stateSchema: hello.stateSchema,
    messages,
    docs: hello.docs,
    conventions: {
      dispatchModel: 'TEA',
      confirmationModel: 'runtime-mediated',
      readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
    },
    schemaHash: hello.schemaHash,
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  // Transition to active: Claude has made its first LAP call to /describe,
  // confirming both the browser WS and Claude are live.
  const wasAwaitingClaude = rec.status === 'awaiting-claude'
  const label = rec.uid ?? 'Claude'
  await deps.tokenStore.markActive(auth.tid, label, nowMs)
  // Fire the active signal to the browser only on the first transition.
  if (wasAwaitingClaude) {
    deps.registry.send(auth.tid, { t: 'active' })
  }
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/describe' },
  })
  return json(out, 200)
}

/**
 * Resolve the bearer token on a request to a `tid`. The opaque-token
 * scheme means "verify" is "look up the SHA-256 hash in the store and
 * check expiry." A missing prefix, an unknown hash, or an expired
 * record all collapse to the same `auth-failed` so a probe-by-hash
 * leak surface is uniform.
 *
 * Status check (revoked / paused / etc.) is the caller's job — every
 * LAP handler does its own follow-up `findByTid` to read the current
 * status. This function only cares whether the bearer is one of ours
 * and unexpired.
 */
export async function verifyAndReadTid(
  req: Request,
  tokenStore: TokenStore,
  nowMs: number = Date.now(),
): Promise<{ ok: true; tid: string } | { ok: false; status: number; code: string }> {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, code: 'auth-failed' }
  const token = auth.slice('Bearer '.length)
  const hash = await tokenHashOf(token)
  if (!hash) return { ok: false, status: 401, code: 'auth-failed' }
  const rec = await tokenStore.findByTokenHash(hash)
  if (!rec) return { ok: false, status: 401, code: 'auth-failed' }
  if (rec.expiresAt <= nowMs) return { ok: false, status: 401, code: 'auth-failed' }
  return { ok: true, tid: rec.tid }
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
