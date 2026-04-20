import { describe, it, expect, beforeEach } from 'vitest'
import { handleSessions } from '../../src/server/http/sessions.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord, SessionsResponse } from '../../src/protocol.js'

let store: InMemoryTokenStore
beforeEach(() => { store = new InMemoryTokenStore() })

const base = (o: Partial<TokenRecord> = {}): TokenRecord => ({
  tid: 't', uid: 'u1', status: 'active',
  createdAt: 1, lastSeenAt: 1, pendingResumeUntil: null,
  origin: 'https://app', label: null, ...o,
})

describe('handleSessions', () => {
  it('returns active + pending-resume sessions for the caller, excludes revoked', async () => {
    await store.create(base({ tid: 't1', status: 'active' }))
    await store.create(base({ tid: 't2', status: 'pending-resume', pendingResumeUntil: 9999, label: 'Claude' }))
    await store.create(base({ tid: 't3', status: 'revoked' }))
    await store.create(base({ tid: 't4', uid: 'other', status: 'active' }))
    const req = new Request('https://app/agent/sessions', { method: 'GET' })
    const res = await handleSessions(req, {
      tokenStore: store, identityResolver: async () => 'u1',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SessionsResponse
    expect(body.sessions.map((s) => s.tid).sort()).toEqual(['t1', 't2'])
  })

  it('returns an empty list when identity resolves to null', async () => {
    await store.create(base({ tid: 't1', uid: 'u1' }))
    const req = new Request('https://app/agent/sessions', { method: 'GET' })
    const res = await handleSessions(req, {
      tokenStore: store, identityResolver: async () => null,
    })
    const body = (await res.json()) as SessionsResponse
    expect(body.sessions).toEqual([])
  })

  it('excludes awaiting-ws and awaiting-claude records (internal statuses)', async () => {
    await store.create(base({ tid: 't1', status: 'awaiting-ws' }))
    await store.create(base({ tid: 't2', status: 'awaiting-claude' }))
    await store.create(base({ tid: 't3', status: 'active' }))
    const req = new Request('https://app/agent/sessions', { method: 'GET' })
    const res = await handleSessions(req, {
      tokenStore: store, identityResolver: async () => 'u1',
    })
    const body = (await res.json()) as SessionsResponse
    expect(body.sessions.map((s) => s.tid)).toEqual(['t3'])
  })
})
