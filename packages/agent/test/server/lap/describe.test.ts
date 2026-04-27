import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleLapDescribe } from '../../../src/server/lap/describe.js'
import {
  WsPairingRegistry,
  type PairingConnection,
} from '../../../src/server/ws/pairing-registry.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { HelloFrame, LapDescribeResponse } from '../../../src/protocol.js'
import type { RateLimiter } from '../../../src/server/rate-limit.js'
import { seedToken } from '../_token-helper.js'

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
  tokenStore: store,
  registry,
  auditSink: { write: () => {} },
  now: () => 1000,
  rateLimiter: permissiveLimiter,
})

const seed = async (
  tid: string,
  status: 'active' | 'awaiting-claude' | 'revoked' = 'active',
): Promise<string> => {
  const { token } = await seedToken(store, { tid, uid: 'u1', status })
  return token
}

const mkRequest = (token: string): Request =>
  new Request('https://app/agent/lap/v1/describe', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })

describe('handleLapDescribe', () => {
  it('serves the cached hello payload', async () => {
    const token = await seed('t1')
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
            dispatchMode: 'shared',
            examples: [],
            warning: null,
            emits: [],
          },
        },
      },
      stateSchema: { count: 'number' },
      affordancesSample: [],
      docs: { purpose: 'Demo' },
      schemaHash: 'abc',
    })
    const res = await handleLapDescribe(mkRequest(token), baseDeps())
    expect(res.status).toBe(200)
    const body = (await res.json()) as LapDescribeResponse
    expect(body.name).toBe('Kanban')
    expect(body.docs?.purpose).toBe('Demo')
    expect(body.messages['inc']?.annotations.intent).toBe('inc')
    expect(body.schemaHash).toBe('abc')
  })

  it('returns 503 paused when no pairing is live', async () => {
    const token = await seed('t1')
    // No registry.register(...)
    const res = await handleLapDescribe(mkRequest(token), baseDeps())
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('paused')
  })

  it('returns 503 paused when WS is live but no hello has arrived yet', async () => {
    const token = await seed('t1')
    const conn = fakeConn()
    registry.register('t1', conn)
    const res = await handleLapDescribe(mkRequest(token), baseDeps())
    expect(res.status).toBe(503)
  })

  it('transitions token status to active on successful describe', async () => {
    const token = await seed('t1', 'awaiting-claude')
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
    const res = await handleLapDescribe(mkRequest(token), baseDeps())
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
    // Seed an active token, then revoke through the store. The revoke
    // path drops the hash index, so the verify boundary returns
    // auth-failed (401) rather than reaching the revoked branch. To
    // test the revoked branch we seed directly with status 'revoked'
    // (the hash stays indexed via seedToken's `create` call).
    const token = await seed('t1', 'revoked')
    const res = await handleLapDescribe(mkRequest(token), baseDeps())
    expect(res.status).toBe(403)
  })

  it('returns 429 with retryAfterMs when rate limiter denies', async () => {
    const token = await seed('t1')
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
    const res = await handleLapDescribe(mkRequest(token), {
      ...baseDeps(),
      rateLimiter: tightLimiter,
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(500)
  })
})
