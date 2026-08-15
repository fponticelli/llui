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
import { incrementalParse, collectDefinitions, type ParseCache } from '../src/index.js'
import { mountReactive, mountStatic, body } from './util.js'
import type { ReactiveMounted } from './util.js'

const parse = (src: string): Root =>
  fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })

const sig = (root: Root): string => JSON.stringify(root.children)

/** The document-global definition table as a comparable string — ids, urls, titles
 * AND iteration order. Definition collection is incremental too (definitions.ts),
 * so the streamed table must stay byte-identical to a cold collection. */
const defsSig = (root: Root): string =>
  JSON.stringify([...collectDefinitions(root)].map(([id, d]) => [id, d.url, d.title ?? null]))

/** Feed a sequence of sources through incrementalParse (threading the cache) and
 * assert every step's tree AND collected definitions equal a full parse's.
 * Returns the reuse counts. */
function feed(steps: string[]): number[] {
  let cache: ParseCache | undefined
  const reused: number[] = []
  for (const src of steps) {
    const res = incrementalParse(cache, src, parse)
    cache = res.cache
    reused.push(res.reused)
    const cold = parse(src)
    expect(sig(res.root), `mismatch at ${JSON.stringify(src)}`).toBe(sig(cold))
    expect(defsSig(res.root), `definitions differ at ${JSON.stringify(src)}`).toBe(defsSig(cold))
  }
  return reused
}

let mounted: ReactiveMounted | undefined
afterEach(() => {
  mounted?.cleanup()
  mounted = undefined
  vi.restoreAllMocks()
})

/** Rendered HTML of `el` with COMMENT nodes stripped. The reactive path renders its
 * blocks through a keyed `each`, which brackets them with anchor comments the static
 * path has no reason to emit; everything else must match exactly. */
function domSig(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_COMMENT)
  const comments: ChildNode[] = []
  while (walker.nextNode()) comments.push(walker.currentNode as ChildNode)
  for (const c of comments) c.remove()
  return clone.innerHTML
}

/** The `.markdown-body` signature of a COLD (fresh, never-streamed) static mount —
 * the reference every streamed step must reproduce. */
function coldHtml(src: string): string {
  const cold = mountStatic(src)
  try {
    return domSig(body(cold.container))
  } finally {
    cold.cleanup()
  }
}

/** Stream `steps` through ONE reactive mount, asserting after every step that the
 * live DOM equals a cold render of that step's source.
 *
 * This is the comparator that catches KEYING/re-render gaps, and the only one that
 * does: the incremental tree and the collected definition table can both be exactly
 * right (`feed()` above proves that much) while a reused prefix block keeps a stale
 * content-id and is therefore never rebuilt — the DOM is the only place the gap is
 * observable. Issue #84 was exactly that shape. */
function streamAndCompare(steps: readonly string[]): void {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const [first, ...rest] = steps
  if (first === undefined) throw new Error('streamAndCompare needs at least one step')
  mounted = mountReactive(first)
  expect(domSig(body(mounted.container)), `cold mismatch at ${JSON.stringify(first)}`).toBe(
    coldHtml(first),
  )
  for (const src of rest) {
    mounted.set(src)
    expect(domSig(body(mounted.container)), `streamed mismatch at ${JSON.stringify(src)}`).toBe(
      coldHtml(src),
    )
  }
  expect(spy).not.toHaveBeenCalled()
}

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

  it('does not reuse an unclosed fenced code block (EOF-terminated, no seal)', () => {
    // An unclosed ``` fence runs to EOF: `code\n\nmore` is ALL inside one code
    // block. The old parse ended the block at EOF (no seal), so a blank line that
    // only appears in the NEW source must NOT be treated as a seal for reuse.
    const reused = feed(['```\ncode', '```\ncode\n\nmore'])
    expect(reused[1]).toBe(0)
  })

  it('does not reuse an unclosed HTML type-1 block (<pre>, EOF-terminated)', () => {
    // `<pre>` opens an HTML type-1 block that continues to EOF; the appended blank
    // line + text stays inside it. No seal existed in the old source → no reuse.
    const reused = feed(['<pre>\nhi', '<pre>\nhi\n\nmore'])
    expect(reused[1]).toBe(0)
  })
})

