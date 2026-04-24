/**
 * Runtime-neutral core of the LLui agent server. Exports everything
 * that works on any runtime with `crypto.subtle` + `Request`/`Response`
 * + long-lived connection primitives — in practice: Node, Bun, Deno,
 * Deno Deploy, Cloudflare Workers + Durable Objects.
 *
 * Intentionally does NOT import the `ws` library or any `node:*`
 * modules. Node-specific wiring lives in `./factory.ts`
 * (`createLluiAgentServer`); web runtimes use `./web/` adapters on
 * top of this core.
 */
import type { ServerOptions } from './options.js'
import type { TokenStore } from './token-store.js'
import type { IdentityResolver } from './identity.js'
import type { AuditSink } from './audit.js'
import type { RateLimiter } from './rate-limit.js'
import type { PairingConnection, PairingRegistry } from './ws/pairing-registry.js'
import { InMemoryTokenStore } from './token-store.js'
import { consoleAuditSink } from './audit.js'
import { defaultRateLimiter } from './rate-limit.js'
import { createHttpRouter } from './http/router.js'
import { createLapRouter } from './lap/router.js'
import { InMemoryPairingRegistry } from './ws/pairing-registry.js'
import { verifyToken } from './token.js'

const ANONYMOUS_RESOLVER: IdentityResolver = async () => null

/**
 * Options accepted by `createLluiAgentCore`. Strict subset of
 * `ServerOptions` — everything needed to build the router, registry,
 * and accept-connection primitive. The Node factory adds WebSocket
 * upgrade wiring on top.
 */
export type CoreOptions = {
  signingKey: ServerOptions['signingKey']
  tokenStore?: TokenStore
  identityResolver?: IdentityResolver
  auditSink?: AuditSink
  rateLimiter?: RateLimiter
  lapBasePath?: string
  /**
   * Override the default `InMemoryPairingRegistry`. Web runtimes that
   * need a different pairing implementation (e.g. a Cloudflare
   * Durable Object that persists across isolates) pass it here.
   */
  registry?: PairingRegistry
}

export type AcceptResult =
  | { ok: true; tid: string }
  | { ok: false; status: number; code: 'auth-failed' | 'revoked' }

/**
 * Handle returned by `createLluiAgentCore`. Purely runtime-neutral —
 * `router` is a Fetch-style handler, `acceptConnection` is the
 * primitive that runtime-specific WebSocket adapters call after
 * accepting a socket in their native way.
 */
export type AgentCoreHandle = {
  router: (req: Request) => Promise<Response | null>
  registry: PairingRegistry
  tokenStore: TokenStore
  auditSink: AuditSink
  /**
   * Validate an agent token and register a `PairingConnection` with
   * the registry. Use this after accepting a WebSocket upgrade via
   * your runtime's native API (e.g. `WebSocketPair` on Cloudflare,
   * `Deno.upgradeWebSocket` on Deno, `server.upgrade` on Bun).
   *
   * On success: marks the token `awaiting-claude`, writes an audit
   * entry, and returns `{ok: true, tid}`. On failure: returns an
   * appropriate HTTP status for the caller to encode into the
   * upgrade response (401 for auth failure, 403 for revoked).
   */
  acceptConnection: (token: string, conn: PairingConnection) => Promise<AcceptResult>
}

/**
 * Compose the runtime-neutral agent server. The returned handle has
 * everything the LAP HTTP routes and the WebSocket acceptance
 * plumbing need; runtime adapters wire the native upgrade API on
 * top (see `@llui/agent/server` for Node, `@llui/agent/server/web`
 * for WHATWG runtimes).
 */
export function createLluiAgentCore(opts: CoreOptions): AgentCoreHandle {
  if (!opts.signingKey) {
    throw new Error('createLluiAgentCore: signingKey is required')
  }

  const tokenStore = opts.tokenStore ?? new InMemoryTokenStore()
  const identityResolver = opts.identityResolver ?? ANONYMOUS_RESOLVER
  const auditSink = opts.auditSink ?? consoleAuditSink
  const rateLimiter = opts.rateLimiter ?? defaultRateLimiter({ perBucket: '30/minute' })
  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'

  const registry: PairingRegistry =
    opts.registry ??
    new InMemoryPairingRegistry({
      onLogAppend: (tid, entry) => {
        void auditSink.write({
          at: entry.at,
          tid,
          uid: null,
          event: 'lap-call',
          detail: {
            source: 'client-log',
            kind: entry.kind,
            variant: entry.variant,
            intent: entry.intent,
          },
        })
      },
    })

  const httpRouter = createHttpRouter({
    signingKey: opts.signingKey,
    tokenStore,
    identityResolver,
    auditSink,
    lapBasePath,
  })

  const lapRouter = createLapRouter(
    {
      signingKey: opts.signingKey,
      tokenStore,
      registry,
      auditSink,
      rateLimiter,
    },
    lapBasePath,
  )

  const router: AgentCoreHandle['router'] = async (req) => {
    const lapRes = await lapRouter(req)
    if (lapRes) return lapRes
    return httpRouter(req)
  }

  const acceptConnection: AgentCoreHandle['acceptConnection'] = async (token, conn) => {
    const verified = await verifyToken(token, opts.signingKey)
    if (verified.kind !== 'ok') return { ok: false, status: 401, code: 'auth-failed' }
    const { tid } = verified.payload
    const rec = await tokenStore.findByTid(tid)
    if (!rec || rec.status === 'revoked') return { ok: false, status: 403, code: 'revoked' }
    registry.register(tid, conn)
    const nowMs = Date.now()
    await tokenStore.markAwaitingClaude(tid, nowMs)
    await auditSink.write({
      at: nowMs,
      tid,
      uid: null,
      event: 'claim',
      detail: { transport: 'ws' },
    })
    return { ok: true, tid }
  }

  return { router, registry, tokenStore, auditSink, acceptConnection }
}
