import { describe, it, expect, beforeEach } from 'vitest'
import { handleRevoke } from '../../src/server/http/revoke.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord } from '../../src/protocol.js'

let store: InMemoryTokenStore
let log: unknown[]
const audit = { write: (e: unknown) => { log.push(e) } }

beforeEach(() => { store = new InMemoryTokenStore(); log = [] })

const seed = async (tid: string, uid: string | null) => {
  const rec: TokenRecord = {
    tid, uid, status: 'active',
    createdAt: 0, lastSeenAt: 0, pendingResumeUntil: null,
    origin: 'https://app.example', label: null,
  }
  await store.create(rec)
}

describe('handleRevoke', () => {
  it('flips status to revoked for caller-owned tokens', async () => {
    await seed('t1', 'u1')
    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      now: () => 1000,
    })
    expect(res.status).toBe(200)
    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('revoked')
    expect(log).toHaveLength(1)
  })

  it('refuses to revoke tokens owned by someone else', async () => {
    await seed('t1', 'u1')
    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'attacker',
      auditSink: audit,
      now: () => 1000,
    })
    expect(res.status).toBe(403)
    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('active')
  })
})
