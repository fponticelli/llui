import { describe, it, expect, vi } from 'vitest'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

/**
 * A reservation is taken synchronously and handed back in a `finally`.
 * That `finally` is only worth what it wraps: the transport constructor,
 * its `onclose` wiring and `createAgentMcpServer` used to sit ABOVE the
 * `try`, so a synchronous throw from any of them lost the slot for the
 * lifetime of the process — every later `initialize` counted a session
 * that was never built.
 *
 * All THREE of those statements are covered here, one test each. Pinning
 * only the last of them would leave the first two free to drift back out
 * of the `try` with the suite still green, which is the same silent
 * regression in a different line.
 *
 * Nothing on that path reads request data today, so this is a guard on
 * the shape rather than a live defect. It is worth a test precisely
 * because the comment on the `finally` claims it covers every exit path:
 * the only way to keep that claim honest as the constructors grow is to
 * make the claim fail when it stops being true.
 */
const FAIL_POINTS = ['transport-constructor', 'transport-onclose', 'server-build'] as const
type FailPoint = (typeof FAIL_POINTS)[number]

/** Arm exactly one failure, consumed by the first allocation that reaches it. */
let failAt: FailPoint | null = null

const failIfArmed = (point: FailPoint): void => {
  if (failAt !== point) return
  failAt = null
  throw new Error(`allocation failed at ${point}`)
}

type TransportModule =
  typeof import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js')

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', async (importOriginal) => {
  const actual = await importOriginal<TransportModule>()
  type TransportArgs = ConstructorParameters<typeof actual.WebStandardStreamableHTTPServerTransport>
  class InstrumentedTransport extends actual.WebStandardStreamableHTTPServerTransport {
    constructor(...args: TransportArgs) {
      failIfArmed('transport-constructor')
      super(...args)
      if (failAt !== 'transport-onclose') return
      failAt = null
      // `onclose` is a plain property on the SDK class, so a subclass
      // accessor is a type error (TS2610) — an own property installed
      // here is what makes the router's `t.onclose = …` assignment
      // throw. The getter keeps `close()`'s `this.onclose?.()` working,
      // so the catch path's cleanup still runs.
      Object.defineProperty(this, 'onclose', {
        configurable: true,
        get: () => undefined,
        set: () => {
          throw new Error('allocation failed at transport-onclose')
        },
      })
    }
  }
  return { ...actual, WebStandardStreamableHTTPServerTransport: InstrumentedTransport }
})

vi.mock('../../../src/server/mcp/server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/mcp/server.js')>()
  return {
    ...actual,
    createAgentMcpServer: (args: Parameters<typeof actual.createAgentMcpServer>[0]) => {
      failIfArmed('server-build')
      return actual.createAgentMcpServer(args)
    },
  }
})

const { createMcpRouter } = await import('../../../src/server/mcp/router.js')

const neverLimited: RateLimiter = { check: async () => ({ allowed: true }) }

function initializeRequest(): Request {
  return new Request('http://local/agent/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
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

describe('MCP router slot reservation (#102)', () => {
  for (const point of FAIL_POINTS) {
    it(`hands the slot back when the allocation throws at ${point}`, async () => {
      const router = createMcpRouter(
        {
          coreRouter: async () => null,
          tokenStore: new InMemoryTokenStore(),
          lapBasePath: '/agent/lap/v1',
          rateLimiter: neverLimited,
        },
        { maxSessions: 1, maxUnauthenticatedSessions: 1 },
      )

      failAt = point
      await expect(router(initializeRequest())).rejects.toThrow(`allocation failed at ${point}`)

      // The failed attempt retained nothing, so it must have cost nothing.
      expect(router.liveSessionCount()).toBe(0)
      const after = await router(initializeRequest())
      expect(after?.status).toBe(200)
      expect(router.liveSessionCount()).toBe(1)
    })
  }
})

/**
 * The same discipline on the RESURRECT path (#186), and specifically on
 * the one route nothing else reaches.
 *
 * A resurrect releases its reservation TWICE over, from two places: the
 * success route hands it back the instant `sessions.set` registers the
 * session (no `await` between the two, or the slot is momentarily
 * double-counted — that is #186), and a trailing `finally` covers
 * everything else. Both are needed and the two are made safe by an
 * idempotent `release()`.
 *
 * The `finally` half is invisible to every test that drives a REFUSAL,
 * because all three refusal routes — the rate limiter, the fail-closed
 * bearer check, a full quota — return BEFORE `reserveSlot` is reached.
 * The only way to hold a reservation and then fail is to THROW after
 * taking it, which is exactly what the fail points above force. Deleting
 * the `finally` release left the whole suite green until this existed;
 * a leaked reservation is permanent, since nothing sweeps a slot with
 * no id.
 */
describe('MCP router slot reservation on the resurrect path (#186)', () => {
  const initialize = async (router: ReturnType<typeof createMcpRouter>): Promise<string | null> => {
    const res = await router(initializeRequest())
    return res?.headers.get('mcp-session-id') ?? null
  }

  for (const point of FAIL_POINTS) {
    it(`hands the slot back when a resurrect throws at ${point}`, async () => {
      const router = createMcpRouter(
        {
          coreRouter: async () => null,
          tokenStore: new InMemoryTokenStore(),
          lapBasePath: '/agent/lap/v1',
          rateLimiter: neverLimited,
        },
        { maxSessions: 4, maxUnauthenticatedSessions: 1 },
      )

      const doomed = await initialize(router)
      await initialize(router) // evicts `doomed`, leaving a tombstone
      expect(router.liveSessionCount()).toBe(1)

      // The replay reserves a slot (evicting the live provisional to get
      // it) and then throws with the reservation in hand — the state the
      // trailing `finally` exists for.
      failAt = point
      await expect(
        router(
          new Request('http://local/agent/mcp', {
            method: 'POST',
            headers: { 'mcp-session-id': doomed as string },
          }),
        ),
      ).rejects.toThrow(`allocation failed at ${point}`)

      // Retained nothing, so it must cost nothing. THIS is the
      // assertion that fires on a missing release (`expected 1 to be
      // +0`) — the reservation is still counted with no session behind
      // it.
      expect(router.liveSessionCount()).toBe(0)
      expect(router.hasLiveSession(doomed as string)).toBe(false)

      // A SECOND, independent observable of the same leak, deliberately
      // not reading the counter: a leaked reservation is still counted
      // as an anonymous slot, so the single anonymous slot is spoken for
      // and this 503s against an EMPTY map. It is unreachable while the
      // count assertion above holds, and it earns its place by
      // surviving the count being blinded — with the release deleted
      // AND `occupancy()` reading only `sessions.size`, the assertion
      // above passes and this one still fails.
      const after = await router(initializeRequest())
      expect(after?.status).toBe(200)
      expect(router.liveSessionCount()).toBe(1)
    })
  }
})
