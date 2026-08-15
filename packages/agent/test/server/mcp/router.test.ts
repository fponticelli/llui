import { describe, it, expect } from 'vitest'
import { createMcpRouter, type McpRouter } from '../../../src/server/mcp/router.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { defaultRateLimiter, type RateLimiter } from '../../../src/server/rate-limit.js'
import { createClientIpResolver } from '../../../src/server/client-ip.js'
import type { AuditSink } from '../../../src/server/audit.js'
import type { AuditEntry } from '../../../src/protocol.js'
import { seedToken } from '../_token-helper.js'

/**
 * A `coreRouter` that answers the one LAP endpoint `connect_session`
 * prefetches (`/observe`) with a minimal well-formed bundle, and 404s
 * everything else. Enough to drive a real connect through the MCP
 * protocol without standing up a browser pairing.
 */
const observingCoreRouter = async (req: Request): Promise<Response | null> => {
  if (new URL(req.url).pathname.endsWith('/observe')) {
    return Response.json({
      state: { n: 1 },
      actions: [],
      description: {
        name: 'Test',
        version: '0.0',
        schemaHash: 'h1',
        messages: [],
        state: {},
        docs: null,
      },
      context: {},
    })
  }
  return null
}

const neverLimited: RateLimiter = { check: async () => ({ allowed: true }) }

type Clock = { now: () => number; advance: (ms: number) => void }
/**
 * Injectable wall clock. Starts at the real epoch so token records
 * (which the MCP server verifies against `Date.now()` inside the
 * protocol handlers) stay unexpired while the router's own sweep runs
 * on the advanced clock.
 */
function clock(start = Date.now()): Clock {
  let t = start
  return { now: () => t, advance: (ms) => void (t += ms) }
}

function initializeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://local/agent/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      },
    }),
  })
}

async function initialize(
  router: McpRouter,
  headers: Record<string, string> = {},
): Promise<{ status: number; sessionId: string | null }> {
  const res = await router(initializeRequest(headers))
  if (!res) throw new Error('mcp router did not claim the request')
  return { status: res.status, sessionId: res.headers.get('mcp-session-id') }
}

/**
 * Drive one `tools/call` over an established session. The transport
 * answers with an SSE stream (JSON responses are not enabled), so pull
 * the single `data:` frame back out of the body.
 */
