import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../src/index.js'
import type { Heading, Paragraph, Table, Delete, Code } from 'mdast'

describe('parseMarkdown', () => {
  it('parses heading + paragraph into mdast with positions', () => {
    const root = parseMarkdown('# Title\n\nHello *world*')
    expect(root.type).toBe('root')
    const [heading, para] = root.children
    expect(heading).toMatchObject({ type: 'heading', depth: 1 })
    expect((heading as Heading).position).toBeTruthy()
    expect(para?.type).toBe('paragraph')
    // inline emphasis is preserved as a child node
    const emphasis = (para as Paragraph).children.find((c) => c.type === 'emphasis')
    expect(emphasis).toBeTruthy()
  })

  it('parses GFM tables by default', () => {
    const root = parseMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')
    const table = root.children[0] as Table
    expect(table.type).toBe('table')
    expect(table.children).toHaveLength(2) // header + one body row
  })

  it('parses GFM strikethrough, task lists and autolinks', () => {
    const strike = parseMarkdown('~~gone~~')
    const para = strike.children[0] as Paragraph
    expect(para.children[0]?.type).toBe('delete')
    expect((para.children[0] as Delete).children[0]).toMatchObject({ type: 'text', value: 'gone' })

    const task = parseMarkdown('- [x] done\n- [ ] todo')
    const list = task.children[0]
    expect(list?.type).toBe('list')

    const auto = parseMarkdown('visit https://example.com now')
    const ap = auto.children[0] as Paragraph
    expect(ap.children.some((c) => c.type === 'link')).toBe(true)
  })

  it('keeps the fenced code language', () => {
    const root = parseMarkdown('```ts\nconst x = 1\n```')
    const code = root.children[0] as Code
    expect(code.type).toBe('code')
    expect(code.lang).toBe('ts')
    expect(code.value).toBe('const x = 1')
  })

  it('disables GFM when gfm:false', () => {
    const root = parseMarkdown('| a | b |\n| - | - |', { gfm: false })
    expect(root.children[0]?.type).not.toBe('table')
  })
})
