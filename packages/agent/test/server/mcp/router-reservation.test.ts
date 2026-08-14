import { describe, it, expect, vi } from 'vitest'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

/**
 * A reservation is taken synchronously and handed back in a `finally`.
 * That `finally` is only worth what it wraps: the transport, its
 * `onclose` wiring and `createAgentMcpServer` used to sit ABOVE the
 * `try`, so a synchronous throw from any of them lost the slot for the
 * lifetime of the process — every later `initialize` counted a session
 * that was never built.
 *
 * Nothing on that path reads request data today, so this is a guard on
 * the shape rather than a live defect. It is worth a test precisely
 * because the comment on the `finally` claims it covers every exit path:
 * the only way to keep that claim honest as the constructors grow is to
 * make the claim fail when it stops being true.
 */
let failNextServerBuild = false

vi.mock('../../../src/server/mcp/server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/mcp/server.js')>()
  return {
    ...actual,
    createAgentMcpServer: (args: Parameters<typeof actual.createAgentMcpServer>[0]) => {
      if (failNextServerBuild) {
        failNextServerBuild = false
        throw new Error('mcp server construction failed')
      }
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
  it('hands the slot back when the allocation throws before the first await', async () => {
    const router = createMcpRouter(
      {
        coreRouter: async () => null,
        tokenStore: new InMemoryTokenStore(),
        lapBasePath: '/agent/lap/v1',
        rateLimiter: neverLimited,
      },
      { maxSessions: 1, maxUnauthenticatedSessions: 1 },
    )

    failNextServerBuild = true
    await expect(router(initializeRequest())).rejects.toThrow('mcp server construction failed')

    // The failed attempt retained nothing, so it must have cost nothing.
    expect(router.liveSessionCount()).toBe(0)
    const after = await router(initializeRequest())
    expect(after?.status).toBe(200)
    expect(router.liveSessionCount()).toBe(1)
  })
})
