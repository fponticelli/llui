import { describe, it, expect, vi } from 'vitest'
import { createMcpRouter, type McpRouter } from '../../../src/server/mcp/router.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'
import { seedToken } from '../_token-helper.js'

/**
 * The four defects found reviewing the session-resurrection work
 * (#186, #187, #188, #190), plus the bound-attack probes that keep
 * their fixes honest.
 *
 * Everything here is about ONE number: `liveSessionCount()`, the
 * occupancy the endpoint's memory bound is enforced on. #102 filed the
 * unbounded-allocation defect that put the bound there; none of these
 * fixes may loosen it, and two of them (#186, #190) are about the bound
 * being reported or granted WRONGLY rather than breached.
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

vi.setConfig({ testTimeout: 60_000 })

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

function replayRequest(sessionId: string, headers: Record<string, string> = {}): Request {
  return new Request('http://local/agent/mcp', {
    method: 'POST',
    headers: { 'mcp-session-id': sessionId, ...headers },
  })
}

/** A bare POST on a session id — the cheapest probe for "is it there". */
async function ping(router: McpRouter, sessionId: string): Promise<number> {
  return (await router(replayRequest(sessionId)))?.status ?? 0
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

async function callTool(
  router: McpRouter,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const res = await router(toolCallRequest(sessionId, name, args))
  if (!res) throw new Error('mcp router did not claim the request')
  const text = await res.text()
  const line = text
    .split('\n')
    .find((l) => l.startsWith('data:'))
    ?.slice('data:'.length)
    .trim()
  return { status: res.status, result: line ? (JSON.parse(line) as ToolOutcome['result']) : null }
}

/**
 * Sample a counter on every microtask tick for as long as `work` is
 * in flight.
 *
 * The transient this catches lives entirely between two `await`s, so
 * nothing observed from OUTSIDE the request can see it — the sampler
 * has to run on the same event loop and read between the ticks. A pure
 * microtask spin would starve any timer the work waits on, hence the
 * periodic macrotask yield.
 */
async function sampleWhile<T>(
  work: Promise<T>,
  read: () => number,
): Promise<{ result: T; samples: number[] }> {
  const samples: number[] = [read()]
  let settled = false
  const tracked = work.then(
    (r) => {
      settled = true
      return r
    },
    (e: unknown) => {
      settled = true
      throw e
    },
  )
  for (let i = 0; i < 20_000 && !settled; i++) {
    samples.push(read())
    await (i % 200 === 199 ? new Promise((r) => setTimeout(r, 0)) : Promise.resolve())
  }
  const result = await tracked
  samples.push(read())
  return { result, samples }
}

describe('MCP router — reported occupancy during a resurrect (#186)', () => {
  /**
   * The defect. `resurrect()` registered the rebuilt session and then
   * replayed the client's request BEFORE handing its reservation back,
   * so across that `await` the session was counted twice — once in
   * `sessions`, once in `reserved` — and `liveSessionCount()` read
   * `maxSessions + 1`. Measured at `maxSessions: 2` as samples of
   * `{2, 3}`.
   *
   * Never a breach: `sessions.size` held the bound throughout. The cost
   * is OVER-strictness, on the number the quota is documented as being
   * enforced on — a concurrent caller could see a spurious 503, or
   * trigger one LRU eviction that was not needed.
   *
   * The `initialize` path has always avoided exactly this and says so:
   * "there is no `await` between the `set` and the release".
   */
  it('never reports more than maxSessions while a resurrect replays', async () => {
    const router = mkRouter({ maxSessions: 2, maxUnauthenticatedSessions: 2 })

    const doomed = await initialize(router)
    await initialize(router)
    await initialize(router) // evicts `doomed` (LRU), leaving a tombstone
    expect(router.liveSessionCount()).toBe(2)

    const { result, samples } = await sampleWhile(
      router(replayRequest(doomed.sessionId as string)),
      () => router.liveSessionCount(),
    )

    expect(result?.status).not.toBe(404)
    expect(router.hasLiveSession(doomed.sessionId as string)).toBe(true)
    expect(Math.max(...samples)).toBe(2)
    expect(samples.length).toBeGreaterThan(2)
    // The OTHER direction of the same fix, and the one a sampler cannot
    // see: releasing the reservation twice (the naive way to "release
    // it early") drives `reserved` NEGATIVE, which under-reports
    // occupancy and over-admits — a breach, where #186 was only
    // over-strictness. The bound is exact, not an upper limit.
    expect(router.liveSessionCount()).toBe(2)
    expect(Math.min(...samples)).toBe(2)
  })

  /**
   * The REFUSAL routes, which are the ones a caller can actually drive:
   * all three of them (the rate limiter, the fail-closed bearer check,
   * a full quota) return BEFORE `reserveSlot` is reached, so a refused
   * resurrect must cost nothing because it never took a slot in the
   * first place. Repeated because a miscounted slot is cumulative — one
   * would be invisible, eight are not.
   *
   * Note what this does NOT cover, since the distinction is exactly
   * where a mutation slipped through review: it cannot detect a missing
   * release in the trailing `finally`, because no route it drives has
   * taken a reservation by the time it returns. The failure-AFTER-
   * reservation route (a throw from `buildSession` / `connect` / the
   * handshake) is the one that needs that `finally`, and it is covered
   * in `router-reservation.test.ts`, which can force those throws.
   */
  it('leaks no reservation across repeated refused resurrects', async () => {
    const router = mkRouter({ maxSessions: 2, maxUnauthenticatedSessions: 2 })

    const doomed = await initialize(router)
    await initialize(router)
    await initialize(router) // evicts `doomed`
    const id = doomed.sessionId as string

    for (let i = 0; i < 8; i++) {
      const res = await router(replayRequest(id, { authorization: 'Bearer agt_not-a-real-token' }))
      expect(res?.status).toBe(401)
      // A refused resurrect must cost exactly nothing, every time.
      expect(router.liveSessionCount()).toBe(2)
    }

    // If any of those had kept its reservation, `reserved` would be
    // permanently inflated and this would 503 with a half-empty map.
    expect(await ping(router, id)).not.toBe(404)
    expect(router.liveSessionCount()).toBe(2)
  })
})

describe('MCP router — a race loser gets the truthful refusal (#187)', () => {
  /**
   * The defect. The loser of a deduplicated resurrect looked the
   * session up and read "not there" as "the server has forgotten this
   * id", answering 404. When the winner was REFUSED (429/503) nothing
   * was registered, so two concurrent replays on a full quota measured
   * `[503, 404]` — while a SERIAL retry of the same id got the honest
   * 503, because the tombstone survives a refusal.
   *
   * A 404 is the one answer the MCP SDK cannot recover from, and it is
   * FALSE here: the server still holds a live tombstone for that id and
   * would rebuild it on a later attempt.
   */
  it('refuses both concurrent replays instead of 404-ing the loser', async () => {
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    const doomed = await initialize(router)
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }
    // Every slot is held by an authenticated session, which is never
    // evictable for an anonymous caller — so a resurrect cannot land.
    expect(router.liveSessionCount()).toBe(2)
    const id = doomed.sessionId as string

    const [first, second] = await Promise.all([
      router(replayRequest(id)),
      router(replayRequest(id)),
    ])

    expect([first?.status, second?.status]).toEqual([503, 503])
    expect(first?.headers.get('retry-after')).toBe('30')
    expect(second?.headers.get('retry-after')).toBe('30')
    // The refusal is what the bound demands; it must not have cost a slot.
    expect(router.liveSessionCount()).toBe(2)
    expect(router.hasLiveSession(id)).toBe(false)
    // Refused, not forgotten — a serial retry says the same thing.
    expect(await ping(router, id)).toBe(503)
    expect(router.retainedTombstoneCount()).toBe(1)
  })

  /**
   * The other half: the refusal is re-DERIVED, not copied, so the
   * moment the pressure lifts the same id resurrects normally. Copying
   * the winner's response would have handed the loser a refusal that
   * had already stopped being true.
   */
  it('resurrects the same id once a slot frees', async () => {
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    const doomed = await initialize(router)
    const authed: string[] = []
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
      authed.push(sessionId as string)
    }
    const id = doomed.sessionId as string
    expect(await ping(router, id)).toBe(503)

    // The client of one authenticated session goes away properly.
    await router(
      new Request('http://local/agent/mcp', {
        method: 'DELETE',
        headers: { 'mcp-session-id': authed[0] as string },
      }),
    )
    expect(router.liveSessionCount()).toBe(1)

    expect(await ping(router, id)).not.toBe(404)
    expect(router.hasLiveSession(id)).toBe(true)
    expect(router.liveSessionCount()).toBe(2)
  })

  /**
   * A re-attempt is an ALLOCATION and is gated like one. On a
   * rate-limited bucket the loser is refused 429 — not served, and not
   * 404'd either.
   */
  it('rate-limits the loser rather than serving or forgetting it', async () => {
    // Budgeted, and armed only after the fixture is built: the limiter
    // gates every allocation, setup included.
    let budget = Number.POSITIVE_INFINITY
    const oneShot: RateLimiter = {
      check: async () => {
        if (budget <= 0) return { allowed: false, retryAfterMs: 5_000 }
        budget--
        return { allowed: true }
      },
    }
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store, rateLimiter: oneShot },
    )

    const doomed = await initialize(router)
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }
    const id = doomed.sessionId as string

    budget = 1
    const [first, second] = await Promise.all([
      router(replayRequest(id)),
      router(replayRequest(id)),
    ])
    // The winner spends the last token and is refused by the quota; the
    // loser re-attempts, finds the bucket empty and is refused by the
    // limiter. Neither is served, and neither is told the id is gone.
    const statuses = [first?.status, second?.status].sort((x, y) => (x ?? 0) - (y ?? 0))
    expect(statuses).toEqual([429, 503])
    expect(router.liveSessionCount()).toBe(2)
  })

  /**
   * The 404 still has to mean what it says. An id the server never
   * issued gets one — under concurrency as much as serially — and
   * allocates nothing on the way.
   */
  it('still 404s an id it never issued, concurrently', async () => {
    const router = mkRouter({ maxSessions: 4, maxUnauthenticatedSessions: 4 })
    await initialize(router)
    const before = router.liveSessionCount()

    const stranger = crypto.randomUUID()
    const statuses = await Promise.all([
      ping(router, stranger),
      ping(router, stranger),
      ping(router, stranger),
    ])
    expect(statuses).toEqual([404, 404, 404])
    expect(router.liveSessionCount()).toBe(before)
  })

  /**
   * …and a DELETE still terminates durably when it loses the race to a
   * REFUSED resurrect. That request used to fall out of the waiter
   * branch with a 404 having forgotten nothing, so the id stayed
   * resurrectable after the client said it was done with it.
   */
  it('honours a DELETE that loses the race to a refused resurrect', async () => {
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    const doomed = await initialize(router)
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }
    const id = doomed.sessionId as string

    const [replayed, deleted] = await Promise.all([
      router(replayRequest(id)),
      router(
        new Request('http://local/agent/mcp', {
          method: 'DELETE',
          headers: { 'mcp-session-id': id },
        }),
      ),
    ])
    expect(replayed?.status).toBe(503)
    expect(deleted?.status).toBe(200)
    // Durable: the termination is remembered even though the resurrect
    // it raced never registered a session.
    expect(await ping(router, id)).toBe(404)
    expect(router.retainedTombstoneCount()).toBe(0)
  })

  /**
   * The retry loop's TERMINATION and its cost, both asserted rather
   * than argued. A request either returns or waits on a resurrect
   * started by some OTHER request; each request starts at most one (it
   * returns that attempt); and the gate leaves `resurrecting` before
   * any waiter resumes. So N overlapping replays cost at most N
   * allocation attempts — exactly what the same N requests issued
   * SERIALLY would cost, which is the ceiling that matters: a loop that
   * re-attempted more than once per request would be an amplifier
   * bolted onto the allocation path.
   */
  it('terminates and consults the limiter at most once per replay', async () => {
    let checks = 0
    const counting: RateLimiter = {
      check: async () => {
        checks++
        return { allowed: true }
      },
    }
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store, rateLimiter: counting },
    )

    const doomed = await initialize(router)
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }
    const id = doomed.sessionId as string

    checks = 0
    const REPLAYS = 12
    const statuses = await Promise.all(
      Array.from({ length: REPLAYS }, async () => (await router(replayRequest(id)))?.status),
    )
    expect(statuses).toEqual(Array.from({ length: REPLAYS }, () => 503))
    expect(checks).toBeLessThanOrEqual(REPLAYS)
    expect(router.liveSessionCount()).toBe(2)
    expect(router.retainedTombstoneCount()).toBe(1)
  })

  /**
   * The dedup itself is unchanged in the SUCCESS direction, and it has
   * to be: two `sessions.set` under one id strand a transport +
   * `McpServer` with nothing accounting for them. Exactly one
   * allocation attempt, and the loser rides the winner's session.
   */
  it('still resurrects exactly once when both replays can be served', async () => {
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
    await initialize(router) // evicts `first`

    checks = 0
    const id = first.sessionId as string
    const statuses = await Promise.all([ping(router, id), ping(router, id), ping(router, id)])
    expect(checks).toBe(1)
    expect(statuses.some((s) => s === 404)).toBe(false)
    expect(router.liveSessionCount()).toBe(2)
  })
})

