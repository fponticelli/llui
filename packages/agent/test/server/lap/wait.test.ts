import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapWait } from '../../../src/server/lap/wait.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { LapWaitResponse } from '../../../src/protocol.js'
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
  new Request('https://app/lap/v1/wait', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

describe('handleLapWait', () => {
  it('returns changed when registry.waitForChange resolves with a match', async () => {
    vi.spyOn(registry, 'waitForChange').mockResolvedValue({
      status: 'changed',
      stateAfter: { n: 2 },
    })
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
    const res = await handleLapWait(req({ path: '/count' }), {
      ...deps(),
      rateLimiter: tightLimiter,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
