import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpSessionMap } from './session-map.js'
import { createAgentMcpServer } from './server.js'
import type { TokenStore } from '../token-store.js'
import type { RateLimiter } from '../rate-limit.js'
import { clientIpOf } from '../client-ip.js'
import type { AuditSink } from '../audit.js'
import type { AuditEvent } from '../../protocol.js'
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
   * How many sessions ONE identity (one `tid`) may hold at a time.
   * Reaching it evicts that identity's own least-recently-used session
   * rather than refusing the new one.
   *
   * This is the anonymous quota's dual, and it matters for the same
   * reason: an authenticated session is deliberately never evicted for
   * an anonymous caller, so without this cap a single VALID bearer
   * presented `maxSessions` times fills the endpoint with sessions
   * nothing can reclaim, and every later caller — including that
   * bearer's own owner — gets a 503 until an idle TTL lapses. It needs
   * no attacker: a client that crash-reconnects that often inside
   * `idleTtlMs` reaches it by accident. Sessions count against their
   * identity whether the bearer arrived at `initialize` or was bound
   * later by `connect_session`. Default: 8.
   */
  maxSessionsPerIdentity?: number
  /**
   * ABSOLUTE lifetime, in ms, of a provisional session (no bearer, no
   * `connect_session`) — measured from its `initialize`, never from its
   * last request. This is the ONLY clock a provisional session runs on.
   *
   * There used to be an idle TTL beside it (`unauthenticatedTtlMs`, 60
   * s), and it was the wrong shape twice over. It bounded nothing: the
   * memory bound is `maxUnauthenticatedSessions`, which caps how many
   * provisional sessions exist at all, and the sweep ran on every route
   * call regardless of pressure — so it reclaimed sessions on an empty
   * endpoint, buying no memory. Meanwhile it broke the pairing flow the
   * docs describe, which is HUMAN-paced: the client initializes at
   * startup and the session then idles while a person opens the app,
   * clicks "Connect with Claude", copies the snippet and pastes it. The
   * MCP SDK client does not re-initialize on a 404, so that reclaim
   * surfaced as a thrown error, not a reconnect. An idle provisional
   * session is now reclaimed only when the quota is CONTENDED, by the
   * LRU eviction in `reserveSlot` — which is the pressure the bound
   * exists for.
   *
   * What this clock is for is the case the quota does not cover:
   * traffic. An idle window is refreshable for the price of an empty
   * POST, so pinging under it held a quota slot forever. Nothing
   * refreshes this one, so a session that has not authenticated by the
   * deadline is closed however much traffic it carries. An
   * authenticated session is NOT capped this way; it moves to
   * `idleTtlMs`.
   *
   * Default: 30 min — the pairing window has to fit a person, and a
   * provisional session holds no bearer, so the only thing this bounds
   * is one slot of a quota that is already bounded.
   */
  unauthenticatedMaxLifetimeMs?: number
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
  /**
   * Bucket key for the caller of a session-allocating request. Defaults
   * to `clientIpOf` with NO proxy trust — one shared bucket for every
   * caller whose address this process cannot establish. It deliberately
   * does NOT read `X-Forwarded-For` by default: that is a caller-written
   * header on a direct-to-origin deployment, and one bucket per
   * caller-chosen value throttles nobody. `createLluiAgentCore` builds
   * the real resolver from `trustProxy`/`clientAddress` and both hosts
   * pass it in, so this surface and `/agent/mint` key identically.
   */
  clientIp?: (req: Request) => string
  /**
   * Audit sink for REFUSALS on the session-allocating path — the 401,
   * the 429 and the capacity 503. `/agent/mint` audits the same class
   * (`mint.ts`), and this surface is the one an unauthenticated caller
   * can reach, so leaving its refusals untraced is the wrong asymmetry.
   * Successful traffic is audited downstream by the LAP gate, which
   * every tool handler goes through.
   *
   * A capacity refusal is written as `rate-limited` with
   * `detail.reason = 'session-capacity'`: it IS a resource refusal, and
   * `AuditEvent` lives in `protocol.ts`, which this change deliberately
   * does not touch.
   */
  auditSink?: AuditSink
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
  /**
   * Sessions currently occupying a slot: retained (transport +
   * `McpServer` pair) PLUS reserved-but-not-yet-registered ones. The
   * in-flight half has to be in this number or it is not the number the
   * quota is enforced on — a concurrent burst is exactly the case where
   * the two differ.
   */
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
const DEFAULT_MAX_SESSIONS_PER_IDENTITY = 8
const DEFAULT_UNAUTHENTICATED_MAX_LIFETIME_MS = 30 * 60_000
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
  /**
   * When the session was allocated. `lastSeenAt` alone is refreshable by
   * the caller, so it can only express an IDLE bound; the absolute
   * provisional lifetime is measured from here.
   */
  createdAt: number
  admitted: boolean
  /**
   * The `tid` this session's admission bearer verified to, when it
   * arrived with one. A session that authenticates LATER carries its tid
   * in `McpSessionMap` instead, so the per-identity cap has to read both
   * — otherwise the cap covers only one of the two doors to it.
   */
  identity: string | null
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
 *   3. Sessions are swept — an AUTHENTICATED one on an idle timestamp
 *      (which is what releases its plaintext bearer), a PROVISIONAL one
 *      on an absolute lifetime from `initialize`. Either way a client
 *      that vanished without the DELETE the protocol assumes is
 *      reclaimed with no help from it.
 *   4. Provisional sessions have their own quota inside `maxSessions`,
 *      LRU-evicted, so anonymous churn can never displace an
 *      authenticated session. With no slot to free, `initialize` 503s.
 *
 * (3) is the bound on a session's LIFETIME; (4) is the bound on the
 * endpoint's MEMORY, and it is the one that has to be tight. An idle
 * provisional session is therefore left alone until the quota is
 * actually contended — reclaiming it below the quota costs the
 * human-paced pairing flow and buys nothing back.
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
  const unauthenticatedMaxLifetimeMs =
    opts.unauthenticatedMaxLifetimeMs ?? DEFAULT_UNAUTHENTICATED_MAX_LIFETIME_MS
  const idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
  const maxSessionsPerIdentity = Math.max(
    1,
    opts.maxSessionsPerIdentity ?? DEFAULT_MAX_SESSIONS_PER_IDENTITY,
  )
  const clientIp = deps.clientIp ?? ((req: Request) => clientIpOf(req))

  // The per-identity cap has two doors, and this is the second: a
  // session that arrives anonymously and binds a token through
  // `connect_session` leaves the anonymous quota the moment it
  // authenticates, so nothing else would ever count it. The bind
  // callback applies the cap at that instant — the request path cannot,
  // because the tool result is written to the response stream after
  // `handleRequest` has already returned.
  const sessionMap = new McpSessionMap((mcpSessionId, session) => {
    enforceIdentityCap(session.tid, 0, mcpSessionId)
  })

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
   * The `tid` a session belongs to, from either door: verified at
   * admission, or bound later by `connect_session`.
   */
  const identityOf = (id: string, entry: McpSessionEntry): string | null =>
    sessionMap.get(id)?.tid ?? entry.identity

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

  /**
   * Drop every session past its deadline. The two halves are on
   * deliberately different clocks:
   *
   *   - AUTHENTICATED: idle. `idleTtlMs` since the last request. This
   *     one is time-driven rather than pressure-driven on purpose — it
   *     is what releases the session's plaintext bearer from
   *     `McpSessionMap`, and holding that past the session's usefulness
   *     is a security cost, not a memory one.
   *   - PROVISIONAL: absolute, from `initialize`. Deliberately NOT
   *     idle-swept: how many provisional sessions may exist is already
   *     capped by `maxUnauthenticatedSessions`, so reclaiming an idle
   *     one below that quota frees nothing that was scarce and breaks
   *     the human-paced pairing flow (see
   *     `unauthenticatedMaxLifetimeMs`). Under quota pressure the LRU
   *     eviction in `reserveSlot` reclaims the stalest one, which is
   *     the same session an idle sweep would have picked.
   */
  const sweep = (nowMs: number): void => {
    for (const [id, entry] of sessions) {
      const deadline = isAuthenticated(id, entry)
        ? entry.lastSeenAt + idleTtlMs
        : entry.createdAt + unauthenticatedMaxLifetimeMs
      if (nowMs >= deadline) dropSession(id)
    }
  }

  /**
   * Sessions reserved but not yet registered. A reservation is taken
   * SYNCHRONOUSLY, before the first `await`, and released in a `finally`
   * on every exit path.
   *
   * This is the whole point of the counters. Registration cannot happen
   * until the transport has assigned a session id, which is two `await`s
   * later (`connect`, then `handleRequest`), and both hosts run the
   * router inside a per-request async handler — so N overlapping
   * initializes are N `route` calls suspended between the check and the
   * `sessions.set`. Reading `sessions.size` at the check point therefore
   * measured a map that every concurrent caller saw as empty, and the
   * ceiling held only for callers that politely awaited each other
   * (measured: `maxSessions: 8`, 500 concurrent initializes, 500 live
   * sessions). A reservation is counted by the quota and by
   * `liveSessionCount`, and is deliberately NOT in `sessions`: it has no
   * id yet, nothing can be routed to it, and neither the sweep nor the
   * LRU eviction can reclaim a slot that is still being built.
   */
  let reserved = 0
  let reservedAnonymous = 0

  /** Sessions retained or under construction — the number the bound is on. */
  const occupancy = (): number => sessions.size + reserved

  /**
   * Make room for one more session, or report that there is none to be
   * had. Only provisional REGISTERED sessions are evictable — evicting
   * an authenticated one on behalf of an anonymous caller would turn the
   * bound itself into the attack, and evicting an in-flight one would
   * free a slot whose allocation is still running.
   *
   * This LRU is also the ONLY thing that reclaims an idle provisional
   * session, which is why it is expressed as pressure rather than as a
   * clock: it fires exactly when a slot is scarce, and the session it
   * picks — the least recently seen — is the one an idle sweep would
   * have picked anyway. Returns false when
   * nothing can be freed; the caller then refuses rather than
   * allocating. Synchronous by construction: an `await` anywhere in here
   * would reopen the race it exists to close.
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
      const anonymousHeld = evictable + reservedAnonymous
      const overQuota =
        occupancy() >= maxSessions || (!admitted && anonymousHeld >= maxUnauthenticated)
      if (!overQuota) {
        reserved++
        if (!admitted) reservedAnonymous++
        return true
      }
      if (lruId === null) return false
      dropSession(lruId)
    }
  }

  /**
   * Release a reservation. Called exactly once per successful
   * `reserveSlot`, from the `finally` that wraps everything the
   * reservation covers — success, a `sessionId`-less POST, or a throw.
   */
  const releaseSlot = (admitted: boolean): void => {
    reserved--
    if (!admitted) reservedAnonymous--
  }

  /**
   * Bring `tid` under the per-identity cap by dropping ITS OWN
   * least-recently-used sessions. Self-eviction, not refusal: a client
   * reconnecting after a crash should replace its own stale session, not
   * be told the endpoint is full of itself.
   *
   * `headroom` is how many slots this identity should be left with — `1`
   * before allocating another session, `0` when merely confirming the
   * existing ones are within the cap. `keepId` is the session the
   * current request is on; it must survive even when an injected clock
   * gives it the same `lastSeenAt` as an older one.
   */
  const enforceIdentityCap = (tid: string, headroom: number, keepId: string | null): void => {
    for (;;) {
      let held = 0
      let lruId: string | null = null
      let lruAt = Number.POSITIVE_INFINITY
      for (const [id, entry] of sessions) {
        if (identityOf(id, entry) !== tid) continue
        held++
        if (id === keepId) continue
        if (entry.lastSeenAt < lruAt) {
          lruAt = entry.lastSeenAt
          lruId = id
        }
      }
      if (held + headroom <= maxSessionsPerIdentity) return
      if (lruId === null) return
      dropSession(lruId)
    }
  }

  /**
   * Record a refusal. Fire-and-forget: an audit write must never be the
   * reason a refusal is slower to leave than the request it refuses.
   */
  const auditRefusal = (event: AuditEvent, at: number, detail: object): void => {
    void deps.auditSink?.write({ at, tid: null, uid: null, event, detail })
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
    const rl = await deps.rateLimiter.check(clientIp(req), 'identity')
    if (!rl.allowed) {
      auditRefusal('rate-limited', nowMs, { endpoint: mcpPath })
      return jsonResponse({ error: { code: 'rate-limited', retryAfterMs: rl.retryAfterMs } }, 429, {
        'retry-after': String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
      })
    }

    // A bearer is NOT required here — `connect_session` is this
    // protocol's auth point and the endpoint has to be reachable to
    // reach it. But a bearer that IS presented has to be one of ours;
    // handing an unknown-token caller a session anyway would make the
    // header decorative. Refused before anything is allocated.
    const presentedBearer = req.headers.get('authorization')?.startsWith('Bearer ') ?? false
    let admittedTid: string | null = null
    if (presentedBearer) {
      const auth = await verifyAndReadTid(req, deps.tokenStore, {
        now: nowMs,
        slidingTtlMs: deps.slidingTtlMs,
      })
      if (!auth.ok) {
        auditRefusal('auth-failed', nowMs, { endpoint: mcpPath, code: auth.code })
        return jsonResponse({ error: { code: auth.code } }, auth.status)
      }
      admittedTid = auth.tid
    }

    // One identity cannot hold the endpoint: make room among ITS OWN
    // sessions before asking for a slot, so a bearer at its cap replaces
    // its stale session instead of adding one nothing can evict.
    if (admittedTid !== null) enforceIdentityCap(admittedTid, 1, null)

    // A verified bearer is an ADMISSION credential, not a binding: the
    // session sits outside the anonymous quota, but every tool still
    // refuses until `connect_session` binds a token to it.
    if (!reserveSlot(presentedBearer)) {
      auditRefusal('rate-limited', nowMs, { endpoint: mcpPath, reason: 'session-capacity' })
      return jsonResponse({ error: { code: 'session-capacity' } }, 503, { 'retry-after': '30' })
    }

    // From here the reservation is live and MUST be handed back exactly
    // once, whichever way this returns — so EVERYTHING it covers is
    // inside the `try`, constructors included. They used to sit above
    // it, on the reasoning that none of them can throw because none of
    // them reads request data; that made the `finally`'s "every exit
    // path" claim false for any future line added there, and a lost
    // reservation is permanent (nothing sweeps a slot with no id).
    //
    // These two are the CATCH's cleanup handles — the body works with
    // the consts, which is also what the closures below have to capture.
    let transport: WebStandardStreamableHTTPServerTransport | null = null
    let mcpServer: McpServer | null = null
    try {
      const t = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessionclosed: (id) => {
          dropSession(id)
        },
      })
      transport = t

      t.onclose = () => {
        const id = t.sessionId
        if (id) dropSession(id)
      }

      const server = createAgentMcpServer({
        coreRouter: deps.coreRouter,
        tokenStore: deps.tokenStore,
        sessionMap,
        getSessionId: () => t.sessionId,
        lapBasePath,
        serverName,
        serverVersion,
        connectDescription,
        slidingTtlMs: deps.slidingTtlMs,
      })
      mcpServer = server

      await server.connect(t)
      const res = await t.handleRequest(req)
      // Register AFTER the transport has assigned its session ID. The
      // SDK's `onsessioninitialized` hook would fire earlier, but
      // reaching it means forward-referencing `mcpServer` from the
      // transport's own constructor; the id is set synchronously during
      // `handleRequest`, so this reads it at the first point both halves
      // exist. A POST that was NOT an initialize leaves `sessionId`
      // undefined and therefore retains nothing. The reservation becomes
      // the registered session here — there is no `await` between the
      // `set` and the release, so the slot is never momentarily free.
      const id = t.sessionId
      if (id) {
        sessions.set(id, {
          transport: t,
          server,
          lastSeenAt: nowMs,
          createdAt: nowMs,
          admitted: presentedBearer,
          identity: admittedTid,
        })
      } else {
        await server.close().catch(() => {})
      }
      return res
    } catch (err) {
      // A failed handshake must not strand the pair it allocated: the
      // reservation is about to be released, so without this the
      // transport and its `McpServer` would outlive every accounting of
      // them. Closing the server closes its transport; a throw before
      // the server exists leaves the transport to close on its own.
      if (mcpServer) await mcpServer.close().catch(() => {})
      else if (transport) await transport.close().catch(() => {})
      throw err
    } finally {
      releaseSlot(presentedBearer)
    }
  }

  return Object.assign(route, {
    liveSessionCount: occupancy,
    hasBoundToken: (mcpSessionId: string) => sessionMap.get(mcpSessionId) !== null,
  })
}