describe('MCP router — incremental tombstone reclamation (#188)', () => {
  const LIFETIME = 60_000

  /** Fill the tombstone FIFO by churning provisional sessions. */
  async function churn(router: McpRouter, n: number): Promise<string[]> {
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      const s = await initialize(router)
      ids.push(s.sessionId as string)
    }
    return ids
  }

  /**
   * The defect. `sweep()` ended with a full walk of the tombstone map
   * on EVERY request — O(`maxResurrectableSessions`) per request, which
   * is nothing at the default (`maxSessions * 4`) and ~5.8 ms/request
   * at 20 000 (200 requests: 330 ms at 256 tombstones, 1496 ms at
   * ~20 000).
   *
   * An early `break` would be UNSOUND: the map's insertion order is by
   * LAST DROP while the deadline is built from an INHERITED
   * `createdAt`, so it is not ordered by deadline and a recently
   * inserted entry can expire before an older one. The fix is a
   * resumable CURSOR — every entry is still visited, just across
   * several requests — which is why this asserts the SHAPE of the
   * reclamation (bounded slice, complete round) rather than a clock
   * reading.
   */
  it('reclaims expired tombstones in bounded slices, not one full scan', async () => {
    const c = clock()
    const router = mkRouter(
      {
        maxSessions: 2,
        maxUnauthenticatedSessions: 1,
        maxResurrectableSessions: 512,
        unauthenticatedMaxLifetimeMs: LIFETIME,
      },
      { now: c.now },
    )

    await churn(router, 201) // each initialize evicts the previous one
    expect(router.retainedTombstoneCount()).toBe(200)

    // Every tombstone (and the one live session) is now past its clock.
    c.advance(LIFETIME + 1_000)

    const stranger = crypto.randomUUID()
    expect(await ping(router, stranger)).toBe(404)
    const afterOne = router.retainedTombstoneCount()
    // One request reclaims a SLICE. A full scan would have emptied the
    // map here; this asserts the per-request work is bounded, which is
    // the whole of #188.
    expect(afterOne).toBeGreaterThan(120)
    expect(afterOne).toBeLessThan(201)

    // …and the round still completes: reclamation is delayed, never
    // abandoned. Without this half a cursor would be indistinguishable
    // from deleting the sweep.
    for (let i = 0; i < 10 && router.retainedTombstoneCount() > 0; i++) {
      await ping(router, stranger)
    }
    expect(router.retainedTombstoneCount()).toBe(0)
  })

  /**
   * Reclamation is MEMORY, never an answer. `resurrectable()` re-checks
   * the deadline at lookup, so an entry the cursor has not reached
   * behaves exactly like one it has — an expired id 404s on the very
   * first request after its deadline, with hundreds of unswept entries
   * still in the map.
   */
  it('answers an expired id 404 before its slice is reached', async () => {
    const c = clock()
    const router = mkRouter(
      {
        maxSessions: 2,
        maxUnauthenticatedSessions: 1,
        maxResurrectableSessions: 512,
        unauthenticatedMaxLifetimeMs: LIFETIME,
      },
      { now: c.now },
    )

    const ids = await churn(router, 201)
    // The OLDEST tombstone: the last entry any cursor round reaches.
    const oldest = ids[0] as string
    c.advance(LIFETIME + 1_000)

    expect(await ping(router, oldest)).toBe(404)
    expect(router.retainedTombstoneCount()).toBeGreaterThan(120)
  })

  /**
   * The UNSOUND "optimisation" this fix must never be replaced by,
   * pinned as a behaviour rather than a comment.
   *
   * Breaking out of the walk at the first non-expired entry is the
   * obvious move on a time-ordered queue, and this map is not one: it
   * is ordered by LAST DROP, while the deadline is built from an
   * INHERITED `createdAt`. This builds exactly that inversion — a
   * NEWER entry that expires LATER sitting in front of an OLDER one
   * that has already expired — and asserts the expired one behind it is
   * still reclaimed. An early break leaves it stranded past its clock.
   */
  it('reclaims an expired tombstone sitting behind a live one', async () => {
    const c = clock(0)
    const router = mkRouter(
      {
        maxSessions: 2,
        maxUnauthenticatedSessions: 1,
        maxResurrectableSessions: 8,
        unauthenticatedMaxLifetimeMs: LIFETIME,
      },
      { now: c.now },
    )

    // A is born at t=0.
    const a = (await initialize(router)).sessionId as string
    c.advance(50_000)
    // B is born at t=50 000 and evicts A, tombstoning A{createdAt: 0}.
    await initialize(router)
    c.advance(1_000)
    // Replaying A rebuilds it with its INHERITED createdAt of 0 and
    // evicts B, so the map is now [B{50 000}] and A carries an old
    // clock on a live session.
    expect(await ping(router, a)).not.toBe(404)
    c.advance(1_000)
    // C evicts A again, which re-inserts A at the BACK of the FIFO —
    // behind B — still carrying createdAt 0.
    await initialize(router)
    expect(router.retainedTombstoneCount()).toBe(2)

    // t=112 000: A (deadline 60 000) is expired; B (deadline 110 000)
    // has just under 8 s left. Insertion order is [B, A].
    c.advance(56_000)
    expect(await ping(router, crypto.randomUUID())).toBe(404)

    // Only A goes. Stopping at B — the first live entry — would leave
    // the map at 2 with an entry 52 s past its deadline in it.
    expect(router.retainedTombstoneCount()).toBe(1)
  })

  /**
   * A slower sweep must not loosen the FIFO ceiling — the tombstone set
   * is caller-caused state and the ceiling is its bound, enforced at
   * insertion regardless of what has been reclaimed.
   */
  it('holds the tombstone ceiling while entries wait to be reclaimed', async () => {
    const c = clock()
    const router = mkRouter(
      {
        maxSessions: 2,
        maxUnauthenticatedSessions: 1,
        maxResurrectableSessions: 32,
        unauthenticatedMaxLifetimeMs: LIFETIME,
      },
      { now: c.now },
    )

    for (let i = 0; i < 200; i++) {
      await initialize(router)
      expect(router.retainedTombstoneCount()).toBeLessThanOrEqual(32)
      // Advance inside the lifetime for a while, then past it, so both
      // the live and the expired regimes are exercised.
      c.advance(i < 100 ? 100 : 5_000)
    }
    expect(router.retainedTombstoneCount()).toBeLessThanOrEqual(32)
  })
})

