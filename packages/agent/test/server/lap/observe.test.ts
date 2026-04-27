import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapObserve } from '../../../src/server/lap/observe.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'
import { seedToken } from '../_token-helper.js'

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

let store: InMemoryTokenStore
let registry: WsPairingRegistry
let bearer: string
let rpcSpy: ReturnType<typeof vi.spyOn>
let helloSpy: ReturnType<typeof vi.spyOn>

function mkReq(): Request {
  return new Request('https://app/lap/v1/observe', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  })
}

beforeEach(async () => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  const seeded = await seedToken(store, { tid: 't1', uid: 'u1', status: 'active' })
  bearer = seeded.token
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
  rpcSpy = vi.spyOn(registry, 'rpc').mockImplementation(async () => ({
    state: { count: 3 },
    actions: [
      {
        variant: 'Inc',
        intent: 'increment',
        requiresConfirm: false,
        source: 'binding',
        selectorHint: null,
        payloadHint: null,
      },
    ],
    context: { summary: 'counting', hints: [], cautions: [] },
  }))
  helloSpy = vi.spyOn(registry, 'getHello').mockReturnValue({
    t: 'hello',
    appName: 'counter',
    appVersion: '1.0.0',
    stateSchema: { type: 'object' },
    msgSchema: {
      Inc: {
        payloadSchema: {},
        annotations: {
          intent: 'increment',
          alwaysAffordable: false,
          requiresConfirm: false,
          dispatchMode: 'shared',
          examples: [],
          warning: null,
          emits: [],
        },
      },
    },
    affordancesSample: [],
    docs: { purpose: 'test' },
    schemaHash: 'hash1',
  })
})

const deps = () => ({
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1,
  rateLimiter: permissiveLimiter,
})

describe('handleLapObserve', () => {
  it('composes state+actions+context from browser with description from hello cache', async () => {
    const res = await handleLapObserve(mkReq(), deps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    expect(body.state).toEqual({ count: 3 })
    expect(Array.isArray(body.actions)).toBe(true)
    expect(body.context).toEqual({ summary: 'counting', hints: [], cautions: [] })

    const description = body.description as Record<string, unknown>
    expect(description.name).toBe('counter')
    expect(description.version).toBe('1.0.0')
    expect(description.schemaHash).toBe('hash1')
    expect((description.conventions as Record<string, unknown>).dispatchModel).toBe('TEA')

    expect(rpcSpy).toHaveBeenCalledWith('t1', 'observe', {})
    expect(helloSpy).toHaveBeenCalledWith('t1')
  })

  it('returns 503 paused when hello cache is empty (browser not connected)', async () => {
    helloSpy.mockReturnValueOnce(undefined)
    const res = await handleLapObserve(mkReq(), deps())
    expect(res.status).toBe(503)
  })

  it('returns 504 timeout when rpc times out', async () => {
    rpcSpy.mockRejectedValueOnce({ code: 'timeout' })
    const res = await handleLapObserve(mkReq(), deps())
    expect(res.status).toBe(504)
  })

  it('returns 503 paused when rpc rejects with paused', async () => {
    rpcSpy.mockRejectedValueOnce({ code: 'paused' })
    const res = await handleLapObserve(mkReq(), deps())
    expect(res.status).toBe(503)
  })
})
