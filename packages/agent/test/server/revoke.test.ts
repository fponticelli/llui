import { describe, it, expect, beforeEach, vi } from 'vitest'
import { handleRevoke } from '../../src/server/http/revoke.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import { InMemoryPairingRegistry } from '../../src/server/ws/pairing-registry.js'
import type { ClientFrame, ServerFrame, TokenRecord } from '../../src/protocol.js'

let store: InMemoryTokenStore
let log: unknown[]
const audit = {
  write: (e: unknown) => {
    log.push(e)
  },
}

const noopRegistry = () => new InMemoryPairingRegistry()

type FakeConn = {
  conn: {
    send: (f: ServerFrame) => void
    onFrame: (h: (cf: ClientFrame) => void) => void
    onClose: (h: () => void) => void
    close: () => void
  }
  emitClose: () => void
  closed: boolean
}

function mkFakeConn(): FakeConn {
  let onClose: () => void = () => {}
  const state = { closed: false }
  const conn = {
    send: vi.fn(),
    onFrame() {},
    onClose(h: () => void) {
      onClose = h
    },
    close() {
      state.closed = true
    },
  }
  return {
    conn,
    emitClose: () => onClose(),
    get closed() {
      return state.closed
    },
  }
}

beforeEach(() => {
  store = new InMemoryTokenStore()
  log = []
})

const seed = async (tid: string, uid: string | null) => {
  const rec: TokenRecord = {
    tid,
    tokenHash: `hash-${tid}`,
    uid,
    status: 'active',
    createdAt: 0,
    expiresAt: Number.MAX_SAFE_INTEGER,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app.example',
    label: null,
  }
  await store.create(rec)
}

describe('handleRevoke', () => {
  it('flips status to revoked for caller-owned tokens', async () => {
    await seed('t1', 'u1')
    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      registry: noopRegistry(),
      now: () => 1000,
    })
    expect(res.status).toBe(200)
    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('revoked')
    expect(log).toHaveLength(1)
  })

  it('tears down the live pairing: pushes a revoked frame, closes the socket, drops buffers', async () => {
    await seed('t1', 'u1')
    const registry = new InMemoryPairingRegistry()
    const fake = mkFakeConn()
    registry.register('t1', fake.conn)
    // Seed per-tid buffers so we can prove they're dropped on revoke.
    registry.subscribe('t1', () => false)
    registry.getRecentLog('t1', 1) // no-op read
    expect(registry.isPaired('t1')).toBe(true)

    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      registry,
      now: () => 1000,
    })

    expect(res.status).toBe(200)
    // A `revoked` frame was pushed to the browser before teardown.
    expect(fake.conn.send).toHaveBeenCalledWith({ t: 'revoked' })
    // The socket was closed and the pairing dropped.
    expect(fake.closed).toBe(true)
    expect(registry.isPaired('t1')).toBe(false)
    // A subsequent send is a no-op (pairing gone, buffers dropped).
    expect(() => registry.send('t1', { t: 'active' })).not.toThrow()
  })

  it('does not touch the registry when the caller does not own the token', async () => {
    await seed('t1', 'u1')
    const registry = new InMemoryPairingRegistry()
    const fake = mkFakeConn()
    registry.register('t1', fake.conn)

    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'attacker',
      auditSink: audit,
      registry,
      now: () => 1000,
    })

    expect(res.status).toBe(403)
    expect(fake.conn.send).not.toHaveBeenCalled()
    expect(registry.isPaired('t1')).toBe(true)
  })

  it('refuses to revoke tokens owned by someone else', async () => {
    await seed('t1', 'u1')
    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'attacker',
      auditSink: audit,
      registry: noopRegistry(),
      now: () => 1000,
    })
    expect(res.status).toBe(403)
    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('active')
  })
})
