import { describe, it, expect, vi } from 'vitest'
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

/**
 * Every test here allocates real `McpServer`s — 16 tools with their Zod
 * schemas each — because that allocation IS what the bound is about; a
 * stubbed transport would assert nothing. The counts are already the
 * smallest that demonstrate the property (200 sequential initializes at
 * 50x the anonymous quota, 500 overlapping ones), and cost ~1.5 s on an
 * idle machine. Under `turbo test` on a loaded box that stretches past
 * the 5 s default and the file goes red for reasons unrelated to what it
 * checks, so the ceiling is stated explicitly. It is a flake guard, not
 * a budget: if any test here approaches it, the fix is a smaller count,
 * not a larger number.
 */
vi.setConfig({ testTimeout: 30_000 })

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
    const router = mkRouter({ unauthenticatedTtlMs: 60_000 }, { now: c.now })

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

    const stale = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': first.sessionId as string },
      }),
    )
    expect(stale?.status).toBe(404)
    const live = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': third.sessionId as string },
      }),
    )
    expect(live?.status).not.toBe(404)
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
   * Attack B: an idle TTL alone is refreshable. Pinging an established
   * provisional session just under the TTL held the anonymous quota
   * indefinitely at near-zero cost, so the quota bounded memory but not
   * availability. A provisional session therefore also has an ABSOLUTE
   * lifetime: traffic keeps it out of the idle sweep, nothing keeps it
   * past the handshake window.
   */
  it('reclaims a provisional session held open by keepalive traffic', async () => {
    const c = clock()
    const router = mkRouter(
      { unauthenticatedTtlMs: 60_000, unauthenticatedMaxLifetimeMs: 300_000 },
      { now: c.now },
    )
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
    // Ten pings at 50 s — always inside the 60 s idle TTL, so the idle
    // sweep alone never fires.
    for (let i = 0; i < 10; i++) {
      c.advance(50_000)
      statuses.push(await ping())
    }

    expect(statuses).toContain(404)
    expect(router.liveSessionCount()).toBe(0)
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
