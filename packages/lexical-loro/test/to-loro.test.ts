/**
 * Outbound sync: Lexical → Loro.
 *
 * The assertions here are mostly about the OP SET, not just the resulting
 * document. A binding that rewrites the whole tree on every keystroke still
 * converges — and still destroys every decorator sub-app and every remote
 * caret. So the tests capture Loro's own event batch and assert exactly which
 * containers were touched, and they pin ContainerIDs across structural edits.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { HeadingNode, QuoteNode, $createHeadingNode, $isHeadingNode } from '@lexical/rich-text'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  SKIP_COLLAB_TAG,
  type ElementNode,
  type LexicalEditor,
  type TextFormatType,
  type TextNode,
} from 'lexical'
import { LoroDoc, LoroText, type ContainerID, type LoroEventBatch } from 'loro-crdt'
import { $createLLuiDecoratorNode, $isLLuiDecoratorNode, LLuiDecoratorNode } from '@llui/lexical'

import {
  containerId,
  elementChildren,
  elementProps,
  elementType,
  formatBit,
  initDoc,
  isTextContainer,
  KEY_CHILDREN,
  KEY_UUID,
  LORO_TEXT_FORMATS,
  normalizeRuns,
  orderedChildren,
  runsFromText,
  seedLoroFromLexical,
  syncLexicalToLoro,
  ContainerNodeMap,
  longestIncreasingSubsequence,
  type ElementContainer,
  type OutboundTarget,
  type TextRun,
} from '../src/index.js'
import { childAt, childContainers } from './children.js'

const BOLD = formatBit('bold')

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** One editor wired to one Loro doc through the outbound direction only. */
class Outbound {
  readonly editor: LexicalEditor
  readonly doc = new LoroDoc()
  readonly root: ElementContainer
  readonly mapping = new ContainerNodeMap()
  readonly target: OutboundTarget
  /** Every Loro event batch produced since the last `takeBatches()`. */
  #batches: LoroEventBatch[] = []
  /** Ops reported by the last `syncLexicalToLoro` call. */
  lastOps = 0

  constructor() {
    this.doc.setPeerId(1n)
    this.root = initDoc(this.doc, LORO_TEXT_FORMATS)
    this.doc.commit()
    this.editor = createHeadlessEditor({
      namespace: 'to-loro',
      nodes: [HeadingNode, QuoteNode, LLuiDecoratorNode],
      onError: (error: Error) => {
        throw error
      },
    })
    this.target = { doc: this.doc, root: this.root, mapping: this.mapping }
    this.doc.subscribe((batch) => this.#batches.push(batch))
    this.editor.registerUpdateListener((payload) => {
      this.lastOps = syncLexicalToLoro(this.target, payload)
    })
  }

  /** Run a discrete Lexical update, then hand back the Loro events it caused. */
  update(fn: () => void, options?: { tag?: string }): LoroEventBatch[] {
    this.#batches = []
    // Reset first: a Lexical update that changes nothing does not fire the
    // update listener at all, so a stale count would read as a success.
    this.lastOps = 0
    this.editor.update(fn, { discrete: true, ...(options?.tag ? { tag: options.tag } : {}) })
    return this.#batches
  }

  /**
   * The events of every batch, flattened, with every carrier uuid in the path
   * replaced by the RENDERED INDEX it projects to.
   *
   * A Loro event path addresses a child by its uuid map key, which is random per
   * run and so cannot be asserted literally. Resolving it through
   * `orderedChildren` — the same projection the inbound direction renders from —
   * keeps these assertions saying what they always said ("the text container of
   * the SECOND paragraph was touched, and nothing else was") while additionally
   * pinning that the event really does land under `children/<uuid>` and, for a
   * text run, on the carrier's `text` key rather than on the carrier itself.
   */
  events(batches: LoroEventBatch[]): { path: (string | number)[]; diff: unknown }[] {
    return batches.flatMap((batch) =>
      batch.events.map((e) => ({ path: renderedPath(this.root, e.path), diff: e.diff })),
    )
  }

  /** Every root-level child ContainerID, in order. */
  childIds(): ContainerID[] {
    return childContainers(this.root).map((child) => containerId(child))
  }

  /** The Loro document as plain JSON — for whole-document assertions. */
  json(): unknown {
    return this.doc.toJSON()
  }

  /**
   * The mirror as the inbound direction would render it: children as an ORDERED
   * array, text runs as their strings.
   *
   * The raw `doc.toJSON()` cannot be asserted whole any more — `children` is a
   * map keyed by random uuids, and every carrier carries a random `pos`. This
   * projects through `orderedChildren`, so the ordering the array expresses is
   * the real sorted-by-`(pos, uuid)` order rather than map iteration order. The
   * carrier keys the projection consumes are asserted separately by
   * {@link carrierShape}, so nothing the old whole-document assertion covered is
   * dropped.
   */
  document(): DocumentShape {
    return describeElement(this.root)
  }
}

/** An element mirror, projected for assertion. */
interface DocumentShape {
  readonly type: string
  readonly props: Record<string, unknown>
  readonly children: (DocumentShape | string)[]
}

function describeElement(element: ElementContainer): DocumentShape {
  return {
    type: elementType(element),
    props: elementProps(element).toJSON() as Record<string, unknown>,
    children: orderedChildren(element).map((entry) =>
      entry.kind === 'text'
        ? (entry.container as LoroText).toString()
        : describeElement(entry.container as ElementContainer),
    ),
  }
}

/**
 * The carrier bookkeeping of an element's children — the keys the ordering
 * projection reads, which the ordered-array projection deliberately hides.
 */
function carrierShape(
  element: ElementContainer,
): { uuidMatchesKey: boolean; kind: string; pos: string }[] {
  return orderedChildren(element).map((entry) => ({
    uuidMatchesKey: entry.carrier.get(KEY_UUID) === entry.uuid,
    kind: entry.kind,
    pos: entry.pos,
  }))
}

/**
 * A Loro event path with each carrier uuid rewritten to its rendered index.
 *
 * Walks the path alongside the document: the segment after every `children` key
 * is a uuid, which is resolved against that element's projection. A path
 * reaching into a text carrier stops resolving there (a `LoroText` has no
 * children), which is what leaves the trailing `'text'` segment intact.
 */
function renderedPath(
  root: ElementContainer,
  path: readonly (string | number)[],
): (string | number)[] {
  const out: (string | number)[] = []
  let element: ElementContainer | null = root
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!
    out.push(segment)
    if (segment !== KEY_CHILDREN || element === null) continue
    const uuid = path[i + 1]
    if (uuid === undefined) break
    i++
    const entries = orderedChildren(element)
    const index = entries.findIndex((entry) => entry.uuid === uuid)
    out.push(index === -1 ? uuid : index)
    const entry = entries[index]
    element =
      entry !== undefined && entry.kind === 'element' ? (entry.container as ElementContainer) : null
  }
  return out
}

