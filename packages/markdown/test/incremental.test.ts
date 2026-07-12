// Incremental (tail re-parse) streaming tests for reactive markdown().
//
// Two layers:
//  - DOM-level (mountReactive): the reactive path exercises incremental parsing
//    with the dev assertion (import.meta.env.DEV === true under vitest) actively
//    checking every update against a full parse. If incremental ever diverges the
//    assertion logs console.error and falls back — these tests additionally assert
//    console.error is NOT called for the correct-reuse cases.
//  - Unit-level (incrementalParse): asserts the incremental tree is byte-for-byte
//    identical to a full parse across the hazard cases (setext, lazy continuation,
//    list looseness, tail-arriving definitions, footnotes, non-append edits).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import type { Root } from 'mdast'
import { incrementalParse, type ParseCache } from '../src/index.js'
import { mountReactive, body } from './util.js'
import type { ReactiveMounted } from './util.js'

const parse = (src: string): Root =>
  fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })

const sig = (root: Root): string => JSON.stringify(root.children)

/** Feed a sequence of sources through incrementalParse (threading the cache) and
 * assert every step's tree equals a full parse. Returns the reuse counts. */
function feed(steps: string[]): number[] {
  let cache: ParseCache | undefined
  const reused: number[] = []
  for (const src of steps) {
    const res = incrementalParse(cache, src, parse)
    cache = res.cache
    reused.push(res.reused)
    expect(sig(res.root), `mismatch at ${JSON.stringify(src)}`).toBe(sig(parse(src)))
  }
  return reused
}

let mounted: ReactiveMounted | undefined
afterEach(() => {
  mounted?.cleanup()
  mounted = undefined
  vi.restoreAllMocks()
})

describe('incrementalParse — tree equals full parse', () => {
  it('append-only growth reuses the stable prefix blocks', () => {
    const reused = feed([
      '# Title\n\nfirst paragraph',
      '# Title\n\nfirst paragraph\n\nsecond paragraph',
      '# Title\n\nfirst paragraph\n\nsecond paragraph\n\nthird',
    ])
    // Grew from 1 sealed block → reuse 1, then 2 (heading + first paragraph, ...).
    expect(reused[1]).toBeGreaterThanOrEqual(1)
    expect(reused[2]).toBeGreaterThanOrEqual(2)
  })

  it('a setext --- appended after a paragraph reclassifies (no stale reuse)', () => {
    // `hello` alone is a paragraph; `hello\n===` retro-converts it to a heading.
    // The boundary must snap back past it — reuse must NOT keep the paragraph.
    const reused = feed(['hello', 'hello\n===\n\nworld'])
    expect(reused[1]).toBe(0) // could not safely reuse the reclassified paragraph
  })

  it('a setext underline with a blank line before it does not reclassify', () => {
    feed(['para one\n\npara two', 'para one\n\npara two\n\n===\n\nmore'])
  })

  it('a tail-arriving reference definition resolves in an earlier block', () => {
    // `[a][r]` is literal text until `[r]: /x` arrives; the new definition is a
    // new label id, so the guard forces a full parse (correct reclassification).
    const reused = feed(['[a][r]', '[a][r]\n\n[r]: /x'])
    expect(reused[1]).toBe(0)
  })

  it('a tail reference pointing at a PREFIX definition still resolves', () => {
    // Definition is in the reused prefix; the tail reference must form a link.
    feed(['text\n\n[r]: /x', 'text\n\n[r]: /x\n\n[a][r]'])
  })

  it('editing an existing definition url reuses (label id-set unchanged)', () => {
    const reused = feed(['[a][r]\n\n[r]: /old', '[a][r]\n\n[r]: /new'])
    expect(reused[1]).toBeGreaterThanOrEqual(1) // prefix `[a][r]` block reused
  })

  it('handles GFM footnotes (a footnote def is a document-global label)', () => {
    feed(['word[^1] here', 'word[^1] here\n\n[^1]: the note'])
    feed(['intro\n\n[^1]: the note', 'intro\n\n[^1]: the note\n\nsee[^1]'])
  })

  it('a non-append (prefix/middle edit) triggers a full reparse', () => {
    expect(feed(['a\n\nb\n\nc', 'x\n\nb\n\nc'])[1]).toBe(0) // first block changed
    // middle edit: only the unchanged head prefix can be reused
    feed(['one\n\ntwo\n\nthree', 'one\n\ntwoEDIT\n\nthree'])
  })

  it('a shorter / unrelated (non-monotonic) source is handled correctly', () => {
    expect(feed(['a\n\nb\n\nc', 'totally different'])[1]).toBe(0)
    feed(['first block\n\nsecond block', 'first block']) // truncation
  })

  it('does not reuse a trailing list/blockquote as the terminal block', () => {
    // Growing a list changes item looseness — must not reuse the list itself.
    feed(['- a', '- a\n- b\n- c'])
    feed(['- a\n\n', '- a\n\n- b']) // tight → loose
    feed(['> quote', '> quote\n> more'])
  })

  it('reuses a list INTERIOR to the prefix, shielded by a sealed leaf', () => {
    const reused = feed(['## H\n\n- a\n- b\n\npara', '## H\n\n- a\n- b\n\npara\n\nmore'])
    expect(reused[1]).toBeGreaterThanOrEqual(3) // heading + list + para reused
  })
})

describe('reactive markdown — streaming DOM (dev assertion active)', () => {
  it('appending reuses earlier DOM and never trips the dev assertion', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('# Title\n\nfirst paragraph')
    const root = body(mounted.container)
    const heading = root.querySelector('h1')
    const firstPara = root.querySelector('p')

    mounted.set('# Title\n\nfirst paragraph\n\nsecond paragraph')
    const paras = root.querySelectorAll('p')
    expect(paras).toHaveLength(2)
    expect(root.querySelector('h1')).toBe(heading) // reused, not rebuilt
    expect(paras[0]).toBe(firstPara)
    expect(paras[1]?.textContent).toBe('second paragraph')
    expect(spy).not.toHaveBeenCalled()
  })

  it('a tail-arriving definition resolves in the earlier block (DOM)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('[a][r]')
    expect(body(mounted.container).querySelector('a')).toBeNull()
    mounted.set('[a][r]\n\n[r]: /x')
    const anchor = body(mounted.container).querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('/x')
    expect(spy).not.toHaveBeenCalled()
  })

  it('a setext reclassification updates the DOM correctly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('hello')
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('hello')
    mounted.set('hello\n===\n\nworld')
    expect(body(mounted.container).querySelector('h1')?.textContent).toBe('hello')
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('world')
    expect(spy).not.toHaveBeenCalled()
  })

  it('long streaming sequence stays correct block-for-block', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('# Doc')
    const chunks = [
      '# Doc',
      '# Doc\n\nintro paragraph',
      '# Doc\n\nintro paragraph\n\n- one\n- two',
      '# Doc\n\nintro paragraph\n\n- one\n- two\n\n```\ncode\n```',
      '# Doc\n\nintro paragraph\n\n- one\n- two\n\n```\ncode\n```\n\nsee[^1]',
      '# Doc\n\nintro paragraph\n\n- one\n- two\n\n```\ncode\n```\n\nsee[^1]\n\n[^1]: a note',
    ]
    for (const c of chunks) mounted.set(c)
    const el = body(mounted.container)
    expect(el.querySelector('h1')?.textContent).toBe('Doc')
    expect(el.querySelectorAll('li')).toHaveLength(2)
    expect(el.querySelector('pre code')?.textContent).toContain('code')
    expect(spy).not.toHaveBeenCalled()
  })
})
