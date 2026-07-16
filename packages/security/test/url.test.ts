import { describe, it, expect } from 'vitest'
import { sanitizeUrl, defaultAllowedProtocols } from '../src/index.js'

describe('sanitizeUrl', () => {
  const allowed = ['http', 'https', 'mailto', 'tel']

  it('allows http/https/mailto/tel', () => {
    expect(sanitizeUrl('https://example.com', allowed)).toBe('https://example.com')
    expect(sanitizeUrl('mailto:a@b.com', allowed)).toBe('mailto:a@b.com')
    expect(sanitizeUrl('tel:+15551234', allowed)).toBe('tel:+15551234')
  })

  it('defaults to defaultAllowedProtocols when no allowlist is passed', () => {
    expect(defaultAllowedProtocols).toEqual(['http', 'https', 'mailto', 'tel'])
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
    expect(sanitizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeUrl('data:text/html,x')).toBeNull() // data: not in the default set
  })

  it('allows relative URLs, anchors and queries (no scheme)', () => {
    expect(sanitizeUrl('/docs/x', allowed)).toBe('/docs/x')
    expect(sanitizeUrl('#section', allowed)).toBe('#section')
    expect(sanitizeUrl('page?q=1', allowed)).toBe('page?q=1')
    expect(sanitizeUrl('./a:b', allowed)).toBe('./a:b') // colon after slash ⇒ relative
  })

  it('blocks javascript:, data:, vbscript: and mangled schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('JAVASCRIPT:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('data:text/html,<script>', allowed)).toBeNull()
    expect(sanitizeUrl('vbscript:msgbox', allowed)).toBeNull()
    expect(sanitizeUrl('java\nscript:alert(1)', allowed)).toBeNull()
  })

  it('blocks schemes hidden behind tabs/newlines and leading control chars', () => {
    // Browsers strip ASCII whitespace/control chars from URLs before resolving
    // the scheme; a sanitizer that does not normalize first can be bypassed.
    expect(sanitizeUrl('java\tscript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('java\r\nscript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('\x01javascript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('  \tjavascript:alert(1)', allowed)).toBeNull()
    // Normalization must not break a legitimate URL with stray leading space.
    expect(sanitizeUrl('  https://example.com', allowed)).toBe('https://example.com')
  })

  it('honors a custom protocol allowlist', () => {
    expect(sanitizeUrl('data:image/png;base64,AAAA', ['data'])).toBe('data:image/png;base64,AAAA')
    expect(sanitizeUrl('https://x', ['data'])).toBeNull()
  })

  it('resolves protocol-relative (//host) URLs against the allowlist instead of passing them as relative', () => {
    // `//tracker/p.png` has no colon, so a naive "no scheme ⇒ relative ⇒ safe"
    // check would let an untrusted image issue a live cross-origin request while
    // dodging the allowlist entirely. Its effective scheme is the page protocol
    // (http/https), so it is only safe when BOTH http and https are permitted.
    expect(sanitizeUrl('//tracker/p.png', allowed)).toBe('//tracker/p.png')
    expect(sanitizeUrl('//example.com/x', ['http', 'https'])).toBe('//example.com/x')
    // Allowlist missing http (or https) ⇒ the effective protocol may be blocked ⇒ reject.
    expect(sanitizeUrl('//tracker/p.png', ['https'])).toBeNull()
    expect(sanitizeUrl('//tracker/p.png', ['http'])).toBeNull()
    expect(sanitizeUrl('//tracker/p.png', ['mailto'])).toBeNull()
    // Leading control/space chars must not hide the protocol-relative form.
    expect(sanitizeUrl('  //tracker/p.png', ['mailto'])).toBeNull()
    expect(sanitizeUrl('\x01//tracker/p.png', ['mailto'])).toBeNull()
    // A single leading slash is a genuine path-relative URL and stays safe.
    expect(sanitizeUrl('/docs/x', ['mailto'])).toBe('/docs/x')
    // `///x` (empty host) is still protocol-relative in form ⇒ gated the same way.
    expect(sanitizeUrl('///x', ['mailto'])).toBeNull()
  })
})