async function callTool(
  router: McpRouter,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; result: unknown }> {
  const req = new Request('http://local/agent/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const res = await router(req)
  if (!res) throw new Error('mcp router did not claim the request')
  const text = await res.text()
  const line = text
    .split('\n')
    .find((l) => l.startsWith('data:'))
    ?.slice('data:'.length)
    .trim()
  return { status: res.status, result: line ? (JSON.parse(line) as unknown) : null }
}

// Every test here allocates real `McpServer`s — 16 tools with their Zod schemas
// each — because that allocation IS what the bound is about; a stubbed transport
// would assert nothing. The counts are already the smallest that demonstrate the
// property (200 sequential initializes at 50x the anonymous quota, 500
// overlapping ones), and cost ~1.5 s on an idle machine. Under `turbo test` on a
// loaded box that stretches far enough that the file goes red for reasons
// unrelated to what it checks. The budget that absorbs it is the workspace-wide
// one in `vitest.shared.ts` (#147) — a per-file `vi.setConfig` here would shadow
// it. It is a flake guard, not a budget: if any test here approaches that
// ceiling, the fix is a smaller count, not a larger number.

function mkRouter(over: Partial<Parameters<typeof createMcpRouter>[1]> = {}, deps = {}): McpRouter {
  return createMcpRouter(
    {
      coreRouter: observingCoreRouter,
      tokenStore: new InMemoryTokenStore(),
      lapBasePath: '/agent/lap/v1',
      rateLimiter: neverLimited,
      ...deps,
    },
    over,
  )
}

describe('MCP router session bounding (#102)', () => {
  it('leaves a bounded number of live sessions across many unauthenticated initializes', async () => {
    const router = mkRouter({ maxSessions: 8, maxUnauthenticatedSessions: 4 })
    // 200 sequential initializes: 50× the anonymous quota, which is what
    // the LRU churn has to hold at. The old 1000 built 1000 full
    // `McpServer`s (16 Zod-schema tools each) and blew the 5 s default
    // timeout under workspace parallelism without proving anything the
    // shorter run doesn't.
    for (let i = 0; i < 200; i++) await initialize(router)
    // Every one of these is anonymous, so the reachable ceiling is the
    // ANONYMOUS quota, not `maxSessions`.
    expect(router.liveSessionCount()).toBeLessThanOrEqual(4)
  })

  /**
   * The bound has to hold when initializes OVERLAP, which is the normal
   * case: both callers (`factory.ts`, `durable-object.ts`) `await` the
   * router inside a per-request handler, so N in-flight requests are N
   * suspended `route` calls. A check that reads `sessions.size` and
   * registers after two `await`s reserves nothing — every concurrent
   * caller sees an empty map and passes.
   */
  it('holds maxSessions when 500 initializes are in flight at once', async () => {
    const router = mkRouter({ maxSessions: 8, maxUnauthenticatedSessions: 8 })
    const results = await Promise.all(Array.from({ length: 500 }, () => initialize(router)))
    expect(router.liveSessionCount()).toBeLessThanOrEqual(8)
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(8)
    // The overflow has to be REFUSED, not silently served.
    expect(results.filter((r) => r.status === 503).length).toBeGreaterThan(0)
  })

  it('holds the anonymous quota when initializes are in flight at once', async () => {
    const router = mkRouter({ maxSessions: 64, maxUnauthenticatedSessions: 4 })
    await Promise.all(Array.from({ length: 200 }, () => initialize(router)))
    expect(router.liveSessionCount()).toBeLessThanOrEqual(4)
  })

  it('counts a session still being built against the bound', async () => {
    const router = mkRouter({ maxSessions: 4, maxUnauthenticatedSessions: 4 })
    // Eight overlapping initializes against four slots. A session under
    // construction is not in the session map yet, so this passes only if
    // the reservation itself is counted — and the overflow must be
    // refused, not served a session that pushes the total to eight.
    const results = await Promise.all(Array.from({ length: 8 }, () => initialize(router)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(4)
    expect(results.filter((r) => r.status === 503)).toHaveLength(4)
    expect(router.liveSessionCount()).toBe(4)
  })

  it('reclaims a stranded session without a client DELETE', async () => {
    const c = clock()
    // The reclaim runs on the provisional session's ABSOLUTE lifetime —
    // the one clock a stranded client cannot refresh and the one that
    // does not need the quota to be contended to fire.
    const router = mkRouter({ unauthenticatedMaxLifetimeMs: 60_000 }, { now: c.now })

    const first = await initialize(router)
    expect(first.sessionId).toBeTruthy()
    expect(router.liveSessionCount()).toBe(1)

    // The client is gone — no DELETE, no further traffic on that session.
    c.advance(61_000)
    // Any later request drives the sweep.
    await initialize(router)

    expect(router.liveSessionCount()).toBe(1)
    const stranded = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': first.sessionId as string },
      }),
    )
    expect(stranded?.status).toBe(404)
  })

  it('releases the bearer token bound to a session when that session is reclaimed', async () => {
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter(
      { idleTtlMs: 5 * 60_000 },
      { tokenStore: store, now: c.now, coreRouter: observingCoreRouter },
    )

    const { sessionId } = await initialize(router)
    const connected = await callTool(router, sessionId as string, 'connect_session', { token })
    expect(connected.status).toBe(200)
    expect(router.hasBoundToken(sessionId as string)).toBe(true)

    c.advance(5 * 60_000 + 1)
    await initialize(router)

    expect(router.hasBoundToken(sessionId as string)).toBe(false)
  })

  it('keeps connect_session working from an unauthenticated initialize', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    const router = mkRouter({}, { tokenStore: store })

    const { status, sessionId } = await initialize(router)
    expect(status).toBe(200)
    const connected = await callTool(router, sessionId as string, 'connect_session', { token })
    const payload = connected.result as {
      result?: { structuredContent?: { status?: string }; isError?: boolean }
    }
    expect(payload.result?.isError).toBeFalsy()
    expect(payload.result?.structuredContent?.status).toBe('connected')
  })

  it('never evicts a connected session to make room for an unauthenticated one', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    const router = mkRouter(
      { maxSessions: 3, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    const { sessionId } = await initialize(router)
    await callTool(router, sessionId as string, 'connect_session', { token })
    expect(router.hasBoundToken(sessionId as string)).toBe(true)

    for (let i = 0; i < 50; i++) await initialize(router)

    expect(router.hasBoundToken(sessionId as string)).toBe(true)
    expect(router.liveSessionCount()).toBeLessThanOrEqual(3)
  })

  /**
   * The dual of the test above, and the property the 30-minute
   * provisional lifetime rests on: an authenticated session must survive
   * anonymous churn, but a PROVISIONAL one must yield to it. The bound
   * tests cannot see this — a bound holds just as well by refusing
   * everyone, so making provisional sessions counted-but-never-evictable
   * (never setting `lruId` in `reserveSlot`) keeps every one of them
   * green while turning a full anonymous quota into a 30-minute denial
   * window for every later caller. Measured under exactly that mutation:
   * this test goes red at the `fresh` assertion (503), and it is the only
   * one that does.
   *
   * It is also what makes the raised lifetime safe: with the LRU as the
   * valve, a squatter holding the whole quota cannot lock out the next
   * honest `initialize` for the 30 minutes its sessions are entitled to.
   */
  it('admits a fresh anonymous initialize while provisional sessions hold the whole quota', async () => {
    const c = clock()
    const router = mkRouter({ maxSessions: 8, maxUnauthenticatedSessions: 2 }, { now: c.now })

    // Fill the anonymous quota, and stagger the two so the LRU victim is
    // unambiguous. Both stay far inside the provisional lifetime, so
    // nothing here is freed by a clock — only by the eviction.
    const squatters: string[] = []
    for (let i = 0; i < 2; i++) {
      const held = await initialize(router)
      expect(held.status).toBe(200)
      squatters.push(held.sessionId as string)
      c.advance(60_000)
    }
    expect(router.liveSessionCount()).toBe(2)

    const fresh = await initialize(router)
    expect(fresh.status).toBe(200)
    expect(fresh.sessionId).toBeTruthy()

    // And it is a working session, not an accounting artefact: the quota
    // still holds, and what made room is the STALEST squatter.
    //
    // Asked directly rather than through a 404 probe: since #149 a
    // request on a dropped id REBUILDS the session, so a probe would
    // repair exactly what it is meant to detect.
    expect(router.liveSessionCount()).toBe(2)
    expect(router.hasLiveSession(squatters[0] as string)).toBe(false)
    expect(router.hasLiveSession(squatters[1] as string)).toBe(true)
  })

  it('answers 503 without allocating when every slot is held by a connected session', async () => {
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }
    expect(router.liveSessionCount()).toBe(2)

    const res = await router(initializeRequest())
    expect(res?.status).toBe(503)
    expect(router.liveSessionCount()).toBe(2)
  })
})

