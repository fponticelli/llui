import { describe, it, expect } from 'vitest'
import { createLluiAgentServer, InMemoryTokenStore } from '../../src/server/index.js'
import { tokenHashOf } from '../../src/server/token.js'
import type { MintResponse, SessionsResponse } from '../../src/protocol.js'

describe('createLluiAgentServer — full HTTP lifecycle', () => {
  it('mints then lists then revokes through the public handle', async () => {
    const store = new InMemoryTokenStore()
    const agent = createLluiAgentServer({
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: { write: () => {} },
    })

    const mintRes = await agent.router(new Request('https://app/agent/mint', { method: 'POST' }))
    expect(mintRes?.status).toBe(200)
    const mintBody = (await mintRes!.json()) as MintResponse

    // The minted bearer maps to a TokenRecord in the store via its hash.
    const hash = await tokenHashOf(mintBody.token)
    expect(hash).not.toBeNull()
    const rec = await store.findByTokenHash(hash!)
    expect(rec?.tid).toBe(mintBody.tid)

    // Real flow: awaiting-ws → (WS upgrade) awaiting-claude → (describe) active.
    // Simulate the full transition here (WS upgrade + describe) to put the token in active status.
    await store.markAwaitingClaude(mintBody.tid, Date.now())
    await store.markActive(mintBody.tid, 'Claude Desktop · test', Date.now())

    const listRes = await agent.router(new Request('https://app/agent/sessions'))
    expect(listRes?.status).toBe(200)
    const listBody = (await listRes!.json()) as SessionsResponse
    expect(listBody.sessions.map((s) => s.tid)).toContain(mintBody.tid)

    const revokeRes = await agent.router(
      new Request('https://app/agent/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tid: mintBody.tid }),
      }),
    )
    expect(revokeRes?.status).toBe(200)

    const postRevokeList = await agent.router(new Request('https://app/agent/sessions'))
    const postRevokeBody = (await postRevokeList!.json()) as SessionsResponse
    expect(postRevokeBody.sessions.map((s) => s.tid)).not.toContain(mintBody.tid)
  })

  it('uses sensible defaults when called with no options', () => {
    const agent = createLluiAgentServer()
    expect(typeof agent.router).toBe('function')
  })
})