describe('MCP router — a revoked bearer buys no admission (#190)', () => {
  /**
   * The defect. `verifyAndReadTid` never read `rec.status`, so a
   * REVOKED token verified and `initialize` marked the session
   * `admitted: true` — placing it OUTSIDE `maxUnauthenticatedSessions`
   * and making it un-evictable for an anonymous caller. Revocation was
   * enforced at tool-call time only, so the token could not DRIVE the
   * app; what it still bought was resource admission for a dead `tid`.
   *
   * Measured before the fix at `maxUnauthenticatedSessions: 1`: the
   * initialize returned 200 and the session survived six subsequent
   * anonymous initializes.
   */
  it('refuses an initialize carrying a revoked bearer, allocating nothing', async () => {
    const store = new InMemoryTokenStore()
    const dead = await seedToken(store, { tid: 't-dead', status: 'revoked' })
    const router = mkRouter(
      { maxSessions: 8, maxUnauthenticatedSessions: 1 },
      { tokenStore: store },
    )

    const res = await router(initializeRequest({ authorization: `Bearer ${dead.token}` }))
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: { code: 'revoked' } })
    expect(res?.headers.get('mcp-session-id')).toBeNull()
    expect(router.liveSessionCount()).toBe(0)

    // The un-evictable slot is what the defect actually bought, so the
    // check is that anonymous churn owns the whole quota afterwards.
    for (let i = 0; i < 6; i++) {
      expect((await initialize(router)).status).toBe(200)
      expect(router.liveSessionCount()).toBe(1)
    }
  })

  /**
   * The REACHABLE half, and the correction to #190 as filed.
   *
   * Going through `store.revoke(tid)` — what `/agent/revoke` actually
   * calls — never reaches the status check at all:
   * `InMemoryTokenStore.revoke` deletes the `tokenHash` index entry, so
   * `findByTokenHash` returns null and `verifyAndReadTid` bails on the
   * uniform `401` one step earlier. That was true BEFORE this change
   * and is true after; the issue's "a revoked token is admitted"
   * measurement only reproduces from a record SEEDED revoked, i.e. a
   * store that keeps the row indexed.
   *
   * Pinned in both directions so nobody "fixes" the docs back: the
   * status code here is 401, and the admission is refused either way.
   */
  it('refuses a token revoked through the store with the uniform 401', async () => {
    const store = new InMemoryTokenStore()
    const live = await seedToken(store, { tid: 't-live' })
    const router = mkRouter(
      { maxSessions: 8, maxUnauthenticatedSessions: 1 },
      { tokenStore: store },
    )

    await store.revoke('t-live')

    const res = await router(initializeRequest({ authorization: `Bearer ${live.token}` }))
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: { code: 'auth-failed' } })
    expect(router.liveSessionCount()).toBe(0)

    // Whichever code it answered with, it bought no un-evictable slot.
    for (let i = 0; i < 6; i++) {
      expect((await initialize(router)).status).toBe(200)
      expect(router.liveSessionCount()).toBe(1)
    }
  })

  /**
   * A VALID bearer still buys admission on `initialize` — this closes a
   * status hole, it does not turn the admission credential off.
   */
  it('still admits a live bearer outside the anonymous quota', async () => {
    const store = new InMemoryTokenStore()
    const live = await seedToken(store, { tid: 't1' })
    const router = mkRouter(
      { maxSessions: 8, maxUnauthenticatedSessions: 1 },
      { tokenStore: store },
    )

    const admitted = await initialize(router, { authorization: `Bearer ${live.token}` })
    expect(admitted.status).toBe(200)
    for (let i = 0; i < 6; i++) expect((await initialize(router)).status).toBe(200)
    // Anonymous churn can never displace it.
    expect(router.hasLiveSession(admitted.sessionId as string)).toBe(true)
  })

  /**
   * Both callers inherit the check, which is why it lives in
   * `verifyAndReadTid`. On the resurrect path a valid bearer buys
   * nothing by design, so the only thing a bearer can do there is make
   * the request STRICTER — and a revoked one now does.
   */
  it('refuses a resurrect carrying a revoked bearer, remembering the id', async () => {
    const store = new InMemoryTokenStore()
    const dead = await seedToken(store, { tid: 't-dead', status: 'revoked' })
    const router = mkRouter(
      { maxSessions: 4, maxUnauthenticatedSessions: 1 },
      { tokenStore: store },
    )

    const first = await initialize(router)
    await initialize(router) // evicts `first`
    const id = first.sessionId as string

    const res = await router(replayRequest(id, { authorization: `Bearer ${dead.token}` }))
    expect(res?.status).toBe(403)
    expect(router.hasLiveSession(id)).toBe(false)
    expect(router.liveSessionCount()).toBe(1)
    // Refused, not forgotten.
    expect(await ping(router, id)).not.toBe(404)
  })
})

