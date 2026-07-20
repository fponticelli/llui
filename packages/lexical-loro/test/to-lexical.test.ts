/**
 * Inbound sync: Loro → Lexical.
 *
 * The assertions here are mostly about NODE KEY IDENTITY, not just the
 * resulting document. A binding that rebuilds the tree on every remote event
 * still converges — and still tears down every mounted `LLuiDecoratorNode`
 * sub-app, every DOM node, and the local selection (see the package README and
 * `packages/lexical/src/decorator.ts`, which disposes the sub-app on the
 * 'destroyed' mutation). So nearly every test below snapshots NodeKeys before
 * the remote change and asserts they survived it.
 */

import { describe, expect, it } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import { $createHeadingNode, $isHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COLLABORATION_TAG,
  type ElementNode,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'
import { LoroDoc, type LoroEventBatch } from 'loro-crdt'
import { $createLLuiDecoratorNode, $isLLuiDecoratorNode, LLuiDecoratorNode } from '@llui/lexical'

import {
  ContainerNodeMap,
  adoptLoroDocument,
  applyLoroToLexical,
  between,
  containerId,
  createElementChild,
  elementChildren,
  formatBit,
  initDoc,
  LORO_TEXT_FORMATS,
  newUuid,
  seedLoroFromLexical,
  syncLexicalToLoro,
  type ElementContainer,
  type InboundTarget,
  type OutboundTarget,
} from '../src/index.js'

const BOLD = formatBit('bold')
const ITALIC = formatBit('italic')

const NODES = [HeadingNode, QuoteNode, LLuiDecoratorNode]

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * A writer (outbound-only) and a reader (inbound-only) over two Loro docs.
 *
 * Splitting the directions makes the reader's behaviour unambiguous: anything
 * that changes in the reader's editor came from an inbound event, never from a
 * local edit bouncing around.
 */
class Pair {
  readonly writerDoc = new LoroDoc()
  readonly readerDoc = new LoroDoc()
  readonly writerRoot: ElementContainer
  readonly readerRoot: ElementContainer
  readonly writer: LexicalEditor
  readonly reader: LexicalEditor
  readonly writerTarget: OutboundTarget
  readonly readerTarget: InboundTarget
  readonly readerMapping = new ContainerNodeMap()
  /** Inbound batches the reader received but has not yet applied. */
  readonly received: LoroEventBatch[] = []
  /** Batches the reader's own doc produced with `by: 'local'`. */
  readonly readerLocalBatches: LoroEventBatch[] = []
  /** Update tags observed on the reader's editor. */
  readonly readerTags: string[][] = []

  constructor() {
    this.writerDoc.setPeerId(1n)
    this.readerDoc.setPeerId(2n)
    this.writerRoot = initDoc(this.writerDoc, LORO_TEXT_FORMATS)
    this.readerRoot = initDoc(this.readerDoc, LORO_TEXT_FORMATS)
    this.writerDoc.commit()
    this.readerDoc.commit()

    this.writer = createHeadlessEditor({
      namespace: 'writer',
      nodes: NODES,
      onError: (error: Error) => {
        throw error
      },
    })
    this.reader = createHeadlessEditor({
      namespace: 'reader',
      nodes: NODES,
      onError: (error: Error) => {
        throw error
      },
    })

    this.writerTarget = {
      doc: this.writerDoc,
      root: this.writerRoot,
      mapping: new ContainerNodeMap(),
    }
    this.readerTarget = {
      doc: this.readerDoc,
      root: this.readerRoot,
      mapping: this.readerMapping,
      editor: this.reader,
    }

    // NB: the callback must return VOID. Lexical 0.48 stores an update
    // listener's return value and CALLS IT as a cleanup before the next
    // invocation, so `(payload) => syncLexicalToLoro(...)` — which returns an
    // op count — throws 'unregister is not a function' on the second update.
    this.writer.registerUpdateListener((payload) => {
      syncLexicalToLoro(this.writerTarget, payload)
    })
    this.readerDoc.subscribe((batch) => {
      if (batch.by === 'local') this.readerLocalBatches.push(batch)
      else this.received.push(batch)
    })
    this.reader.registerUpdateListener(({ tags }) => {
      this.readerTags.push([...tags])
    })
  }

  /** Edit the writer, ship the resulting update to the reader, and apply it. */
  push(fn: () => void): number {
    this.writer.update(fn, { discrete: true })
    return this.deliver()
  }

  /** Ship whatever the writer has produced and apply every pending batch. */
  deliver(): number {
    this.received.length = 0
    this.readerDoc.import(this.writerDoc.export({ mode: 'update' }))
    const batches = [...this.received]
    this.received.length = 0
    let applied = 0
    for (const batch of batches) if (applyLoroToLexical(this.readerTarget, batch)) applied++
    return applied
  }

  /** The reader's document, as a comparable shape (no NodeKeys). */
  readerJson(): unknown {
    return this.reader.getEditorState().toJSON()
  }

  writerJson(): unknown {
    return this.writer.getEditorState().toJSON()
  }

  /** Every NodeKey in the reader, keyed by a stable structural address. */
  readerKeys(): Map<string, NodeKey> {
    const out = new Map<string, NodeKey>()
    this.reader.getEditorState().read(() => {
      const visit = (node: ElementNode, path: string): void => {
        out.set(path, node.getKey())
        node.getChildren().forEach((child, index) => {
          const childPath = `${path}/${index}:${child.getType()}`
          if ($isElementNode(child)) visit(child, childPath)
          else out.set(childPath, child.getKey())
        })
      }
      visit($getRoot(), 'root')
    })
    return out
  }

  dispose(): void {
    // Headless editors hold no DOM; nothing to release.
  }
}

/** Seed both sides so the reader starts from a real, mapped document. */
function seedPair(pair: Pair, fn: () => void): void {
  pair.writer.update(fn, { discrete: true })
  pair.deliver()
}

/** Read the reader's plain-text content, paragraph by paragraph. */
function readerText(pair: Pair): string[] {
  const out: string[] = []
  pair.reader.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) out.push(child.getTextContent())
  })
  return out
}

