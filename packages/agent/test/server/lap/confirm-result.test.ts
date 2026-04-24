import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapConfirmResult } from '../../../src/server/lap/confirm-result.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
let store: InMemoryTokenStore
let registry: WsPairingRegistry
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
})

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

const deps = () => ({
  signingKey: key,
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
  rateLimiter: permissiveLimiter,
})

const req = async (body: unknown): Promise<Request> =>
  new Request('https://app/lap/v1/confirm-result', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await validToken('t1')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

describe('handleLapConfirmResult', () => {
  it('returns confirmed when waitForConfirm resolves with confirmed', async () => {
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({
      outcome: 'confirmed',
      stateAfter: { n: 2 },
    })
    const res = await handleLapConfirmResult(await req({ confirmId: 'c1' }), deps())
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('confirmed')
  })

  it('returns rejected user-cancelled when waitForConfirm resolves cancelled', async () => {
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'user-cancelled' })
    const res = await handleLapConfirmResult(await req({ confirmId: 'c1' }), deps())
    const body = (await res.json()) as { status: string; reason?: string }
    expect(body.status).toBe('rejected')
    expect(body.reason).toBe('user-cancelled')
  })

  it('rejects missing confirmId', async () => {
    const res = await handleLapConfirmResult(await req({}), deps())
    expect(res.status).toBe(400)
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check: vi.fn<RateLimiter['check']>(async () => ({ allowed: false, retryAfterMs: 500 })),
    }
    const res = await handleLapConfirmResult(await req({ confirmId: 'c1' }), {
      ...deps(),
      rateLimiter: tightLimiter,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
