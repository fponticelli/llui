import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { RevokeRequest, RevokeResponse } from '../../protocol.js'

export type RevokeDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  /**
   * Live pairing registry. Revoke must tear the pairing DOWN, not just
   * flip the record: without this the WebSocket stays open and the
   * per-tid subscriber / recent-log / confirm-outcome buffers leak for
   * the life of the process. On revoke we push a `revoked` frame (so the
   * browser closes its side) and then `unregister` the tid (fires close
   * handlers, drops the buffers).
   */
  registry: PairingRegistry
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

  // Tear the live pairing down. Tell the browser first (so it closes its
  // own socket and flips out of the paired UI), then unregister — which
  // fires the pairing's close handlers and drops the per-tid buffers so
  // a revoked session leaks nothing.
  deps.registry.send(body.tid, { t: 'revoked' })
  deps.registry.unregister(body.tid)

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
