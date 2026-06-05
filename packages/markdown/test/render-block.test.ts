import { describe, it, expect, afterEach } from 'vitest'
import { mountStatic, body } from './util.js'
import type { Mounted } from './util.js'

let mounted: Mounted | undefined
afterEach(() => mounted?.cleanup())

describe('block rendering', () => {
  it('renders headings h1–h6', () => {
    mounted = mountStatic('# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f')
    const root = body(mounted.container)
    for (const [tag, txt] of [
      ['h1', 'a'],
      ['h2', 'b'],
      ['h3', 'c'],
      ['h4', 'd'],
      ['h5', 'e'],
      ['h6', 'f'],
    ] as const) {
      expect(root.querySelector(tag)?.textContent).toBe(txt)
    }
  })

  it('renders paragraphs', () => {
    mounted = mountStatic('hello world')
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('hello world')
  })

  it('renders unordered and ordered lists', () => {
    mounted = mountStatic('- one\n- two\n\n1. first\n2. second')
    const root = body(mounted.container)
    expect(root.querySelectorAll('ul li')).toHaveLength(2)
    expect(root.querySelectorAll('ol li')).toHaveLength(2)
  })

  it('renders tight list items inline (no <p> wrapper)', () => {
    mounted = mountStatic('- one\n- two')
    const items = body(mounted.container).querySelectorAll('ul li')
    expect(items).toHaveLength(2)
    // tight list ⇒ no block paragraph inside the item
    expect(items[0]?.querySelector('p')).toBeNull()
    expect(items[0]?.textContent).toBe('one')
  })

  it('keeps <p> wrappers in loose lists', () => {
    mounted = mountStatic('- one\n\n- two')
    const items = body(mounted.container).querySelectorAll('ul li')
    expect(items[0]?.querySelector('p')?.textContent).toBe('one')
  })

  it('renders an ordered list with a custom start', () => {
    mounted = mountStatic('3. three\n4. four')
    expect(body(mounted.container).querySelector('ol')?.getAttribute('start')).toBe('3')
  })

  it('renders GFM task-list items with disabled checkboxes', () => {
    mounted = mountStatic('- [x] done\n- [ ] todo')
    const boxes = body(mounted.container).querySelectorAll<HTMLInputElement>(
      'li.task-list-item input[type=checkbox]',
    )
    expect(boxes).toHaveLength(2)
    expect(boxes[0]?.checked).toBe(true)
    expect(boxes[1]?.checked).toBe(false)
    expect(boxes[0]?.disabled).toBe(true)
  })

  it('renders blockquotes', () => {
    mounted = mountStatic('> quoted')
    expect(body(mounted.container).querySelector('blockquote p')?.textContent).toBe('quoted')
  })

  it('renders fenced code with a language class', () => {
    mounted = mountStatic('```ts\nconst x = 1\n```')
    const code = body(mounted.container).querySelector('pre code')
    expect(code?.classList.contains('language-ts')).toBe(true)
    expect(code?.textContent).toBe('const x = 1')
  })

  it('renders a thematic break', () => {
    mounted = mountStatic('a\n\n---\n\nb')
    expect(body(mounted.container).querySelector('hr')).toBeTruthy()
  })

  it('renders a GFM table with alignment', () => {
    mounted = mountStatic('| L | R |\n| :- | -: |\n| 1 | 2 |')
    const root = body(mounted.container)
    expect(root.querySelectorAll('table thead th')).toHaveLength(2)
    expect(root.querySelectorAll('table tbody td')).toHaveLength(2)
    const right = root.querySelectorAll('thead th')[1] as HTMLElement
    expect(right.getAttribute('style')).toContain('text-align:right')
  })
})
