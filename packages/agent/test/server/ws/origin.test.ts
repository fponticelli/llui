import { describe, it, expect } from 'vitest'
import { checkWsOrigin, composeSelfOrigin } from '../../../src/server/ws/origin.js'

describe('composeSelfOrigin', () => {
  it('prefers forwarded proto/host (first entry, trimmed) over the fallback', () => {
    expect(
      composeSelfOrigin({
        forwardedProto: 'https, http',
        fallbackProto: 'http',
        forwardedHost: 'app.example.com, internal',
        fallbackHost: '10.0.0.1:8787',
      }),
    ).toBe('https://app.example.com')
  })

  it('falls back when forwarded values are absent, null, or empty', () => {
    expect(composeSelfOrigin({ fallbackProto: 'http', fallbackHost: '127.0.0.1:8787' })).toBe(
      'http://127.0.0.1:8787',
    )
    expect(
      composeSelfOrigin({
        forwardedProto: null,
        fallbackProto: 'https',
        forwardedHost: '   ',
        fallbackHost: 'host:1',
      }),
    ).toBe('https://host:1')
  })

  it('lets a proxied https Origin pass the same-origin check (the regression it fixes)', () => {
    // Runtime sees http (TLS terminated at the proxy); forwarded proto is https.
    const selfOrigin = composeSelfOrigin({
      forwardedProto: 'https',
      fallbackProto: 'http',
      forwardedHost: 'app.example.com',
      fallbackHost: 'app.example.com',
    })
    expect(checkWsOrigin('https://app.example.com', selfOrigin).ok).toBe(true)
    expect(checkWsOrigin('https://evil.example', selfOrigin).ok).toBe(false)
  })
})
