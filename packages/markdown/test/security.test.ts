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

  it('renders raw HTML when allowDangerousHtml is set', () => {
    mounted = mountStatic('<div class="ok">x</div>', { allowDangerousHtml: true })
    const root = body(mounted.container)
    expect(root.querySelector('.ok')).toBeTruthy()
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