describe('MCP router authentication (#102)', () => {
  it('rejects an initialize carrying an unknown bearer, allocating nothing', async () => {
    const router = mkRouter()
    const res = await router(initializeRequest({ authorization: 'Bearer agt_not-a-real-token' }))
    expect(res?.status).toBe(401)
    expect(router.liveSessionCount()).toBe(0)
  })

  it('rejects an initialize carrying an expired bearer, allocating nothing', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', expiresAt: Date.now() - 1 })
    const router = mkRouter({}, { tokenStore: store })
    const res = await router(initializeRequest({ authorization: `Bearer ${token}` }))
    expect(res?.status).toBe(401)
    expect(router.liveSessionCount()).toBe(0)
  })

  it('admits an initialize carrying a valid bearer outside the unauthenticated quota', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    const router = mkRouter(
      { maxSessions: 4, maxUnauthenticatedSessions: 1 },
      { tokenStore: store },
    )

    const admitted = await initialize(router, { authorization: `Bearer ${token}` })
    expect(admitted.status).toBe(200)

    // Three unauthenticated initializes churn through the single
    // provisional slot; the admitted session must survive all of them.
    for (let i = 0; i < 3; i++) await initialize(router)

    const still = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': admitted.sessionId as string },
      }),
    )
    expect(still?.status).not.toBe(404)
  })
})