/** Build `texts.length` paragraphs, one text node each. */
function seedParagraphs(harness: Outbound, texts: readonly string[]): void {
  harness.update(() => {
    const root = $getRoot()
    root.clear()
    for (const text of texts) {
      root.append($createParagraphNode().append($createTextNode(text)))
    }
  })
}

/** Read the projected runs of the root's Nth child (must be a text-only element). */
function loroRuns(harness: Outbound, index: number): TextRun[] {
  const element = childAt(harness.root, index)
  if (!(element instanceof Object) || isTextContainer(element)) {
    throw new Error('expected an element child')
  }
  const child = childAt(element as ElementContainer, 0)
  if (!(child instanceof LoroText)) throw new Error('expected a text child')
  return runsFromText(child)
}

/** The Lexical runs of the root's Nth child. */
function lexicalRuns(harness: Outbound, index: number): TextRun[] {
  let runs: TextRun[] = []
  harness.editor.getEditorState().read(() => {
    const nodes: TextNode[] = []
    for (const child of $blockAt(index).getChildren()) if ($isTextNode(child)) nodes.push(child)
    runs = normalizeRuns(nodes.map((n) => ({ text: n.getTextContent(), format: n.getFormat() })))
  })
  return runs
}

/** The root's Nth child, narrowed to an element. Call inside an editor read. */
function $blockAt(index: number): ElementNode {
  const node = $getRoot().getChildAtIndex(index)
  if (!$isElementNode(node)) throw new Error(`expected an element at index ${index}`)
  return node
}

let harness: Outbound

beforeEach(() => {
  harness = new Outbound()
})

// ---------------------------------------------------------------------------
// Echo suppression
// ---------------------------------------------------------------------------

