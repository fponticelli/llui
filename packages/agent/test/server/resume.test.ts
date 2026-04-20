import { describe, it, expect, beforeEach } from 'vitest'
import { handleResumeList, handleResumeClaim } from '../../src/server/http/resume.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import { verifyToken } from '../../src/server/token.js'
import type { TokenRecord, ResumeListResponse, ResumeClaimResponse } from '../../src/protocol.js'

const key = 'x'.repeat(32)
let store: InMemoryTokenStore
let audit: { write: (e: unknown) => void }
let log: unknown[]

beforeEach(() => {
  store = new InMemoryTokenStore()
  log = []
  audit = {
    write: (e) => {
      log.push(e)
    },
  }
})

const seedPendingResume = async (tid: string, uid: string | null, origin: string) => {
  const rec: TokenRecord = {
    tid,
    uid,
    status: 'pending-resume',
    createdAt: 1000,
    lastSeenAt: 1000,
    pendingResumeUntil: 9999,
    origin,
    label: 'Claude · Opus',
  }
  await store.create(rec)
}

describe('handleResumeList', () => {
  it('returns only pending-resume pairings for the current identity', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    await seedPendingResume('t2', 'u1', 'https://app.example')
    await seedPendingResume('t3', 'u2', 'https://app.example')
    const req = new Request('https://app.example/agent/resume/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tids: ['t1', 't2', 't3'] }),
    })
    const res = await handleResumeList(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      now: () => 5000,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ResumeListResponse
    expect(body.sessions.map((s) => s.tid).sort()).toEqual(['t1', 't2'])
  })

  it('filters out records past pendingResumeUntil', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    // grace expired
    await store.markPendingResume('t1', 500)
    const req = new Request('https://app.example/agent/resume/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tids: ['t1'] }),
    })
    const res = await handleResumeList(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      now: () => 10_000,
    })
    const body = (await res.json()) as ResumeListResponse
    expect(body.sessions).toEqual([])
  })
})

describe('handleResumeClaim', () => {
  it('returns a fresh token + wsUrl and flips the record to active', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const req = new Request('https://app.example/agent/resume/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleResumeClaim(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      signingKey: key,
      now: () => 5000,
      hardExpiryMs: 3600_000,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ResumeClaimResponse
    expect(body.token).toBeDefined()
    expect(body.wsUrl).toMatch(/\/agent\/ws$/)
    const verified = verifyToken(body.token, key, 5)
    expect(verified.kind).toBe('ok')

    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('active')
  })

  it('rejects when the identity does not own the tid', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const req = new Request('https://app.example/agent/resume/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleResumeClaim(req, {
      tokenStore: store,
      identityResolver: async () => 'u-someone-else',
      auditSink: audit,
      signingKey: key,
      now: () => 5000,
      hardExpiryMs: 3600_000,
    })
    expect(res.status).toBe(403)
  })

  it('rejects when the origin differs from the minted origin', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const req = new Request('https://other.example/agent/resume/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleResumeClaim(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      signingKey: key,
      now: () => 5000,
      hardExpiryMs: 3600_000,
    })
    expect(res.status).toBe(403)
  })
})
