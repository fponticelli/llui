import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapDescribe } from '../../../src/server/lap/describe.js'
import {
  WsPairingRegistry,
  type PairingConnection,
} from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import { signToken } from '../../../src/server/token.js'
import type { HelloFrame, LapDescribeResponse, TokenRecord } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'

const key = 'x'.repeat(32)

function fakeConn(): PairingConnection & { emit: (f: HelloFrame) => void } {
  let onFrame: (f: unknown) => void = () => {}
  return {
    send: () => {},
    onFrame(h: (f: unknown) => void) {
      onFrame = h
    },
    onClose: () => {},
    close: () => {},
    emit: (f: HelloFrame) => onFrame(f),
  } as unknown as PairingConnection & { emit: (f: HelloFrame) => void }
}

const permissiveLimiter: RateLimiter = { check: async () => ({ allowed: true }) }

let store: InMemoryTokenStore
let registry: WsPairingRegistry
beforeEach(() => {
  store = new InMemoryTokenStore()
  registry = new WsPairingRegistry()
})

const baseDeps = () => ({
  signingKey: key,
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1000,
  rateLimiter: permissiveLimiter,
})

const seed = async (tid: string): Promise<void> => {
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

const mkRequest = (token: string): Request =>
  new Request('https://app/agent/lap/v1/describe', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })

const validToken = (tid: string): string =>
  signToken({ tid, iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)

describe('handleLapDescribe', () => {
  it('serves the cached hello payload', async () => {
    await seed('t1')
    const conn = fakeConn()
    registry.register('t1', conn)
    conn.emit({
      t: 'hello',
      appName: 'Kanban',
      appVersion: '1.0',
      msgSchema: {
        inc: {
          payloadSchema: {},
          annotations: {
            intent: 'inc',
            alwaysAffordable: false,
            requiresConfirm: false,
            humanOnly: false,
          },
        },
      },
      stateSchema: { count: 'number' },
      affordancesSample: [],
      docs: { purpose: 'Demo' },
      schemaHash: 'abc',
    })
    const res = await handleLapDescribe(mkRequest(validToken('t1')), baseDeps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as LapDescribeResponse
    expect(body.name).toBe('Kanban')
    expect(body.docs?.purpose).toBe('Demo')
    expect(body.messages['inc']?.annotations.intent).toBe('inc')
    expect(body.schemaHash).toBe('abc')
  })

  it('returns 503 paused when no pairing is live', async () => {
    await seed('t1')
    // No registry.register(...)
    const res = await handleLapDescribe(mkRequest(validToken('t1')), baseDeps())
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('paused')
  })

  it('returns 503 paused when WS is live but no hello has arrived yet', async () => {
    await seed('t1')
    const conn = fakeConn()
    registry.register('t1', conn)
    const res = await handleLapDescribe(mkRequest(validToken('t1')), baseDeps())
    expect(res.status).toBe(503)
  })

  it('transitions token status to active on successful describe', async () => {
    await seed('t1')
    await store.markAwaitingClaude('t1', 0)
    const conn = fakeConn()
    registry.register('t1', conn)
    conn.emit({
      t: 'hello',
      appName: 'Kanban',
      appVersion: '1.0',
      msgSchema: {},
      stateSchema: {},
      affordancesSample: [],
      docs: null,
      schemaHash: 'abc',
    })
    const res = await handleLapDescribe(mkRequest(validToken('t1')), baseDeps())
    expect(res.status).toBe(200)
    const rec = await store.findByTid('t1')
    expect(rec?.status).toBe('active')
    expect(rec?.lastSeenAt).toBe(1000)
  })

  it('rejects bearer-less requests with 401', async () => {
    const req = new Request('https://app/agent/lap/v1/describe', { method: 'POST' })
    const res = await handleLapDescribe(req, baseDeps())
    expect(res.status).toBe(401)
  })

  it('rejects revoked tokens with 403', async () => {
    await seed('t1')
    await store.revoke('t1')
    const res = await handleLapDescribe(mkRequest(validToken('t1')), baseDeps())
    expect(res.status).toBe(403)
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    await seed('t1')
    const conn = fakeConn()
    registry.register('t1', conn)
    conn.emit({
      t: 'hello',
      appName: 'Kanban',
      appVersion: '1.0',
      msgSchema: {},
      stateSchema: {},
      affordancesSample: [],
      docs: { purpose: 'Test' },
      schemaHash: 'abc',
    })
    const tightLimiter: RateLimiter = {
      check: vi.fn<RateLimiter['check']>(async () => ({ allowed: false, retryAfterMs: 500 })),
    }
    const res = await handleLapDescribe(mkRequest(validToken('t1')), {
      ...baseDeps(),
      rateLimiter: tightLimiter,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
