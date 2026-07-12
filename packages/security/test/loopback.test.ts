import { describe, it, expect } from 'vitest'
import { isLoopbackHost, isLoopbackAuthority, isLoopbackOrigin } from '../src/index.js'

describe('isLoopbackHost', () => {
  it('recognizes the documented loopback host set', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('[::1]')).toBe(true) // bracketed IPv6
    expect(isLoopbackHost('LOCALHOST')).toBe(true) // case-insensitive
  })

  it('rejects non-loopback and the 0.0.0.0 unspecified address', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('evil.example.com')).toBe(false)
    expect(isLoopbackHost('169.254.169.254')).toBe(false)
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false)
  })
})

describe('isLoopbackAuthority (Host / authority header, absent ⇒ false)', () => {
  it('rejects an absent/empty authority (not provably same-machine)', () => {
    expect(isLoopbackAuthority(undefined)).toBe(false)
    expect(isLoopbackAuthority('')).toBe(false)
  })

  it('strips the port and recognizes loopback', () => {
    expect(isLoopbackAuthority('127.0.0.1:5173')).toBe(true)
    expect(isLoopbackAuthority('localhost:3000')).toBe(true)
    expect(isLoopbackAuthority('localhost')).toBe(true)
    expect(isLoopbackAuthority('[::1]:5173')).toBe(true) // bracketed IPv6 + port
    expect(isLoopbackAuthority('::1')).toBe(true) // bare IPv6, no port
  })

  it('rejects 0.0.0.0 and cross-origin authorities', () => {
    expect(isLoopbackAuthority('0.0.0.0:5173')).toBe(false)
    expect(isLoopbackAuthority('evil.example.com')).toBe(false)
    expect(isLoopbackAuthority('evil.example.com:443')).toBe(false)
  })
})

describe('isLoopbackOrigin (Origin header, absent ⇒ true)', () => {
  it('allows an absent Origin (native, non-browser client)', () => {
    expect(isLoopbackOrigin(undefined)).toBe(true)
  })

  it('allows loopback origins', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:5200')).toBe(true)
    expect(isLoopbackOrigin('http://localhost:3000')).toBe(true)
    expect(isLoopbackOrigin('https://localhost')).toBe(true)
  })

  it('allows bracketed IPv6 loopback', () => {
    expect(isLoopbackOrigin('http://[::1]:5200')).toBe(true)
    expect(isLoopbackOrigin('http://[::1]')).toBe(true)
  })

  it('rejects a literal `Origin: null` (sandboxed / file: / data: context)', () => {
    expect(isLoopbackOrigin('null')).toBe(false)
  })

  it('rejects 0.0.0.0 and cross-origin hosts', () => {
    expect(isLoopbackOrigin('http://0.0.0.0:5200')).toBe(false)
    expect(isLoopbackOrigin('https://evil.example.com')).toBe(false)
    expect(isLoopbackOrigin('http://169.254.169.254')).toBe(false)
    expect(isLoopbackOrigin('http://127.0.0.1.evil.com')).toBe(false)
  })
})
