import { describe, it, expect, vi } from 'vitest'
import { createMcpRouter, type McpRouter } from '../../../src/server/mcp/router.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { defaultRateLimiter, type RateLimiter } from '../../../src/server/rate-limit.js'
import { seedToken } from '../_token-helper.js'

/**
 * Session resurrection (#149).
 *
 * The endpoint's bound is LRU over provisional sessions, and a pairing
 * session is the LRU provisional BY CONSTRUCTION — it is idle precisely
 * because a human is reading the pairing instructions. So an unrelated
 * anonymous burst evicts it, `connect_session` 404s, and the MCP SDK
 * (1.29.0) cannot recover: the POST path throws `StreamableHTTPError`
 * on a 404 with no recovery case, and `_sessionId` is cleared only by
 * an explicit `terminateSession()`.
 *
 * The fix is recoverability, not prevention: an id the server ISSUED
 * and has since dropped is rebuilt under the same id and the request
 * replayed. Everything here is about the guardrails that keep that
 * from reopening #102's unbounded-allocation door.
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
function clock(start = Date.now()): Clock {
  let t = start
  return { now: () => t, advance: (ms) => void (t += ms) }
}

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

function toolCallRequest(sessionId: string, name: string, args: Record<string, unknown>): Request {
  return new Request('http://local/agent/mcp', {
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
}

type ToolOutcome = {
  status: number
  result: {
    result?: { structuredContent?: { status?: string }; isError?: boolean; content?: unknown }
  } | null
}

async function readToolResponse(res: Response | null): Promise<ToolOutcome> {
  if (!res) throw new Error('mcp router did not claim the request')
  const text = await res.text()
  const line = text
    .split('\n')
    .find((l) => l.startsWith('data:'))
    ?.slice('data:'.length)
    .trim()
  return { status: res.status, result: line ? (JSON.parse(line) as ToolOutcome['result']) : null }
}

async function callTool(
  router: McpRouter,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  return readToolResponse(await router(toolCallRequest(sessionId, name, args)))
}

/** A bare POST on a session id — the cheapest probe for "is it there". */
async function ping(router: McpRouter, sessionId: string): Promise<number> {
  const res = await router(
    new Request('http://local/agent/mcp', {
      method: 'POST',
      headers: { 'mcp-session-id': sessionId },
    }),
  )
  return res?.status ?? 0
}

describe('MCP session resurrection — the reported scenario (#149)', () => {
  /**
   * The issue, end to end, on the SHIPPED defaults. A human starts the
   * documented pairing flow; unrelated anonymous traffic fills the
   * provisional quota while they read; their session — idle, therefore
   * LRU — is evicted; they paste the token. Before this fix the paste
   * returned 404 and the SDK could not recover from it.
   */
  it('connects after an anonymous burst evicted the idle pairing session', async () => {
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter({}, { tokenStore: store, now: c.now })

    // The human's client initializes at chat start.
    const pairing = await initialize(router)
    expect(pairing.status).toBe(200)

    // They open the app and read the pairing panel. Meanwhile 20
    // unrelated anonymous initializes arrive — more than the shipped
    // anonymous quota of 16, so the LRU (this pairing) is evicted.
    for (let i = 0; i < 20; i++) {
      c.advance(1_000)
      expect((await initialize(router)).status).toBe(200)
    }

    // They paste the token.
    const connected = await callTool(router, pairing.sessionId as string, 'connect_session', {
      token,
    })
    expect(connected.status).toBe(200)
    expect(connected.result?.result?.isError).toBeFalsy()
    expect(connected.result?.result?.structuredContent?.status).toBe('connected')
  })

  /**
   * The LRU key is CALLER-REFRESHABLE, which makes the victim
   * attacker-SELECTABLE rather than incidental: an adversary that pings
   * its own quota-filling sessions keeps them all newer than the idle
   * pairing, so the pairing is the deterministic eviction victim on
   * every allocation. Same recovery has to hold.
   */
  it('connects even when the attacker keeps its own sessions warm', async () => {
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter(
      { maxSessions: 8, maxUnauthenticatedSessions: 4 },
      { tokenStore: store, now: c.now },
    )

    const pairing = await initialize(router)
    const held: string[] = []
    for (let i = 0; i < 4; i++) {
      c.advance(1_000)
      const s = await initialize(router)
      held.push(s.sessionId as string)
    }
    // Refresh every attacker session so the idle pairing stays LRU.
    for (const id of held) {
      c.advance(1_000)
      await ping(router, id)
    }

    const connected = await callTool(router, pairing.sessionId as string, 'connect_session', {
      token,
    })
    expect(connected.result?.result?.structuredContent?.status).toBe('connected')
  })
})

