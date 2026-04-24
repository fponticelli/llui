import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import { signToken } from '../token.js'
import type { MintResponse, TokenPayload, TokenRecord } from '../../protocol.js'

export type MintDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  lapBasePath: string
  /** Wall-clock in milliseconds; injectable for tests. */
  now?: () => number
  /** UUID generator; injectable for tests. */
  uuid?: () => string
  /** Hard-expiry window, default 24 h. */
  hardExpiryMs?: number
}

/**
 * POST /agent/mint — creates a pairing record and returns the mint
 * response. See spec §6.2. The caller is responsible for routing
 * `/agent/mint` requests to this handler; `router.ts` composes that.
 */
export async function handleMint(req: Request, deps: MintDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'method-not-allowed' } }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  const now = deps.now ?? (() => Date.now())
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  const hardExpiryMs = deps.hardExpiryMs ?? 24 * 60 * 60 * 1000

  const uid = await deps.identityResolver(req)
  const tid = uuid()
  const nowMs = now()
  const iat = Math.floor(nowMs / 1000)
  const exp = Math.floor((nowMs + hardExpiryMs) / 1000)
  const origin = new URL(req.url).origin

  const payload: TokenPayload = { tid, iat, exp, scope: 'agent' }
  const token = await signToken(payload, deps.signingKey)

  const record: TokenRecord = {
    tid,
    uid,
    status: 'awaiting-ws',
    createdAt: nowMs,
    lastSeenAt: nowMs,
    pendingResumeUntil: null,
    origin,
    label: null,
  }
  await deps.tokenStore.create(record)

  await deps.auditSink.write({
    at: nowMs,
    tid,
    uid,
    event: 'mint',
    detail: { origin },
  })

  const wsUrl = toWsUrl(new URL(req.url).origin) + '/agent/ws'
  const lapUrl = new URL(deps.lapBasePath, origin).toString()

  const body: MintResponse = {
    token,
    tid,
    wsUrl,
    lapUrl,
    expiresAt: exp,
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function toWsUrl(httpOrigin: string): string {
  return httpOrigin.startsWith('https://')
    ? 'wss://' + httpOrigin.slice('https://'.length)
    : 'ws://' + httpOrigin.slice('http://'.length)
}
