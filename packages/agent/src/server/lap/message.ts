import type { TokenStore } from '../token-store.js'
import type { PairingRegistry } from '../ws/pairing-registry.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { verifyAndReadTid } from './describe.js'
import type { LapMessageRequest, LapMessageResponse } from '../../protocol.js'

export type LapMessageDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  registry: PairingRegistry
  auditSink: AuditSink
  rateLimiter: RateLimiter
  now?: () => number
}

export async function handleLapMessage(req: Request, deps: LapMessageDeps): Promise<Response> {
  const auth = await verifyAndReadTid(req, deps.signingKey)
  if (!auth.ok) return json({ error: { code: auth.code } }, auth.status)

  const rec = await deps.tokenStore.findByTid(auth.tid)
  if (!rec || rec.status === 'revoked') return json({ error: { code: 'revoked' } }, 403)
  if (!deps.registry.isPaired(auth.tid)) return json({ error: { code: 'paused' } }, 503)

  const rlCheck = await deps.rateLimiter.check(auth.tid, 'token')
  if (!rlCheck.allowed) {
    return json({ error: { code: 'rate-limited', retryAfterMs: rlCheck.retryAfterMs } }, 429)
  }

  const body = (await req.json().catch(() => null)) as LapMessageRequest | null
  if (!body || !body.msg || typeof body.msg.type !== 'string') {
    return json({ error: { code: 'invalid' } }, 400)
  }

  const timeoutMs = body.timeoutMs ?? 5_000

  // The browser-side drain loop caps at `timeoutMs`; give the outer
  // RPC a small buffer so a near-edge drain doesn't race the transport
  // timeout and come back as a false 504.
  const rpcTimeoutMs = timeoutMs + 1_000

  let initial: LapMessageResponse
  try {
    initial = (await deps.registry.rpc(auth.tid, 'send_message', body, {
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
    return json({ error: { code: err.code ?? 'internal', detail } }, status)
  }

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.touch(auth.tid, nowMs)

  if (
    initial.status === 'dispatched' ||
    initial.status === 'confirmed' ||
    initial.status === 'rejected'
  ) {
    await deps.auditSink.write({
      at: nowMs,
      tid: auth.tid,
      uid: rec.uid,
      event: initial.status === 'rejected' ? 'msg-blocked' : 'msg-dispatched',
      detail: { variant: body.msg.type, status: initial.status },
    })
    return json(initial, 200)
  }

  if (initial.status === 'pending-confirmation') {
    await deps.auditSink.write({
      at: nowMs,
      tid: auth.tid,
      uid: rec.uid,
      event: 'confirm-proposed',
      detail: { variant: body.msg.type, confirmId: initial.confirmId },
    })
    const resolved = await deps.registry.waitForConfirm(auth.tid, initial.confirmId, timeoutMs)
    const nowMs2 = (deps.now ?? (() => Date.now()))()
    if (resolved.outcome === 'confirmed') {
      await deps.auditSink.write({
        at: nowMs2,
        tid: auth.tid,
        uid: rec.uid,
        event: 'confirm-approved',
        detail: { variant: body.msg.type, confirmId: initial.confirmId },
      })
      return json(
        { status: 'confirmed', stateAfter: resolved.stateAfter } satisfies LapMessageResponse,
        200,
      )
    }
    await deps.auditSink.write({
      at: nowMs2,
      tid: auth.tid,
      uid: rec.uid,
      event: 'confirm-rejected',
      detail: { variant: body.msg.type, confirmId: initial.confirmId },
    })
    return json({ status: 'rejected', reason: 'user-cancelled' } satisfies LapMessageResponse, 200)
  }

  return json(
    {
      error: {
        code: 'internal',
        detail: `unexpected browser status: ${String((initial as { status?: unknown }).status ?? 'undefined')}`,
      },
    },
    500,
  )
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