describe('MCP session resurrection — allocation guardrails (#149)', () => {
  /**
   * Guardrail 1. A resurrect is only ever offered for an id this server
   * ISSUED and has since dropped. If an arbitrary id could resurrect,
   * the with-session-id path — which is deliberately free and
   * unthrottled for established sessions — would become a second,
   * unbounded allocation door.
   */
  it('does not resurrect an id the server never issued', async () => {
    const router = mkRouter()
    await initialize(router)
    const before = router.liveSessionCount()

    expect(await ping(router, crypto.randomUUID())).toBe(404)
    expect(await ping(router, 'not-even-a-uuid')).toBe(404)
    expect(router.liveSessionCount()).toBe(before)
  })

  /**
   * Guardrail 2, half one. A resurrect IS an allocation, so it goes
   * through the same limiter a fresh `initialize` does — and, like a
   * fresh initialize, allocates nothing when refused.
   */
  it('rate-limits a resurrect exactly like a fresh initialize', async () => {
    const c = clock()
    const router = mkRouter(
      { maxSessions: 4, maxUnauthenticatedSessions: 1 },
      { rateLimiter: defaultRateLimiter({ perBucket: '2/minute' }, c.now), now: c.now },
    )

    const first = await initialize(router)
    expect(first.status).toBe(200)
    // The second initialize evicts the first — that is the tombstone.
    expect((await initialize(router)).status).toBe(200)
    expect(router.liveSessionCount()).toBe(1)

    // The bucket is spent; the resurrect must be refused, not served.
    const res = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': first.sessionId as string },
      }),
    )
    expect(res?.status).toBe(429)
    expect(res?.headers.get('retry-after')).toBeTruthy()
    expect(router.liveSessionCount()).toBe(1)
  })

  /**
   * Guardrail 2, half two. A resurrect takes a reservation through
   * `reserveSlot` like every other allocation, so it cannot exceed the
   * quota — and when every slot is held by an authenticated session
   * (which is never evictable for an anonymous caller) it is refused
   * with the same 503 a fresh initialize gets.
   */
  it('refuses a resurrect with 503 when the quota is fully held', async () => {
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    // A provisional session that will be evicted, leaving a tombstone.
    const doomed = await initialize(router)
    // Two authenticated sessions then take every slot.
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }
    expect(router.liveSessionCount()).toBe(2)
    // The bound is unchanged: a FRESH initialize is refused too.
    expect((await router(initializeRequest()))?.status).toBe(503)

    const res = await router(
      new Request('http://local/agent/mcp', {
        method: 'POST',
        headers: { 'mcp-session-id': doomed.sessionId as string },
      }),
    )
    expect(res?.status).toBe(503)
    expect(res?.headers.get('retry-after')).toBe('30')
    expect(router.liveSessionCount()).toBe(2)
  })

  /**
   * The bound must be exactly as strict after this change as before:
   * sustained pressure on a full quota still refuses, whether the
   * pressure arrives as fresh initializes or as replayed tombstones.
   * Resurrection buys recovery from a BURST, not from a sustained
   * attack.
   */
  it('holds the quota under sustained mixed initialize + resurrect pressure', async () => {
    const router = mkRouter({ maxSessions: 6, maxUnauthenticatedSessions: 3 })

    const issued: string[] = []
    for (let i = 0; i < 12; i++) {
      const s = await initialize(router)
      if (s.sessionId) issued.push(s.sessionId)
      // Replay the last six issued ids — enough of them tombstoned that
      // an unreserved resurrect would push the live set past the quota
      // faster than the next `initialize` could pull it back.
      for (const id of issued.slice(-6)) await ping(router, id)
      expect(router.liveSessionCount()).toBeLessThanOrEqual(3)
    }
    expect(router.liveSessionCount()).toBeLessThanOrEqual(3)
  })

  /**
   * Guardrail 3. The bearer binding lives in `McpSessionMap` and is
   * dropped with the session. A resurrected session is PROVISIONAL: no
   * bound token, no admission credential, no identity — every tool
   * refuses until `connect_session` runs again.
   */
  it('carries no bearer privilege into a resurrected session', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1' })
    // A per-identity cap of 1 makes the identity evict its own first
    // session the instant the second one binds the same token.
    const router = mkRouter({ maxSessionsPerIdentity: 1 }, { tokenStore: store })

    const first = await initialize(router)
    await callTool(router, first.sessionId as string, 'connect_session', { token })
    expect(router.hasBoundToken(first.sessionId as string)).toBe(true)

    const second = await initialize(router)
    await callTool(router, second.sessionId as string, 'connect_session', { token })
    expect(router.hasBoundToken(first.sessionId as string)).toBe(false)

    // The evicted id still resurrects — but as an anonymous session.
    const observed = await callTool(router, first.sessionId as string, 'observe', {})
    expect(observed.status).toBe(200)
    expect(observed.result?.result?.isError).toBe(true)
    expect(JSON.stringify(observed.result?.result?.content)).toContain('Not connected')
    expect(router.hasBoundToken(first.sessionId as string)).toBe(false)
  })

  /**
   * Guardrail 3, the quota half. "Provisional" is not only about the
   * bearer: a session marked as ADMITTED sits OUTSIDE the anonymous
   * quota and can never be evicted for an anonymous caller. A
   * resurrected session must be neither — otherwise replaying
   * tombstoned ids is a way to accumulate un-evictable sessions past
   * `maxUnauthenticatedSessions`, which is the #102 defect wearing a
   * different hat.
   */
  it('puts a resurrected session inside the anonymous quota', async () => {
    const router = mkRouter({ maxSessions: 8, maxUnauthenticatedSessions: 1 })

    const first = await initialize(router)
    await initialize(router) // evicts `first`
    expect(await ping(router, first.sessionId as string)).not.toBe(404)
    expect(router.hasLiveSession(first.sessionId as string)).toBe(true)
    expect(router.liveSessionCount()).toBe(1)

    // The single anonymous slot is now held by the resurrected session,
    // and ordinary anonymous churn must be able to take it back.
    for (let i = 0; i < 5; i++) expect((await initialize(router)).status).toBe(200)
    expect(router.liveSessionCount()).toBe(1)
    expect(router.hasLiveSession(first.sessionId as string)).toBe(false)
  })
})

