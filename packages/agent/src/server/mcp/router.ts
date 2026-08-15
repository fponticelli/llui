import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
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
  /**
   * How many dropped session IDs are remembered as RESURRECTABLE — the
   * bound on the tombstone FIFO behind session resurrection (#149).
   *
   * The endpoint's memory bound is LRU over provisional sessions, and a
   * pairing session is the LRU provisional BY CONSTRUCTION: it is idle
   * precisely because a human is reading the pairing panel. So an
   * unrelated anonymous burst evicts it, `connect_session` 404s, and
   * the MCP SDK cannot recover — 1.29.0 has no 404 case on the POST
   * path and clears `_sessionId` only in `terminateSession()`. Rather
   * than make the pairing un-evictable (which turns a full quota into a
   * denial window — the #102 defect), a dropped id is remembered and
   * the session REBUILT under it on the next request.
   *
   * A tombstone is a string and a timestamp, but it is still state a
   * caller can cause, so it is a FIFO with a hard ceiling: past it the
   * oldest ids are forgotten and answer 404 again. Default:
   * `maxSessions * 4`.
   */
  maxResurrectableSessions?: number
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
   * True while `mcpSessionId` is RETAINED — its transport and
   * `McpServer` still allocated.
   *
   * Since session resurrection (#149) a 404 probe no longer answers
   * this: a dropped id the server still remembers is REBUILT on the
   * next request, which is the whole point. So "was this session
   * evicted" has to be asked directly, and the eviction/quota tests are
   * where it matters — a bound that is only checked through a probe
   * that silently repairs what it is probing checks nothing.
   */
  hasLiveSession(mcpSessionId: string): boolean
  /**
   * True when `mcpSessionId` still holds a bearer token bound by
   * `connect_session`. Goes false the moment the session is reclaimed —
   * not retaining those plaintext tokens past a session's usefulness is
   * half of what the session bound is for.
   */
  hasBoundToken(mcpSessionId: string): boolean
  /**
   * How many dropped ids are currently REMEMBERED as resurrectable —
   * the occupancy of the tombstone FIFO, bounded by
   * `maxResurrectableSessions`.
   *
   * A tombstone is cheap but it is still caller-caused state, so it is
   * bounded, and a bound that cannot be read from outside cannot be
   * asserted. It is also the only window onto the INCREMENTAL
   * reclamation (#188): whether an expired tombstone has been reclaimed
   * yet is invisible through the request surface by design —
   * `resurrectable()` re-checks the deadline at lookup, so an unswept
   * entry answers exactly like a swept one.
   *
   * Counts entries, not live ones: an entry past its deadline that this
   * request's slice has not reached yet is still occupying memory and
   * still occupying a FIFO slot, which is precisely what a caller of
   * this wants to know.
   */
  retainedTombstoneCount(): number
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
/** Tombstones per configured session slot — see `maxResurrectableSessions`. */
const DEFAULT_RESURRECTABLE_PER_SLOT = 4
/**
 * How many tombstones one request reclaims (#188). The tombstone map is
 * already HARD-bounded by `maxResurrectableSessions`; reclamation below
 * that ceiling is opportunistic, so it is paid for in constant-size
 * slices rather than a full scan per request. See `reclaimTombstones`.
 */
const TOMBSTONE_RECLAIM_SLICE = 64

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

/**
 * A session id this server ISSUED and has since dropped.
 *
 * Only the original `createdAt` is kept, and it does two jobs at once:
 * it is the deadline the tombstone itself expires on, and it is what a
 * resurrected session INHERITS. Both matter. Inheriting it is what
 * stops resurrection renewing `unauthenticatedMaxLifetimeMs` — reset
 * the clock and a caller holds a quota slot forever by letting it lapse
 * and replaying the id, which is the refreshable-window defect that
 * absolute lifetime exists to close. And expiring on it means an id
 * stays resurrectable for exactly as long as its session would have
 * been allowed to live, no longer.
 */
type Tombstone = { createdAt: number }

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
 *
 * ── RESURRECTION ───────────────────────────────────────────────────
 * (4) still costs a real user their pairing (#149): under contention
 * the LRU provisional session IS the pairing, because it is idle
 * precisely while a human reads the panel — and the LRU key is
 * caller-refreshable, so an adversary pinging its own sessions makes
 * the victim SELECTABLE rather than incidental. The MCP SDK cannot
 * recover from the resulting 404. So the fix is recoverability, not
 * prevention: an id this server ISSUED and has since dropped is
 * remembered (bounded FIFO, same 30-minute clock) and its session
 * REBUILT under the same id, with the triggering request replayed. The
 * client never learns anything happened.
 *
 * A resurrect is an ALLOCATION and is treated as one — same rate
 * limiter, same fail-closed bearer check, same `reserveSlot`, same
 * 401/429/503 refusals — and what it rebuilds is PROVISIONAL: the
 * bearer binding went with the session, so nothing is escalated (a
 * VALID bearer buys admission on `initialize` and nothing at all here).
 * A DELETE is the one teardown that is NOT remembered: an explicit
 * termination has to stay terminated. What this trades is a hard bound
 * on how many
 * sessions may EXIST (unchanged) for a softer bound on allocation
 * CHURN: replaying N tombstoned ids forces N rate-limited,
 * quota-bounded re-allocations. Under a SUSTAINED full quota a
 * resurrect still 503s; this recovers a burst, not a siege.
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
  const maxResurrectable = Math.max(
    0,
    opts.maxResurrectableSessions ?? maxSessions * DEFAULT_RESURRECTABLE_PER_SLOT,
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
   * Dropped ids that may still be resurrected, oldest first — a `Map`
   * because JS maps iterate in insertion order, which is the FIFO the
   * bound is applied against.
   */
  const tombstones = new Map<string, Tombstone>()

  /**
   * Resurrections in flight, by id. Overlapping requests on ONE session
   * id are ordinary in MCP (the SDK runs a standalone GET stream beside
   * its POSTs), and both would find no session and both would rebuild
   * one: the second `sessions.set` strands the first transport +
   * `McpServer` with nothing accounting for them — a permanent leak
   * inside the very bound that exists to prevent it. The loser of the
   * race waits for the winner and then uses the session it registered.
   */
  const resurrecting = new Map<string, Promise<void>>()

  /**
   * Ids whose teardown is an EXPLICIT client termination (a DELETE), for
   * the duration of that request. Read by `dropSession`, which the SDK
   * re-enters through `onsessionclosed`/`onclose` from inside
   * `handleRequest` — so intent has to be parked somewhere the callback
   * can see it rather than passed as an argument.
   */
  const terminating = new Set<string>()

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
    // Remember the id so a client that has no way to know it is gone can
    // recover (#149) — for every teardown reason EXCEPT one. A DELETE is
    // the client saying "I am done with this id", and `terminating`
    // carries that intent down to here: remembering it would make the
    // protocol's own `terminateSession()` non-durable, since the next
    // request on the id would quietly rebuild the session the client
    // just asked to destroy. Every OTHER reason (LRU eviction, the
    // identity cap, either clock) is a decision the SERVER made and the
    // client has no way to learn about, which is exactly what
    // resurrection exists to paper over.
    if (!terminating.has(id)) tombstone(id, entry.createdAt)
    // Closing the server closes its transport, whose `onclose` re-enters
    // here; the delete above already ran, so the re-entry is a no-op
    // rather than a loop.
    void entry.server.close().catch(() => {
      // Best-effort — a transport already tearing down may reject.
    })
  }

  /**
   * Record a dropped id, oldest-out at the ceiling. Re-inserting an id
   * moves it to the back — the FIFO is over the LAST drop of each id,
   * which is the one whose `createdAt` is current.
   */
  const tombstone = (id: string, createdAt: number): void => {
    if (maxResurrectable === 0) return
    tombstones.delete(id)
    tombstones.set(id, { createdAt })
    while (tombstones.size > maxResurrectable) {
      const oldest = tombstones.keys().next()
      if (oldest.done) break
      tombstones.delete(oldest.value)
    }
  }

  /**
   * The tombstone for `id`, or null if the server never issued it, has
   * forgotten it, or its clock has run out. Expired entries are dropped
   * on sight so the lookup and the sweep agree on one deadline.
   */
  const resurrectable = (id: string, nowMs: number): Tombstone | null => {
    const tomb = tombstones.get(id)
    if (!tomb) return null
    if (nowMs >= tomb.createdAt + unauthenticatedMaxLifetimeMs) {
      tombstones.delete(id)
      return null
    }
    return tomb
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
    // Tombstones run on the provisional clock too, and this is what
    // reclaims them below the FIFO ceiling — the ceiling alone would
    // hold a quiet endpoint's last few ids forever.
    reclaimTombstones(nowMs)
  }

  /**
   * Where the last tombstone reclamation slice stopped. A `Map`
   * iterator is LIVE under mutation — an entry deleted before the
   * iterator reaches it is skipped, and a re-inserted one moves to the
   * back and is visited again — so keeping one across requests is what
   * makes the scan resumable rather than restartable.
   */
  let reclaimCursor: IterableIterator<string> | null = null

  /**
   * Reclaim expired tombstones, at most `TOMBSTONE_RECLAIM_SLICE` per
   * call (#188).
   *
   * This used to be `for (const id of tombstones.keys()) resurrectable(id, nowMs)`
   * on EVERY request: O(`maxResurrectableSessions`) per request, which
   * is nothing at the default of `maxSessions * 4` and ~5.8 ms/request
   * at 20 000.
   *
   * An early `break` is the obvious fix and is UNSOUND here, which is
   * why this is a cursor and not a break condition. The map's insertion
   * order is by LAST DROP, while the deadline is `createdAt +
   * unauthenticatedMaxLifetimeMs` and `createdAt` is INHERITED — a
   * resurrected session keeps its predecessor's, and re-tombstoning
   * moves the id to the back of the FIFO carrying that OLD `createdAt`.
   * So a recently-inserted entry can have an EARLIER deadline than an
   * older one and the map is not ordered by deadline at all; stopping
   * at the first live entry would strand expired ones indefinitely.
   *
   * Slicing is sound where breaking is not because a slice STILL VISITS
   * EVERY ENTRY, just across several requests. Nothing depends on the
   * timing: `resurrectable()` re-checks the deadline at lookup, so an
   * entry this slice has not reached can never actually resurrect past
   * its clock. What the delay costs is memory held a few requests
   * longer — inside a ceiling that already bounds it.
   */
  const reclaimTombstones = (nowMs: number): void => {
    for (let budget = TOMBSTONE_RECLAIM_SLICE; budget > 0; budget--) {
      if (!reclaimCursor) reclaimCursor = tombstones.keys()
      const next = reclaimCursor.next()
      if (next.done === true) {
        // A full round completed (or the map is empty). Drop the spent
        // iterator so the next call starts a fresh round rather than
        // spinning on a permanently-done one.
        reclaimCursor = null
        return
      }
      resurrectable(next.value, nowMs)
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

  /**
   * Build the transport + `McpServer` pair one session is made of, wired
   * so that either half tearing down drops the whole entry. The two
   * allocating paths — a fresh `initialize` and a resurrect — differ
   * ONLY in where the session id comes from, so they share this: a
   * teardown hook wired on one path and forgotten on the other is a leak
   * with no symptom until the quota fills.
   */
  const buildSession = (
    sessionIdGenerator: () => string,
  ): { transport: WebStandardStreamableHTTPServerTransport; server: McpServer } => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator,
      onsessionclosed: (id) => {
        dropSession(id)
      },
    })
    transport.onclose = () => {
      const id = transport.sessionId
      if (id) dropSession(id)
    }
    const server = createAgentMcpServer({
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
    return { transport, server }
  }

  /**
   * The `initialize` a resurrected transport never received.
   *
   * The SDK will not serve a request carrying a session id until the
   * transport is `_initialized`, and the only public way into that state
   * is an `initialize` POST — which is also where `sessionIdGenerator`
   * is consulted, so this is what actually stamps the OLD id back on.
   * Its response is discarded; the client's own request is replayed
   * afterwards and is what they see.
   *
   * The protocol version is echoed from the request when it carries one
   * so the rebuilt session negotiates what the client already speaks.
   * The transport validates that header against its supported list
   * independently of anything negotiated here, so a client on an
   * unsupported version is refused on its own request, as before.
   */
  const resurrectionHandshake = (req: Request): Request =>
    new Request(req.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'llui-resurrect',
        method: 'initialize',
        params: {
          protocolVersion: req.headers.get('mcp-protocol-version') ?? LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'llui-agent-resurrect', version: serverVersion },
        },
      }),
    })

  /**
   * Rebuild `id`'s session and replay `req` against it, registering the
   * attempt in `resurrecting` so a concurrent request on the same id
   * waits instead of building a second one. The gate is installed
   * SYNCHRONOUSLY — before the first `await` inside `resurrect` — for
   * the same reason `reserveSlot` is synchronous: every overlapping
   * caller is suspended between the lookup and the registration.
   */
  const startResurrect = (
    req: Request,
    id: string,
    tomb: Tombstone,
    nowMs: number,
  ): Promise<Response> => {
    const attempt = resurrect(req, id, tomb, nowMs)
    // Waiters must never see this promise's rejection — they only need
    // to know the attempt is over — so the gate is a neutralized copy.
    const gate = attempt.then(
      () => undefined,
      () => undefined,
    )
    resurrecting.set(id, gate)
    void gate.then(() => {
      if (resurrecting.get(id) === gate) resurrecting.delete(id)
    })
    return attempt
  }

  const resurrect = async (
    req: Request,
    id: string,
    tomb: Tombstone,
    nowMs: number,
  ): Promise<Response> => {
    // A resurrect allocates a transport and a fully-registered
    // `McpServer`, exactly like an `initialize`, so it passes exactly the
    // same three gates in the same order. Anything less would make the
    // with-session-id path a way around them.
    const rl = await deps.rateLimiter.check(clientIp(req), 'identity')
    if (!rl.allowed) {
      auditRefusal('rate-limited', nowMs, { endpoint: mcpPath, reason: 'resurrect' })
      return jsonResponse({ error: { code: 'rate-limited', retryAfterMs: rl.retryAfterMs } }, 429, {
        'retry-after': String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))),
      })
    }
    // Gate 2, the same "fail closed" rule the allocating path states: a
    // bearer is not REQUIRED (the endpoint is deliberately reachable
    // without one), but a bearer that IS presented has to be one of ours
    // or nothing is allocated. Omitting this made the comment above a
    // lie and let a bogus-bearer caller allocate here while the same
    // header 401s on `initialize`.
    //
    // The ASYMMETRY with `initialize` is deliberate and is the point of
    // the next comment: there, a valid bearer buys ADMISSION outside the
    // anonymous quota. Here it buys nothing at all. A resurrected
    // session is provisional whatever the caller presents, so a bearer
    // can only ever make this stricter, never looser.
    if (req.headers.get('authorization')?.startsWith('Bearer ') ?? false) {
      const auth = await verifyAndReadTid(req, deps.tokenStore, {
        now: nowMs,
        slidingTtlMs: deps.slidingTtlMs,
      })
      if (!auth.ok) {
        auditRefusal('auth-failed', nowMs, {
          endpoint: mcpPath,
          code: auth.code,
          resurrect: true,
        })
        return jsonResponse({ error: { code: auth.code } }, auth.status)
      }
    }
    // Always PROVISIONAL: whatever the dropped session had, its bearer
    // binding went with it, so this asks for an anonymous slot and can
    // be refused by the anonymous quota like any other anonymous caller.
    if (!reserveSlot(false)) {
      auditRefusal('rate-limited', nowMs, {
        endpoint: mcpPath,
        reason: 'session-capacity',
        resurrect: true,
      })
      return jsonResponse({ error: { code: 'session-capacity' } }, 503, { 'retry-after': '30' })
    }

    // The reservation must be handed back EXACTLY ONCE, and there are
    // now two routes to that: the success route hands it back the
    // instant the session is registered, every failure route in the
    // trailing `finally`. Idempotence is the whole of it — the
    // `finally` covers the failure paths too, so a release simply MOVED
    // up would be released twice on success, and a release simply
    // dropped from the `finally` would leak a slot on every failure
    // path. A leaked reservation is permanent: nothing sweeps a slot
    // with no id.
    let slotHeld = true
    const release = (): void => {
      if (!slotHeld) return
      slotHeld = false
      releaseSlot(false)
    }

    let transport: WebStandardStreamableHTTPServerTransport | null = null
    let mcpServer: McpServer | null = null
    try {
      const { transport: t, server } = buildSession(() => id)
      transport = t
      mcpServer = server

      await server.connect(t)
      const handshake = await t.handleRequest(resurrectionHandshake(req))
      await handshake.body?.cancel().catch(() => {})
      if (t.sessionId !== id) {
        // Defensive: the SDK assigns the id from the generator during
        // the handshake, so this cannot happen — but registering under
        // the wrong key would leave an unreachable, unaccounted pair.
        await server.close().catch(() => {})
        return jsonResponse({ error: 'session not found' }, 404)
      }

      tombstones.delete(id)
      sessions.set(id, {
        transport: t,
        server,
        lastSeenAt: nowMs,
        // Inherited, never reset — see `Tombstone`.
        createdAt: tomb.createdAt,
        admitted: false,
        identity: null,
      })
      // The reservation BECOMES the registered session here, exactly as
      // on the `initialize` path, and for the same reason: there must
      // be no `await` between the `set` and the release. Releasing in
      // the `finally` instead put the replay below inside the window,
      // and across that `await` the session was counted TWICE — once in
      // `sessions`, once in `reserved` — so `liveSessionCount()` read
      // `maxSessions + 1` (#186). Never a breach (`sessions.size` held),
      // but over-strict: a concurrent caller saw a spurious 503 or
      // triggered one LRU eviction that was not needed.
      release()
      return await t.handleRequest(req)
    } catch (err) {
      if (mcpServer) await mcpServer.close().catch(() => {})
      else if (transport) await transport.close().catch(() => {})
      throw err
    } finally {
      release()
    }
  }

  /**
   * Hand a request to a LIVE session's transport, recording termination
   * intent for the duration when it is a DELETE.
   *
   * There is more than ONE door to this call — the ordinary
   * live-session branch and the `resurrecting` waiter branch, which is
   * reached when a DELETE overlaps a resurrect of the same id (a
   * standalone GET stream beside POSTs makes overlapping requests on one
   * id ordinary in MCP). The marking therefore lives HERE, with the
   * dispatch, rather than at each door: a door that forgot it let the
   * SDK's teardown reach `dropSession` with no intent recorded, which
   * re-tombstoned an id the client had just terminated and let a third
   * party replay it back to life.
   *
   * An explicit termination has to be DURABLE. The SDK's own
   * `terminateSession()` clears its `_sessionId` and never sends it
   * again, so a tombstone here could only ever be redeemed by someone
   * ELSE — and would contradict the client's request either way. The
   * flag is dropped in a `finally` because the teardown it marks happens
   * INSIDE `handleRequest`.
   */
  const dispatch = async (id: string, entry: McpSessionEntry, req: Request): Promise<Response> => {
    if (req.method !== 'DELETE') return entry.transport.handleRequest(req)
    terminating.add(id)
    try {
      return await entry.transport.handleRequest(req)
    } finally {
      terminating.delete(id)
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
      // RE-EVALUATED, not fallen through (#187). Waiting on another
      // request's resurrect invalidates every branch below it, and the
      // waiter used to assume exactly one outcome — that the winner
      // registered a session — so a missing session was read as "the
      // server has forgotten this id" and answered 404. When the
      // winner's resurrect was REFUSED (429 or 503) nothing was
      // registered, and the loser got a 404 for an id the server still
      // holds a live tombstone for: two concurrent replays on a full
      // quota measured `[503, 404]`, while a SERIAL retry of the same
      // id got the honest 503. That 404 is the one answer the MCP SDK
      // cannot recover from (no re-initialize on the POST path,
      // `_sessionId` cleared only by `terminateSession()`) and it is
      // false — which is the whole thing #149 exists to remove.
      //
      // Re-deriving the answer is preferred over copying the winner's
      // refusal for two reasons: the winner's 401 belongs to the
      // winner's bearer, not to a loser that presented none; and by the
      // time the loser resumes the refusal may simply no longer be
      // true. Nothing is weakened by it — a re-attempt is a fresh
      // allocation and takes the same rate limiter, the same
      // fail-closed bearer check and the same `reserveSlot` the winner
      // took, so a genuinely-refused resurrect is refused AGAIN, with
      // its own honest 429/503/401. It costs a loser on a full quota
      // one rate-limiter token, which is exactly what the same requests
      // issued serially would cost.
      //
      // The loop TERMINATES because a request either returns or waits
      // on a resurrect started by SOME OTHER request, each request
      // starts at most one (it returns that attempt), and the gate is
      // removed from `resurrecting` before any waiter resumes — so the
      // iteration count is bounded by the number of requests
      // concurrently in flight on this id.
      for (let at = nowMs; ; at = now()) {
        const entry = sessions.get(sessionHeader)
        if (entry) {
          // Traffic on a session is what keeps it out of the sweep.
          entry.lastSeenAt = at
          return dispatch(sessionHeader, entry, req)
        }

        // Someone is already rebuilding this id: wait for them rather
        // than building a second one on top (see `resurrecting`). Two
        // `sessions.set` under one id would strand the first transport
        // + `McpServer` with nothing accounting for them, so the retry
        // above MUST come back through here rather than allocating
        // beside an attempt already in flight.
        const pending = resurrecting.get(sessionHeader)
        if (pending) {
          await pending
          continue
        }

        const tomb = resurrectable(sessionHeader, at)
        if (!tomb) {
          // An id this server never issued, or has forgotten. This is
          // the guardrail that keeps the with-session-id path — free
          // and unthrottled by design — from becoming a second
          // allocation door: only ids we handed out are rebuildable.
          // It is also now the only REACHABLE route to a 404 here —
          // which is what makes the 404 mean what it says. The one
          // other `return … 404` in the resurrect path is the
          // defensive `t.sessionId !== id` branch, documented there as
          // impossible by construction (the SDK assigns the id from the
          // generator during the handshake). "Reachable" rather than
          // "only" because that branch is still code: if it ever fires
          // it hands a client the answer this change exists to remove,
          // and it should be re-examined rather than assumed.
          return jsonResponse({ error: 'session not found' }, 404)
        }

        if (req.method === 'DELETE') {
          // The client is saying it is done with this id. Rebuilding a
          // session only to tear it down is an allocation for nothing.
          tombstones.delete(sessionHeader)
          return new Response(null, { status: 200 })
        }

        return startResurrect(req, sessionHeader, tomb, at)
      }
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
      const { transport: t, server } = buildSession(() => crypto.randomUUID())
      transport = t
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
    hasLiveSession: (mcpSessionId: string) => sessions.has(mcpSessionId),
    hasBoundToken: (mcpSessionId: string) => sessionMap.get(mcpSessionId) !== null,
    retainedTombstoneCount: () => tombstones.size,
  })
}
