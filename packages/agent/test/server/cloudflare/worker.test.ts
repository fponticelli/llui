import { describe, it, expect, vi } from 'vitest'
import { routeToAgentDO } from '../../../src/server/cloudflare/worker.js'
import type { MinimalDurableObjectNamespace } from '../../../src/server/cloudflare/worker.js'

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

// In the opaque-token world, `routeToAgentDO` doesn't verify tokens
// itself — the caller passes a `resolveTid` callback that turns a
// bearer into its tid via the shared token store. Tests below use
// stubs that mimic the two outcomes: lookup hit (returns a tid) and
// lookup miss (returns null → 401).
const resolveAlways = (tid: string) => async () => tid
const resolveNever = async () => null

describe('routeToAgentDO', () => {
  it('routes /agent/mint to the root DO', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/mint', { method: 'POST' })
    await routeToAgentDO(req, ns, resolveNever)
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })

  it('routes /agent/resume/list to the root DO', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/resume/list', { method: 'POST' })
    await routeToAgentDO(req, ns, resolveNever)
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })

  it('rejects token-bearing routes with no token as 401', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/lap/v1/describe', { method: 'POST' })
    const res = await routeToAgentDO(req, ns, resolveNever)
    expect(res.status).toBe(401)
    expect(ns.get).not.toHaveBeenCalled()
  })

  it('rejects requests when resolveTid yields no tid (401)', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/lap/v1/describe', {
      method: 'POST',
      headers: { authorization: `Bearer agt_does-not-resolve` },
    })
    const res = await routeToAgentDO(req, ns, resolveNever)
    expect(res.status).toBe(401)
    expect(ns.get).not.toHaveBeenCalled()
  })

  it('routes valid token-bearing requests to the per-tid DO', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/lap/v1/state', {
      method: 'POST',
      headers: { authorization: `Bearer agt_some-token` },
    })
    const res = await routeToAgentDO(req, ns, resolveAlways('user-42'))
    expect(res.status).toBe(200)
    expect(ns.idFromName).toHaveBeenCalledWith('user-42')
    expect(ns.__lastStubFetch).toHaveBeenCalled()
  })

  it('accepts token from ?token= query string (WS upgrade pattern)', async () => {
    const ns = mockNamespace()
    const req = new Request(`https://app/agent/ws?token=agt_ws-token`)
    const res = await routeToAgentDO(req, ns, resolveAlways('user-99'))
    expect(res.status).toBe(200)
    expect(ns.idFromName).toHaveBeenCalledWith('user-99')
  })

  it('routes /agent/mcp to the root DO without requiring a bearer token', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/mcp', { method: 'POST' })
    await routeToAgentDO(req, ns, resolveNever)
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })

  it('routes /agent/mcp sub-paths to the root DO (session continuation)', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/agent/mcp/sse', {
      method: 'GET',
      headers: { 'mcp-session-id': 'test-session' },
    })
    await routeToAgentDO(req, ns, resolveNever)
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })

  it('rejects a public /__resolve (and any /__* internal path) with 404', async () => {
    // `/__resolve` is reachable ONLY via an internal DO stub. A public
    // request must never reach a DO and become a token-resolution oracle.
    const ns = mockNamespace()
    const req = new Request('https://app/__resolve', {
      method: 'POST',
      headers: { authorization: `Bearer agt_probe` },
    })
    const res = await routeToAgentDO(req, ns, resolveAlways('t1'))
    expect(res.status).toBe(404)
    expect(ns.get).not.toHaveBeenCalled()
  })

  it('respects a custom mcpPath option', async () => {
    const ns = mockNamespace()
    const req = new Request('https://app/mcp', { method: 'POST' })
    await routeToAgentDO(req, ns, resolveNever, { mcpPath: '/mcp' })
    expect(ns.idFromName).toHaveBeenCalledWith('__root')
  })
})
