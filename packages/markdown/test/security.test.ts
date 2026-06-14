import { describe, it, expect, afterEach } from 'vitest'
import { sanitizeUrl } from '../src/index.js'
import { mountStatic, body } from './util.js'
import type { Mounted } from './util.js'

let mounted: Mounted | undefined
afterEach(() => mounted?.cleanup())

describe('sanitizeUrl', () => {
  const allowed = ['http', 'https', 'mailto', 'tel']

  it('allows http/https/mailto/tel', () => {
    expect(sanitizeUrl('https://example.com', allowed)).toBe('https://example.com')
    expect(sanitizeUrl('mailto:a@b.com', allowed)).toBe('mailto:a@b.com')
    expect(sanitizeUrl('tel:+15551234', allowed)).toBe('tel:+15551234')
  })

  it('allows relative URLs, anchors and queries (no scheme)', () => {
    expect(sanitizeUrl('/docs/x', allowed)).toBe('/docs/x')
    expect(sanitizeUrl('#section', allowed)).toBe('#section')
    expect(sanitizeUrl('page?q=1', allowed)).toBe('page?q=1')
    expect(sanitizeUrl('./a:b', allowed)).toBe('./a:b') // colon after slash ⇒ relative
  })

  it('blocks javascript:, data:, vbscript: and mangled schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('data:text/html,<script>', allowed)).toBeNull()
    expect(sanitizeUrl('vbscript:msgbox', allowed)).toBeNull()
    expect(sanitizeUrl('java\nscript:alert(1)', allowed)).toBeNull()
  })

  it('blocks schemes hidden behind tabs/newlines and leading control chars', () => {
    // Browsers strip ASCII whitespace/control chars from URLs before
    // resolving the scheme, so a sanitizer that does not normalize first
    // can be bypassed by `java\tscript:` or a leading control char.
    expect(sanitizeUrl('java\tscript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('java\r\nscript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('javascript:alert(1)', allowed)).toBeNull()
    expect(sanitizeUrl('  \tjavascript:alert(1)', allowed)).toBeNull()
    // Normalization must not break a legitimate URL with stray leading space.
    expect(sanitizeUrl('  https://example.com', allowed)).toBe('https://example.com')
  })

  it('honors a custom protocol allowlist', () => {
    expect(sanitizeUrl('data:image/png;base64,AAAA', ['data'])).toBe('data:image/png;base64,AAAA')
  })
})

describe('render security', () => {
  it('neutralizes a javascript: link, keeping its text', () => {
    mounted = mountStatic('[click](javascript:alert(1))')
    const root = body(mounted.container)
    expect(root.querySelector('a')).toBeNull()
    expect(root.textContent).toContain('click')
  })

  it('drops raw HTML by default', () => {
    mounted = mountStatic('before\n\n<div class="danger">x</div>\n\nafter')
    const root = body(mounted.container)
    expect(root.querySelector('.danger')).toBeNull()
    expect(root.textContent).toContain('before')
    expect(root.textContent).toContain('after')
  })

  it('renders raw HTML only through a sanitizeHtml hook', () => {
    // No unsanitized passthrough exists: raw HTML renders only when the
    // consumer supplies a sanitizer, which sees the raw string and
    // returns the safe HTML to inject.
    const seen: string[] = []
    mounted = mountStatic('<div class="ok">x</div><img onerror="alert(1)">', {
      sanitizeHtml: (html) => {
        seen.push(html)
        // Trivial allow-list sanitizer for the test: keep the div, drop the img.
        return html.replace(/<img[^>]*>/g, '')
      },
    })
    const root = body(mounted.container)
    expect(root.querySelector('.ok')).toBeTruthy()
    expect(root.querySelector('img')).toBeNull()
    expect(seen.join('')).toContain('onerror')
  })

  it('drops raw HTML when no sanitizeHtml hook is provided', () => {
    mounted = mountStatic('<img src=x onerror="alert(1)"><div class="danger">x</div>')
    const root = body(mounted.container)
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('.danger')).toBeNull()
  })

  it('drops an image with a blocked src', () => {
    mounted = mountStatic('![alt](javascript:evil)')
    const root = body(mounted.container)
    expect(root.querySelector('img')).toBeNull()
  })

  it('applies transformLink to rewrite hrefs', () => {
    mounted = mountStatic('[x](/rel)', {
      transformLink: (href) => `https://site.test${href}`,
    })
    const root = body(mounted.container)
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://site.test/rel')
  })
})
