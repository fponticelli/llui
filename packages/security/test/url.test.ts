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
})
