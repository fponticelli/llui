// Incremental document-label (definition) collection.
//
// Definition collection used to walk the WHOLE tree on every source change, so a
// streamed document paid O(N) per chunk — O(N·k) over the stream — even though
// parsing and per-block hashing were already incremental. These tests pin the
// three things that must hold at once:
//   1. a streamed append walks ONLY the freshly-parsed tail blocks (measured),
//   2. the collected definitions are byte-identical to a cold, non-incremental
//      collection at every step of the stream,
//   3. a definition that arrives in the TAIL still resolves for a reference in
//      the reused PREFIX (the correctness trap incremental parsing already
//      guards — a definition cache must not undo it).

import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Root, RootContent, Definition } from 'mdast'
import type { Node } from 'unist'
import {
  incrementalParse,
  collectDefinitions,
  definitionNodesVisited,
  definitionBlocksScanned,
  parseMarkdown,
  type ParseCache,
} from '../src/index.js'
import { mountReactive, body } from './util.js'
import type { ReactiveMounted } from './util.js'

const parse = (src: string): Root => parseMarkdown(src)

/** Total node count of a subtree (what a whole-tree definition walk visits). */
function countNodes(node: Node): number {
  let n = 1
  const kids = (node as { children?: readonly Node[] }).children
  if (kids) for (const child of kids) n += countNodes(child)
  return n
}

function countBlocks(blocks: readonly RootContent[]): number {
  let n = 0
  for (const b of blocks) n += countNodes(b)
  return n
}

/** A stable serialization of a definitions map: ids, urls, titles AND iteration
 * order (first-definition-wins order is observable through the map). */
function defsSig(defs: ReadonlyMap<string, Definition>): string {
  return JSON.stringify([...defs].map(([id, d]) => [id, d.url, d.title ?? null]))
}

let mounted: ReactiveMounted | undefined
afterEach(() => {
  mounted?.cleanup()
  mounted = undefined
  vi.restoreAllMocks()
})

describe('definition collection — incremental (no whole-tree walk per change)', () => {
  it('walks only the freshly-parsed tail blocks across a streamed append', () => {
    const s1 = '# Title\n\nintro [a][r] paragraph\n\n[r]: /one\n\n'
    const r1 = incrementalParse(undefined, s1, parse)
    collectDefinitions(r1.root) // warm the first tree, as the render path does

    // Baseline: what a whole-tree (non-incremental) collection costs for s2.
    const s2 = s1 + 'second paragraph with *emphasis* and `code`\n\nthird paragraph'
    const cold = parse(s2)
    definitionNodesVisited(true)
    definitionBlocksScanned(true)
    collectDefinitions(cold)
    const coldVisits = definitionNodesVisited(true)
    const coldBlocks = definitionBlocksScanned(true)
    expect(coldVisits).toBe(countBlocks(cold.children)) // every node of the tree
    expect(coldBlocks).toBe(cold.children.length) // every top-level block

    // Incremental: the parse + the render path's collection together.
    const r2 = incrementalParse(r1.cache, s2, parse)
    expect(r2.reused).toBeGreaterThanOrEqual(3)
    collectDefinitions(r2.root)
    const incVisits = definitionNodesVisited(true)
    const incBlocks = definitionBlocksScanned(true)

    // Exactly the tail blocks — the reused prefix contributes its already-collected
    // definitions instead of being re-walked.
    expect(incVisits).toBe(countBlocks(r2.root.children.slice(r2.reused)))
    expect(incVisits).toBeLessThan(coldVisits)
    // And the reused prefix is not even ITERATED: the per-block memo alone would
    // still sweep every block (cheaply); the per-root accumulation removes that.
    expect(incBlocks).toBe(r2.root.children.length - r2.reused)
    expect(incBlocks).toBeLessThan(coldBlocks)
  })

  it('keeps per-chunk definition work bounded as the document grows', () => {
    // Stream 60 blocks; a whole-tree walk would make the total quadratic.
    const head = '[r]: /x\n\nintro [a][r]\n\n'
    const blocks: string[] = []
    for (let i = 0; i < 60; i++) blocks.push(`paragraph number ${i} with some words`)

    let cache: ParseCache | undefined
    let src = head
    let incrementalTotal = 0
    let wholeTreeTotal = 0
    const perChunk: number[] = []
    const perChunkBlocks: number[] = []

    for (const block of blocks) {
      src = src + block + '\n\n'
      definitionNodesVisited(true)
      definitionBlocksScanned(true)
      const res = incrementalParse(cache, src, parse)
      cache = res.cache
      collectDefinitions(res.root)
      const visits = definitionNodesVisited(true)
      perChunk.push(visits)
      perChunkBlocks.push(definitionBlocksScanned(true))
      incrementalTotal += visits
      wholeTreeTotal += countBlocks(res.root.children)
    }

    // Per-chunk cost must not grow with the document: the last chunk costs no more
    // than a small constant, and no more than the first.
    const first = perChunk[0]!
    const last = perChunk[perChunk.length - 1]!
    expect(last).toBeLessThanOrEqual(Math.max(first, 20))
    expect(Math.max(...perChunk.slice(1))).toBeLessThanOrEqual(20)
    // And the whole stream is linear rather than quadratic.
    expect(incrementalTotal).toBeLessThan(wholeTreeTotal / 10)

    // THE LEVEL-2 GATE. The per-block memo makes each block cheap; only the
    // per-root accumulation (deriveDocumentLabels) stops the pass from TOUCHING
    // every block per chunk. Without it every assertion above still passes — node
    // visits stay low because the memo hits — while this one goes quadratic. So:
    // the per-chunk block count must be CONSTANT as the document grows, not
    // merely small, and the tail chunks must cost no more than the first ones.
    const blocksLast = perChunkBlocks[perChunkBlocks.length - 1]!
    expect(blocksLast).toBeLessThanOrEqual(2)
    expect(Math.max(...perChunkBlocks)).toBeLessThanOrEqual(4)
    // Stream total stays O(chunks); a per-chunk sweep would make it O(chunks²).
    const blocksTotal = perChunkBlocks.reduce((a, b) => a + b, 0)
    expect(blocksTotal).toBeLessThan(blocks.length * 4)
  })
})

