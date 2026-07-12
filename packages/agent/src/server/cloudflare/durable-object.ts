/**
 * Durable Object helper for hosting the agent pairing + LAP surface
 * on Cloudflare Workers. One DO instance owns one `tid` — its
 * in-memory `PairingRegistry` survives across Worker isolate
 * invocations because the DO IS persistent.
 *
 * This file exports a class designed to be composed into a real
 * Durable Object in the user's Worker project. We intentionally
 * don't subclass `DurableObject` from `@cloudflare/workers-types` —
 * that dependency belongs to the user's project, not ours. Users
 * wrap an instance of `AgentPairingDurableObject` in their own DO
 * class and forward `fetch` to it.
 *
 * Usage in a Worker project:
 *
 * ```ts
 * // worker.ts
 * import { AgentPairingDurableObject } from '@llui/agent/server/cloudflare'
 *
 * export class AgentDO {
 *   private agent: AgentPairingDurableObject
 *   constructor(_state: DurableObjectState, env: Env) {
 *     // Tokens are opaque (see token.ts) — no signing key needed.
 *     this.agent = new AgentPairingDurableObject({})
 *   }
 *   fetch(req: Request): Promise<Response> {
 *     return this.agent.fetch(req)
 *   }
 * }
 *
 * export default {
 *   async fetch(req: Request, env: Env): Promise<Response> {
 *     // routeToAgentDO now takes a `resolveTid` callback — typically
 *     // a fetch to the root DO's token-resolution endpoint, or a
 *     // const stub when you don't shard by tid.
 *     return routeToAgentDO(req, env.AGENT_DO, async (token) => {
 *       const stub = env.AGENT_DO.get(env.AGENT_DO.idFromName('__root'))
 *       // Send the bearer in a header (and POST), never the query
 *       // string — a token in the URL lands in Workers request logs and
 *       // traces. `__resolve` must be reachable ONLY via this internal
 *       // DO stub, never wired to a public route.
 *       const r = await stub.fetch('http://internal/__resolve', {
 *         method: 'POST',
 *         headers: { authorization: `Bearer ${token}` },
 *       })
 *       const body = (await r.json()) as { tid: string | null }
 *       return body.tid
 *     })
 *   },
 * }
 * ```
 *
 * See `./worker.ts` for `routeToAgentDO` and the full wiring.
 */
import type { CoreOptions, AgentCoreHandle } from '../core.js'
import { createLluiAgentCore } from '../core.js'
import { handleCloudflareUpgrade } from '../web/upgrade.js'
import type { McpRouterOptions } from '../mcp/router.js'
import { createMcpRouter } from '../mcp/router.js'
import { tokenHashOf } from '../token.js'

export type DurableObjectOptions = Omit<CoreOptions, 'registry'> & {
  /**
   * Enable the server-side MCP endpoint at `/agent/mcp` (or a custom
   * path). Pass `true` for all defaults, or an `McpRouterOptions`
   * object to customise path, server name, and connect_session
   * description.
   */
  mcp?: boolean | McpRouterOptions
}

/**
 * Agent server instance scoped to a single Durable Object. All
 * pairing state lives in the DO's in-process memory — which is safe
 * here because the DO is a persistent addressable entity, not a
 * one-shot Worker isolate.
 *
 * Users instantiate one of these inside their DO class's constructor
 * and delegate `fetch` to `agent.fetch(req)`. LAP HTTP routes,
 * WebSocket upgrades, the optional MCP endpoint, and the internal
 * `/__resolve` token-resolution endpoint all flow through this single
 * entry.
 *
 * ── SHARDED-DEPLOYMENT REQUIREMENT ────────────────────────────────
 * `routeToAgentDO` shards by `tid`: the root DO (`__root`) owns
 * `/agent/mint` and friends, while LAP/WS calls route to a per-tid DO.
 * Because each DO defaults to its own `InMemoryTokenStore`, a token
 * minted on the root DO is INVISIBLE to a per-tid DO — `/__resolve`
 * (and every LAP auth check) would 401. So the sharded recipe REQUIRES
 * a single shared external `TokenStore` (a KV/D1-backed implementation
 * of the `TokenStore` interface) injected into EVERY DO:
 *
 * ```ts
 * const tokenStore = new KvTokenStore(env.AGENT_KV) // your adapter
 * this.agent = new AgentPairingDurableObject({ tokenStore })
 * ```
 *
 * The only no-shared-store option is to NOT shard — route everything
 * through the root DO by passing `() => Promise.resolve('__root')` as
 * `resolveTid`. Then all state (tokens + pairings) lives in one DO and
 * the default `InMemoryTokenStore` is sufficient, at the cost of a
 * single-DO bottleneck.
 */
export class AgentPairingDurableObject {
  readonly agent: AgentCoreHandle
  private readonly mcpRouter: ((req: Request) => Promise<Response | null>) | null

  constructor(opts: DurableObjectOptions) {
    const { mcp, ...coreOpts } = opts
    this.agent = createLluiAgentCore(coreOpts)
    if (mcp) {
      const mcpOpts = mcp === true ? {} : mcp
      const lapBasePath = coreOpts.lapBasePath ?? '/agent/lap/v1'
      this.mcpRouter = createMcpRouter(
        {
          coreRouter: this.agent.router,
          tokenStore: this.agent.tokenStore,
          lapBasePath,
          slidingTtlMs: this.agent.slidingTtlMs,
        },
        mcpOpts,
      )
    } else {
      this.mcpRouter = null
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // Internal token-resolution endpoint. `routeToAgentDO` posts here on
    // the ROOT DO stub to turn an opaque bearer into its `tid` (the token
    // format is random, not signed, so `tid` can't be recovered from the
    // token alone). This is reachable ONLY via an internal DO stub —
    // `routeToAgentDO` rejects any public `/__*` request — and it never
    // touches pairing state, only the shared token store. For this to
    // resolve tokens minted on the root DO from a per-tid DO, every DO
    // MUST be constructed with the SAME external `tokenStore` (see the
    // class docs); the default per-DO `InMemoryTokenStore` is visible
    // only within its own DO and will 404-resolve cross-DO tokens.
    if (url.pathname === '/__resolve') {
      return this.resolveToken(req)
    }

    // MCP endpoint takes priority when enabled.
    if (this.mcpRouter) {
      const mcpRes = await this.mcpRouter(req)
      if (mcpRes) return mcpRes
    }

    // LAP routes (/agent/lap/v1/*, /agent/*). `router` returns null
    // for non-matching paths so we can fall through to the upgrade.
    const lapRes = await this.agent.router(req)
    if (lapRes) return lapRes

    // WebSocket upgrade — uses `WebSocketPair`, which only exists in
    // Cloudflare Workers.
    if (url.pathname === '/agent/ws') {
      return handleCloudflareUpgrade(req, this.agent)
    }

    return new Response('Not Found', { status: 404 })
  }

  /**
   * Resolve `Authorization: Bearer <token>` to its `tid` via the shared
   * token store. Returns `{ tid: string | null }` — `null` for an unknown
   * / malformed / expired-hash token (uniform, no probe surface). POST
   * only; the bearer travels in the header (never the URL) so it stays
   * out of Workers request logs.
   */
  private async resolveToken(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    const auth = req.headers.get('authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
    if (!token) return Response.json({ tid: null })
    const hash = await tokenHashOf(token)
    if (!hash) return Response.json({ tid: null })
    const rec = await this.agent.tokenStore.findByTokenHash(hash)
    return Response.json({ tid: rec ? rec.tid : null })
  }
}
