import { describe, it, expect } from 'vitest'
import { buildPausedResponse } from '../../../src/server/lap/paused.js'
import { InMemoryTokenStore } from '../../../src/server/token-store.js'
import type { TokenRecord } from '../../../src/protocol.js'

// Build a record with sensible defaults; the test overrides the
// fields it cares about (status, pendingResumeUntil).
function rec(over: Partial<TokenRecord>): TokenRecord {
  return {
    tid: 't1',
    tokenHash: 'h',
    uid: 'u',
    label: 'l',
    origin: 'http://app',
    status: 'active',
    createdAt: 1,
    expiresAt: 9_999_999_999_999,
    lastSeenAt: 1,
    pendingResumeUntil: null,
    ...over,
  }
}

describe('buildPausedResponse', () => {
  it('returns 503 with X-LLui-Reconnect: pending and Retry-After when within the grace window', async () => {
    const store = new InMemoryTokenStore()
    const now = 1_000_000
    await store.create(rec({ status: 'pending-resume', pendingResumeUntil: now + 30_000 }))
    const res = await buildPausedResponse(store, 't1', now)
    expect(res.status).toBe(503)
    expect(res.headers.get('x-llui-reconnect')).toBe('pending')
    // 30s remaining, ceil → 30
    expect(res.headers.get('retry-after')).toBe('30')
    const body = (await res.json()) as { error: { code: string; reconnect: string } }
    expect(body.error).toEqual({ code: 'paused', reconnect: 'pending' })
  })

  it('returns Retry-After ≥ 1 even when only milliseconds remain in the grace window', async () => {
    const store = new InMemoryTokenStore()
    const now = 1_000_000
    await store.create(rec({ status: 'pending-resume', pendingResumeUntil: now + 50 }))
    const res = await buildPausedResponse(store, 't1', now)
    // 50ms remaining → ceil 1s.
    expect(res.headers.get('retry-after')).toBe('1')
  })

  it('reports `expired` when pending-resume window has already closed', async () => {
    const store = new InMemoryTokenStore()
    const now = 1_000_000
    await store.create(rec({ status: 'pending-resume', pendingResumeUntil: now - 1 }))
    const res = await buildPausedResponse(store, 't1', now)
    expect(res.headers.get('x-llui-reconnect')).toBe('expired')
    expect(res.headers.get('retry-after')).toBeNull()
  })

  it('reports `revoked` for explicitly-revoked records', async () => {
    const store = new InMemoryTokenStore()
    await store.create(rec({ status: 'revoked' }))
    const res = await buildPausedResponse(store, 't1')
    expect(res.headers.get('x-llui-reconnect')).toBe('revoked')
    expect(res.headers.get('retry-after')).toBeNull()
  })

  it('reports `pending` with default retry for active/awaiting-claude with no live WS', async () => {
    // Edge case — record is `active` but isPaired returned false.
    // The close handler hasn't fired yet, or the WS is mid-reconnect.
    // Surface as pending with a short Retry-After so the agent
    // backs off briefly and tries again.
    const store = new InMemoryTokenStore()
    await store.create(rec({ status: 'active' }))
    const res = await buildPausedResponse(store, 't1')
    expect(res.headers.get('x-llui-reconnect')).toBe('pending')
    expect(res.headers.get('retry-after')).toBe('5')
  })

  it('reports `unknown` and no Retry-After for missing records', async () => {
    const store = new InMemoryTokenStore()
    const res = await buildPausedResponse(store, 't-missing')
    expect(res.headers.get('x-llui-reconnect')).toBe('unknown')
    expect(res.headers.get('retry-after')).toBeNull()
    const body = (await res.json()) as { error: { code: string; reconnect: string } }
    expect(body.error.reconnect).toBe('unknown')
  })

  it('always sets content-type: application/json', async () => {
    const store = new InMemoryTokenStore()
    await store.create(rec({ status: 'active' }))
    const res = await buildPausedResponse(store, 't1')
    expect(res.headers.get('content-type')).toBe('application/json')
  })
})
