import { describe, it, expect } from 'vitest'
import { createLluiAgentServer, InMemoryTokenStore } from '../../src/server/index.js'
import { verifyToken } from '../../src/server/token.js'
import type { MintResponse, SessionsResponse } from '../../src/protocol.js'

const key = 'x'.repeat(32)

describe('createLluiAgentServer — full HTTP lifecycle', () => {
  it('mints then lists then revokes through the public handle', async () => {
    const store = new InMemoryTokenStore()
    const agent = createLluiAgentServer({
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: { write: () => {} },
    })

    const mintRes = await agent.router(new Request('https://app/agent/mint', { method: 'POST' }))
    expect(mintRes?.status).toBe(200)
    const mintBody = (await mintRes!.json()) as MintResponse
    expect(verifyToken(mintBody.token, key).kind).toBe('ok')

    // Token is awaiting-ws immediately after mint — simulate WS connect
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

  it('throws when signingKey is missing', () => {
    expect(() => createLluiAgentServer({ signingKey: '' } as any)).toThrow()
  })

  it('uses sensible defaults when only signingKey is provided', () => {
    const agent = createLluiAgentServer({ signingKey: key })
    expect(typeof agent.router).toBe('function')
  })
})
