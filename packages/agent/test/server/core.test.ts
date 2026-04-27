import { describe, it, expect } from 'vitest'
import { createLluiAgentCore } from '../../src/server/core.js'
import { InMemoryPairingRegistry } from '../../src/server/ws/pairing-registry.js'
import type { PairingConnection } from '../../src/server/ws/pairing-registry.js'
import { seedToken } from './_token-helper.js'

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
    const core = createLluiAgentCore()
    expect(typeof core.router).toBe('function')
    expect(typeof core.acceptConnection).toBe('function')
    expect(core.registry).toBeInstanceOf(InMemoryPairingRegistry)
    expect(core.tokenStore).toBeDefined()
    expect(core.auditSink).toBeDefined()
  })

  it('acceptConnection rejects malformed tokens', async () => {
    const core = createLluiAgentCore()
    const conn = mkConn()
    const result = await core.acceptConnection('not-a-token', conn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('acceptConnection rejects unknown opaque tokens (no record)', async () => {
    const core = createLluiAgentCore()
    // Well-formed prefix but no record exists for this hash.
    const result = await core.acceptConnection('llui-agent_unseededOpaque', mkConn())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('auth-failed')
    }
  })

  it('acceptConnection registers the pairing on success', async () => {
    const core = createLluiAgentCore()
    const { token } = await seedToken(core.tokenStore, {
      tid: 't1',
      uid: 'u1',
      status: 'awaiting-ws',
    })
    const result = await core.acceptConnection(token, mkConn())
    expect(result).toEqual({ ok: true, tid: 't1' })
    expect(core.registry.isPaired('t1')).toBe(true)
    const rec = await core.tokenStore.findByTid('t1')
    expect(rec?.status).toBe('awaiting-claude')
  })

  it('acceptConnection rejects revoked tokens with 403', async () => {
    const core = createLluiAgentCore()
    const { token } = await seedToken(core.tokenStore, {
      tid: 't-rev',
      uid: 'u1',
      status: 'revoked',
    })
    const res = await core.acceptConnection(token, mkConn())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(403)
      expect(res.code).toBe('revoked')
    }
  })
})
