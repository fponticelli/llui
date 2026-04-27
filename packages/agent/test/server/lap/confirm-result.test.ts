import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapConfirmResult } from '../../../src/server/lap/confirm-result.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'
import { seedToken } from '../_token-helper.js'

let store: InMemoryTokenStore
let registry: WsPairingRegistry
let bearer: string

beforeEach(async () => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  const seeded = await seedToken(store, { tid: 't1', uid: 'u1', status: 'active' })
  bearer = seeded.token
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

const deps = () => ({
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
  rateLimiter: permissiveLimiter,
})

const req = (body: unknown): Request =>
  new Request('https://app/lap/v1/confirm-result', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
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
    const res = await handleLapConfirmResult(req({ confirmId: 'c1' }), deps())
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('confirmed')
  })

  it('returns rejected user-cancelled when waitForConfirm resolves cancelled', async () => {
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'user-cancelled' })
    const res = await handleLapConfirmResult(req({ confirmId: 'c1' }), deps())
    const body = (await res.json()) as { status: string; reason?: string }
    expect(body.status).toBe('rejected')
    expect(body.reason).toBe('user-cancelled')
  })

  it('rejects missing confirmId', async () => {
    const res = await handleLapConfirmResult(req({}), deps())
    expect(res.status).toBe(400)
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check: vi.fn<RateLimiter['check']>(async () => ({ allowed: false, retryAfterMs: 500 })),
    }
    const res = await handleLapConfirmResult(req({ confirmId: 'c1' }), {
      ...deps(),
      rateLimiter: tightLimiter,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
