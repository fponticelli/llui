import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpSessionMap } from './session-map.js'
import { createAgentMcpServer } from './server.js'
import type { TokenStore } from '../token-store.js'
import type { RateLimiter } from '../rate-limit.js'
import { clientIpOf } from '../client-ip.js'
import { verifyAndReadTid } from '../lap/gate.js'

export type McpRouterOptions = {
  /** Path prefix for the MCP endpoint. Default: '/agent/mcp'. */
  path?: string
  /** MCP server name shown in Claude Desktop. Default: 'agent'. */
  serverName?: string
  /** MCP server version string. Default: '1'. */
  serverVersion?: string
  /** Description for the connect_session tool. */
  connectDescription?: string
  /**
   * Hard ceiling on concurrently-retained MCP sessions. Each session
   * costs a transport plus a fully-registered `McpServer` (16 tools with
   * their Zod schemas — ~113 KB measured), so this is the number that
   * bounds the endpoint's memory. An `initialize` that cannot free a
   * slot is refused with 503 rather than served a smaller allocation.
   * Default: 64.
   */
  maxSessions?: number
  /**
   * How many of `maxSessions` may be held by sessions that arrived
   * WITHOUT a bearer and have not yet completed `connect_session`. The
   * endpoint is deliberately reachable without a bearer — that is where
   * `connect_session` happens — so this is the quota an anonymous caller
   * can reach: within it a new `initialize` evicts the least-recently-
   * used provisional session, and it can never displace an
   * authenticated one. Default: 16.
   */
  maxUnauthenticatedSessions?: number
  /**
   * Idle window, in ms, after which a provisional session (no bearer, no
   * `connect_session`) is closed and swept. Short by design — a real
   * client connects within a turn or two. Default: 60 s.
   */
  unauthenticatedTtlMs?: number
  /**
   * Idle window, in ms, after which an AUTHENTICATED session is closed
   * and swept. Bounds a session whose client crashed or dropped without
   * sending the DELETE the protocol relies on, and is what releases that
   * session's plaintext bearer from `McpSessionMap`. Default: 30 min.
   */
  idleTtlMs?: number
}

export type McpRouterDeps = {
  coreRouter: (req: Request) => Promise<Response | null>
  tokenStore: TokenStore
  lapBasePath: string
  /**
   * Rate limiter for the session-ALLOCATING path (a POST with no
   * `mcp-session-id`). Required, not optional: this router runs ahead of
   * `core.router`, so a limiter it forgets to consult is a limiter that
   * never sees the endpoint at all — which is exactly how the MCP
   * surface stayed unthrottled while every LAP route was covered.
   * Requests on an ESTABLISHED session are not checked here; their tool
   * handlers reach LAP through `coreRouter`, which gates them on the
   * per-token bucket.
   */
  rateLimiter: RateLimiter
  /** Sliding (inactivity) TTL in ms; folded into the connect verify. */
  slidingTtlMs?: number
  /** Wall clock in ms; injectable for tests. */
  now?: () => number
}

/**
 * The MCP router plus the two read-only diagnostics that make its
 * resource bound assertable from outside. Assignable anywhere a plain
 * `(req) => Promise<Response | null>` is expected.
 */
export type McpRouter = ((req: Request) => Promise<Response | null>) & {
  /** Sessions currently retained (transport + `McpServer` pair). */
  liveSessionCount(): number
  /**
   * True when `mcpSessionId` still holds a bearer token bound by
   * `connect_session`. Goes false the moment the session is reclaimed —
   * not retaining those plaintext tokens past a session's usefulness is
   * half of what the session bound is for.
   */
  hasBoundToken(mcpSessionId: string): boolean
}

const DEFAULT_CONNECT_DESCRIPTION =
  'Connect to the app. Call once per chat when the user pastes a token from the app connect panel. ' +
  'Returns {state, actions, description, context} so you can start acting immediately — ' +
  'no separate observe call needed on the first turn.'

const DEFAULT_MAX_SESSIONS = 64
const DEFAULT_MAX_UNAUTHENTICATED_SESSIONS = 16
const DEFAULT_UNAUTHENTICATED_TTL_MS = 60_000
const DEFAULT_IDLE_TTL_MS = 30 * 60_000

/**
 * One retained MCP session.
 *
 * `lastSeenAt` is the whole reason this is a record rather than a bare
 * transport: with no timestamp there was nothing to sweep on, so a
 * client that crashed mid-session pinned its allocation until the
 * process restarted. `admitted` records that the `initialize` carried a
 * VERIFIED bearer — such a session sits outside the anonymous quota even
 * before `connect_session` binds a token to it.
 */
