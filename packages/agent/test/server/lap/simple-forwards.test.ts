import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  handleLapState,
  handleLapActions,
  handleLapQueryDom,
  handleLapDescribeVisible,
  handleLapContext,
} from '../../../src/server/lap/forward.js'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { TokenRecord } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

const key = 'x'.repeat(32)
const validToken = (tid: string) => signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
const seed = async (store: InMemoryTokenStore, tid: string) => {
  const rec: TokenRecord = {
    tid, uid: 'u1', status: 'active',
    createdAt: 0, lastSeenAt: 0, pendingResumeUntil: null,
    origin: 'https://app', label: null,
  }
  await store.create(rec)
}

let store: InMemoryTokenStore
let registry: WsPairingRegistry
let rpcSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
  rpcSpy = vi.spyOn(registry, 'rpc').mockImplementation(async (_tid, tool, args) => {
    return { _tool: tool, _args: args }
  })
  vi.spyOn(registry, 'isPaired').mockReturnValue(true)
})

function mkReq(path: string, body: unknown): Request {
  return new Request(`https://app${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${validToken('t1')}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

const deps = () => ({
  signingKey: key, tokenStore: store, registry,
  auditSink: { write: () => {} }, now: () => 1,
  rateLimiter: permissiveLimiter,
})

describe('LAP simple-forward handlers', () => {
  beforeEach(async () => { await seed(store, 't1') })

  it('/state forwards get_state with {path}', async () => {
    const res = await handleLapState(mkReq('/lap/v1/state', { path: '/x' }), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'get_state', { path: '/x' })
  })

  it('/state rejects a non-string path with 400', async () => {
    const res = await handleLapState(mkReq('/lap/v1/state', { path: 123 }), deps())
    expect(res.status).toBe(400)
  })

  it('/actions forwards list_actions with {}', async () => {
    const res = await handleLapActions(mkReq('/lap/v1/actions', {}), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'list_actions', {})
  })

  it('/query-dom forwards {name, multiple}', async () => {
    const res = await handleLapQueryDom(mkReq('/lap/v1/query-dom', { name: 'email', multiple: true }), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'query_dom', { name: 'email', multiple: true })
  })

  it('/query-dom rejects missing name', async () => {
    const res = await handleLapQueryDom(mkReq('/lap/v1/query-dom', {}), deps())
    expect(res.status).toBe(400)
  })

  it('/describe-visible forwards describe_visible_content with {}', async () => {
    const res = await handleLapDescribeVisible(mkReq('/lap/v1/describe-visible', {}), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'describe_visible_content', {})
  })

  it('/context forwards describe_context with {}', async () => {
    const res = await handleLapContext(mkReq('/lap/v1/context', {}), deps())
    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('t1', 'describe_context', {})
  })

  it('returns 503 paused when registry rpc rejects with paused', async () => {
    rpcSpy.mockRejectedValueOnce({ code: 'paused' })
    const res = await handleLapState(mkReq('/lap/v1/state', {}), deps())
    expect(res.status).toBe(503)
  })

  it('returns 504 timeout when registry rpc rejects with timeout', async () => {
    rpcSpy.mockRejectedValueOnce({ code: 'timeout' })
    const res = await handleLapState(mkReq('/lap/v1/state', {}), deps())
    expect(res.status).toBe(504)
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check: vi.fn<RateLimiter['check']>(async () => ({ allowed: false, retryAfterMs: 500 })),
    }
    const res = await handleLapState(mkReq('/lap/v1/state', {}), { ...deps(), rateLimiter: tightLimiter })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