describe('incrementalParse — prefix reuse can be disabled (unsafe custom extensions)', () => {
  it('never reuses a prefix when allowPrefixReuse=false, staying correct', () => {
    let cache: ParseCache | undefined
    const step = (src: string): number => {
      const res = incrementalParse(cache, src, parse, false)
      cache = res.cache
      expect(sig(res.root)).toBe(sig(parse(src)))
      return res.reused
    }
    // Append that WOULD normally reuse the sealed prefix — disabled ⇒ full parse.
    expect(step('# T\n\npara\n\n')).toBe(0)
    expect(step('# T\n\npara\n\nmore')).toBe(0)
    // A late reclassifying edit is handled by the (forced) full parse.
    expect(step('# T\n\npara\n\nmore\n\nhello')).toBe(0)
  })

  it('still short-circuits an IDENTICAL source (no reparse needed)', () => {
    let cache: ParseCache | undefined
    const r1 = incrementalParse(cache, 'a\n\nb', parse, false)
    cache = r1.cache
    const r2 = incrementalParse(cache, 'a\n\nb', parse, false)
    expect(r2.root).toBe(r1.root) // unchanged source returns the cached tree
  })
})

describe('reactive markdown — custom extensions disable prefix reuse by default', () => {
  // A harmless no-op custom syntax + mdast extension: its mere PRESENCE must switch
  // markdown() to full-parse-per-chunk (the seal invariant isn't proven for it),
  // yet streaming must still render every reclassification correctly.
  const custom = { extensions: [{}], mdastExtensions: [{}] }

  it('a late setext reclassification renders correctly with a custom extension', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('hello', custom)
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('hello')
    // `hello` → `hello\n===` retro-converts the paragraph to a heading. With reuse
    // disabled this is a full parse, so it is always correct (never a stale prefix).
    mounted.set('hello\n===\n\nworld')
    expect(body(mounted.container).querySelector('h1')?.textContent).toBe('hello')
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('world')
    // Reuse never runs (reused === 0 always), so the dev divergence assertion path
    // is never entered — no console.error either way.
    expect(spy).not.toHaveBeenCalled()
  })

  it('opting in with sealSafeExtensions re-enables prefix reuse', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('# Title\n\nfirst paragraph', {
      ...custom,
      sealSafeExtensions: true,
    })
    const heading = body(mounted.container).querySelector('h1')
    mounted.set('# Title\n\nfirst paragraph\n\nsecond paragraph')
    // Reuse is back on: the heading DOM is preserved across the streamed append.
    expect(body(mounted.container).querySelector('h1')).toBe(heading)
    expect(spy).not.toHaveBeenCalled()
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

describe('reactive markdown — streamed DOM equals a cold render (footnotes, #84)', () => {
  // `see[^a]` is literal text until `[^a]:` exists, so the definition arriving in
  // the TAIL must rebuild the reused PREFIX block. That decision is made by the
  // block's content-id (keying.ts), which folds in the references the block
  // consumes — footnote references included. With `footnoteReference` missing from
  // that fingerprint the prefix keeps its key and stays literal text forever, while
  // the tree, the definition table and the definition SECTION are all still correct.
  const head = 'intro\n\nsee[^a] here\n\nmiddle one\n\nmiddle two\n\n'

  it('resolves a prefix footnote reference when its definition arrives in the tail', () => {
    streamAndCompare([
      'intro\n\n',
      'intro\n\nsee[^a] here\n\n',
      head + 'middle three\n\n',
      head + 'middle three\n\n[^a]: the',
      head + 'middle three\n\n[^a]: the note\n',
    ])
    const el = body(mounted!.container)
    // The prefix paragraph is a real footnote reference, not the literal `[^a]`.
    const ref = el.querySelector('.footnote-ref a')
    expect(ref?.getAttribute('href')).toBe('#fn-a')
    expect(el.querySelectorAll('p')[1]?.textContent).toBe('seea here')
  })

  it('re-renders the prefix reference when the footnote definition is EDITED', () => {
    streamAndCompare([
      head,
      head + '[^a]: the note\n',
      head + '[^a]: an edited note\n',
      // Renaming the label undefines `a`: the prefix reference must revert to text.
      head + '[^b]: an edited note\n',
    ])
    const el = body(mounted!.container)
    expect(el.querySelector('.footnote-ref')).toBeNull()
    expect(el.querySelectorAll('p')[1]?.textContent).toBe('see[^a] here')
  })

  it('reverts the prefix reference to literal text when the definition is REMOVED', () => {
    streamAndCompare([head + '[^a]: the note\n', head])
    const el = body(mounted!.container)
    expect(el.querySelector('.footnote-ref')).toBeNull()
    expect(el.textContent).not.toContain('the note')
  })

  it('handles a footnote and a link reference sharing one identifier in one block', () => {
    // Un-namespaced reference ids would collapse the link ref `x` and the footnote
    // ref `x` into one fingerprint entry, so the footnote definition arriving would
    // leave the fingerprint (and the key, and the DOM) unchanged.
    const doc = 'see [a][x] and[^x] here\n\n'
    streamAndCompare([doc, doc + '[x]: /link\n', doc + '[x]: /link\n\n[^x]: the note\n'])
    const el = body(mounted!.container)
    expect(el.querySelector('p a')?.getAttribute('href')).toBe('/link')
    expect(el.querySelector('.footnote-ref a')?.getAttribute('href')).toBe('#fn-x')
  })

  it('re-renders when a definition edit only MOVES a `|` between url and title (#94)', () => {
    // The two states below are DIFFERENT definitions (`/a|b` with no title vs `/a`
    // with title `b|`) that the old `${id}=${url}|${title}` fingerprint layout
    // spelled identically. The paragraph is in the sealed prefix, so its node
    // object is reused, its source is unchanged, and an identical fingerprint means
    // an identical content-id: the reconciler keeps the row and the href stays
    // wrong. The separator between fields must be one no url or title can contain.
    const head = 'see [x][r] here\n\n'
    streamAndCompare([head + '[r]: /a|b\n', head + '[r]: /a "b|"\n'])
    const el = body(mounted!.container)
    const link = el.querySelector('p a')
    expect(link?.getAttribute('href')).toBe('/a')
    expect(link?.getAttribute('title')).toBe('b|')
  })
})

describe('reactive markdown — differential fuzz (streamed DOM vs cold DOM)', () => {
  // The generalization of the tests above, and the net that found #84 in the first
  // place: assemble random documents from a block corpus that is deliberately dense
  // in reference/definition pairs, stream each one in small chunks, and compare the
  // live DOM to a cold render at EVERY step. Any keying/re-render gap — a block that
  // should rebuild and doesn't, or rebuilds wrong — shows up here and nowhere else.
  //
  // The generator is a SEEDED PRNG, so the corpus is fixed and a failure is exactly
  // reproducible from its reported trial number. Do not make it time/Math.random
  // based: a flaky differential test gets muted, and a muted one catches nothing.

  /** Block fragments, weighted toward the reference machinery: link, image and
   * footnote references, their definitions, and later REDEFINITIONS of the same
   * identifiers (so trials exercise arrival, edit and shadowing). */
  const BLOCKS: readonly string[] = [
    '# Heading\n',
    'plain paragraph text\n',
    'see [a][r] link ref\n',
    'img ![alt][img] here\n',
    'note[^fn] here\n',
    '[r]: /url "T"\n',
    '[img]: /pic.png\n',
    '[^fn]: the footnote body\n',
    '- one\n- two\n',
    '> quoted [b][r]\n',
    '```js\ncode();\n```\n',
    '| a | b |\n| - | - |\n| 1 | 2 |\n',
    '---\n',
    '**bold** and `code` and <https://x.test>\n',
    '[r]: /other\n',
    '[^fn]: an edited footnote body\n',
  ]

  /** mulberry32 — a small, fully deterministic PRNG (no dependency, no global state). */
  function rng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // KEPT above the shared 30s `testTimeout` (`vitest.shared.ts`, #147): this
  // mounts and streams 120 documents through the real reactive path, which is
  // legitimately slow — ~5s idle, ~19s when the rest of the monorepo's suites
  // are running beside it. 30s is only ~1.6x that measured worst case, which is
  // not enough headroom for the thing the shared budget exists to absorb.
  // Widen the budget rather than thin the corpus — the trial count is the point.
  it(
    'streamed DOM equals a cold render across 120 generated documents',
    { timeout: 60_000 },
    () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      for (let trial = 0; trial < 120; trial++) {
        const rnd = rng(trial * 7919 + 13)
        const blocks: string[] = []
        const count = 2 + Math.floor(rnd() * 6)
        for (let i = 0; i < count; i++) blocks.push(BLOCKS[Math.floor(rnd() * BLOCKS.length)]!)
        const doc = blocks.join('\n')

        // Stream the document in 1–12 character chunks, the shape an LLM token
        // stream has: mid-word, mid-fence and mid-definition prefixes all occur.
        const steps: string[] = []
        for (let pos = 0; pos < doc.length; ) {
          pos = Math.min(doc.length, pos + 1 + Math.floor(rnd() * 12))
          steps.push(doc.slice(0, pos))
        }

        const live = mountReactive(steps[0] ?? '')
        try {
          for (const src of steps) {
            live.set(src)
            expect(domSig(body(live.container)), `trial ${trial} at ${JSON.stringify(src)}`).toBe(
              coldHtml(src),
            )
          }
        } finally {
          live.cleanup()
        }
      }
      expect(spy).not.toHaveBeenCalled()
    },
  )
})
