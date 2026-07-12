import { describe, it, expect } from 'vitest'
import { AgentPairingDurableObject } from '../../../src/server/cloudflare/durable-object.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { seedToken } from '../_token-helper.js'

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
