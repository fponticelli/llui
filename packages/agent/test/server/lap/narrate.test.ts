import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapNarrate } from '../../../src/server/lap/narrate.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { LapNarrateResponse, ServerFrame } from '../../../src/protocol.js'
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
  now: () => 1700,
  rateLimiter: permissiveLimiter,
})

const req = (body: unknown): Request =>
  new Request('https://app/lap/v1/narrate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

describe('handleLapNarrate', () => {
  it('pushes a log-push frame to the paired runtime carrying a narrate-kind LogEntry', async () => {
    const send = vi.spyOn(registry, 'send').mockImplementation(() => {})
    const res = await handleLapNarrate(req({ text: 'thinking…' }), deps())

    expect(res.status).toBe(200)
    const body = (await res.json()) as LapNarrateResponse
    expect(body).toEqual({ ok: true })

    expect(send).toHaveBeenCalledOnce()
    const frame = send.mock.calls[0]![1] as ServerFrame
    expect(frame.t).toBe('log-push')
    if (frame.t !== 'log-push') return
    expect(frame.entry.kind).toBe('narrate')
    expect(frame.entry.detail).toBe('thinking…')
    expect(frame.entry.intent).toBe('Agent narrated')
    expect(frame.entry.at).toBe(1700)
    expect(frame.entry.id).toMatch(/^narrate-1700-/)
  })

  it('honours an explicit `intent` label', async () => {
    const send = vi.spyOn(registry, 'send').mockImplementation(() => {})
    await handleLapNarrate(req({ text: 'about to delete', intent: 'Plan' }), deps())
    const frame = send.mock.calls[0]![1] as ServerFrame
    if (frame.t !== 'log-push') throw new Error('wrong frame')
    expect(frame.entry.intent).toBe('Plan')
  })

  it('rejects empty text with 400 invalid', async () => {
    const send = vi.spyOn(registry, 'send').mockImplementation(() => {})
    const res = await handleLapNarrate(req({ text: '' }), deps())
    expect(res.status).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects missing text with 400 invalid', async () => {
    const res = await handleLapNarrate(req({}), deps())
    expect(res.status).toBe(400)
  })

  it('returns 503 paused when the runtime is not paired', async () => {
    vi.spyOn(registry, 'isPaired').mockReturnValue(false)
    const res = await handleLapNarrate(req({ text: 'hi' }), deps())
    expect(res.status).toBe(503)
  })

  it('returns 429 when the rate limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check: async () => ({ allowed: false, retryAfterMs: 250 }),
    }
    const tightDeps = () => ({ ...deps(), rateLimiter: tightLimiter })
    const res = await handleLapNarrate(req({ text: 'hi' }), tightDeps())
    expect(res.status).toBe(429)
  })
})