// ---------------------------------------------------------------------------
// 1. Building a document that was not there before
// ---------------------------------------------------------------------------

describe('inbound: initial adoption', () => {
  it('builds the whole document into an empty editor', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('hello')))
      root.append($createHeadingNode('h2').append($createTextNode('world')))
    })
    expect(readerText(pair)).toEqual(['hello', 'world'])
    expect(pair.readerJson()).toEqual(pair.writerJson())
  })

  it('adoptLoroDocument fills an editor from a document it never saw an event for', () => {
    const pair = new Pair()
    pair.writer.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode().append($createTextNode('adopted')))
      },
      { discrete: true },
    )
    // Import WITHOUT applying any event batch: the reader is now behind.
    pair.received.length = 0
    pair.readerDoc.import(pair.writerDoc.export({ mode: 'update' }))
    pair.received.length = 0
    expect(readerText(pair)).toEqual([])

    adoptLoroDocument(pair.readerTarget)
    expect(readerText(pair)).toEqual(['adopted'])
    expect(pair.readerJson()).toEqual(pair.writerJson())
  })

  it('projects an EMPTIED-but-not-deleted LoroText as zero text nodes', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('gone')))
    })
    // Outbound EMPTIES the last LoroText rather than deleting it (so a peer's
    // concurrent insert into that container survives); inbound must project the
    // empty container as no text nodes at all, not as an empty TextNode.
    pair.push(() => {
      const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>()
      paragraph.clear()
    })
    let childCount = -1
    pair.reader.getEditorState().read(() => {
      childCount = $getRoot().getFirstChildOrThrow<ElementNode>().getChildrenSize()
    })
    expect(childCount).toBe(0)
    expect(pair.readerJson()).toEqual(pair.writerJson())
  })
})

// ---------------------------------------------------------------------------
// 2. Identity preservation — the reason this package exists
// ---------------------------------------------------------------------------