describe('tag guards', () => {
  it('writes NOTHING for an update tagged as collaboration — design fact 4b', () => {
    seedParagraphs(harness, ['hello'])
    const batches = harness.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('remote')))
      },
      { tag: COLLABORATION_TAG },
    )
    expect(harness.lastOps).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('writes NOTHING for an update tagged skip-collab', () => {
    seedParagraphs(harness, ['hello'])
    const batches = harness.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('local only')))
      },
      { tag: SKIP_COLLAB_TAG },
    )
    expect(harness.lastOps).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('DOES sync a historic (undo) update — v1 undo is Lexical-local, so it is a real local change', () => {
    seedParagraphs(harness, ['hello'])
    const batches = harness.update(
      () => {
        $getRoot().append($createParagraphNode().append($createTextNode('undone back in')))
      },
      { tag: 'historic' },
    )
    expect(harness.lastOps).toBeGreaterThan(0)
    expect(batches.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// No-op / minimal op sets — the pruning regression guards
// ---------------------------------------------------------------------------

describe('op minimality', () => {
  it('produces NO ops for an update that changes nothing', () => {
    seedParagraphs(harness, ['alpha', 'beta', 'gamma'])
    const batches = harness.update(() => {
      // Touch the tree without changing it: read every node.
      $getRoot().getAllTextNodes()
    })
    expect(harness.lastOps).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('produces NO ops for a selection-only change', () => {
    seedParagraphs(harness, ['alpha', 'beta'])
    const batches = harness.update(() => {
      $getRoot().getAllTextNodes()[0]!.select(1, 1)
    })
    expect(harness.lastOps).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('produces NO ops for a re-set of a prop to its existing value', () => {
    seedParagraphs(harness, ['alpha'])
    const batches = harness.update(() => {
      // Writing the same value clones the node (so reference-equality pruning
      // does not fire) but must still not reach Loro.
      $blockAt(0).setFormat('')
    })
    expect(harness.lastOps).toBe(0)
    expect(batches).toHaveLength(0)
  })

  it('a single character insertion emits EXACTLY ONE text op on ONE container', () => {
    seedParagraphs(harness, ['alpha', 'beta', 'gamma'])
    const idsBefore = harness.childIds()

    const batches = harness.update(() => {
      const node = $getRoot().getAllTextNodes()[1]!
      node.select(4, 4)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected range selection')
      selection.insertText('X')
    })

    expect(harness.lastOps).toBe(1)
    // One batch, one event, on the text container of the SECOND paragraph.
    const events = harness.events(batches)
    expect(events).toEqual([
      {
        path: ['root', 'children', 1, 'children', 0, 'text'],
        diff: { type: 'text', diff: [{ retain: 4 }, { insert: 'X' }] },
      },
    ])
    // Every element container survived — nothing was recreated.
    expect(harness.childIds()).toEqual(idsBefore)
  })

  it('typing in one paragraph never touches its siblings', () => {
    seedParagraphs(harness, ['alpha', 'beta', 'gamma'])
    harness.update(() => {
      const node = $getRoot().getAllTextNodes()[0]!
      node.select(5, 5)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected range selection')
      selection.insertText('!')
    })
    expect(loroRuns(harness, 0)).toEqual([{ text: 'alpha!', format: 0 }])
    expect(loroRuns(harness, 1)).toEqual([{ text: 'beta', format: 0 }])
    expect(loroRuns(harness, 2)).toEqual([{ text: 'gamma', format: 0 }])
  })
})

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('structure', () => {
  it('mirrors a fresh document', () => {
    seedParagraphs(harness, ['alpha', 'beta'])
    expect(harness.document()).toEqual({
      type: 'root',
      props: { format: '', indent: 0, direction: null },
      children: [
        {
          type: 'paragraph',
          props: {
            format: '',
            indent: 0,
            direction: null,
            textFormat: 0,
            textStyle: '',
          },
          children: ['alpha'],
        },
        {
          type: 'paragraph',
          props: {
            format: '',
            indent: 0,
            direction: null,
            textFormat: 0,
            textStyle: '',
          },
          children: ['beta'],
        },
      ],
    })
  })

  it('files every child as a carrier keyed by its own uuid, ordered by pos', () => {
    seedParagraphs(harness, ['alpha', 'beta'])
    const carriers = carrierShape(harness.root)
    expect(carriers.map((c) => c.kind)).toEqual(['element', 'element'])
    expect(carriers.every((c) => c.uuidMatchesKey)).toBe(true)
    // The array order the projection reports IS the `pos` order — the ordered
    // shape above is a consequence of the keys, not of map iteration order.
    expect(carriers[0]!.pos < carriers[1]!.pos).toBe(true)

    const paragraph = childAt(harness.root, 0) as ElementContainer
    expect(carrierShape(paragraph).map((c) => c.kind)).toEqual(['text'])
  })

  it('mirrors the node type and scalar props of a heading', () => {
    harness.update(() => {
      $getRoot()
        .clear()
        .append($createHeadingNode('h2').append($createTextNode('Title')))
    })
    const heading = childAt(harness.root, 0) as ElementContainer
    expect(elementType(heading)).toBe('heading')
    expect(elementProps(heading).get('tag')).toBe('h2')
  })

  it('updates a prop in place without recreating the container', () => {
    harness.update(() => {
      $getRoot()
        .clear()
        .append($createHeadingNode('h1').append($createTextNode('Title')))
    })
    const before = harness.childIds()
    harness.update(() => {
      const heading = $blockAt(0)
      if (!$isHeadingNode(heading)) throw new Error('no heading')
      heading.setTag('h3')
    })
    expect(elementProps(childAt(harness.root, 0) as ElementContainer).get('tag')).toBe('h3')
    expect(harness.childIds()).toEqual(before)
  })

  it('mirrors a line break as an element child, splitting the text run', () => {
    harness.update(() => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append(
            $createTextNode('one'),
            $createLineBreakNode(),
            $createTextNode('two'),
          ),
        )
    })
    const paragraph = childAt(harness.root, 0) as ElementContainer
    const children = childContainers(paragraph)
    expect(children).toHaveLength(3)
    expect(isTextContainer(children[0])).toBe(true)
    expect(elementType(children[1] as ElementContainer)).toBe('linebreak')
    expect(isTextContainer(children[2])).toBe(true)
  })

  it('deletes removed children and drops their mapping entries', () => {
    seedParagraphs(harness, ['alpha', 'beta', 'gamma'])
    const removedId = harness.childIds()[1]!
    expect(harness.mapping.hasContainer(removedId)).toBe(true)

    harness.update(() => {
      $getRoot().getChildAtIndex(1)!.remove()
    })

    expect(harness.childIds()).toHaveLength(2)
    expect(harness.mapping.hasContainer(removedId)).toBe(false)
    harness.mapping.assertBijective()
  })

  it('EMPTIES rather than deletes the last text container when an element is cleared', () => {
    // Deleting the LoroText would discard a concurrent remote insertion into it.
    seedParagraphs(harness, ['alpha'])
    const paragraph = childAt(harness.root, 0) as ElementContainer
    const textId = containerId(childAt(paragraph, 0) as LoroText)

    harness.update(() => {
      $blockAt(0).getFirstChildOrThrow().remove()
    })

    const children = childContainers(paragraph)
    expect(children).toHaveLength(1)
    expect(containerId(children[0] as LoroText)).toBe(textId)
    expect((children[0] as LoroText).toString()).toBe('')
  })

  it('keeps the mapping bijective across a burst of structural edits', () => {
    seedParagraphs(harness, ['a', 'b', 'c'])
    harness.update(() => {
      const root = $getRoot()
      root.getChildAtIndex(0)!.remove()
      root.append($createParagraphNode().append($createTextNode('d')))
      root.getChildAtIndex(0)!.insertBefore($createParagraphNode().append($createTextNode('z')))
    })
    harness.mapping.assertBijective()
    expect(harness.json()).toEqual(
      JSON.parse(JSON.stringify(harness.json())), // structural sanity
    )
    expect(
      childContainers(harness.root)
        .map((c) => childAt(c as ElementContainer, 0))
        .map((t) => (t as LoroText).toString()),
    ).toEqual(['z', 'b', 'c', 'd'])
  })
})

// ---------------------------------------------------------------------------
// Reorder — the MOVE requirement (design fact 2)
// ---------------------------------------------------------------------------

describe('reorder', () => {
  it('emits a MOVE, not a delete+insert, so container identity survives', () => {
    seedParagraphs(harness, ['alpha', 'beta', 'gamma'])
    const [a, b, c] = harness.childIds()

    const batches = harness.update(() => {
      const root = $getRoot()
      const first = root.getChildAtIndex(0)!
      root.getChildAtIndex(2)!.insertAfter(first)
    })

    // alpha moved to the end: the SAME containers, reordered.
    expect(harness.childIds()).toEqual([b, c, a])
    // Exactly one write. A delete+recreate would be at least two, and would
    // mint a new ContainerID — remounting every decorator in the subtree.
    expect(harness.lastOps).toBe(1)
    expect(harness.events(batches)).toHaveLength(1)
  })

  it('preserves identity for a rotation, in ONE move', () => {
    seedParagraphs(harness, ['a', 'b', 'c', 'd'])
    const [w, x, y, z] = harness.childIds()

    harness.update(() => {
      const root = $getRoot()
      const last = root.getChildAtIndex(3)!
      root.getChildAtIndex(0)!.insertBefore(last)
    })

    expect(harness.childIds()).toEqual([z, w, x, y])
    expect(harness.lastOps).toBe(1)
  })

  it('preserves identity for a swap of two adjacent blocks', () => {
    seedParagraphs(harness, ['a', 'b'])
    const [x, y] = harness.childIds()
    harness.update(() => {
      const root = $getRoot()
      // Move the SECOND block in front of the first — `a.insertAfter(b)` when
      // b already follows a is a no-op and would not exercise anything.
      root.getChildAtIndex(0)!.insertBefore(root.getChildAtIndex(1)!)
    })
    expect(harness.childIds()).toEqual([y, x])
    expect(harness.lastOps).toBe(1)
  })

  it('preserves the moved subtree, not just the block', () => {
    seedParagraphs(harness, ['alpha', 'beta'])
    const paragraph = childAt(harness.root, 0) as ElementContainer
    const innerTextId = containerId(childAt(paragraph, 0) as LoroText)

    harness.update(() => {
      const root = $getRoot()
      root.getChildAtIndex(1)!.insertAfter(root.getChildAtIndex(0)!)
    })

    const moved = childAt(harness.root, 1) as ElementContainer
    expect(containerId(childAt(moved, 0) as LoroText)).toBe(innerTextId)
  })

  it('handles a reorder combined with an insertion and a deletion', () => {
    seedParagraphs(harness, ['a', 'b', 'c'])
    const [x, y] = harness.childIds()
    harness.update(() => {
      const root = $getRoot()
      root.getChildAtIndex(2)!.remove() // drop 'c'
      const first = root.getChildAtIndex(0)! // 'a'
      root.getChildAtIndex(1)!.insertAfter(first) // -> b, a
      root.append($createParagraphNode().append($createTextNode('d')))
    })
    const ids = harness.childIds()
    expect(ids.slice(0, 2)).toEqual([y, x])
    expect(
      childContainers(harness.root).map((c) =>
        (childAt(c as ElementContainer, 0) as LoroText).toString(),
      ),
    ).toEqual(['b', 'a', 'd'])
    harness.mapping.assertBijective()
  })

  it('reproduces an ARBITRARY permutation, preserving every container', () => {
    // The reorder planner keeps a longest already-ordered run of survivors in
    // place and threads the rest around it, which is what makes a drag-reorder
    // one `move` instead of one per displaced block. That is a subtle enough
    // argument to be worth checking against random permutations rather than
    // hand-picked ones.
    let state = 0x1f123bb5
    const random = (n: number): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state % n
    }

    for (let round = 0; round < 300; round++) {
      const size = 2 + random(11)
      const local = new Outbound()
      seedParagraphs(
        local,
        Array.from({ length: size }, (_, i) => `p${i}`),
      )
      const before = local.childIds()

      const order = Array.from({ length: size }, (_, i) => i)
      for (let i = size - 1; i > 0; i--) {
        const j = random(i + 1)
        ;[order[i], order[j]] = [order[j]!, order[i]!]
      }

      local.update(() => {
        const root = $getRoot()
        const children = order.map((index) => root.getChildAtIndex(index)!)
        // Appending an already-attached node MOVES it, so appending in target
        // order rewrites the child list as one permutation.
        for (const child of children) root.append(child)
      })

      expect(local.childIds(), `order=${order.join(',')}`).toEqual(order.map((i) => before[i]!))
      expect(
        childContainers(local.root).map((c) =>
          (childAt(c as ElementContainer, 0) as LoroText).toString(),
        ),
        `order=${order.join(',')}`,
      ).toEqual(order.map((i) => `p${i}`))
      local.mapping.assertBijective()

      // Minimality: exactly the blocks outside a longest increasing run move.
      const kept = longestIncreasingSubsequence(order).length
      expect(local.lastOps, `order=${order.join(',')}`).toBe(size - kept)
    }
  })
})

// ---------------------------------------------------------------------------
// longestIncreasingSubsequence — the move minimiser
// ---------------------------------------------------------------------------

describe('longestIncreasingSubsequence', () => {
  it('returns the indices of a longest increasing subsequence', () => {
    expect(longestIncreasingSubsequence([])).toEqual([])
    expect(longestIncreasingSubsequence([5])).toEqual([0])
    expect(longestIncreasingSubsequence([0, 1, 2, 3])).toEqual([0, 1, 2, 3])
    expect(longestIncreasingSubsequence([3, 2, 1, 0])).toHaveLength(1)
    // [1,2] is the LIS of [1,2,0]: keeping it costs ONE move, not two.
    expect(longestIncreasingSubsequence([1, 2, 0])).toEqual([0, 1])
  })

  it('always returns a strictly increasing, maximal-length subsequence', () => {
    let state = 0x2545f491
    const random = (n: number): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state % n
    }
    for (let round = 0; round < 500; round++) {
      const length = random(12)
      const values = Array.from({ length }, () => random(20))
      const picked = longestIncreasingSubsequence(values)
      for (let i = 1; i < picked.length; i++) {
        expect(picked[i]!).toBeGreaterThan(picked[i - 1]!)
        expect(values[picked[i]!]!).toBeGreaterThan(values[picked[i - 1]!]!)
      }
      // Brute-force the true LIS length for small inputs.
      const best = new Array<number>(length).fill(1)
      let expected = length === 0 ? 0 : 1
      for (let i = 0; i < length; i++) {
        for (let j = 0; j < i; j++) {
          if (values[j]! < values[i]!) best[i] = Math.max(best[i]!, best[j]! + 1)
        }
        expected = Math.max(expected, best[i]!)
      }
      expect(picked).toHaveLength(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// Text formatting — the three measured divergences, end to end
// ---------------------------------------------------------------------------

/** Place the caret at `offset` in the paragraph, applying Lexical's caret rules. */
function selectAt(offset: number): void {
  const nodes = $getRoot().getAllTextNodes()
  let index = 0
  let node: TextNode = nodes[0]!
  let local = 0
  for (const candidate of nodes) {
    const length = candidate.getTextContentSize()
    const delta = offset - index
    if (delta >= 0 && delta <= length) {
      node = candidate
      local = delta
      break
    }
    index += length
  }
  if (local === 0) {
    const previous = node.getPreviousSibling()
    if ($isTextNode(previous) && !node.isUnmergeable()) {
      node = previous
      local = previous.getTextContentSize()
    }
  }
  node.select(local, local)
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) throw new Error('expected range selection')
  selection.setFormat(node.getFormat())
}

interface FormatCase {
  readonly runs: readonly TextRun[]
  readonly caret: number
  readonly toggle?: readonly string[]
  readonly type: string
}

/** Seed, place the caret, toggle formats, type — then compare Loro to Lexical. */
function runFormatCase(testCase: FormatCase): void {
  const local = new Outbound()
  local.update(() => {
    const paragraph = $createParagraphNode()
    for (const run of testCase.runs)
      paragraph.append($createTextNode(run.text).setFormat(run.format))
    $getRoot().clear().append(paragraph)
  })
  local.update(() => {
    selectAt(testCase.caret)
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) throw new Error('expected range selection')
    for (const format of testCase.toggle ?? []) selection.formatText(format as TextFormatType)
    if (testCase.type !== '') selection.insertText(testCase.type)
  })
  expect(loroRuns(local, 0)).toEqual(lexicalRuns(local, 0))
}

describe('text formats reach Loro exactly as Lexical resolved them', () => {
  it('DIVERGENCE 1: typing at index 0 of a formatted first run', () => {
    runFormatCase({ runs: [{ text: 'abc', format: BOLD }], caret: 0, type: 'X' })
  })

  it('DIVERGENCE 2: a format toggled ON at a collapsed caret', () => {
    runFormatCase({ runs: [{ text: 'abc', format: 0 }], caret: 3, toggle: ['bold'], type: 'X' })
  })

  it('DIVERGENCE 3: a format toggled OFF at a collapsed caret', () => {
    runFormatCase({ runs: [{ text: 'abc', format: BOLD }], caret: 3, toggle: ['bold'], type: 'X' })
  })

  it('reproduces Lexical across every boundary case, for every format', () => {
    for (const format of LORO_TEXT_FORMATS) {
      const f = formatBit(format)
      const cases: readonly FormatCase[] = [
        { runs: [{ text: 'abc', format: f }], caret: 3, type: 'X' },
        { runs: [{ text: 'abc', format: f }], caret: 0, type: 'X' },
        { runs: [{ text: 'abc', format: f }], caret: 1, type: 'X' },
        {
          runs: [
            { text: 'ab', format: f },
            { text: 'cd', format: 0 },
          ],
          caret: 2,
          type: 'X',
        },
        {
          runs: [
            { text: 'ab', format: 0 },
            { text: 'cd', format: f },
          ],
          caret: 2,
          type: 'X',
        },
        { runs: [{ text: 'abc', format: 0 }], caret: 3, toggle: [format], type: 'X' },
        { runs: [{ text: 'abc', format: f }], caret: 3, toggle: [format], type: 'X' },
      ]
      for (const testCase of cases) runFormatCase(testCase)
    }
  })

  it('formats an existing range with mark ops, leaving the text untouched', () => {
    seedParagraphs(harness, ['abcdef'])
    const paragraph = childAt(harness.root, 0) as ElementContainer
    const textId = containerId(childAt(paragraph, 0) as LoroText)

    harness.update(() => {
      const node = $getRoot().getAllTextNodes()[0]!
      node.select(2, 4)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected range selection')
      selection.formatText('bold')
    })

    expect(loroRuns(harness, 0)).toEqual([
      { text: 'ab', format: 0 },
      { text: 'cd', format: BOLD },
      { text: 'ef', format: 0 },
    ])
    // The container was reused, so a concurrent remote insert into it survives.
    expect(containerId(childAt(paragraph, 0) as LoroText)).toBe(textId)
    expect(harness.lastOps).toBe(1)
  })

  it('a repeated-character insertion lands at the CARET, not the leftmost match', () => {
    seedParagraphs(harness, ['foo'])
    const batches = harness.update(() => {
      const node = $getRoot().getAllTextNodes()[0]!
      node.select(3, 3)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected range selection')
      selection.insertText('o')
    })
    expect(harness.events(batches)).toEqual([
      {
        path: ['root', 'children', 0, 'children', 0, 'text'],
        diff: { type: 'text', diff: [{ retain: 3 }, { insert: 'o' }] },
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('seedLoroFromLexical', () => {
  it('fills an empty document without an update payload', () => {
    const editor = createHeadlessEditor({
      namespace: 'seed',
      nodes: [HeadingNode, QuoteNode],
      onError: (error: Error) => {
        throw error
      },
    })
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createHeadingNode('h1').append($createTextNode('Title')))
          .append($createParagraphNode().append($createTextNode('Body')))
      },
      { discrete: true },
    )

    const doc = new LoroDoc()
    doc.setPeerId(7n)
    const root = initDoc(doc, LORO_TEXT_FORMATS)
    const mapping = new ContainerNodeMap()
    const ops = seedLoroFromLexical({ doc, root, mapping }, editor.getEditorState())

    expect(ops).toBeGreaterThan(0)
    expect(childContainers(root)).toHaveLength(2)
    expect(elementType(childAt(root, 0) as ElementContainer)).toBe('heading')
    mapping.assertBijective()
  })

  it('is idempotent — seeding twice writes nothing the second time', () => {
    seedParagraphs(harness, ['alpha', 'beta'])
    const ops = seedLoroFromLexical(harness.target, harness.editor.getEditorState())
    expect(ops).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Decorators — the reason container identity is load-bearing
// ---------------------------------------------------------------------------

describe('LLuiDecoratorNode', () => {
  function withDecorator(): Outbound {
    const local = new Outbound()
    local.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('before')))
        .append(
          $createParagraphNode().append($createLLuiDecoratorNode('chart', { series: [1, 2] })),
        )
    })
    return local
  }

  it('mirrors bridgeType and the arbitrary JSON data payload', () => {
    const local = withDecorator()
    const paragraph = childAt(local.root, 1) as ElementContainer
    const decorator = childAt(paragraph, 0) as ElementContainer
    expect(elementType(decorator)).toBe('llui-decorator')
    expect(elementProps(decorator).get('bridgeType')).toBe('chart')
    expect(elementProps(decorator).get('data')).toEqual({ series: [1, 2] })
  })

  it('updates the payload IN PLACE — a new ContainerID would remount the sub-app', () => {
    const local = withDecorator()
    const paragraph = childAt(local.root, 1) as ElementContainer
    const before = containerId(childAt(paragraph, 0) as ElementContainer)

    local.update(() => {
      const node = $blockAt(1).getFirstChild()
      if (!$isLLuiDecoratorNode(node)) throw new Error('no decorator')
      node.setData({ series: [1, 2, 3] })
    })

    const decorator = childAt(paragraph, 0) as ElementContainer
    expect(containerId(decorator)).toBe(before)
    expect(elementProps(decorator).get('data')).toEqual({ series: [1, 2, 3] })
    expect(local.lastOps).toBe(1)
  })

  it('survives a block reorder with its ContainerID intact', () => {
    const local = withDecorator()
    const paragraph = childAt(local.root, 1) as ElementContainer
    const before = containerId(childAt(paragraph, 0) as ElementContainer)

    local.update(() => {
      const root = $getRoot()
      root.getChildAtIndex(0)!.insertBefore(root.getChildAtIndex(1)!)
    })

    const moved = childAt(local.root, 0) as ElementContainer
    expect(containerId(childAt(moved, 0) as ElementContainer)).toBe(before)
    expect(local.lastOps).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Two peers — the outbound direction must produce mergeable updates
// ---------------------------------------------------------------------------

describe('concurrent peers', () => {
  it('merges two peers editing different blocks', () => {
    const a = new Outbound()
    const b = new Outbound()
    b.doc.setPeerId(2n)

    // Both peers start from the same seeded document.
    seedParagraphs(a, ['alpha', 'beta'])
    b.doc.import(a.doc.export({ mode: 'snapshot' }))

    a.update(() => {
      const node = $getRoot().getAllTextNodes()[0]!
      node.select(5, 5)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected range selection')
      selection.insertText('-A')
    })

    // Peer b edits its own mirror of the SAME document, concurrently.
    const merged = new LoroDoc()
    merged.setPeerId(3n)
    initDoc(merged, LORO_TEXT_FORMATS)
    merged.import(a.doc.export({ mode: 'snapshot' }))

    const paragraph = childAt(a.root, 1) as ElementContainer
    const textId = containerId(childAt(paragraph, 0) as LoroText)
    const remote = merged.getContainerById(textId)
    if (!(remote instanceof LoroText)) throw new Error('expected a text container')
    remote.insert(4, '-B')
    merged.commit()

    a.doc.import(merged.export({ mode: 'update' }))

    expect(loroRuns(a, 0)).toEqual([{ text: 'alpha-A', format: 0 }])
    expect(loroRuns(a, 1)).toEqual([{ text: 'beta-B', format: 0 }])
  })
})

// ---------------------------------------------------------------------------
// Run identity under Lexical's own splitting and normalization
// ---------------------------------------------------------------------------

/**
 * The two findings from the round-3 real-Lexical gate (D1 and D2). Both are
 * observations of what Lexical 0.48 ACTUALLY does, and `syncLexicalToLoro`
 * depends on each of them. They lived in a throwaway spike that drove a
 * prototype schema; here they drive the shipping binding, so they keep failing
 * if the real reconciliation drifts.
 */
describe('run identity under Lexical normalization', () => {
  /**
   * D1 — A RUN IS A MAXIMAL ADJACENT GROUP of TextNodes, not one TextNode.
   *
   * This is the single most counter-intuitive fact about the outbound direction.
   * Bolding a sub-range makes Lexical split ONE TextNode into THREE, so the
   * obvious expectation is three carriers and two new ContainerIDs. It is wrong:
   * `describeChildren` coalesces adjacent text nodes into ONE desired child, so
   * the carrier count and the LoroText ContainerID are UNCHANGED and the format
   * lands as a MARK inside the existing container.
   *
   * That matters because the most common real "split" in an editor is a format
   * toggle, and if it re-minted containers every bold would invalidate a remote
   * caret and reset any concurrent edit in that run.
   */
  it('D1: a format split of a sub-range leaves ONE carrier and the SAME ContainerID', () => {
    seedParagraphs(harness, ['hello world'])
    const paragraph = childAt(harness.root, 0) as ElementContainer
    const before = containerId(childAt(paragraph, 0) as LoroText)

    // A MIDDLE sub-range, which is the three-way split D1 describes.
    harness.update(() => {
      const text = $blockAt(0).getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('expected a text node')
      text.select(6, 9)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected a range selection')
      selection.formatText('bold')
    })

    // Lexical really did split the one node into THREE locally...
    const lexicalNodes = harness.editor.getEditorState().read(() => {
      return $blockAt(0)
        .getChildren()
        .filter((child) => $isTextNode(child)).length
    })
    expect(lexicalNodes).toBe(3)

    // ...but the mirror still holds ONE text child, at the SAME address, with
    // the format carried as a mark inside it.
    const children = childContainers(paragraph)
    expect(children).toHaveLength(1)
    expect(containerId(children[0] as LoroText)).toBe(before)
    expect(loroRuns(harness, 0)).toEqual([
      { text: 'hello ', format: 0 },
      { text: 'wor', format: BOLD },
      { text: 'ld', format: 0 },
    ])
    harness.mapping.assertBijective()
  })

  /**
   * D2, first half — A SPLIT REPORTS NOTHING through `normalizedNodes`.
   *
   * `splitText` is not normalization, so a binding that keyed carrier work off
   * `normalizedNodes` would silently do nothing on the one edit that genuinely
   * restructures a run. `syncLexicalToLoro` therefore uses it ONLY to retire
   * stale registry entries, never to decide what to write.
   */
  it('D2: a structural split reports NOTHING through normalizedNodes', () => {
    seedParagraphs(harness, ['hello world'])
    const normalized: number[] = []
    harness.editor.registerUpdateListener((payload) => {
      normalized.push(payload.normalizedNodes.size)
    })

    harness.update(() => {
      const text = $blockAt(0).getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('expected a text node')
      text.select(5, 5)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected a range selection')
      selection.insertNodes([$createLineBreakNode()])
    })

    expect(normalized).toEqual([0])
    // The linebreak really did split the run into two text children.
    const paragraph = childAt(harness.root, 0) as ElementContainer
    expect(childContainers(paragraph)).toHaveLength(3)
  })

  /**
   * D2, second half — A MERGE REPORTS BOTH KEYS, AND node1 IS THE LIVE SURVIVOR.
   *
   * THE TRAP: `$mergeTextNodes` reports node1 and node2 alike, but node1 is
   * still in the tree. A binding that read `normalizedNodes` as "these nodes are
   * gone" would unlink the anchor of the run it just KEPT.
   *
   * `syncLexicalToLoro` does unlink every reported key — which is only safe
   * because the walk that follows re-links every run anchor it visits. This test
   * is what pins that pairing: if the unlink is ever kept while the re-link is
   * refactored away, the run's ContainerID changes here and the test fails.
   */
  it('D2: a merge reports the LIVE survivor, and the run keeps its ContainerID', () => {
    seedParagraphs(harness, ['hello world'])
    const paragraph = childAt(harness.root, 0) as ElementContainer
    const original = containerId(childAt(paragraph, 0) as LoroText)

    // Split the run with a linebreak.
    harness.update(() => {
      const text = $blockAt(0).getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('expected a text node')
      text.select(5, 5)
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) throw new Error('expected a range selection')
      selection.insertNodes([$createLineBreakNode()])
    })
    const [headKey, tailKey] = harness.editor.getEditorState().read(() => {
      const texts = $blockAt(0)
        .getChildren()
        .filter((child): child is TextNode => $isTextNode(child))
      return [texts[0]!.getKey(), texts[1]!.getKey()] as const
    })
    // The head kept the ORIGINAL container; splitText mints only the tail.
    expect(containerId(childAt(paragraph, 0) as LoroText)).toBe(original)

    let reported = new Set<string>()
    harness.editor.registerUpdateListener((payload) => {
      reported = new Set(payload.normalizedNodes)
    })

    // Remove the linebreak: Lexical merges the two runs back together.
    harness.update(() => {
      for (const child of $blockAt(0).getChildren()) {
        if (child.getType() === 'linebreak') child.remove()
      }
    })

    // BOTH keys are reported, including the one that is still live.
    expect(reported).toEqual(new Set([headKey, tailKey]))
    const survivors = harness.editor.getEditorState().read(() =>
      $blockAt(0)
        .getChildren()
        .filter((child): child is TextNode => $isTextNode(child))
        .map((child) => child.getKey()),
    )
    expect(survivors).toEqual([headKey])

    // And the merged run still lives at its ORIGINAL address — the unlink was
    // repaired by the walk, not left dangling.
    const merged = childContainers(paragraph)
    expect(merged).toHaveLength(1)
    expect(containerId(merged[0] as LoroText)).toBe(original)
    expect((merged[0] as LoroText).toString()).toBe('hello world')
    harness.mapping.assertBijective()
  })

  /**
   * INCIDENTAL BUT REAL, and the reason every listener in this package uses a
   * BLOCK body: Lexical 0.48 stores whatever an update listener RETURNS and
   * calls it as a teardown before the next invocation. A concise arrow returning
   * a non-function (`(payload) => syncLexicalToLoro(target, payload)` returns an
   * op count) crashes the NEXT update with "unregister is not a function".
   */
  it('survives repeated updates — the update listener must not return a value', () => {
    seedParagraphs(harness, ['alpha'])
    for (let i = 0; i < 5; i++) {
      expect(() =>
        harness.update(() => {
          $blockAt(0).append($createTextNode(`-${i}`))
        }),
      ).not.toThrow()
    }
    expect(loroRuns(harness, 0)).toEqual([{ text: 'alpha-0-1-2-3-4', format: 0 }])
  })
})