describe('MCP session resurrection — tombstone bounds (#149)', () => {
  /**
   * The tombstone set is itself an allocation, so it is a bounded FIFO:
   * past the bound the OLDEST ids stop resurrecting and go back to
   * answering 404.
   */
  it('bounds the tombstone FIFO, dropping the oldest ids first', async () => {
    const router = mkRouter({
      maxSessions: 4,
      maxUnauthenticatedSessions: 1,
      maxResurrectableSessions: 2,
    })

    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const s = await initialize(router)
      ids.push(s.sessionId as string)
    }
    // Each initialize evicted the previous session, so ids[0..2] were
    // tombstoned in order and the bound of 2 dropped the oldest.
    expect(await ping(router, ids[0] as string)).toBe(404)
    expect(await ping(router, ids[2] as string)).not.toBe(404)
  })

  /**
   * A tombstone runs on the SAME clock the session it replaces ran on:
   * a provisional session's absolute lifetime, measured from its
   * `initialize`. Past that deadline the id is forgotten.
   */
  it('expires a tombstone on the provisional lifetime clock', async () => {
    const c = clock()
    const router = mkRouter(
      { maxSessions: 4, maxUnauthenticatedSessions: 1, unauthenticatedMaxLifetimeMs: 60_000 },
      { now: c.now },
    )

    const first = await initialize(router)
    await initialize(router) // evicts `first`

    c.advance(30_000)
    expect(await ping(router, first.sessionId as string)).not.toBe(404)

    const second = await initialize(router)
    await initialize(router) // evicts `second`
    c.advance(61_000)
    expect(await ping(router, second.sessionId as string)).toBe(404)
  })

  /**
   * A resurrected session INHERITS its predecessor's `createdAt`, so
   * resurrection cannot be used to renew the absolute provisional
   * lifetime. Resetting the clock here would let a caller hold a quota
   * slot forever by letting it lapse and replaying the id — exactly the
   * refreshable-window defect `unauthenticatedMaxLifetimeMs` exists to
   * close.
   */
  it('does not renew the absolute provisional lifetime', async () => {
    const c = clock()
    const router = mkRouter(
      { maxSessions: 4, maxUnauthenticatedSessions: 1, unauthenticatedMaxLifetimeMs: 60_000 },
      { now: c.now },
    )

    const first = await initialize(router)
    c.advance(30_000)
    await initialize(router) // evicts `first`

    expect(await ping(router, first.sessionId as string)).not.toBe(404)
    // 61 s after the ORIGINAL initialize, not after the resurrect.
    c.advance(31_000)
    expect(await ping(router, first.sessionId as string)).toBe(404)
  })

  /**
   * A DELETE is a client saying "I am done with this id". Rebuilding a
   * session to immediately tear it down is a pure allocation for
   * nothing, so a tombstoned id answers the termination directly.
   */
  it('answers a DELETE on a tombstoned id without allocating', async () => {
    const router = mkRouter({ maxSessions: 4, maxUnauthenticatedSessions: 1 })
    const first = await initialize(router)
    await initialize(router) // evicts `first`
    expect(router.liveSessionCount()).toBe(1)

    const res = await router(
      new Request('http://local/agent/mcp', {
        method: 'DELETE',
        headers: { 'mcp-session-id': first.sessionId as string },
      }),
    )
    expect(res?.status).toBe(200)
    expect(router.liveSessionCount()).toBe(1)
    // And the id is forgotten — a replay after termination gets a 404.
    expect(await ping(router, first.sessionId as string)).toBe(404)
  })
})