describe('inbound: NodeKey identity', () => {
  it('a remote text edit reuses the existing TextNode and paragraph', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('ab')))
    })
    const before = pair.readerKeys()

    pair.push(() => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('abc')
    })

    expect(readerText(pair)).toEqual(['abc'])
    expect(pair.readerKeys()).toEqual(before)
  })

  it('a remote format change reuses the paragraph and splits inside it only', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('abcd')))
    })
    const before = pair.readerKeys()

    pair.push(() => {
      const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>()
      paragraph.clear()
      paragraph.append($createTextNode('ab'))
      const bold = $createTextNode('cd')
      bold.setFormat(BOLD)
      paragraph.append(bold)
    })

    // The paragraph and the run's FIRST text node keep their keys; only the new
    // second run is a new node.
    expect(pair.readerKeys().get('root')).toBe(before.get('root'))
    expect(pair.readerKeys().get('root/0:paragraph')).toBe(before.get('root/0:paragraph'))
    expect(pair.readerKeys().get('root/0:paragraph/0:text')).toBe(
      before.get('root/0:paragraph/0:text'),
    )

    const formats: number[] = []
    pair.reader.getEditorState().read(() => {
      for (const child of $getRoot().getFirstChildOrThrow<ElementNode>().getChildren()) {
        if ($isTextNode(child)) formats.push(child.getFormat())
      }
    })
    expect(formats).toEqual([0, BOLD])
  })

  it('inserting a sibling block leaves every existing block key untouched', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('one')))
      root.append($createParagraphNode().append($createTextNode('three')))
    })
    const before = pair.readerKeys()

    pair.push(() => {
      const root = $getRoot()
      const first = root.getFirstChildOrThrow()
      first.insertAfter($createParagraphNode().append($createTextNode('two')))
    })

    expect(readerText(pair)).toEqual(['one', 'two', 'three'])
    const after = pair.readerKeys()
    expect(after.get('root/0:paragraph')).toBe(before.get('root/0:paragraph'))
    // 'three' moved from index 1 to index 2 but is the SAME node.
    expect(after.get('root/2:paragraph')).toBe(before.get('root/1:paragraph'))
  })

  it('a remote block MOVE preserves the moved subtree — decorator mounts survive', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('a')))
      root.append($createParagraphNode().append($createLLuiDecoratorNode('chart', { n: 1 })))
      root.append($createParagraphNode().append($createTextNode('c')))
    })
    const before = pair.readerKeys()
    const decoratorKey = before.get('root/1:paragraph/0:llui-decorator')
    expect(decoratorKey).toBeDefined()

    pair.push(() => {
      const root = $getRoot()
      const [first, second] = root.getChildren()
      if (first === undefined || second === undefined) throw new Error('missing children')
      // Drag the decorator block to the front.
      first.insertBefore(second)
    })

    const after = pair.readerKeys()
    expect(after.get('root/0:paragraph')).toBe(before.get('root/1:paragraph'))
    expect(after.get('root/0:paragraph/0:llui-decorator')).toBe(decoratorKey)
    expect(after.get('root/1:paragraph')).toBe(before.get('root/0:paragraph'))
    expect(pair.readerJson()).toEqual(pair.writerJson())
  })

  it('a remote decorator DATA change updates in place, keeping the mount alive', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createLLuiDecoratorNode('chart', { n: 1 })))
    })
    const before = pair.readerKeys()

    pair.push(() => {
      const decorator = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isLLuiDecoratorNode(decorator)) decorator.setData({ n: 2 })
    })

    expect(pair.readerKeys()).toEqual(before)
    let data: unknown
    pair.reader.getEditorState().read(() => {
      const decorator = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isLLuiDecoratorNode(decorator)) data = decorator.getData()
    })
    expect(data).toEqual({ n: 2 })
  })

  it('a remote element PROP change updates in place', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createHeadingNode('h1').append($createTextNode('title')))
    })
    const before = pair.readerKeys()

    pair.push(() => {
      const heading = $getRoot().getFirstChildOrThrow()
      if ($isHeadingNode(heading)) heading.setTag('h3')
    })

    expect(pair.readerKeys()).toEqual(before)
    let tag = ''
    pair.reader.getEditorState().read(() => {
      const heading = $getRoot().getFirstChildOrThrow()
      if ($isHeadingNode(heading)) tag = heading.getTag()
    })
    expect(tag).toBe('h3')
  })

  it('a remote node TYPE change replaces the node (it cannot be updated in place)', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('x')))
    })

    pair.push(() => {
      const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>()
      paragraph.replace($createHeadingNode('h2'), true)
    })

    expect(pair.readerJson()).toEqual(pair.writerJson())
  })

  it('deleting a block removes its nodes and sweeps the mapping', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('one')))
      root.append($createParagraphNode().append($createTextNode('two')))
    })
    const mappedBefore = pair.readerMapping.size

    pair.push(() => {
      $getRoot().getLastChildOrThrow().remove()
    })

    expect(readerText(pair)).toEqual(['one'])
    expect(pair.readerMapping.size).toBeLessThan(mappedBefore)
    pair.readerMapping.assertBijective()
  })

  it('keeps line breaks and mixed inline content', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('a'))
      paragraph.append($createLineBreakNode())
      paragraph.append($createTextNode('b'))
      root.append(paragraph)
    })
    expect(pair.readerJson()).toEqual(pair.writerJson())
  })
})

