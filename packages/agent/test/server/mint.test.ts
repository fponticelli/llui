import { describe, it, expect, beforeEach } from 'vitest'
import { handleMint } from '../../src/server/http/mint.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import { verifyToken } from '../../src/server/token.js'
import type { MintResponse } from '../../src/protocol.js'

const key = 'x'.repeat(32)
let store: InMemoryTokenStore
let auditLog: unknown[]
let clock = 1_700_000_000

const now = () => clock
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
  it('creates a pairing record and returns a signed token + wsUrl + lapUrl', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      signingKey: key,
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

    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBe('u1')
    expect(stored?.status).toBe('awaiting-ws')
    expect(stored?.origin).toBe('https://app.example')

    const verified = await verifyToken(body.token, key, clock)
    expect(verified.kind).toBe('ok')
  })

  it('tolerates a null identity (anonymous app)', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 't-null',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBeNull()
  })

  it('writes a mint audit entry', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    await handleMint(req, {
      signingKey: key,
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
      signingKey: key,
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