describe('definition collection — byte-identical to a cold collection', () => {
  it('matches a cold parse at every step of a streamed document', () => {
    const chunks = [
      '# Doc\n\n',
      '# Doc\n\nsee [a][r]\n\n',
      '# Doc\n\nsee [a][r]\n\n[r]: /one "T"\n\n',
      '# Doc\n\nsee [a][r]\n\n[r]: /one "T"\n\n> quoted [b][s]\n\n',
      '# Doc\n\nsee [a][r]\n\n[r]: /one "T"\n\n> quoted [b][s]\n\n[s]: /two\n\n',
      '# Doc\n\nsee [a][r]\n\n[r]: /one "T"\n\n> quoted [b][s]\n\n[s]: /two\n\ntail[^1]\n\n',
      '# Doc\n\nsee [a][r]\n\n[r]: /one "T"\n\n> quoted [b][s]\n\n[s]: /two\n\ntail[^1]\n\n[^1]: note [c][r]\n\n',
    ]
    let cache: ParseCache | undefined
    for (const src of chunks) {
      const res = incrementalParse(cache, src, parse)
      cache = res.cache
      const incremental = defsSig(collectDefinitions(res.root))
      const coldRoot = parse(src)
      expect(incremental, `definitions differ at ${JSON.stringify(src)}`).toBe(
        defsSig(collectDefinitions(coldRoot)),
      )
    }
  })

  it('keeps duplicate-identifier first-wins order across incremental reuse', () => {
    // Two definitions for `r`: the FIRST must win, even though the second lands in
    // the freshly-parsed tail.
    const s1 = '[a][r]\n\n[r]: /first\n\n'
    const r1 = incrementalParse(undefined, s1, parse)
    const s2 = s1 + '[r]: /second\n\ntail\n\n'
    const r2 = incrementalParse(r1.cache, s2, parse)
    expect(defsSig(collectDefinitions(r2.root))).toBe(defsSig(collectDefinitions(parse(s2))))
    expect(collectDefinitions(r2.root).get('r')?.url).toBe('/first')
  })
})

describe('definition collection — a TAIL definition still resolves for a PREFIX reference', () => {
  it('picks up a re-parsed tail definition for a reused prefix reference', () => {
    // `[a][r]` is a reused PREFIX block; its definition is edited in the TAIL.
    const s1 = '[a][r]\n\n[r]: /old'
    const r1 = incrementalParse(undefined, s1, parse)
    const s2 = '[a][r]\n\n[r]: /new'
    const r2 = incrementalParse(r1.cache, s2, parse)
    expect(r2.reused).toBeGreaterThanOrEqual(1) // the reference block WAS reused
    expect(collectDefinitions(r2.root).get('r')?.url).toBe('/new')
  })

  it('picks up a brand-new tail definition for an earlier reference', () => {
    const s1 = 'intro\n\nsee [a][r]\n\n'
    const r1 = incrementalParse(undefined, s1, parse)
    const s2 = s1 + '[r]: /late\n'
    const r2 = incrementalParse(r1.cache, s2, parse)
    expect(collectDefinitions(r2.root).get('r')?.url).toBe('/late')
    expect(defsSig(collectDefinitions(r2.root))).toBe(defsSig(collectDefinitions(parse(s2))))
  })

  it('renders the late definition into the earlier block (DOM)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('intro\n\nsee [a][r]\n\n')
    expect(body(mounted.container).querySelector('a')).toBeNull()
    mounted.set('intro\n\nsee [a][r]\n\n[r]: /late\n')
    expect(body(mounted.container).querySelector('a')?.getAttribute('href')).toBe('/late')
    // Editing the definition in the tail must re-resolve the reused prefix block.
    mounted.set('intro\n\nsee [a][r]\n\n[r]: /edited\n')
    expect(body(mounted.container).querySelector('a')?.getAttribute('href')).toBe('/edited')
    expect(spy).not.toHaveBeenCalled()
  })

  it('renders a tail footnote definition AND resolves the prefix reference (DOM)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mounted = mountReactive('intro\n\nsee[^1]\n\n')
    // Until the definition exists, `see[^1]` is literal text — no reference node.
    expect(body(mounted.container).querySelector('.footnote-ref')).toBeNull()
    mounted.set('intro\n\nsee[^1]\n\n[^1]: the note\n')
    const el = body(mounted.container)
    expect(el.textContent).toContain('the note')
    // Both halves: the definition SECTION renders, and the reused PREFIX block
    // re-renders into a real footnote reference pointing at it (#84).
    expect(el.querySelector('.footnote-definition')?.id).toBe('fn-1')
    expect(el.querySelector('.footnote-ref a')?.getAttribute('href')).toBe('#fn-1')
    expect(el.querySelector('p')?.textContent).toBe('intro')
    expect(el.querySelectorAll('p')[1]?.textContent).toBe('see1')
    expect(spy).not.toHaveBeenCalled()
  })
})
