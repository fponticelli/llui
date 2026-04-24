import { describe, it, expect } from 'vitest'
import { createLluiAgentCore } from '../../src/server/core.js'
import { InMemoryPairingRegistry } from '../../src/server/ws/pairing-registry.js'
import type { PairingConnection } from '../../src/server/ws/pairing-registry.js'
import { signToken } from '../../src/server/token.js'

const key = 'x'.repeat(32)

function mkConn(): PairingConnection & { __frames: unknown[] } {
  const frames: unknown[] = []
  return {
    send(f) {
      frames.push(f)
    },
    onFrame() {},
    onClose() {},
    close() {},
    __frames: frames,
  }
}

describe('createLluiAgentCore', () => {
  it('builds a runtime-neutral handle with router + registry + acceptConnection', () => {
    const core = createLluiAgentCore({ signingKey: key })
    expect(typeof core.router).toBe('function')
    expect(typeof core.acceptConnection).toBe('function')
    expect(core.registry).toBeInstanceOf(InMemoryPairingRegistry)
    expect(core.tokenStore).toBeDefined()
    expect(core.auditSink).toBeDefined()
  })

  it('acceptConnection rejects unsigned tokens', async () => {
    const core = createLluiAgentCore({ signingKey: key })
    const conn = mkConn()
    const result = await core.acceptConnection('not-a-token', conn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('acceptConnection rejects tokens signed with a different key', async () => {
    const core = createLluiAgentCore({ signingKey: key })
    const other = await signToken(
      { tid: 't1', iat: 0, exp: 9_999_999_999, scope: 'agent' },
      'y'.repeat(32),
    )
    const result = await core.acceptConnection(other, mkConn())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('acceptConnection rejects when the tid has no TokenRecord', async () => {
    const core = createLluiAgentCore({ signingKey: key })
    const token = await signToken(
      { tid: 'unseeded', iat: 0, exp: 9_999_999_999, scope: 'agent' },
      key,
    )
    const result = await core.acceptConnection(token, mkConn())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.code).toBe('revoked')
    }
  })

  it('acceptConnection registers the pairing on success', async () => {
    const core = createLluiAgentCore({ signingKey: key })
    // Seed a token record for 't1'
    await core.tokenStore.create({
      tid: 't1',
      uid: 'u1',
      status: 'awaiting-ws',
      createdAt: 0,
      lastSeenAt: 0,
      pendingResumeUntil: null,
      origin: 'https://app',
      label: null,
    })
    const token = await signToken({ tid: 't1', iat: 0, exp: 9_999_999_999, scope: 'agent' }, key)
    const result = await core.acceptConnection(token, mkConn())
    expect(result).toEqual({ ok: true, tid: 't1' })
    expect(core.registry.isPaired('t1')).toBe(true)
    const rec = await core.tokenStore.findByTid('t1')
    expect(rec?.status).toBe('awaiting-claude')
  })
})
