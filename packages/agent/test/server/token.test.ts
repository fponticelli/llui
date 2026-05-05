import { describe, it, expect } from 'vitest'
import { mintToken, tokenHashOf } from '../../src/server/token.js'

describe('mintToken / tokenHashOf', () => {
  it('mints a prefixed token + a SHA-256 hex hash', async () => {
    const { token, tokenHash } = await mintToken()
    expect(token).toMatch(/^agt_/)
    // base64url-encoded 32 bytes = 43 chars + 4-char prefix = 47 chars
    expect(token.length).toBe(47)
    // SHA-256 in hex = 64 chars
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    // hashOf(token) reproduces the same hash; this is what the server
    // does on every authenticated request.
    expect(await tokenHashOf(token)).toBe(tokenHash)
  })

  it('returns null for tokens missing the prefix (fail-fast on garbage)', async () => {
    expect(await tokenHashOf('not-a-token')).toBeNull()
    expect(await tokenHashOf('Bearer xyz')).toBeNull()
    expect(await tokenHashOf('')).toBeNull()
  })

  it('hashes any prefixed input shape — opaque tokens have no internal structure', async () => {
    // Crucially, the verify path does NOT inspect the token after the
    // prefix. So even a tampered or made-up suffix produces a hash;
    // the lookup against the store is what fails the auth.
    const hash = await tokenHashOf('agt_made-up-bytes-that-arent-in-the-store')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mints distinct tokens across calls (entropy sanity check)', async () => {
    const a = await mintToken()
    const b = await mintToken()
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })
})
