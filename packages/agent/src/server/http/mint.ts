import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import { mintToken } from '../token.js'
import type { MintResponse, TokenRecord } from '../../protocol.js'

export type MintDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  lapBasePath: string
  /**
   * Permit minting a remote-control token for an UNAUTHENTICATED caller
   * (one the `identityResolver` resolves to `null`/`undefined`).
   *
   * SECURITY: defaults to `false` — fail closed. Without an identity and
   * without this explicit opt-in, `POST /agent/mint` returns 401 and no
   * token is created, so a deployment that forgets to configure an
   * identity resolver can't hand out remote-control tokens to anyone who
   * can reach the endpoint. Set `true` only for genuinely anonymous apps
   * that intend to let any visitor pair an agent.
   */
  allowAnonymous?: boolean
  /** Wall-clock in milliseconds; injectable for tests. */
  now?: () => number
  /** UUID generator; injectable for tests. */
  uuid?: () => string
  /** Hard-expiry window, default 24 h. */
  hardExpiryMs?: number
  /**
   * Override the token mint primitive (for tests that need a known
   * token value). Production uses the default opaque mint.
   */
  mint?: typeof mintToken
}

/**
 * POST /agent/mint — creates a pairing record and returns the mint
 * response. The caller is responsible for routing
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

  // Fail closed: an unauthenticated caller (no resolved identity) must
  // not be able to mint a remote-control token unless the operator has
  // explicitly opted into anonymous pairing. See `allowAnonymous`.
  if ((uid === null || uid === undefined) && !deps.allowAnonymous) {
    return new Response(JSON.stringify({ error: { code: 'auth-required' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const tid = uuid()
  const nowMs = now()
  const expiresAt = nowMs + hardExpiryMs
  const origin = new URL(req.url).origin

  // Mint an opaque random token + the SHA-256 hash we'll persist. The
  // plaintext token is returned to the caller in this single HTTP
  // response; from this point on, the server only knows the hash. See
  // token.ts for the security rationale.
  const mint = deps.mint ?? mintToken
  const { token, tokenHash } = await mint()

  const record: TokenRecord = {
    tid,
    tokenHash,
    uid,
    status: 'awaiting-ws',
    createdAt: nowMs,
    expiresAt,
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
    // Wire format keeps the seconds-since-epoch convention from the
    // pre-0.0.35 JWT-payload `exp` so existing clients reading
    // `expiresAt` see the same units.
    expiresAt: Math.floor(expiresAt / 1000),
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
