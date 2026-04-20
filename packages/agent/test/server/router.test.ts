import { describe, it, expect } from 'vitest'
import { createHttpRouter } from '../../src/server/http/router.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'

const key = 'x'.repeat(32)

const mkRouter = () => {
  const store = new InMemoryTokenStore()
  const audit = { write: () => {} }
  return createHttpRouter({
    signingKey: key,
    tokenStore: store,
    identityResolver: async () => 'u1',
    auditSink: audit,
    lapBasePath: '/agent/lap/v1',
  })
}

describe('createHttpRouter', () => {
  it('routes /agent/mint', async () => {
    const r = mkRouter()
    const res = await r(new Request('https://app/agent/mint', { method: 'POST' }))
    expect(res?.status).toBe(200)
  })

  it('returns null for unknown paths', async () => {
    const r = mkRouter()
    const res = await r(new Request('https://app/unknown', { method: 'GET' }))
    expect(res).toBeNull()
  })

  it('routes /agent/sessions', async () => {
    const r = mkRouter()
    const res = await r(new Request('https://app/agent/sessions', { method: 'GET' }))
    expect(res?.status).toBe(200)
  })
})
