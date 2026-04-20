import { verifyToken } from '../token.js'
import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import type { LapDescribeResponse, MessageSchemaEntry } from '../../protocol.js'

export type LapDescribeDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

export async function handleLapDescribe(req: Request, deps: LapDescribeDeps): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const hello = deps.registry.getHello(auth.tid)
  if (!hello) return json({ error: { code: 'paused' } }, 503)

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
  const label = rec.uid ?? 'Claude'
  await deps.tokenStore.markActive(auth.tid, label, nowMs)
  await deps.auditSink.write({
    at: nowMs,
    tid: auth.tid,
    uid: rec.uid,
    event: 'lap-call',
    detail: { path: '/lap/v1/describe' },
  })
  return json(out, 200)
}

export function verifyAndReadTid(
  req: Request,
  key: string | Uint8Array,
): { ok: true; tid: string } | { ok: false; status: number; code: string } {
  const auth = req.headers.get('authorization')
  if (!auth || !auth.startsWith('Bearer ')) return { ok: false, status: 401, code: 'auth-failed' }
  const token = auth.slice('Bearer '.length)
  const v = verifyToken(token, key)
  if (v.kind !== 'ok') return { ok: false, status: 401, code: 'auth-failed' }
  return { ok: true, tid: v.payload.tid }
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
