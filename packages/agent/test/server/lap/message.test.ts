import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapMessage } from '../../../src/server/lap/message.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { LapMessageResponse } from '../../../src/protocol.js'
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

const mkReq = (body: unknown): Request =>
  new Request('https://app/lap/v1/message', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

describe('handleLapMessage', () => {
  it('returns dispatched when browser replies dispatched', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'dispatched', stateAfter: { n: 1 } })
    const res = await handleLapMessage(mkReq({ msg: { type: 'inc' } }), deps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('dispatched')
  })

  it('returns rejected when browser replies rejected', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'rejected', reason: 'human-only' })
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

  it('returns pending-confirmation (NOT rejected) when the confirm wait times out', async () => {
    // Regression: the old code fabricated a `rejected: user-cancelled` on
    // timeout, while a later user Approve still fired the dispatch — a lie.
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'pending-confirmation', confirmId: 'c1' })
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'timeout' })
    const sendSpy = vi.spyOn(registry, 'send')
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('pending-confirmation')
    if (body.status === 'pending-confirmation') expect(body.confirmId).toBe('c1')
    // Must NOT expire the browser entry on a timeout — a genuine slow
    // approval should still be able to fire.
    expect(sendSpy).not.toHaveBeenCalledWith('t1', { t: 'confirm-expire', confirmId: 'c1' })
  })

  it('expires the browser confirm entry when the user genuinely cancels', async () => {
    vi.spyOn(registry, 'rpc').mockResolvedValue({ status: 'pending-confirmation', confirmId: 'c1' })
    vi.spyOn(registry, 'waitForConfirm').mockResolvedValue({ outcome: 'user-cancelled' })
    const sendSpy = vi.spyOn(registry, 'send')
    const res = await handleLapMessage(mkReq({ msg: { type: 'delete' } }), deps())
    const body = (await res.json()) as LapMessageResponse
    expect(body.status).toBe('rejected')
    expect(sendSpy).toHaveBeenCalledWith('t1', { t: 'confirm-expire', confirmId: 'c1' })
  })

  it('returns 413 when the declared Content-Length exceeds the LAP size cap', async () => {
    // Hardening: the LAP surface had no message-size limit. An oversized
    // declared Content-Length is rejected up front, before the body is
    // buffered or parsed (real Node http requests always carry a
    // Content-Length or are chunked; the check runs before auth).
    const req = new Request('https://app/lap/v1/message', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        'content-length': String(1024 * 1024 + 16),
      },
      body: JSON.stringify({ msg: { type: 'inc' } }),
    })
    const res = await handleLapMessage(req, deps())
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('payload-too-large')
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