type McpSessionEntry = {
  transport: WebStandardStreamableHTTPServerTransport
  server: McpServer
  lastSeenAt: number
  admitted: boolean
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * Build a WHATWG-compatible MCP router that mounts at `opts.path`.
 * Integrates into the agent core's fetch-style router by prepending
 * this function's result in the request chain.
 *
 * Uses `WebStandardStreamableHTTPServerTransport` (WHATWG, runtime-
 * neutral) rather than the Node-only `StreamableHTTPServerTransport`.
 *
 * ── RESOURCE DISCIPLINE ────────────────────────────────────────────
 * A POST without an `mcp-session-id` allocates a transport AND a full
 * `McpServer`. That is deliberately reachable without a bearer —
 * `connect_session` is where this protocol authenticates — so the
 * ALLOCATION is what has to be bounded, in four parts that all have to
 * hold together:
 *
 *   1. Every allocation goes through the rate limiter, keyed by client
 *      IP (this router runs BEFORE `core.router`, so nothing else will).
 *   2. A bearer that IS presented must verify, or the request is refused
 *      401 having allocated nothing. Fail closed: the no-bearer path
 *      stays open, the invalid-bearer path does not.
 *   3. Sessions carry an idle timestamp and are swept — a short TTL
 *      while provisional, a long one once authenticated. The sweep is
 *      what reclaims a session whose client vanished without the DELETE
 *      the protocol assumes, and what releases its plaintext bearer.
 *   4. Provisional sessions have their own quota inside `maxSessions`,
 *      LRU-evicted, so anonymous churn can never displace an
 *      authenticated session. With no slot to free, `initialize` 503s.
 */
export function createMcpRouter(deps: McpRouterDeps, opts: McpRouterOptions = {}): McpRouter {
  const mcpPath = opts.path ?? '/agent/mcp'
  const serverName = opts.serverName ?? 'agent'
  const serverVersion = opts.serverVersion ?? '1'
  const connectDescription = opts.connectDescription ?? DEFAULT_CONNECT_DESCRIPTION
  const lapBasePath = deps.lapBasePath
  const now = deps.now ?? (() => Date.now())
  const maxSessions = Math.max(1, opts.maxSessions ?? DEFAULT_MAX_SESSIONS)
  const maxUnauthenticated = Math.min(
    Math.max(1, opts.maxUnauthenticatedSessions ?? DEFAULT_MAX_UNAUTHENTICATED_SESSIONS),
    maxSessions,
  )
  const unauthenticatedTtlMs = opts.unauthenticatedTtlMs ?? DEFAULT_UNAUTHENTICATED_TTL_MS
  const idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS

  const sessionMap = new McpSessionMap()

  // mcp-session-id → retained session. Populated on initialize; dropped
  // by DELETE, by transport close, or by the idle sweep below.
  const sessions = new Map<string, McpSessionEntry>()

  /**
   * A session is authenticated once it either arrived with a verified
   * bearer or bound one through `connect_session`. Authenticated
   * sessions are neither evictable nor on the short TTL.
   */
  const isAuthenticated = (id: string, entry: McpSessionEntry): boolean =>
    entry.admitted || sessionMap.get(id) !== null

  /**
   * Release a session: close the MCP server (which closes its transport)
   * and drop BOTH maps. Every teardown path funnels through here, so the
   * bearer held in `McpSessionMap` cannot outlive the transport that
   * justified holding it.
   */
  const dropSession = (id: string): void => {
    const entry = sessions.get(id)
    sessions.delete(id)
    sessionMap.delete(id)
    if (!entry) return
    // Closing the server closes its transport, whose `onclose` re-enters
    // here; the delete above already ran, so the re-entry is a no-op
    // rather than a loop.
    void entry.server.close().catch(() => {
      // Best-effort — a transport already tearing down may reject.
    })
  }

  /** Drop every session idle past the TTL its authentication earns it. */
  const sweep = (nowMs: number): void => {
    for (const [id, entry] of sessions) {
      const ttl = isAuthenticated(id, entry) ? idleTtlMs : unauthenticatedTtlMs
      if (nowMs - entry.lastSeenAt >= ttl) dropSession(id)
    }
  }

  /**
   * Make room for one more session, or report that there is none to be
   * had. Only provisional sessions are evictable — evicting an
   * authenticated one on behalf of an anonymous caller would turn the
   * bound itself into the attack. Returns false when every slot is held
   * by an authenticated session; the caller then refuses rather than
   * allocating.
   */
  const reserveSlot = (admitted: boolean): boolean => {
    for (;;) {
      let evictable = 0
      let lruId: string | null = null
      let lruAt = Number.POSITIVE_INFINITY
      for (const [id, entry] of sessions) {
        if (isAuthenticated(id, entry)) continue
        evictable++
        if (entry.lastSeenAt < lruAt) {
          lruAt = entry.lastSeenAt
          lruId = id
        }
      }
      const overQuota =
        sessions.size >= maxSessions || (!admitted && evictable >= maxUnauthenticated)
      if (!overQuota) return true
      if (lruId === null) return false
      dropSession(lruId)
    }
  }

  const route = async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url)
    if (!url.pathname.startsWith(mcpPath)) return null

    const nowMs = now()
    sweep(nowMs)

    const sessionHeader = req.headers.get('mcp-session-id')

    // ── Existing session ───────────────────────────────────────────
    if (sessionHeader) {
      const entry = sessions.get(sessionHeader)
      if (!entry) {
        // Unknown (or already-reclaimed) session ID — reject so the
        // client can reinitialize.
        return jsonResponse({ error: 'session not found' }, 404)
      }
      // Traffic on a session is what keeps it out of the sweep.
      entry.lastSeenAt = nowMs
      return entry.transport.handleRequest(req)
    }

    // ── New session (no mcp-session-id) ───────────────────────────
    // Only POST (initialize) should arrive without a session ID.
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'mcp-session-id required' }, 400)
    }

    // Throttle the allocation FIRST, keyed by client IP — the only
    // stable discriminator available before `connect_session` runs, and
    // the cheapest of the three gates, so it also caps how often the
    // token hash below is computed.
    const rl = await deps.rateLimiter.check(clientIpOf(req), 'identity')
    if (!rl.allowed) {
      return jsonResponse({ error: { code: 'rate-limited', retryAfterMs: rl.retryAfterMs } }, 429)
    }

    // A bearer is NOT required here — `connect_session` is this
    // protocol's auth point and the endpoint has to be reachable to
    // reach it. But a bearer that IS presented has to be one of ours;
    // handing an unknown-token caller a session anyway would make the
    // header decorative. Refused before anything is allocated.
    const presentedBearer = req.headers.get('authorization')?.startsWith('Bearer ') ?? false
    if (presentedBearer) {
      const auth = await verifyAndReadTid(req, deps.tokenStore, {
        now: nowMs,
        slidingTtlMs: deps.slidingTtlMs,
      })
      if (!auth.ok) return jsonResponse({ error: { code: auth.code } }, auth.status)
    }

    // A verified bearer is an ADMISSION credential, not a binding: the
    // session sits outside the anonymous quota, but every tool still
    // refuses until `connect_session` binds a token to it.
    if (!reserveSlot(presentedBearer)) {
      return jsonResponse({ error: { code: 'session-capacity' } }, 503, { 'retry-after': '30' })
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessionclosed: (id) => {
        dropSession(id)
      },
    })

    transport.onclose = () => {
      const id = transport.sessionId
      if (id) dropSession(id)
    }

    const mcpServer = createAgentMcpServer({
      coreRouter: deps.coreRouter,
      tokenStore: deps.tokenStore,
      sessionMap,
      getSessionId: () => transport.sessionId,
      lapBasePath,
      serverName,
      serverVersion,
      connectDescription,
      slidingTtlMs: deps.slidingTtlMs,
    })

    await mcpServer.connect(transport)
    const res = await transport.handleRequest(req)
    // Register AFTER the transport has assigned its session ID. The
    // SDK's `onsessioninitialized` hook would fire earlier, but reaching
    // it means forward-referencing `mcpServer` from the transport's own
    // constructor; the id is set synchronously during `handleRequest`,
    // so this reads it at the first point both halves exist. A POST that
    // was NOT an initialize leaves `sessionId` undefined and therefore
    // retains nothing.
    const id = transport.sessionId
    if (id)
      sessions.set(id, {
        transport,
        server: mcpServer,
        lastSeenAt: nowMs,
        admitted: presentedBearer,
      })
    else await mcpServer.close().catch(() => {})
    return res
  }

  return Object.assign(route, {
    liveSessionCount: () => sessions.size,
    hasBoundToken: (mcpSessionId: string) => sessionMap.get(mcpSessionId) !== null,
  })
}
