import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import type { RateLimiter } from '../rate-limit.js'
import { mintToken } from '../token.js'
import { LAP_VERSION, type MintResponse, type TokenRecord } from '../../protocol.js'

/**
 * How long a hard-expired token record is retained before the lazy
 * mint-time sweep evicts it. Long enough that `/resume/list` and audit
 * reads can still see a just-lapsed session; short enough to bound
 * memory. 1 hour past `expiresAt`.
 */
const RECORD_RETENTION_MS = 60 * 60 * 1000

export type MintDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  /**
   * Rate limiter for the mint endpoint. Mint is checked BEFORE any
   * record is created, keyed by resolved identity (or client IP for
   * anonymous callers), so a caller can't spam token records into
   * existence. Optional for back-compat; when omitted, mint is
   * unthrottled (the core always wires one).
   */
  rateLimiter?: RateLimiter
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

  // Rate-limit BEFORE creating anything, keyed by resolved identity (or
  // client IP for anonymous callers) — otherwise a caller who can reach
  // the endpoint could spam token records into the store unbounded.
  if (deps.rateLimiter) {
    const rlKey = uid ?? clientIpOf(req)
    const rl = await deps.rateLimiter.check(rlKey, 'identity')
    if (!rl.allowed) {
      await deps.auditSink.write({
        at: now(),
        tid: null,
        uid: uid ?? null,
        event: 'rate-limited',
        detail: { endpoint: '/agent/mint' },
      })
      return new Response(
        JSON.stringify({ error: { code: 'rate-limited', retryAfterMs: rl.retryAfterMs } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      )
    }
  }

  // Opportunistic, lazy eviction of long-expired records (mint is the
  // record-creation growth point, so it's the natural sweep trigger).
  if (deps.tokenStore.sweepExpired) {
    await deps.tokenStore.sweepExpired(now(), RECORD_RETENTION_MS)
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
    lapVersion: LAP_VERSION,
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Best-effort client IP for anonymous rate-limiting. Prefers the first
 * `X-Forwarded-For` hop (the original client behind proxies), then
 * `X-Real-IP`. Falls back to a shared constant so anonymous callers
 * without any forwarding header still share ONE throttle bucket rather
 * than each getting an unlimited allowance.
 */
function clientIpOf(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'anon'
}

function toWsUrl(httpOrigin: string): string {
  return httpOrigin.startsWith('https://')
    ? 'wss://' + httpOrigin.slice('https://'.length)
    : 'ws://' + httpOrigin.slice('http://'.length)
}
