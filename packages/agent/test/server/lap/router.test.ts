import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createLapRouter } from '../../../src/server/lap/router.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)

describe('createLapRouter', () => {
  let store: InMemoryTokenStore
  let registry: WsPairingRegistry
  let router: (req: Request) => Promise<Response | null>
  beforeEach(async () => {
    store = new InMemoryTokenStore()
    registry = new WsPairingRegistry()
    const rec: TokenRecord = {
      tid: 't1',
      uid: 'u1',
      status: 'active',
      createdAt: 0,
      lastSeenAt: 0,
      pendingResumeUntil: null,
      origin: 'https://app',
      label: null,
    }
    await store.create(rec)
    vi.spyOn(registry, 'isPaired').mockReturnValue(true)
    vi.spyOn(registry, 'rpc').mockResolvedValue({ ok: true })
    const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }
    router = createLapRouter(
      {
        signingKey: key,
        tokenStore: store,
        registry,
        auditSink: { write: () => {} },
        rateLimiter: permissiveLimiter,
      },
      '/agent/lap/v1',
    )
  })

  it('returns null for paths outside the base', async () => {
    expect(await router(new Request('https://app/unknown'))).toBeNull()
  })

  it('routes /agent/lap/v1/state', async () => {
    const res = await router(
      new Request('https://app/agent/lap/v1/state', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${validToken('t1')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
    )
    expect(res?.status).toBe(200)
  })

  it('returns null for unknown /agent/lap/v1/bogus', async () => {
    const res = await router(new Request('https://app/agent/lap/v1/bogus', { method: 'POST' }))
    expect(res).toBeNull()
  })
})
