import { describe, it, expect } from 'vitest'
import { AgentPairingDurableObject } from '../../../src/server/cloudflare/durable-object.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { seedToken } from '../_token-helper.js'

// The MCP-bound cases below allocate 200 real `McpServer`s each, which is the
// point of them. That costs ~100 ms idle and stretches under a loaded
// `turbo test`; the budget that absorbs it is the workspace-wide one in
// `vitest.shared.ts` (#147), not a per-file `vi.setConfig` that would shadow it.

function resolveReq(token?: string, method = 'POST'): Request {
  return new Request('http://internal/__resolve', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

async function tidOf(res: Response): Promise<string | null> {
  return ((await res.json()) as { tid: string | null }).tid
}

describe('AgentPairingDurableObject /__resolve', () => {
  it('resolves a known bearer token to its tid', async () => {
    const store = new InMemoryTokenStore()
    const { token } = await seedToken(store, { tid: 'tid-42' })
    const doInstance = new AgentPairingDurableObject({ tokenStore: store })
    const res = await doInstance.fetch(resolveReq(token))
    expect(res.status).toBe(200)
    expect(await tidOf(res)).toBe('tid-42')
  })

  it('returns tid:null for an unknown token', async () => {
    const doInstance = new AgentPairingDurableObject({ tokenStore: new InMemoryTokenStore() })
    const res = await doInstance.fetch(resolveReq('agt_not-a-real-token'))
    expect(await tidOf(res)).toBeNull()
  })

  it('returns tid:null when no bearer is presented', async () => {
    const doInstance = new AgentPairingDurableObject({ tokenStore: new InMemoryTokenStore() })
    expect(await tidOf(await doInstance.fetch(resolveReq()))).toBeNull()
  })

  it('rejects non-POST /__resolve with 405 (bearer stays in the header, not the URL)', async () => {
    const doInstance = new AgentPairingDurableObject({ tokenStore: new InMemoryTokenStore() })
    const res = await doInstance.fetch(resolveReq('agt_x', 'GET'))
    expect(res.status).toBe(405)
  })

  it('resolves a token across DIFFERENT DO instances that share one TokenStore', async () => {
    // The sharded recipe: the root DO owns mint while per-tid DOs resolve.
    // Both must share ONE external TokenStore or cross-DO resolution 401s.
    const shared = new InMemoryTokenStore()
    const { token } = await seedToken(shared, { tid: 'shared-tid' })
    const rootDO = new AgentPairingDurableObject({ tokenStore: shared })
    const perTidDO = new AgentPairingDurableObject({ tokenStore: shared })
    // Resolve on a DIFFERENT instance than the one that would have minted.
    expect(await tidOf(await perTidDO.fetch(resolveReq(token)))).toBe('shared-tid')
    void rootDO

    // Sanity: a DO with its OWN default in-memory store cannot see it —
    // demonstrating exactly why the shared store is required.
    const isolatedDO = new AgentPairingDurableObject({})
    expect(await tidOf(await isolatedDO.fetch(resolveReq(token)))).toBeNull()
  })
})

describe('AgentPairingDurableObject MCP session bound (#102)', () => {
  it('bounds retained MCP sessions across repeated unauthenticated initializes', async () => {
    // A DO's 128 MB ceiling is reached at ~1,100 unbounded sessions, so
    // the bound has to hold on THIS path, not only in the Node factory.
    //
    // The limiter is deliberately disabled here. With the default
    // 30/minute the 31st request onward is a 429 that allocates nothing,
    // so the loop would exercise the RATE LIMIT and leave the session
    // bound — the thing under test — reached only incidentally.
    const doInstance = new AgentPairingDurableObject({
      rateLimiter: { check: async () => ({ allowed: true }) },
      mcp: { maxSessions: 8, maxUnauthenticatedSessions: 4 },
    })
    for (let i = 0; i < 200; i++) {
      await doInstance.fetch(
        new Request('http://do/agent/mcp', {
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
        }),
      )
    }
    // Every one of the 200 was anonymous, so the reachable ceiling is
    // the ANONYMOUS quota, not `maxSessions`.
    expect(doInstance.mcpRouter?.liveSessionCount()).toBeLessThanOrEqual(4)
  })

  it('holds the bound when the DO serves overlapping initializes', async () => {
    // A Worker forwards each request to the DO independently, so
    // concurrent `initialize`s are the normal case here too.
    const doInstance = new AgentPairingDurableObject({
      rateLimiter: { check: async () => ({ allowed: true }) },
      mcp: { maxSessions: 8, maxUnauthenticatedSessions: 8 },
    })
    await Promise.all(
      Array.from({ length: 200 }, () =>
        doInstance.fetch(
          new Request('http://do/agent/mcp', {
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
          }),
        ),
      ),
    )
    expect(doInstance.mcpRouter?.liveSessionCount()).toBeLessThanOrEqual(8)
  })
})