describe('MCP router — bound attack (#102 stays closed)', () => {
  /**
   * The adversarial probe the four fixes are measured against: a
   * concurrent mix of every path that can allocate or free a slot —
   * fresh initializes, replays of tombstoned ids, DELETEs, and the
   * expiry clock — with `liveSessionCount()` sampled between every
   * microtask.
   *
   * The assertion is the bound itself. `liveSessionCount()` counts
   * reservations as well as registrations precisely so that an
   * in-flight allocation cannot hide inside it, and #186 was a defect
   * in this number rather than in the map behind it, so the number is
   * what gets watched.
   */
  it('never exceeds maxSessions under a concurrent initialize/replay/DELETE/expiry mix', async () => {
    const c = clock()
    const MAX = 6
    const store = new InMemoryTokenStore()
    // MORE distinct identities than there are slots, each with a valid
    // bearer. This is what makes `maxSessions` the binding constraint
    // rather than `maxUnauthenticatedSessions`: an ADMITTED session is
    // outside the anonymous quota and is never evictable for an
    // anonymous caller, so a burst of them contends the hard ceiling
    // directly — which is the only limb a probe of the hard ceiling can
    // be measuring.
    const bearers: string[] = []
    for (let i = 0; i < 10; i++) {
      const { token } = await seedToken(store, { tid: `t${i}`, now: c.now() })
      bearers.push(token)
    }
    const router = mkRouter(
      {
        maxSessions: MAX,
        maxUnauthenticatedSessions: 3,
        maxSessionsPerIdentity: 10,
        unauthenticatedMaxLifetimeMs: 30_000,
        idleTtlMs: 45_000,
      },
      { tokenStore: store, now: c.now },
    )

    const issued: string[] = []
    const peaks: number[] = []
    for (let round = 0; round < 12; round++) {
      const inFlight: Promise<Response | null>[] = []
      // Deliberately MORE anonymous initializes in one tick than there
      // are slots: they are the burst that first proved reservations
      // have to be counted by the quota (#102 — `maxSessions: 8`, 500
      // concurrent initializes, 500 live sessions). Every one of them
      // is suspended between the check and the `sessions.set`, so a
      // quota reading only the map sees an empty endpoint N times over.
      for (let i = 0; i < MAX * 2; i++) inFlight.push(router(initializeRequest()))
      for (const token of bearers) {
        inFlight.push(router(initializeRequest({ authorization: `Bearer ${token}` })))
      }
      for (const id of issued.slice(-8)) inFlight.push(router(replayRequest(id)))
      for (const id of issued.slice(-3)) {
        inFlight.push(
          router(
            new Request('http://local/agent/mcp', {
              method: 'DELETE',
              headers: { 'mcp-session-id': id },
            }),
          ),
        )
      }

      const { result, samples } = await sampleWhile(Promise.all(inFlight), () =>
        router.liveSessionCount(),
      )
      peaks.push(Math.max(...samples))
      expect(Math.max(...samples)).toBeLessThanOrEqual(MAX)

      for (const res of result) {
        const id = res?.headers.get('mcp-session-id')
        if (id) issued.push(id)
      }
      // Push some of the fleet past the provisional lifetime so the
      // sweep runs against a map that is being mutated concurrently.
      c.advance(round % 3 === 2 ? 31_000 : 1_000)
    }

    expect(Math.max(...peaks)).toBeLessThanOrEqual(MAX)
    expect(router.liveSessionCount()).toBeLessThanOrEqual(MAX)
  })

  /**
   * The refusal half. A full quota still refuses — with the honest 503
   * and a `retry-after` — whether the pressure arrives as fresh
   * initializes or as replayed tombstones. Resurrection recovers a
   * burst; it never survives a siege.
   */
  it('still 503s a full quota, from both allocation doors', async () => {
    const store = new InMemoryTokenStore()
    const a = await seedToken(store, { tid: 't1' })
    const b = await seedToken(store, { tid: 't2' })
    const router = mkRouter(
      { maxSessions: 2, maxUnauthenticatedSessions: 2 },
      { tokenStore: store },
    )

    const doomed = await initialize(router)
    for (const t of [a, b]) {
      const { sessionId } = await initialize(router)
      await callTool(router, sessionId as string, 'connect_session', { token: t.token })
    }

    const fresh = await router(initializeRequest())
    expect(fresh?.status).toBe(503)
    expect(fresh?.headers.get('retry-after')).toBe('30')

    const replayed = await router(replayRequest(doomed.sessionId as string))
    expect(replayed?.status).toBe(503)
    expect(replayed?.headers.get('retry-after')).toBe('30')

    expect(router.liveSessionCount()).toBe(2)
  })

  /**
   * The #149 scenario the whole resurrection mechanism exists for,
   * re-run through the CONCURRENT waiter path this change rewrote: the
   * human's pairing session is evicted by an anonymous burst while they
   * read the panel, and their paste — racing the SDK's own standalone
   * stream on the same id — still connects.
   */
  it('closes the reported pairing scenario with an overlapping request', async () => {
    const c = clock()
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 't1', now: c.now() })
    const router = mkRouter({}, { tokenStore: store, now: c.now })

    const pairing = await initialize(router)
    for (let i = 0; i < 20; i++) {
      c.advance(1_000)
      expect((await initialize(router)).status).toBe(200)
    }
    const id = pairing.sessionId as string

    // The paste and an overlapping probe on the same id, same tick.
    const paste = router(toolCallRequest(id, 'connect_session', { token }))
    const overlap = router(replayRequest(id))
    const [pasted, probed] = await Promise.all([paste, overlap])

    expect(probed?.status).not.toBe(404)
    const text = await pasted?.text()
    const line = text
      ?.split('\n')
      .find((l) => l.startsWith('data:'))
      ?.slice('data:'.length)
      .trim()
    const parsed = line ? (JSON.parse(line) as ToolOutcome['result']) : null
    expect(parsed?.result?.isError).toBeFalsy()
    expect(parsed?.result?.structuredContent?.status).toBe('connected')
    expect(router.hasBoundToken(id)).toBe(true)
  })
})
