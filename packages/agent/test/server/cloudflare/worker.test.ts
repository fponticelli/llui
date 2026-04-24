import { describe, it, expect, vi } from 'vitest'
import { routeToAgentDO } from '../../../src/server/cloudflare/worker.js'
import type { MinimalDurableObjectNamespace } from '../../../src/server/cloudflare/worker.js'
import { signToken } from '../../../src/server/token.js'

const key = 'x'.repeat(32)

function mockNamespace(): MinimalDurableObjectNamespace & {
  get: ReturnType<typeof vi.fn>
  idFromName: ReturnType<typeof vi.fn>
  __lastStubFetch: ReturnType<typeof vi.fn>
} {
  const stubFetch = vi.fn(async () => new Response('from-do', { status: 200 }))
  const idFromName = vi.fn((name: string) => ({ name }))
  const get = vi.fn(() => ({ fetch: stubFetch }))
  return {
    idFromName,
    get,
    __lastStubFetch: stubFetch,
  } as unknown as MinimalDurableObjectNamespace & {
    get: ReturnType<typeof vi.fn>
    idFromName: ReturnType<typeof vi.fn>
    __lastStubFetch: ReturnType<typeof vi.fn>
  }
}

describe('routeToAgentDO', () => {
  it('routes /agent/mint to the root DO', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/mint', { method: 'POST' })
    await routeToAgentDO(req, ns, key)
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })

  it('routes /agent/resume/list to the root DO', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/resume/list', { method: 'POST' })
    await routeToAgentDO(req, ns, key)
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })

  it('rejects token-bearing routes with no token as 401', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/lap/v1/describe', { method: 'POST' })
    const res = await routeToAgentDO(req, ns, key)
    expect(res.status).toBe(401)
    expect(ns.get).not.toHaveBeenCalled()
  })

  it('rejects requests with a bad-signature token as 401', async () => {
    const ns = mockNamespace()
    const badToken = 'llui-agent_bogus.sig'
    const req = new Request('https://app/agent/lap/v1/describe', {
      method: 'POST',
      headers: { authorization: `Bearer ${badToken}` },
    })
    const res = await routeToAgentDO(req, ns, key)
    expect(res.status).toBe(401)
    expect(ns.get).not.toHaveBeenCalled()
  })

  it('routes valid token-bearing requests to the per-tid DO', async () => {
    const ns = mockNamespace()
    const token = await signToken(
      { tid: 'user-42', iat: 0, exp: 9_999_999_999, scope: 'agent' },
      key,
    )
    const req = new Request('https://app/agent/lap/v1/state', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    const res = await routeToAgentDO(req, ns, key)
    expect(res.status).toBe(200)
    expect(ns.idFromName).toHaveBeenCalledWith('user-42')
    expect(ns.__lastStubFetch).toHaveBeenCalled()
  })

  it('accepts token from ?token= query string (WS upgrade pattern)', async () => {
    const ns = mockNamespace()
    const token = await signToken(
      { tid: 'user-99', iat: 0, exp: 9_999_999_999, scope: 'agent' },
      key,
    )
    const req = new Request(`https://app/agent/ws?token=${encodeURIComponent(token)}`)
    const res = await routeToAgentDO(req, ns, key)
    expect(res.status).toBe(200)
    expect(ns.idFromName).toHaveBeenCalledWith('user-99')
  })
})
