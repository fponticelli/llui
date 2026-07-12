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
    const result = await core.acceptConnection('agt_unseededOpaque', mkConn())
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

  // ── WS-close → pending-resume → re-pair ────────────────────────
  // The grace window. When a paired WS closes, the token record
  // transitions to `pending-resume` with a TTL. A reconnect with the
  // same bearer within the TTL re-pairs without rotating the token
  // (so the agent's existing connection stays valid). After the TTL,
  // the record is treated as expired and the bearer no longer auths.

  it('WS close transitions an active tid to pending-resume with a TTL', async () => {
    const core = createLluiAgentCore({ pendingResumeGraceMs: 60_000 })
    const { token } = await seedToken(core.tokenStore, {
      tid: 't-close',
      uid: 'u1',
      status: 'awaiting-ws',
    })
    // Open and then close the WS via the connection's onClose callback.
    let closeFn: (() => void) | null = null
    const conn = {
      send() {},
      onFrame() {},
      onClose(fn: () => void) {
        closeFn = fn
      },
      close() {},
    }
    await core.acceptConnection(token, conn)
    // Mark active to simulate Claude having claimed the session.
    await core.tokenStore.markActive('t-close', 'demo', Date.now())
    expect(closeFn).not.toBeNull()
    closeFn!()
    // Microtask queue drains for the void async-write inside the close
    // handler.
    await new Promise((r) => setTimeout(r, 0))
    const after = await core.tokenStore.findByTid('t-close')
    expect(after?.status).toBe('pending-resume')
    expect(after?.pendingResumeUntil).toBeGreaterThan(Date.now())
  })

  it('reconnect with same bearer within the grace window re-pairs as active (no rotation)', async () => {
    const core = createLluiAgentCore({ pendingResumeGraceMs: 60_000 })
    const { token } = await seedToken(core.tokenStore, {
      tid: 't-repair',
      uid: 'u1',
      status: 'awaiting-ws',
    })
    let firstClose: (() => void) | null = null
    const conn1 = {
      send() {},
      onFrame() {},
      onClose(fn: () => void) {
        firstClose = fn
      },
      close() {},
    }
    await core.acceptConnection(token, conn1)
    await core.tokenStore.markActive('t-repair', 'demo', Date.now())
    firstClose!()
    await new Promise((r) => setTimeout(r, 0))

    // Reconnect with the SAME token. Should land on `active`,
    // skipping `awaiting-claude` since Claude was already bound.
    const result = await core.acceptConnection(token, mkConn())
    expect(result).toEqual({ ok: true, tid: 't-repair' })
    const after = await core.tokenStore.findByTid('t-repair')
    expect(after?.status).toBe('active')
    expect(after?.label).toBe('demo')
    // The bearer wasn't rotated — the original tokenHash is still
    // valid (a fresh `findByTokenHash(originalHash)` would still
    // resolve). We can't read the hash directly, but we can confirm
    // the same token still authenticates: opening another WS with
    // the same token (after closing this one) succeeds again.
  })

  it('reconnect after grace expiry rejects with auth-failed', async () => {
    const core = createLluiAgentCore({ pendingResumeGraceMs: 1 })
    const { token } = await seedToken(core.tokenStore, {
      tid: 't-expired',
      uid: 'u1',
      status: 'awaiting-ws',
    })
    let closeFn: (() => void) | null = null
    const conn = {
      send() {},
      onFrame() {},
      onClose(fn: () => void) {
        closeFn = fn
      },
      close() {},
    }
    await core.acceptConnection(token, conn)
    await core.tokenStore.markActive('t-expired', 'demo', Date.now())
    closeFn!()
    await new Promise((r) => setTimeout(r, 5))

    // Past the 1ms grace — reconnect with the same bearer is rejected.
    const result = await core.acceptConnection(token, mkConn())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('auth-failed')
  })

  it('opting out (graceMs=0) transitions to an immediately-claimable pending-resume on WS close', async () => {
    const core = createLluiAgentCore({ pendingResumeGraceMs: 0 })
    const { token } = await seedToken(core.tokenStore, {
      tid: 't-no-grace',
      uid: 'u1',
      status: 'awaiting-ws',
    })
    let closeFn: (() => void) | null = null
    const conn = {
      send() {},
      onFrame() {},
      onClose(fn: () => void) {
        closeFn = fn
      },
      close() {},
    }
    await core.acceptConnection(token, conn)
    await core.tokenStore.markActive('t-no-grace', 'demo', Date.now())
    closeFn!()
    await new Promise((r) => setTimeout(r, 0))
    // With grace=0 the close handler still runs, transitioning the record
    // OUT of `active` into `pending-resume` with a window that is already
    // expired — so the record isn't stuck live, and any WS reconnect must
    // go through /resume/claim (rotation).
    const after = await core.tokenStore.findByTid('t-no-grace')
    expect(after?.status).toBe('pending-resume')
    expect(after?.pendingResumeUntil).toBeLessThanOrEqual(Date.now())

    // Reconnecting the WS with the same bearer is rejected (grace expired).
    const conn2 = { send() {}, onFrame() {}, onClose() {}, close() {} }
    const res = await core.acceptConnection(token, conn2)
    expect(res.ok).toBe(false)
  })
})