describe('MCP router rate limiting (#102)', () => {
  it('throttles the session-allocating path and allocates nothing when throttled', async () => {
    const c = clock()
    const router = mkRouter(
      {},
      { rateLimiter: defaultRateLimiter({ perBucket: '3/minute' }, c.now), now: c.now },
    )

    for (let i = 0; i < 3; i++) {
      const res = await router(initializeRequest({ 'x-forwarded-for': '10.0.0.1' }))
      expect(res?.status).toBe(200)
    }
    const throttled = await router(initializeRequest({ 'x-forwarded-for': '10.0.0.1' }))
    expect(throttled?.status).toBe(429)
    expect(router.liveSessionCount()).toBe(3)
  })

  /**
   * Replaces the old `buckets the allocation limit per client IP`, which
   * varied `x-forwarded-for` and asserted each value got its own
   * allowance — i.e. it codified the bypass as intended behaviour. On a
   * direct-to-origin deployment (the primary one for this package) every
   * forwarding header is attacker-supplied, so a limiter keyed on one is
   * no limiter at all.
   */
  it('does not let a caller mint fresh buckets with forwarding headers', async () => {
    const c = clock()
    const router = mkRouter(
      {},
      { rateLimiter: defaultRateLimiter({ perBucket: '3/minute' }, c.now), now: c.now },
    )

    const statuses: number[] = []
    for (let i = 0; i < 20; i++) {
      const res = await router(
        initializeRequest({
          'x-forwarded-for': `10.0.0.${i}`,
          'x-real-ip': `192.0.2.${i}`,
        }),
      )
      statuses.push(res?.status ?? 0)
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(3)
    expect(statuses.filter((s) => s === 429)).toHaveLength(17)
    expect(router.liveSessionCount()).toBe(3)
  })

  it('buckets per forwarded client only when the host declares a trusted proxy', async () => {
    const c = clock()
    const router = mkRouter(
      {},
      {
        rateLimiter: defaultRateLimiter({ perBucket: '1/minute' }, c.now),
        now: c.now,
        clientIp: createClientIpResolver({ trustProxy: 1 }),
      },
    )

    expect((await router(initializeRequest({ 'x-forwarded-for': '10.0.0.1' })))?.status).toBe(200)
    expect((await router(initializeRequest({ 'x-forwarded-for': '10.0.0.1' })))?.status).toBe(429)
    // A different client behind the same trusted proxy gets its own
    // allowance — the reason the option exists at all.
    expect((await router(initializeRequest({ 'x-forwarded-for': '10.0.0.2' })))?.status).toBe(200)
  })

  /**
   * The declared-proxy path has its own bypass, and it is the one a real
   * deployment hits. `trustProxy: n` asserts that `n` proxies you
   * control APPEND to `X-Forwarded-For`; behind an nginx that sets only
   * `X-Real-IP`, or with a declaration deeper than the chain, the router
   * used to read a caller-authored value anyway — one bucket per
   * request, through a limiter the deployment believed was on. Measured
   * before the fix: 60/60 allocations in both shapes below.
   */
  it('does not let a caller mint fresh buckets under a trusted-proxy declaration', async () => {
    const mk = (trustProxy: number, c: Clock): McpRouter =>
      mkRouter(
        {},
        {
          rateLimiter: defaultRateLimiter({ perBucket: '3/minute' }, c.now),
          now: c.now,
          clientIp: createClientIpResolver({ trustProxy }),
        },
      )

    // A proxy that writes X-Real-IP and no chain: the caller's own
    // X-Forwarded-For is not the proxy's word, and neither is the
    // X-Real-IP it can equally write.
    const realIpOnly = clock()
    const realIpRouter = mk(1, realIpOnly)
    const a: number[] = []
    for (let i = 0; i < 60; i++) {
      const res = await realIpRouter(initializeRequest({ 'x-real-ip': `192.0.2.${i}` }))
      a.push(res?.status ?? 0)
    }
    expect(a.filter((s) => s === 200)).toHaveLength(3)
    expect(a.filter((s) => s === 429)).toHaveLength(57)

    // A chain shorter than the declared depth cannot have passed through
    // that many appending proxies.
    const shortChain = clock()
    const shortRouter = mk(2, shortChain)
    const b: number[] = []
    for (let i = 0; i < 60; i++) {
      const res = await shortRouter(initializeRequest({ 'x-forwarded-for': `10.0.0.${i}` }))
      b.push(res?.status ?? 0)
    }
    expect(b.filter((s) => s === 200)).toHaveLength(3)
    expect(b.filter((s) => s === 429)).toHaveLength(57)
  })

  it('carries retry-after on a 429 so a client backs off instead of hammering', async () => {
    const c = clock()
    const router = mkRouter(
      {},
      { rateLimiter: defaultRateLimiter({ perBucket: '1/minute' }, c.now), now: c.now },
    )
    await router(initializeRequest())
    const throttled = await router(initializeRequest())
    expect(throttled?.status).toBe(429)
    expect(Number(throttled?.headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
  })
})

describe('MCP router audit trail (#102)', () => {
  it('records the refusals — 401, 429 and the capacity 503', async () => {
    const entries: AuditEntry[] = []
    const auditSink: AuditSink = {
      write: async (e) => void entries.push(e),
    }
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter(
      { maxSessions: 1, maxUnauthenticatedSessions: 1 },
      {
        tokenStore: store,
        auditSink,
        now: c.now,
        rateLimiter: defaultRateLimiter({ perBucket: '3/minute' }, c.now),
      },
    )

    // 401 — a bearer that is not one of ours.
    await router(initializeRequest({ authorization: 'Bearer agt_nope' }))
    // 503 — the one slot goes to an authenticated session, which is
    // never evicted for an anonymous caller.
    const admitted = await initialize(router, { authorization: `Bearer ${token}` })
    await callTool(router, admitted.sessionId as string, 'connect_session', { token })
    await router(initializeRequest())
    // 429 — the 3/minute bucket is spent by now.
    await router(initializeRequest())

    expect(entries.map((e) => e.event)).toEqual(['auth-failed', 'rate-limited', 'rate-limited'])
    expect(entries[1]?.detail).toMatchObject({ reason: 'session-capacity' })
  })
})

describe('MCP router per-identity cap (#102)', () => {
  /**
   * Attack C: an authenticated session is (correctly) never evicted on
   * behalf of an anonymous caller, so without a per-identity cap ONE
   * valid bearer presented `maxSessions` times fills the endpoint with
   * sessions nothing can reclaim and every later caller gets a 503. The
   * accidental version is worse because it needs no attacker: a client
   * that crash-reconnects often enough inside the idle TTL does it.
   */
  it('caps how many sessions a single bearer can hold, without 503ing the endpoint', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    const router = mkRouter(
      { maxSessions: 8, maxUnauthenticatedSessions: 2, maxSessionsPerIdentity: 3 },
      { tokenStore: store },
    )

    for (let i = 0; i < 12; i++) {
      const res = await initialize(router, { authorization: `Bearer ${token}` })
      expect(res.status).toBe(200)
    }
    expect(router.liveSessionCount()).toBeLessThanOrEqual(3)

    // The endpoint is still usable by everyone else — the point of the cap.
    const other = await initialize(router)
    expect(other.status).toBe(200)
  })

  it('keeps the most recent sessions of a capped identity', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    const router = mkRouter({ maxSessionsPerIdentity: 2 }, { tokenStore: store })

    const first = await initialize(router, { authorization: `Bearer ${token}` })
    await initialize(router, { authorization: `Bearer ${token}` })
    const third = await initialize(router, { authorization: `Bearer ${token}` })

    expect(router.hasLiveSession(first.sessionId as string)).toBe(false)
    expect(router.hasLiveSession(third.sessionId as string)).toBe(true)
  })

  it('applies the cap to sessions that authenticate through connect_session', async () => {
    // The other door to attack C: initialize anonymously (inside the
    // anonymous quota), then bind the SAME token. Each session leaves
    // the quota the moment it authenticates, so the anonymous ceiling
    // never sees the accumulation.
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    const router = mkRouter({ maxSessionsPerIdentity: 2 }, { tokenStore: store })

    for (let i = 0; i < 5; i++) {
      const { sessionId } = await initialize(router)
      const connected = await callTool(router, sessionId as string, 'connect_session', { token })
      expect(connected.status).toBe(200)
    }

    expect(router.liveSessionCount()).toBeLessThanOrEqual(2)
  })
})

describe('MCP router provisional-session lifetime (#102)', () => {
  /**
   * Attack B: an idle window alone is refreshable. Pinging an
   * established provisional session just under it held a slot of the
   * anonymous quota indefinitely at near-zero cost. The provisional
   * clock is therefore ABSOLUTE: traffic buys nothing, and the session
   * goes at the deadline however busy it looks.
   */
  it('reclaims a provisional session held open by keepalive traffic', async () => {
    const c = clock()
    const router = mkRouter({ unauthenticatedMaxLifetimeMs: 300_000 }, { now: c.now })
    const { sessionId } = await initialize(router)
    expect(sessionId).toBeTruthy()

    const ping = async (): Promise<number> => {
      const res = await router(
        new Request('http://local/agent/mcp', {
          method: 'POST',
          headers: { 'mcp-session-id': sessionId as string },
        }),
      )
      return res?.status ?? 0
    }

    const statuses: number[] = []
    // Ten pings at 50 s — busy enough that no idle window would ever
    // lapse, and each one refreshes `lastSeenAt` so the LRU would keep
    // choosing someone else.
    for (let i = 0; i < 10; i++) {
      c.advance(50_000)
      statuses.push(await ping())
    }

    expect(statuses).toContain(404)
    expect(router.liveSessionCount()).toBe(0)
  })

  /**
   * The flow `site/content/agents.md` documents is HUMAN-paced: Claude
   * Desktop initializes at startup, and the provisional session then
   * idles while a person opens the app, clicks "Connect with Claude",
   * copies the snippet and pastes it into the chat. Nothing in that
   * sequence sends a request.
   *
   * Sweeping the session out from under it is not a memory bound — the
   * anonymous quota is — and the MCP SDK client (1.29.0) does not
   * re-initialize on a 404, so the reclaim surfaces to the user as a
   * thrown `StreamableHTTPError` rather than a transparent reconnect.
   * Six minutes exceeds BOTH pre-repair bounds (a 60 s idle TTL and a
   * 5 min absolute lifetime), and this runs on the shipped DEFAULTS
   * because the defaults are what that flow meets.
   */
  it('connects after a human-paced pause on the shipped defaults', async () => {
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter({}, { tokenStore: store, now: c.now })

    const { status, sessionId } = await initialize(router)
    expect(status).toBe(200)

    // The human opens the app, clicks connect, copies, pastes.
    c.advance(6 * 60_000)

    const connected = await callTool(router, sessionId as string, 'connect_session', { token })
    expect(connected.status).toBe(200)
    const payload = connected.result as {
      result?: { structuredContent?: { status?: string }; isError?: boolean }
    }
    expect(payload.result?.isError).toBeFalsy()
    expect(payload.result?.structuredContent?.status).toBe('connected')
  })

  it('leaves an idle provisional session alone while the quota is uncontended', async () => {
    // The sweep used to run at the top of every route call regardless of
    // pressure, so unrelated traffic on an endpoint with 15 free
    // anonymous slots reclaimed a session that was costing nothing. The
    // quota is the memory bound; reclaiming below it buys nothing and
    // costs the pairing.
    const c = clock()
    const router = mkRouter({}, { now: c.now })

    const first = await initialize(router)
    c.advance(10 * 60_000)
    await initialize(router)

    const still = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': first.sessionId as string },
      }),
    )
    expect(still?.status).not.toBe(404)
    expect(router.liveSessionCount()).toBe(2)
  })

  it('reclaims idle provisional sessions once the quota IS contended', async () => {
    // The other half: not sweeping on an idle endpoint must not turn the
    // quota into a leak. Under contention the LRU provisional session —
    // the stalest one, by construction — is what makes room.
    const c = clock()
    const router = mkRouter({ maxSessions: 8, maxUnauthenticatedSessions: 2 }, { now: c.now })

    const first = await initialize(router)
    c.advance(10 * 60_000)
    for (let i = 0; i < 20; i++) await initialize(router)

    expect(router.liveSessionCount()).toBe(2)
    expect(router.hasLiveSession(first.sessionId as string)).toBe(false)
  })

  it('does not cap the lifetime of a session that completed connect_session', async () => {
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter(
      { unauthenticatedMaxLifetimeMs: 60_000, idleTtlMs: 30 * 60_000 },
      { tokenStore: store, now: c.now },
    )
    const { sessionId } = await initialize(router)
    await callTool(router, sessionId as string, 'connect_session', { token })
    expect(router.hasBoundToken(sessionId as string)).toBe(true)

    // Well past the PROVISIONAL cap, inside the authenticated idle TTL.
    c.advance(10 * 60_000)
    await initialize(router)
    expect(router.hasBoundToken(sessionId as string)).toBe(true)
  })
})