describe('MCP session resurrection — concurrency (#149)', () => {
  /**
   * Overlapping requests on one session id are normal in MCP (the SDK
   * runs a standalone GET stream alongside POSTs). Two of them racing
   * a resurrect must produce ONE session: a second `sessions.set` under
   * the same id would strand the first transport + `McpServer` with
   * nothing accounting for them — a permanent leak inside a bound whose
   * whole job is to stop that.
   *
   * The rate limiter is the observable: exactly one allocation attempt.
   */
  it('resurrects once when two requests race the same id', async () => {
    let checks = 0
    const counting: RateLimiter = {
      check: async () => {
        checks++
        return { allowed: true }
      },
    }
    const router = mkRouter(
      { maxSessions: 8, maxUnauthenticatedSessions: 2 },
      { rateLimiter: counting },
    )

    const first = await initialize(router)
    await initialize(router)
    await initialize(router) // evicts `first` (LRU)
    expect(router.liveSessionCount()).toBe(2)

    checks = 0
    const [a, b] = await Promise.all([
      ping(router, first.sessionId as string),
      ping(router, first.sessionId as string),
    ])
    expect(checks).toBe(1)
    expect(a).not.toBe(404)
    expect(b).not.toBe(404)
    expect(router.liveSessionCount()).toBe(2)
  })
})
