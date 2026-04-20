import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import type { RevokeRequest, RevokeResponse } from '../../protocol.js'

export type RevokeDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  now?: () => number
}

export async function handleRevoke(req: Request, deps: RevokeDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: { code: 'method-not-allowed' } }, 405)
  }
  const body = (await req.json().catch(() => null)) as RevokeRequest | null
  if (!body || typeof body.tid !== 'string') return json({ error: { code: 'invalid' } }, 400)

  const uid = await deps.identityResolver(req)
  const rec = await deps.tokenStore.findByTid(body.tid)
  if (!rec || rec.uid !== uid) return json({ error: { code: 'revoked' } }, 403)

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.revoke(body.tid)
  await deps.auditSink.write({ at: nowMs, tid: body.tid, uid, event: 'revoke', detail: {} })

  const out: RevokeResponse = { status: 'revoked' }
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
