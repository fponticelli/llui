import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapMessage } from '../../../src/server/lap/message.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord, LapMessageResponse } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
const seed = async (store: InMemoryTokenStore, tid: string) => {
  const rec: TokenRecord = {
    tid,
    uid: 'u1',
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app',
    label: null,
  }
  await store.create(rec)
}

let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(() => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
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

const mkReq = (body: unknown): Request =>
  new Request('https://app/lap/v1/message', {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('handleLapMessage', () => {
  beforeEach(async () => {
    await seed(store, 't1')
  })

  it('returns dispatched when browser replies dispatched', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'dispatched', stateAfter: { n: 1 } })
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), deps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('dispatched')
  })

  it('returns rejected when browser replies rejected', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'rejected', reason: 'humanOnly' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('rejected')
  })

  it('long-polls on pending-confirmation and resolves to confirmed', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'pending-confirmation', confirmId: 'c1' })
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({
      outcome: 'confirmed',
      stateAfter: { ok: true },
    })
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('confirmed')
    if (body.status === 'confirmed') expect(body.stateAfter).toEqual({ ok: true })
  })

  it('long-polls on pending-confirmation and resolves to rejected on user-cancelled', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'pending-confirmation', confirmId: 'c1' })
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'user-cancelled' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('rejected')
    if (body.status === 'rejected') expect(body.reason).toBe('user-cancelled')
  })

  it('rejects missing msg.type with 400', async () => {
    const res = await handleLapMessage(mkReq({}), deps())
    expect(res.status).toBe(400)
  })

  it('returns 503 paused when registry rpc rejects with paused', async () => {
    vi.spyOn(registry, 'rpc').mockRejectedValue({ code: 'paused' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), deps())
    expect(res.status).toBe(503)
  })

  it('returns 500 with descriptive detail when browser replies an unknown status', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'mystery-status-xyz' })
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), deps())
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; detail: string } }
    expect(body.error.code).toBe('internal')
    expect(body.error.detail).toMatch('mystery-status-xyz')
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check: vi.fn<RateLimiter['check']>(async () => ({ allowed: false, retryAfterMs: 500 })),
    }
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), {
      ...deps(),
      rateLimiter: tightLimiter,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
