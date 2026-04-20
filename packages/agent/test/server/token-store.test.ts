import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord } from '../../src/protocol.js'

let store: InMemoryTokenStore
beforeEach(() => {
  store = new InMemoryTokenStore()
})

const baseRecord = (overrides: Partial<TokenRecord> = {}): TokenRecord => ({
  tid: 't1',
  uid: 'u1',
  status: 'awaiting-ws',
  createdAt: 1000,
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
    await store.markActive('missing', 'x', 1)
    await store.markPendingResume('missing', 1)
    await store.revoke('missing')
    expect(await store.findByTid('missing')).toBeNull()
  })
})
