import { describe, it, expect } from 'vitest'
import { createMcpRouter, type McpRouter } from '../../../src/server/mcp/router.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { defaultRateLimiter, type RateLimiter } from '../../../src/server/rate-limit.js'
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
    for (let i = 0; i < 1000; i++) await initialize(router)
    expect(router.liveSessionCount()).toBeLessThanOrEqual(8)
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

  it('buckets the allocation limit per client IP', async () => {
    const c = clock()
    const router = mkRouter(
      {},
      { rateLimiter: defaultRateLimiter({ perBucket: '1/minute' }, c.now), now: c.now },
    )

    expect((await router(initializeRequest({ 'x-forwarded-for': '10.0.0.1' })))?.status).toBe(200)
    expect((await router(initializeRequest({ 'x-forwarded-for': '10.0.0.1' })))?.status).toBe(429)
    // A different client still gets its own allowance.
    expect((await router(initializeRequest({ 'x-forwarded-for': '10.0.0.2' })))?.status).toBe(200)
  })
})
