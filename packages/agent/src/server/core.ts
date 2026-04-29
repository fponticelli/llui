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
import { tokenHashOf } from './token.js'

const ANONYMOUS_RESOLVER: IdentityResolver = async () => null

/**
 * Options accepted by `createLluiAgentCore`. Strict subset of
 * `ServerOptions` — everything needed to build the router, registry,
 * and accept-connection primitive. The Node factory adds WebSocket
 * upgrade wiring on top.
 */
export type CoreOptions = {
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
  /**
   * How long, in milliseconds, a token's record stays in
   * `pending-resume` after the WS pairing closes. During this window
   * the same browser can reconnect with the same bearer token and
   * the WS re-pairs without going through the rotate-on-resume path
   * (`/resume/claim`). The agent's existing token stays valid the
   * whole time, so brief network drops, page reloads, and quick
   * server restarts don't invalidate the agent's session.
   *
   * After the window, LAP calls report `X-LLui-Reconnect: expired`
   * and the record becomes resume-claimable (rotation required).
   * Set to `0` to opt out — the WS close immediately drops the
   * record and any reconnect must go through `/resume/claim`.
   *
   * Default: 60 seconds — long enough for laptop sleep, brief Wi-Fi
   * flicker, and a server restart; short enough that a deliberately-
   * closed tab doesn't keep the record alive forever.
   */
  pendingResumeGraceMs?: number
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
export function createLluiAgentCore(opts: CoreOptions = {}): AgentCoreHandle {
  const tokenStore = opts.tokenStore ?? new InMemoryTokenStore()
  const identityResolver = opts.identityResolver ?? ANONYMOUS_RESOLVER
  const auditSink = opts.auditSink ?? consoleAuditSink
  const rateLimiter = opts.rateLimiter ?? defaultRateLimiter({ perBucket: '30/minute' })
  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'
  const pendingResumeGraceMs = opts.pendingResumeGraceMs ?? 60_000

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
    tokenStore,
    identityResolver,
    auditSink,
    lapBasePath,
  })

  const lapRouter = createLapRouter(
    {
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
    // Same hash-lookup path as the LAP HTTP routes — keeps the auth
    // story uniform across HTTP and WS surfaces.
    const hash = await tokenHashOf(token)
    if (!hash) return { ok: false, status: 401, code: 'auth-failed' }
    const rec = await tokenStore.findByTokenHash(hash)
    if (!rec) return { ok: false, status: 401, code: 'auth-failed' }
    if (rec.expiresAt <= Date.now()) return { ok: false, status: 401, code: 'auth-failed' }
    if (rec.status === 'revoked') return { ok: false, status: 403, code: 'revoked' }
    // Reject `pending-resume` records past their grace window — the
    // agent has to go through `/resume/claim` (which rotates the
    // bearer) for those, since the long-gap path can't assume the
    // previous bearer wasn't leaked.
    if (
      rec.status === 'pending-resume' &&
      rec.pendingResumeUntil !== null &&
      rec.pendingResumeUntil <= Date.now()
    ) {
      return { ok: false, status: 401, code: 'auth-failed' }
    }
    const tid = rec.tid
    const isRepair = rec.status === 'pending-resume'
    registry.register(tid, conn)
    const nowMs = Date.now()
    if (isRepair) {
      // Same browser came back within the grace window — re-pair
      // without a token rotation. Claude was already bound; its
      // existing token stays valid and the next LAP call sees a live
      // pairing again. Restore the original label so audit context
      // doesn't show a "reconnected" placeholder bouncing in and out.
      await tokenStore.markActive(tid, rec.label ?? '(reconnected)', nowMs)
    } else {
      await tokenStore.markAwaitingClaude(tid, nowMs)
    }
    // Hook the close: when the WS drops, transition the record to
    // `pending-resume` with a TTL so the next reconnect within the
    // grace window can re-pair without rotating the token. After
    // grace, LAP calls return `X-LLui-Reconnect: expired` and the
    // agent must call `/resume/claim` to start fresh. The token-
    // store guards the transition so `revoke`/`expired` don't get
    // lifted back into a grace window.
    if (pendingResumeGraceMs > 0) {
      registry.onClose(tid, () => {
        void tokenStore.markPendingResume(tid, Date.now() + pendingResumeGraceMs)
      })
    }
    await auditSink.write({
      at: nowMs,
      tid,
      uid: null,
      event: 'claim',
      detail: { transport: 'ws', repair: isRepair },
    })
    return { ok: true, tid }
  }

  return { router, registry, tokenStore, auditSink, acceptConnection }
}