// ---------------------------------------------------------------------------
// 3. Echo suppression — the three layers
// ---------------------------------------------------------------------------

describe('inbound: echo suppression', () => {
  it('(a) ignores a batch produced by a LOCAL commit', () => {
    const pair = new Pair()
    const localBatches: LoroEventBatch[] = []
    pair.readerDoc.subscribe((batch) => {
      if (batch.by === 'local') localBatches.push(batch)
    })
    const children = elementChildren(pair.readerRoot)
    createElementChild(children, newUuid(), between(null, null), 'paragraph')
    pair.readerDoc.commit()
    expect(localBatches.length).toBeGreaterThan(0)
    for (const batch of localBatches) {
      expect(applyLoroToLexical(pair.readerTarget, batch)).toBe(false)
    }
  })

  it('(b) stamps COLLABORATION_TAG so the outbound direction skips the writeback', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('hi')))
    })
    expect(pair.readerTags.length).toBeGreaterThan(0)
    for (const tags of pair.readerTags) expect(tags).toContain(COLLABORATION_TAG)
  })

  it('(c) never stamps PROGRAMMATIC_TAG — that tag cancels the host onChange', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('hi')))
    })
    for (const tags of pair.readerTags) {
      // `PROGRAMMATIC_TAG` is `@llui/lexical`'s own tag string; assert by value
      // so this test does not depend on that package's export surface.
      expect(tags).not.toContain('llui-programmatic')
    }
  })

  it('applying a remote batch does not produce a new LOCAL Loro commit', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('hi')))
    })
    expect(pair.readerLocalBatches).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4. Selection survival
// ---------------------------------------------------------------------------

describe('inbound: selection', () => {
  /** Put the reader's caret in the first paragraph's first text node. */
  const placeCaret = (pair: Pair, offset: number): void => {
    pair.reader.update(
      () => {
        const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
        if (!$isTextNode(text)) throw new Error('expected a text node')
        const selection = $createRangeSelection()
        selection.anchor.set(text.getKey(), offset, 'text')
        selection.focus.set(text.getKey(), offset, 'text')
        $setSelection(selection)
      },
      { discrete: true },
    )
  }

  const caretOffset = (pair: Pair): number => {
    let offset = -1
    pair.reader.getEditorState().read(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) offset = selection.focus.offset
    })
    return offset
  }

  it('an untouched paragraph leaves the caret alone by construction', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('local')))
      root.append($createParagraphNode().append($createTextNode('remote')))
    })
    placeCaret(pair, 3)
    pair.push(() => {
      const second = $getRoot().getLastChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(second)) second.setTextContent('remote!!')
    })
    expect(caretOffset(pair)).toBe(3)
  })

  it('a remote insert BEFORE the caret shifts it by the inserted length', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('world')))
    })
    placeCaret(pair, 5)
    pair.push(() => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('hello world')
    })
    expect(readerText(pair)).toEqual(['hello world'])
    expect(caretOffset(pair)).toBe(11)
  })

  it('a remote insert AFTER the caret leaves it where it was', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('hello')))
    })
    placeCaret(pair, 2)
    pair.push(() => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('hello world')
    })
    expect(caretOffset(pair)).toBe(2)
  })

  it('a remote delete spanning the caret clamps it to the edit point', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('abcdef')))
    })
    placeCaret(pair, 4)
    pair.push(() => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('af')
    })
    expect(readerText(pair)).toEqual(['af'])
    expect(caretOffset(pair)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 5. Minimality — the dirty gate
// ---------------------------------------------------------------------------

describe('inbound: minimality', () => {
  it('descends only into the blocks a batch actually touched', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      for (let i = 0; i < 20; i++) {
        root.append($createParagraphNode().append($createTextNode(`p${i}`)))
      }
    })
    const before = pair.readerKeys()

    pair.push(() => {
      const target = $getRoot().getChildAtIndex<ElementNode>(7)
      const text = target?.getFirstChild()
      if (text !== null && text !== undefined && $isTextNode(text)) text.setTextContent('p7!')
    })

    const after = pair.readerKeys()
    // Every key survives — including the 19 untouched paragraphs.
    for (const [path, key] of before) {
      if (path === 'root/7:paragraph/0:text') continue
      expect(after.get(path)).toBe(key)
    }
    expect(readerText(pair)[7]).toBe('p7!')
  })

  it('a batch that changes nothing observable reports no application', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('same')))
    })
    // Re-import the same update: Loro produces no events for state it already has.
    pair.received.length = 0
    pair.readerDoc.import(pair.writerDoc.export({ mode: 'update' }))
    expect(pair.received).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. Formatting round-trip
