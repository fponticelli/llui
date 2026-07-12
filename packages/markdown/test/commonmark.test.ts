import { describe, it, expect } from 'vitest'
import { parseMarkdown as parseCommon } from '../src/commonmark.js'
import { parseMarkdown as parseGfm } from '../src/index.js'
import type { Paragraph } from 'mdast'

declare global {
  // vite/vitest provide `import.meta.glob`; declare the narrow shape we use so the
  // type-check (raw tsc, no vite/client types) passes.
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: string; import: string; eager: true },
    ): Record<string, string>
  }
}

describe('@llui/markdown/commonmark — GFM-free parser', () => {
  it('does NOT parse GFM tables (renders as a paragraph)', () => {
    const root = parseCommon('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(root.children.some((c) => c.type === 'table')).toBe(false)
  })

  it('does NOT parse GFM strikethrough', () => {
    const root = parseCommon('~~gone~~')
    const para = root.children[0] as Paragraph
    expect(para.children.some((c) => c.type === 'delete')).toBe(false)
  })

  it('still parses plain CommonMark (headings, emphasis, links)', () => {
    const root = parseCommon('# Title\n\nHello *world* [x](/y)')
    expect(root.children[0]).toMatchObject({ type: 'heading', depth: 1 })
    const para = root.children[1] as Paragraph
    expect(para.children.some((c) => c.type === 'emphasis')).toBe(true)
    expect(para.children.some((c) => c.type === 'link')).toBe(true)
  })

  it('the default (GFM) entry still parses tables — the two entries diverge', () => {
    expect(parseGfm('| a |\n| - |\n| 1 |').children[0]?.type).toBe('table')
  })
})

describe('CommonMark import graph is GFM-free (static check)', () => {
  // The whole point of the split entry: a consumer importing /commonmark must not
  // pull micromark/mdast GFM into their bundle. Read every module's source via
  // vite's `?raw` glob (no node:fs types needed) and assert nothing reachable from
  // commonmark.ts statically imports a gfm package — parse.js (which does) must be
  // reachable ONLY from the default entry.
  const raw = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  })
  const gfmImport = /from\s+['"][^'"]*gfm[^'"]*['"]/

  const read = (rel: string): string => {
    const entry = Object.entries(raw).find(([p]) => p.endsWith(rel))
    if (!entry) throw new Error(`source not found: ${rel}`)
    return entry[1]
  }

  it('commonmark.ts does not import ./parse.js (the GFM module) or any gfm pkg', () => {
    const text = read('/commonmark.ts')
    expect(text.includes("'./parse.js'")).toBe(false)
    expect(gfmImport.test(text)).toBe(false)
  })

  it('parse-core.ts (the CommonMark parser) imports no gfm extension', () => {
    expect(gfmImport.test(read('/parse-core.ts'))).toBe(false)
  })

  it('render.ts (shared factory) imports no parser and no gfm extension', () => {
    const text = read('/render.ts')
    expect(gfmImport.test(text)).toBe(false)
    expect(text.includes("'./parse.js'")).toBe(false)
    expect(text.includes("'./parse-core.js'")).toBe(false)
  })

  it('parse.js IS reachable from the default index (sanity: the split is real)', () => {
    expect(read('/index.ts').includes("'./parse.js'")).toBe(true)
  })
})
