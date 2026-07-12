import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord } from '../../src/protocol.js'

let store: InMemoryTokenStore
beforeEach(() => {
  store = new InMemoryTokenStore()
})

const baseRecord = (overrides: Partial<TokenRecord> = {}): TokenRecord => ({
  tid: 't1',
  tokenHash: `hash-${overrides.tid ?? 't1'}`,
  uid: 'u1',
  status: 'awaiting-ws',
  createdAt: 1000,
  expiresAt: Number.MAX_SAFE_INTEGER,
  lastSeenAt: 1000,
  pendingResumeUntil: null,
  origin: 'https://app.example',
  label: null,
  ...overrides,
})

describe('InMemoryTokenStore', () => {
  it('create + findByTid round-trip', async () => {
    await store.create(baseRecord())
    const got = await store.findByTid('t1')
    expect(got).toEqual(baseRecord())
  })

  it('findByTid returns null for unknown tid', async () => {
    expect(await store.findByTid('missing')).toBeNull()
  })

  it('listByIdentity filters by uid and excludes other uids', async () => {
    await store.create(baseRecord({ tid: 't1', uid: 'u1' }))
    await store.create(baseRecord({ tid: 't2', uid: 'u2' }))
    await store.create(baseRecord({ tid: 't3', uid: 'u1' }))
    const got = await store.listByIdentity('u1')
    expect(got.map((r) => r.tid).sort()).toEqual(['t1', 't3'])
  })

  it('listByIdentity excludes null uid entries', async () => {
    await store.create(baseRecord({ tid: 't1', uid: 'u1' }))
    await store.create(baseRecord({ tid: 't2', uid: null }))
    const got = await store.listByIdentity('u1')
    expect(got.map((r) => r.tid)).toEqual(['t1'])
  })

  it('touch updates lastSeenAt', async () => {
    await store.create(baseRecord())
    await store.touch('t1', 2000)
    const got = await store.findByTid('t1')
    expect(got?.lastSeenAt).toBe(2000)
    expect(got?.createdAt).toBe(1000)
  })

  it('markActive flips status and sets label', async () => {
    await store.create(baseRecord({ status: 'awaiting-claude' }))
    await store.markActive('t1', 'Claude Desktop · Opus', 2000)
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('active')
    expect(got?.label).toBe('Claude Desktop · Opus')
    expect(got?.lastSeenAt).toBe(2000)
  })

  it('markAwaitingClaude flips status to awaiting-claude and updates lastSeenAt', async () => {
    await store.create(baseRecord({ status: 'awaiting-ws' }))
    await store.markAwaitingClaude('t1', 3000)
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('awaiting-claude')
    expect(got?.lastSeenAt).toBe(3000)
  })

  it('markPendingResume flips status and sets pendingResumeUntil', async () => {
    await store.create(baseRecord({ status: 'active' }))
    await store.markPendingResume('t1', 9999)
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('pending-resume')
    expect(got?.pendingResumeUntil).toBe(9999)
  })

  it('revoke flips status and clears pendingResumeUntil', async () => {
    await store.create(baseRecord({ status: 'active', pendingResumeUntil: 9999 }))
    await store.revoke('t1')
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('revoked')
    expect(got?.pendingResumeUntil).toBeNull()
  })

  it('mutations on a missing tid are no-ops (do not throw)', async () => {
    await store.touch('missing', 1)
    await store.markAwaitingClaude('missing', 1)
    await store.markActive('missing', 'x', 1)
    await store.markPendingResume('missing', 1)
    await store.revoke('missing')
    expect(await store.findByTid('missing')).toBeNull()
  })

  it('sweepExpired evicts records past expiry + retention (and drops the hash index)', async () => {
    await store.create(baseRecord({ tid: 'live', expiresAt: 10_000 }))
    await store.create(baseRecord({ tid: 'lapsed', expiresAt: 1_000 }))

    // now=5_000, retention=1_000 → 'lapsed' (1000+1000 <= 5000) is evicted,
    // 'live' (10000+1000 > 5000) is kept.
    const evicted = await store.sweepExpired(5_000, 1_000)
    expect(evicted).toBe(1)
    expect(await store.findByTid('lapsed')).toBeNull()
    expect(await store.findByTokenHash('hash-lapsed')).toBeNull()
    expect(await store.findByTid('live')).not.toBeNull()
  })

  it('sweepExpired keeps a just-expired record inside the retention window', async () => {
    await store.create(baseRecord({ tid: 'recent', expiresAt: 4_500 }))
    // now=5_000, retention=1_000 → 4500+1000=5500 > 5000, still retained.
    const evicted = await store.sweepExpired(5_000, 1_000)
    expect(evicted).toBe(0)
    expect(await store.findByTid('recent')).not.toBeNull()
  })
})
