import { describe, it, expect } from 'vitest'
import { clientIpOf, createClientIpResolver } from '../../src/server/client-ip.js'

const req = (headers: Record<string, string> = {}): Request =>
  new Request('https://app.example/agent/mint', { method: 'POST', headers })

describe('clientIpOf', () => {
  it('ignores forwarding headers by default', () => {
    // The default deployment is direct-to-origin, where every header is
    // written by the caller. Keying a rate limiter on one hands the
    // caller an unlimited supply of buckets.
    expect(clientIpOf(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('anon')
    expect(clientIpOf(req({ 'x-real-ip': '203.0.113.7' }))).toBe('anon')
    expect(clientIpOf(req())).toBe('anon')
  })

  it('uses the host-supplied peer address when one is available', () => {
    const resolve = createClientIpResolver({ clientAddress: () => '198.51.100.4' })
    // Attacker-supplied headers do not displace the socket address.
    expect(resolve(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('198.51.100.4')
  })

  it('falls back to the shared bucket when the peer address is unknown', () => {
    const resolve = createClientIpResolver({ clientAddress: () => null })
    expect(resolve(req())).toBe('anon')
  })

  it('reads the hop the trusted proxy wrote, not the one the caller chose', () => {
    // One trusted proxy in front: it APPENDS the peer it saw, so the
    // rightmost entry is the only one it authored. Everything to its
    // left arrived in the caller's own header.
    const resolve = createClientIpResolver({ trustProxy: 1 })
    expect(resolve(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
    expect(resolve(req({ 'x-forwarded-for': 'spoofed, junk, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('walks back one hop per declared proxy', () => {
    const resolve = createClientIpResolver({ trustProxy: 2 })
    expect(resolve(req({ 'x-forwarded-for': 'spoofed, 203.0.113.7, 10.0.0.1' }))).toBe(
      '203.0.113.7',
    )
  })

  it('takes the leftmost hop when the chain is shorter than the declared depth', () => {
    // Every entry was then written by a trusted proxy, so the leftmost
    // one IS the real client.
    const resolve = createClientIpResolver({ trustProxy: 3 })
    expect(resolve(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
  })

  it('accepts trustProxy: true as one hop', () => {
    const resolve = createClientIpResolver({ trustProxy: true })
    expect(resolve(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('reads x-real-ip only with a trusted proxy and no forwarded chain', () => {
    const trusting = createClientIpResolver({ trustProxy: 1 })
    expect(trusting(req({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(trusting(req({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '203.0.113.7' }))).toBe(
      '1.2.3.4',
    )
  })

  it('prefers the forwarded chain over the peer address behind a trusted proxy', () => {
    // Behind a proxy the socket address is the PROXY's — the same value
    // for every client, which would collapse all of them into one bucket.
    const resolve = createClientIpResolver({
      trustProxy: 1,
      clientAddress: () => '10.0.0.1',
    })
    expect(resolve(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    // …but a request that carries no chain still falls back to it.
    expect(resolve(req())).toBe('10.0.0.1')
  })

  it('ignores an empty or whitespace-only header value', () => {
    const resolve = createClientIpResolver({ trustProxy: 1 })
    expect(resolve(req({ 'x-forwarded-for': '  ,  ' }))).toBe('anon')
    expect(resolve(req({ 'x-real-ip': '   ' }))).toBe('anon')
  })
})
