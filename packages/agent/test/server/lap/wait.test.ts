import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapWait } from '../../../src/server/lap/wait.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord, LapWaitResponse } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) => signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(async () => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  const rec: TokenRecord = {
    tid: 't1', uid: 'u1', status: 'active',
    createdAt: 0, lastSeenAt: 0, pendingResumeUntil: null,
    origin: 'https://app', label: null,
  }
  await store.create(rec)
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

const deps = () => ({
  signingKey: key, tokenStore: store, registry,
  auditSink: { write: () => {} }, now: () => 1,
  rateLimiter: permissiveLimiter,
})

const req = (body: unknown): Request =>
  new Request('https://app/lap/v1/wait', {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('handleLapWait', () => {
  it('returns changed when registry.waitForChange resolves with a match', async () => {
    vi.spyOn(registry, 'waitForChange').mockResolvedValue({ status: 'changed', stateAfter: { n: 2 } })
    const res = await handleLapWait(req({ path: '/count' }), deps())
    const body = (await res.json()) as LapWaitResponse
    expect(body.status).toBe('changed')
  })

  it('returns timeout when registry times out', async () => {
    vi.spyOn(registry, 'waitForChange').mockResolvedValue({ status: 'timeout', stateAfter: null })
    const res = await handleLapWait(req({ timeoutMs: 1 }), deps())
    const body = (await res.json()) as LapWaitResponse
    expect(body.status).toBe('timeout')
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check: vi.fn<RateLimiter['check']>(async () => ({ allowed: false, retryAfterMs: 500 })),
    }
    const res = await handleLapWait(req({ path: '/count' }), { ...deps(), rateLimiter: tightLimiter })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
