import { describe, it, expect, beforeEach } from 'vitest'
import { handleMint } from '../../src/server/http/mint.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import { tokenHashOf } from '../../src/server/token.js'
import type { MintResponse } from '../../src/protocol.js'

let store: InMemoryTokenStore
let auditLog: unknown[]
let clock = 1_700_000_000

beforeEach(() => {
  store = new InMemoryTokenStore()
  auditLog = []
  clock = 1_700_000_000
})

const audit = {
  write: (e: unknown) => {
    auditLog.push(e)
  },
}

describe('handleMint', () => {
  it('creates a pairing record and returns an opaque token + wsUrl + lapUrl', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000, // ms-resolution wall clock
      uuid: () => '11111111-1111-1111-1111-111111111111',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    expect(body.tid).toBe('11111111-1111-1111-1111-111111111111')
    expect(body.lapUrl).toBe('https://app.example/agent/lap/v1')
    expect(body.wsUrl).toMatch(/^wss?:\/\/app\.example\/agent\/ws$/)
    expect(body.expiresAt).toBeGreaterThan(clock)
    expect(body.token.startsWith('agt_')).toBe(true)
    // LAP version negotiation: mint advertises the server's wire version.
    expect(body.lapVersion).toBe(1)

    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBe('u1')
    expect(stored?.status).toBe('awaiting-ws')
    expect(stored?.origin).toBe('https://app.example')

    // The opaque bearer hashes to the record's tokenHash, and the
    // record is reachable by hash on the auth hot path.
    const hash = await tokenHashOf(body.token)
    expect(hash).not.toBeNull()
    expect(stored?.tokenHash).toBe(hash)
    const fromHash = await store.findByTokenHash(hash!)
    expect(fromHash?.tid).toBe(body.tid)
  })

  it('FAILS CLOSED on a null identity by default (no anonymous mint)', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 't-null',
    })
    // Without an identity and without explicit opt-in, no token is
    // minted — an unauthenticated caller must NOT receive a
    // remote-control token.
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('auth-required')
    // Nothing was persisted.
    const stored = await store.findByTid('t-null')
    expect(stored).toBeNull()
  })

  it('mints with a null identity when allowAnonymous is explicitly enabled', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      allowAnonymous: true,
      now: () => clock * 1000,
      uuid: () => 't-null',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBeNull()
  })

  it('mints when the resolver returns a real uid (default config)', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => 'real-user',
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 't-real',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBe('real-user')
  })

  it('writes a mint audit entry', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 'tid-audit',
    })
    expect(auditLog).toHaveLength(1)
    expect((auditLog[0] as { event: string }).event).toBe('mint')
  })

  it('rate-limits by identity BEFORE creating any record (429, nothing persisted)', async () => {
    const denyLimiter = {
      calls: [] as Array<{ key: string; bucket: string }>,
      check: async (key: string, bucket: 'token' | 'identity') => {
        denyLimiter.calls.push({ key, bucket })
        return { allowed: false as const, retryAfterMs: 1234 }
      },
    }
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => 'spammer',
      auditSink: audit,
      rateLimiter: denyLimiter,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 't-rl',
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string; retryAfterMs: number } }
    expect(body.error.code).toBe('rate-limited')
    expect(body.error.retryAfterMs).toBe(1234)
    // Keyed by resolved identity, in the identity bucket.
    expect(denyLimiter.calls).toEqual([{ key: 'spammer', bucket: 'identity' }])
    // No record was created.
    expect(await store.findByTid('t-rl')).toBeNull()
  })

  it('rate-limits anonymous callers by client IP (X-Forwarded-For)', async () => {
    const seen: string[] = []
    const denyLimiter = {
      check: async (key: string) => {
        seen.push(key)
        return { allowed: false as const, retryAfterMs: 1 }
      },
    }
    const req = new Request('https://app.example/agent/mint', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    })
    await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      rateLimiter: denyLimiter,
      allowAnonymous: true,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 't-ip',
    })
    expect(seen).toEqual(['203.0.113.7'])
  })

  it('lazily sweeps records past expiry + retention on mint', async () => {
    // Seed a record whose hard expiry lapsed well over an hour ago.
    await store.create({
      tid: 'old',
      tokenHash: 'oldhash',
      uid: 'u1',
      status: 'active',
      createdAt: 0,
      expiresAt: 1000, // ms — ancient
      lastSeenAt: 0,
      pendingResumeUntil: null,
      origin: 'https://app.example',
      label: null,
    })
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000, // far in the future vs the seeded record
      uuid: () => 't-fresh',
    })
    // The ancient record was evicted by the mint-time sweep.
    expect(await store.findByTid('old')).toBeNull()
    // The fresh mint persisted normally.
    expect(await store.findByTid('t-fresh')).not.toBeNull()
  })

  it('rejects non-POST methods', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'GET' })
    const res = await handleMint(req, {
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 'x',
    })
    expect(res.status).toBe(405)
  })
})
