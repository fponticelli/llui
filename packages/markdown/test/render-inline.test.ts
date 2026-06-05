import { describe, it, expect, afterEach } from 'vitest'
import { mountStatic, body } from './util.js'
import type { Mounted } from './util.js'

let mounted: Mounted | undefined
afterEach(() => mounted?.cleanup())

describe('inline rendering', () => {
  it('renders emphasis, strong and strikethrough', () => {
    mounted = mountStatic('*em* **strong** ~~gone~~')
    const root = body(mounted.container)
    expect(root.querySelector('em')?.textContent).toBe('em')
    expect(root.querySelector('strong')?.textContent).toBe('strong')
    expect(root.querySelector('del')?.textContent).toBe('gone')
  })

  it('renders inline code', () => {
    mounted = mountStatic('use `const x = 1` here')
    expect(body(mounted.container).querySelector('code')?.textContent).toBe('const x = 1')
  })

  it('renders links with href and title', () => {
    mounted = mountStatic('[LLui](https://llui.dev "home")')
    const a = body(mounted.container).querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://llui.dev')
    expect(a?.getAttribute('title')).toBe('home')
    expect(a?.textContent).toBe('LLui')
  })

  it('renders images with src and alt', () => {
    mounted = mountStatic('![logo](https://llui.dev/logo.png)')
    const img = body(mounted.container).querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://llui.dev/logo.png')
    expect(img?.getAttribute('alt')).toBe('logo')
  })

  it('renders a hard line break', () => {
    mounted = mountStatic('line one  \nline two')
    expect(body(mounted.container).querySelector('br')).toBeTruthy()
  })

  it('preserves nested inline structure', () => {
    mounted = mountStatic('**bold with *italic* inside**')
    const strong = body(mounted.container).querySelector('strong')
    expect(strong?.querySelector('em')?.textContent).toBe('italic')
  })

  it('resolves reference-style links', () => {
    mounted = mountStatic('[ref][id]\n\n[id]: https://example.com "t"')
    const a = body(mounted.container).querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://example.com')
    expect(a?.getAttribute('title')).toBe('t')
  })
})
