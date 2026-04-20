import type { TokenStore } from '../token-store.js'
import type { WsPairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapMessageRequest, LapMessageResponse } from '../../protocol.js'

export type LapMessageDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: WsPairingRegistry
  auditSink: AuditSink
  now?: () => number
}

export async function handleLapMessage(req: Request, deps: LapMessageDeps): Promise<Response> {
  const auth = verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const body = (await req.json().catch(() => null)) as LapMessageRequest | null
  if (!body || !body.msg || typeof body.msg.type !== 'string') {
    return json({ error: { code: 'invalid' } }, 400)
  }

  const timeoutMs = body.timeoutMs ?? 15_000

  let initial: LapMessageResponse
  try {
    initial = (await deps.registry.rpc(auth.tid, 'send_message', body, { timeoutMs })) as LapMessageResponse
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string }
    const status = err.code === 'paused' ? 503 : err.code === 'timeout' ? 504 : 500
    return json({ error: { code: err.code ?? 'internal', detail: err.detail } }, status)
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)

  if (initial.status === 'dispatched' || initial.status === 'confirmed' || initial.status === 'rejected') {
    await deps.auditSink.write({
      at: nowMs, tid: auth.tid, uid: rec.uid,
      event: initial.status === 'rejected' ? 'msg-blocked' : 'msg-dispatched',
      detail: { variant: body.msg.type, status: initial.status },
    })
    return json(initial, 200)
  }

  if (initial.status === 'pending-confirmation') {
    await deps.auditSink.write({
      at: nowMs, tid: auth.tid, uid: rec.uid,
      event: 'confirm-proposed',
      detail: { variant: body.msg.type, confirmId: initial.confirmId },
    })
    const resolved = await deps.registry.waitForConfirm(auth.tid, initial.confirmId, timeoutMs)
    const nowMs2 = (deps.now ?? (() => Date.now()))()
    if (resolved.outcome === 'confirmed') {
      await deps.auditSink.write({
        at: nowMs2, tid: auth.tid, uid: rec.uid,
        event: 'confirm-approved',
        detail: { variant: body.msg.type, confirmId: initial.confirmId },
      })
      return json({ status: 'confirmed', stateAfter: resolved.stateAfter } satisfies LapMessageResponse, 200)
    }
    await deps.auditSink.write({
      at: nowMs2, tid: auth.tid, uid: rec.uid,
      event: 'confirm-rejected',
      detail: { variant: body.msg.type, confirmId: initial.confirmId },
    })
    return json(
      { status: 'rejected', reason: 'user-cancelled' } satisfies LapMessageResponse,
      200,
    )
  }

  return json({ error: { code: 'internal', detail: 'unknown browser status' } }, 500)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } })
}
