import { describe, it, expect } from 'vitest'
import { signToken, verifyToken, type TokenPayload } from '../../src/server/token.js'

const key = 'x'.repeat(32)

describe('signToken / verifyToken', () => {
  it('round-trips a payload', async () => {
    const payload: TokenPayload = {
      tid: '11111111-1111-1111-1111-111111111111',
      iat: 1700000000,
      exp: 9999999999,
      scope: 'agent',
    }
    const tok = await signToken(payload, key)
    expect(tok).toMatch(/^llui-agent_/)
    const verified = await verifyToken(tok, key)
    expect(verified).toEqual({ kind: 'ok', payload })
  })

  it('rejects a token signed with a different key', async () => {
    const payload: TokenPayload = { tid: 't1', iat: 0, exp: 86400, scope: 'agent' }
    const tok = await signToken(payload, key)
    const verified = await verifyToken(tok, 'y'.repeat(32))
    expect(verified).toEqual({ kind: 'invalid', reason: 'bad-signature' })
  })

  it('rejects a tampered payload', async () => {
    const payload: TokenPayload = { tid: 't1', iat: 0, exp: 86400, scope: 'agent' }
    const tok = await signToken(payload, key)
    const tampered = 'llui-agent_eyJ0aWQiOiJoYWNrZXIifQ.' + tok.split('.')[1]
    expect(await verifyToken(tampered, key)).toEqual({ kind: 'invalid', reason: 'bad-signature' })
  })

  it('reports expired tokens distinctly from bad-signature', async () => {
    const past: TokenPayload = { tid: 't1', iat: 0, exp: 1, scope: 'agent' }
    const tok = await signToken(past, key)
    const verified = await verifyToken(tok, key, 100)
    expect(verified).toEqual({ kind: 'invalid', reason: 'expired' })
  })

  it('rejects a malformed token string', async () => {
    expect(await verifyToken('not-a-token', key)).toEqual({
      kind: 'invalid',
      reason: 'malformed',
    })
    expect(await verifyToken('llui-agent_abc', key)).toEqual({
      kind: 'invalid',
      reason: 'malformed',
    })
  })

  it('rejects an empty/short HMAC key', async () => {
    const payload: TokenPayload = { tid: 't1', iat: 0, exp: 86400, scope: 'agent' }
    // Synchronous throws in async functions become promise rejections.
    await expect(signToken(payload, 'short')).rejects.toThrow(/32 bytes/)
  })
})
