import { describe, it, expect } from 'vitest'
import { tokensMatch, isLoopbackOrigin } from '../src/util/loopback.js'

describe('tokensMatch', () => {
  it('returns true for identical tokens', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true)
  })

  it('returns false for differing tokens of equal length', () => {
    expect(tokensMatch('abc123', 'abc124')).toBe(false)
  })

  it('returns false (no throw) for differing lengths', () => {
    // Length mismatch short-circuits before timingSafeEqual, which would
    // otherwise throw on unequal-length buffers.
    expect(tokensMatch('short', 'a-much-longer-token')).toBe(false)
  })

  it('returns true for empty-vs-empty', () => {
    expect(tokensMatch('', '')).toBe(true)
  })
})

describe('isLoopbackOrigin', () => {
  it('allows an absent Origin header (native, non-browser client)', () => {
    expect(isLoopbackOrigin(undefined)).toBe(true)
  })

  it('allows loopback hosts', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:5200')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:3000')).toBe(true)
    expect(isLoopbackOrigin('https://localhost')).toBe(true)
  })

  it('allows bracketed IPv6 loopback', () => {
    // WHATWG URL.hostname keeps the brackets (`[::1]`); the helper strips
    // them before the loopback comparison.
    expect(isLoopbackOrigin('http://[::1]:5200')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]')).toBe(true)
  })

  it('rejects a literal `Origin: null` (sandboxed / file: / data: context)', () => {
    // NOT the same as an absent header — `new URL("null")` throws and it
    // falls through to rejection.
    expect(isLoopbackOrigin('null')).toBe(false)
  })

  it('rejects cross-origin hosts', () => {
    expect(isLoopbackOrigin('https://evil.example.com')).toBe(false)
    expect(isLoopbackOrigin('http://169.254.169.254')).toBe(false)
    expect(isLoopbackOrigin('http://127.0.0.1.evil.com')).toBe(false)
  })
})