// ---------------------------------------------------------------------------

describe('inbound: text formats', () => {
  it('projects independent Loro marks back into a Lexical bitmask', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('plain')))
    })

    pair.push(() => {
      const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>()
      paragraph.clear()
      const both = $createTextNode('both')
      both.setFormat(BOLD | ITALIC)
      paragraph.append(both)
    })

    let format = -1
    pair.reader.getEditorState().read(() => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) format = text.getFormat()
    })
    expect(format).toBe(BOLD | ITALIC)
  })

  it('seedLoroFromLexical + adopt round-trips a formatted document exactly', () => {
    const pair = new Pair()
    pair.writer.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        paragraph.append($createTextNode('a'))
        const bold = $createTextNode('b')
        bold.setFormat(BOLD)
        paragraph.append(bold)
        const italic = $createTextNode('c')
        italic.setFormat(ITALIC)
        paragraph.append(italic)
        root.append(paragraph)
      },
      { discrete: true },
    )
    // Seed explicitly (idempotent) and adopt on the other side.
    seedLoroFromLexical(pair.writerTarget, pair.writer.getEditorState())
    pair.received.length = 0
    pair.readerDoc.import(pair.writerDoc.export({ mode: 'update' }))
    pair.received.length = 0
    adoptLoroDocument(pair.readerTarget)
    expect(pair.readerJson()).toEqual(pair.writerJson())
  })
})

// ---------------------------------------------------------------------------
// 7. The mapping stays bijective through everything
// ---------------------------------------------------------------------------

describe('inbound: mapping invariant', () => {
  it('stays bijective across create, edit, move and delete', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      for (const t of ['a', 'b', 'c']) {
        root.append($createParagraphNode().append($createTextNode(t)))
      }
    })
    pair.readerMapping.assertBijective()

    pair.push(() => {
      const root = $getRoot()
      const last = root.getLastChildOrThrow()
      root.getFirstChildOrThrow().insertBefore(last)
    })
    pair.readerMapping.assertBijective()

    pair.push(() => {
      $getRoot().getLastChildOrThrow().remove()
    })
    pair.readerMapping.assertBijective()

    pair.push(() => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('changed')
    })
    pair.readerMapping.assertBijective()

    // Every mapped container must still resolve to a live node.
    for (const { id, key } of pair.readerMapping.entries()) {
      expect(pair.readerDoc.getContainerById(id)).toBeDefined()
      let found = false
      pair.reader.getEditorState().read(() => {
        found = pair.reader.getEditorState()._nodeMap.has(key)
      })
      expect(found).toBe(true)
    }
  })

  it('maps the root container to the RootNode', () => {
    const pair = new Pair()
    seedPair(pair, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('x')))
    })
    let rootKey = ''
    pair.reader.getEditorState().read(() => {
      rootKey = $getRoot().getKey()
    })
    expect(pair.readerMapping.nodeKey(containerId(pair.readerRoot))).toBe(rootKey)
  })
})
