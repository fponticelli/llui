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
