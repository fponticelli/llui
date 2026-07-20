/**
 * Adversarial convergence: the cases `convergence.test.ts` does NOT cover.
 *
 * That file pins the shapes the author designed for. This one attacks the
 * places where a CRDT binding actually breaks — the ones where "it looked right
 * on two peers in the happy order" is not evidence of anything:
 *
 * - COMMUTATIVITY. The defining property of a CRDT is that delivery ORDER is
 *   irrelevant. Every other test here delivers updates in one order, so an
 *   order-dependent bug in the binding is invisible to all of them. These tests
 *   hand the SAME concurrent updates to different peers in different
 *   permutations and demand identical final documents.
 * - CAUSAL CONFLICTS. One peer deleting a subtree while the other edits inside
 *   it: the inbound side must resolve to a container that may no longer exist,
 *   and the registry must not be left pointing at a dead NodeKey.
 * - DEGENERATE DOCUMENTS. Empty, decorator-only, deeply nested — the shapes
 *   that skip whole branches of the reconciler.
 * - VOLUME. Long bursts, to shake out ContainerID ↔ NodeKey mapping drift that
 *   only shows up after enough create/delete churn.
 *
 * Where a test cannot assert a specific document (a genuine concurrent conflict
 * has no single "right" answer), it asserts the property that must hold anyway:
 * every peer agrees, and the result is well-formed.
 */

import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'
import { $createQuoteNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from '@lexical/list'
import { LLuiDecoratorNode, $createLLuiDecoratorNode, $isLLuiDecoratorNode } from '@llui/lexical'

import { loroCollab } from '../src/index.js'
import {
  documentBlockCount,
  expectConverged,
  Network,
  projectEditor,
  type Peer,
} from './network.js'

const NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LLuiDecoratorNode]

function collabNetwork(names?: readonly string[]): Network {
  return new Network({
    ...(names ? { names } : {}),
    nodes: NODES,
    bind: (editor, doc) => {
      const collab = loroCollab({ doc, shouldBootstrap: false })
      const dispose = collab.register(editor)
      return { dispose }
    },
  })
}

function edit(peer: Peer, fn: (editor: LexicalEditor) => void): void {
  peer.editor.update(() => fn(peer.editor), { discrete: true })
}

function setParagraphs(peer: Peer, texts: readonly string[]): void {
  edit(peer, () => {
    const root = $getRoot()
    root.clear()
    for (const text of texts) root.append($createParagraphNode().append($createTextNode(text)))
  })
}

function blocks(peer: Peer): string[] {
  const out: string[] = []
  peer.editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) out.push(child.getTextContent())
  })
  return out
}

/** Append to the first TextNode of the Nth top-level block. */
function appendText(peer: Peer, index: number, suffix: string): void {
  edit(peer, () => {
    const block = $getRoot().getChildAtIndex<ElementNode>(index)
    const text = block?.getFirstChild()
    if (text != null && $isTextNode(text)) text.setTextContent(text.getTextContent() + suffix)
  })
}

/**
 * Walk every node, asserting the tree is structurally legal.
 *
 * A converged-but-corrupt document is a real failure mode: both peers can agree
 * on a tree Lexical itself considers invalid (an ElementNode whose child list
 * disagrees with the parent pointers, or a detached node still in a child list).
 * Equality assertions alone would pass.
 */
function expectWellFormed(peer: Peer): void {
  peer.editor.getEditorState().read(() => {
    const visit = (node: LexicalNode, depth: number): void => {
      if (depth > 50) throw new Error(`${peer.name}: tree deeper than 50 — probable cycle`)
      if (!$isElementNode(node)) return
      const children = node.getChildren()
      for (const [index, child] of children.entries()) {
        const parent = child.getParent()
        if (parent === null || !parent.is(node)) {
          throw new Error(
            `${peer.name}: child ${child.getKey()} (${child.getType()}) at index ${index} ` +
              `does not point back at its parent ${node.getKey()} (${node.getType()})`,
          )
        }
        visit(child, depth + 1)
      }
    }
    visit($getRoot(), 0)
  })
}

function expectAllWellFormed(network: Network): void {
  for (const peer of network.peers) expectWellFormed(peer)
}

describe('convergence — degenerate documents', () => {
  it('an empty document converges and stays empty', () => {
    const network = collabNetwork()
    network.settle()
    expectConverged(network)
    expect(blocks(network.a)).toEqual([])
    expect(blocks(network.b)).toEqual([])
    network.dispose()
  })

  it('a document emptied on one peer empties on the other', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['a', 'b', 'c'])
    network.settle()

    edit(network.a, () => {
      $getRoot().clear()
    })
    network.settle()

    expectConverged(network)
    expect(blocks(network.b)).toEqual([])
    expectAllWellFormed(network)
    network.dispose()
  })

  it('both peers concurrently emptying the document converges to empty', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['x', 'y'])
    network.settle()

    edit(network.a, () => $getRoot().clear())
    edit(network.b, () => $getRoot().clear())
    network.settle()

    expectConverged(network)
    expect(blocks(network.a)).toEqual([])
    expectAllWellFormed(network)
    network.dispose()
  })

  it('a document containing ONLY a decorator node converges', () => {
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createLLuiDecoratorNode('chart', { n: 7 })))
    })
    network.settle()

    expectConverged(network)
    let payload: unknown
    network.b.editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isLLuiDecoratorNode(node)) payload = node.getData()
    })
    expect(payload).toEqual({ n: 7 })
    expectAllWellFormed(network)
    network.dispose()
  })

  it('a decorator whose data is edited remotely keeps its NodeKey', () => {
    // The whole reason `updateFromJSON` exists on LLuiDecoratorNode: replacing
    // the node instead of updating it would dispose the mounted LLui sub-app.
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createLLuiDecoratorNode('chart', { n: 1 })))
    })
    network.settle()

    const keyOf = (peer: Peer): string => {
      let key = ''
      peer.editor.getEditorState().read(() => {
        key = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow().getKey()
      })
      return key
    }
    const before = keyOf(network.b)

    edit(network.a, () => {
      const node = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isLLuiDecoratorNode(node)) node.setData({ n: 2 })
    })
    network.settle()

    expect(keyOf(network.b)).toBe(before)
    let payload: unknown
    network.b.editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isLLuiDecoratorNode(node)) payload = node.getData()
    })
    expect(payload).toEqual({ n: 2 })
    expectConverged(network)
    network.dispose()
  })

  it('deeply nested lists converge, and a deep edit propagates', () => {
    const network = collabNetwork()
    const DEPTH = 6
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      const outer = $createListNode('bullet')
      root.append(outer)
      let list = outer
      for (let level = 0; level < DEPTH; level++) {
        const item = $createListItemNode()
        item.append($createTextNode(`level-${level}`))
        list.append(item)
        if (level === DEPTH - 1) break
        const holder = $createListItemNode()
        const nested = $createListNode('bullet')
        holder.append(nested)
        list.append(holder)
        list = nested
      }
    })
    network.settle()
    expectConverged(network)
    expectAllWellFormed(network)

    // Now edit the DEEPEST text from the other peer.
    edit(network.b, () => {
      let node: LexicalNode = $getRoot()
      const deepest: LexicalNode[] = []
      const walk = (current: LexicalNode): void => {
        if ($isTextNode(current)) deepest.push(current)
        if ($isElementNode(current)) for (const child of current.getChildren()) walk(child)
      }
      walk(node)
      const last = deepest[deepest.length - 1]
      if (last != null && $isTextNode(last)) last.setTextContent(last.getTextContent() + '!')
      void node
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    expect(blocks(network.a)[0]).toContain(`level-${DEPTH - 1}!`)
    network.dispose()
  })

  it('deeply nested structure built concurrently on both peers converges', () => {
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      root.append($createQuoteNode().append($createTextNode('shared')))
    })
    network.settle()

    // Both nest further inside the SAME quote, concurrently.
    edit(network.a, () => {
      const quote = $getRoot().getFirstChildOrThrow<ElementNode>()
      quote.append($createTextNode(' fromA'))
    })
    edit(network.b, () => {
      const quote = $getRoot().getFirstChildOrThrow<ElementNode>()
      quote.append($createTextNode(' fromB'))
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    const text = blocks(network.a)[0] ?? ''
    expect(text).toContain('fromA')
    expect(text).toContain('fromB')
    network.dispose()
  })
})

describe('convergence — delete versus concurrent edit', () => {
  it('a block deleted on A while B types inside it converges', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['keep', 'doomed', 'tail'])
    network.settle()

    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    appendText(network.b, 1, '-typing')
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    // Whatever the merge decides, 'keep' and 'tail' must survive intact.
    expect(blocks(network.a)).toContain('keep')
    expect(blocks(network.a)).toContain('tail')
    network.dispose()
  })

  it('a SUBTREE deleted on A while B appends a child inside it converges', () => {
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('before')))
      const quote = $createQuoteNode()
      quote.append($createTextNode('inside'))
      root.append(quote)
      root.append($createParagraphNode().append($createTextNode('after')))
    })
    network.settle()

    // A removes the whole quote subtree…
    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    // …while B, unaware, appends into it.
    edit(network.b, () => {
      const quote = $getRoot().getChildAtIndex<ElementNode>(1)
      quote?.append($createTextNode('-more'))
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    expect(blocks(network.a)).toContain('before')
    expect(blocks(network.a)).toContain('after')
    network.dispose()
  })

  it('a subtree deleted on A while B inserts a DECORATOR inside it converges', () => {
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('head')))
      root.append($createQuoteNode().append($createTextNode('victim')))
    })
    network.settle()

    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    edit(network.b, () => {
      $getRoot()
        .getChildAtIndex<ElementNode>(1)
        ?.append($createLLuiDecoratorNode('chart', { n: 3 }))
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    expect(blocks(network.a)).toContain('head')
    network.dispose()
  })

  it('both peers deleting DIFFERENT blocks converges to neither surviving', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
    network.settle()

    edit(network.a, () => $getRoot().getChildAtIndex(1)?.remove())
    edit(network.b, () => $getRoot().getChildAtIndex(2)?.remove())
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    expect(blocks(network.a)).toEqual(['p0', 'p3'])
    network.dispose()
  })

  it('both peers deleting the SAME block converges (delete is idempotent)', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['p0', 'p1', 'p2'])
    network.settle()

    edit(network.a, () => $getRoot().getChildAtIndex(1)?.remove())
    edit(network.b, () => $getRoot().getChildAtIndex(1)?.remove())
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    expect(blocks(network.a)).toEqual(['p0', 'p2'])
    network.dispose()
  })
})

describe('convergence — delete concurrent with move', () => {
  /**
   * DELETE BEATS MOVE, and every peer must agree — including the deleter.
   *
   * Under the carrier schema a move is one LWW write to the carrier's `pos`,
   * while a delete removes the carrier's whole slot from the `children` map. The
   * two touch different things, so the delete wins and the block VANISHES on
   * every peer, in both delivery orders. That is the deliberate choice recorded
   * in `schema.ts`: the alternative — `LoroMovableList`, which RESURRECTS a
   * deliberately deleted block — pays for it with an uncatchable WASM panic.
   *
   * The property these tests actually defend is older and outlives that choice:
   * PROJECTION MUST DEPEND ONLY ON REPLICATED STATE. `container.isDeleted()` is
   * PEER-LOCAL bookkeeping — the peer that issued a delete reports `true` while
   * every other peer reports `false` for the very same ContainerID. Any
   * projection rule consulting it renders a DIFFERENT document on the deleting
   * peer: identical CRDT state, divergent editors, and nothing ever repairs it.
   * This shape is where that bug surfaced, so it is pinned directly rather than
   * left to the randomized test to stumble into.
   */
  it('a block deleted on A and MOVED on B converges on all peers', () => {
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2'])
    network.settle()

    // A deletes the middle block…
    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    // …while B concurrently drags that same block to the front.
    edit(network.b, () => {
      const root = $getRoot()
      const moved = root.getChildAtIndex(1)
      if (moved !== null) root.getFirstChildOrThrow().insertBefore(moved)
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })

  it("every peer's editor matches its OWN document, the deleter included", () => {
    // The sharpest form of the projection-purity property: assert each editor
    // against the document that peer actually holds, rather than against the
    // other peers. A peer whose editor omits — or keeps — a block its own
    // document disagrees with is permanently, unrecoverably stale, and
    // cross-peer convergence alone would not notice.
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['keep', 'contested', 'tail'])
    network.settle()

    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    edit(network.b, () => {
      const root = $getRoot()
      const moved = root.getChildAtIndex(1)
      if (moved !== null) root.getFirstChildOrThrow().insertBefore(moved)
    })
    network.settle()

    // Every peer's editor must have exactly as many blocks as its own document.
    for (const peer of network.peers) {
      let editorBlocks = 0
      peer.editor.getEditorState().read(() => {
        editorBlocks = $getRoot().getChildrenSize()
      })
      const docBlocks = documentBlockCount(peer.doc)
      expect(editorBlocks, `${peer.name}: editor/document block count disagree`).toBe(docBlocks)
    }
    expectConverged(network)
    network.dispose()
  })

  it('delete-versus-move survives a further round of edits on every peer', () => {
    // After the resurrection, the document must remain usable: a peer that got
    // its projection wrong would keep writing against a stale tree.
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2'])
    network.settle()

    edit(network.a, () => $getRoot().getChildAtIndex(1)?.remove())
    edit(network.b, () => {
      const root = $getRoot()
      const moved = root.getChildAtIndex(1)
      if (moved !== null) root.getFirstChildOrThrow().insertBefore(moved)
    })
    network.settle()

    for (const peer of network.peers) appendText(peer, 0, `-${peer.name}`)
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })
})

describe('convergence — concurrent text at the same position', () => {
  it('both peers inserting at the SAME index of one run converge to a merge', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['XY'])
    network.settle()

    // Both splice at index 1 without seeing the other.
    edit(network.a, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('XaaY')
    })
    edit(network.b, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('XbbY')
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    const merged = blocks(network.a)[0] ?? ''
    // Both insertions survive, both anchors survive, order is Loro's to choose.
    expect(merged).toMatch(/^X(aabb|bbaa)Y$/)
    network.dispose()
  })

  it('a peer deleting a run while the other types into it converges', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['deleteme'])
    network.settle()

    edit(network.a, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('')
    })
    edit(network.b, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('deletemeNOW')
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })

  it('three peers typing into the same run at once converge', () => {
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['base'])
    network.settle()

    for (const [name, suffix] of [
      ['a', 'AAA'],
      ['b', 'BBB'],
      ['c', 'CCC'],
    ] as const) {
      edit(network.peer(name), () => {
        const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
        if ($isTextNode(text)) text.setTextContent('base' + suffix)
      })
    }
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    const merged = blocks(network.a)[0] ?? ''
    for (const suffix of ['AAA', 'BBB', 'CCC']) expect(merged).toContain(suffix)
    network.dispose()
  })
})

describe('convergence — concurrent formatting', () => {
  /** Read the (text, format) runs of the first block. */
  function runs(peer: Peer): Array<{ text: string; format: number }> {
    const out: Array<{ text: string; format: number }> = []
    peer.editor.getEditorState().read(() => {
      for (const child of $getRoot().getFirstChildOrThrow<ElementNode>().getChildren()) {
        if ($isTextNode(child))
          out.push({ text: child.getTextContent(), format: child.getFormat() })
      }
    })
    return out
  }

  /** Rewrite the first block as the given runs. */
  function setRuns(peer: Peer, spec: ReadonlyArray<readonly [string, number]>): void {
    edit(peer, () => {
      const block = $getRoot().getFirstChildOrThrow<ElementNode>()
      block.clear()
      for (const [text, format] of spec) {
        const node = $createTextNode(text)
        node.setFormat(format)
        block.append(node)
      }
    })
  }

  it('bold ON from A and italic ON from B over the SAME range union', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['abcd'])
    network.settle()

    setRuns(network.a, [['abcd', 1]])
    setRuns(network.b, [['abcd', 2]])
    network.settle()

    expectConverged(network)
    expect(runs(network.a)).toEqual([{ text: 'abcd', format: 3 }])
    network.dispose()
  })

  it('bold ON from A and bold OFF from B over the same range converges', () => {
    // A genuine LWW conflict on ONE mark — there is no union answer. The
    // requirement is only that BOTH peers pick the SAME answer.
    const network = collabNetwork()
    setParagraphs(network.a, ['abcd'])
    network.settle()
    setRuns(network.a, [['abcd', 1]])
    network.settle()

    setRuns(network.a, [['abcd', 1 | 2]]) // A adds italic, keeps bold
    setRuns(network.b, [['abcd', 0]]) // B clears everything
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })

  it('partially OVERLAPPING format ranges converge to per-segment unions', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['abcdefgh'])
    network.settle()

    // A bolds [0,6); B italicises [2,8).
    setRuns(network.a, [
      ['abcdef', 1],
      ['gh', 0],
    ])
    setRuns(network.b, [
      ['ab', 0],
      ['cdefgh', 2],
    ])
    network.settle()

    expectConverged(network)
    expect(runs(network.a)).toEqual([
      { text: 'ab', format: 1 },
      { text: 'cdef', format: 3 },
      { text: 'gh', format: 2 },
    ])
    network.dispose()
  })

  it('formatting on A concurrent with a text insert on B keeps both', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['abcd'])
    network.settle()

    setRuns(network.a, [['abcd', 1]])
    edit(network.b, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('abcdEF')
    })
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    const merged = runs(network.a)
      .map((r) => r.text)
      .join('')
    expect(merged).toBe('abcdEF')
    // The originally-bolded region is still bold.
    expect(runs(network.a)[0]?.format).toBe(1)
    network.dispose()
  })

  it('three formats applied concurrently by three peers all survive', () => {
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['abcd'])
    network.settle()

    setRuns(network.a, [['abcd', 1]]) // bold
    setRuns(network.b, [['abcd', 2]]) // italic
    setRuns(network.peer('c'), [['abcd', 8]]) // underline
    network.settle()

    expectConverged(network)
    expect(runs(network.a)).toEqual([{ text: 'abcd', format: 1 | 2 | 8 }])
    network.dispose()
  })
})

describe('convergence — commutativity (delivery order is irrelevant)', () => {
  /**
   * The core CRDT property, and the one nothing else in the suite tests: given
   * the same set of concurrent updates, EVERY permutation of delivery order must
   * produce the same document.
   *
   * The test is built so each receiving peer sees a different permutation of the
   * same three concurrent updates. If the binding's inbound side depends on
   * arrival order anywhere — a registry write that assumes a parent landed
   * first, a dirty-set walk that assumes a container still exists — the peers
   * end up disagreeing and `expectConverged` reports it.
   */
  function permutations<T>(values: readonly T[]): T[][] {
    if (values.length <= 1) return [[...values]]
    const out: T[][] = []
    for (let i = 0; i < values.length; i++) {
      const rest = [...values.slice(0, i), ...values.slice(i + 1)]
      for (const tail of permutations(rest)) out.push([values[i]!, ...tail])
    }
    return out
  }

  it('enumerates all 6 orderings of three concurrent updates identically', () => {
    const orders = permutations([0, 1, 2])
    const results: string[] = []

    for (const order of orders) {
      // Four peers: a/b/c each produce ONE concurrent update; d only receives,
      // in the permutation under test.
      const network = collabNetwork(['a', 'b', 'c', 'd'])
      setParagraphs(network.a, ['p0', 'p1', 'p2'])
      network.settle()

      // Three concurrent edits — nobody delivers anything yet.
      appendText(network.peer('a'), 0, '-A')
      edit(network.peer('b'), () => {
        $getRoot().getChildAtIndex(1)?.remove()
      })
      edit(network.peer('c'), () => {
        $getRoot()
          .getLastChildOrThrow()
          .insertAfter($createParagraphNode().append($createTextNode('fromC')))
      })

      const d = network.peer('d')
      expect(d.inbox.length).toBe(3)
      d.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      expectAllWellFormed(network)
      results.push(JSON.stringify(projectEditor(d.editor)))
      network.dispose()
    }

    // Every permutation produced the SAME document.
    const [first, ...rest] = results
    for (const [index, result] of rest.entries()) {
      expect(result, `ordering ${JSON.stringify(orders[index + 1])} diverged`).toBe(first)
    }
  })

  it('commutes for concurrent formatting updates', () => {
    const orders = permutations([0, 1, 2])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c', 'd'])
      setParagraphs(network.a, ['abcdef'])
      network.settle()

      const applyRuns = (peer: Peer, spec: ReadonlyArray<readonly [string, number]>): void => {
        edit(peer, () => {
          const block = $getRoot().getFirstChildOrThrow<ElementNode>()
          block.clear()
          for (const [text, format] of spec) {
            const node = $createTextNode(text)
            node.setFormat(format)
            block.append(node)
          }
        })
      }

      applyRuns(network.peer('a'), [
        ['abcd', 1],
        ['ef', 0],
      ])
      applyRuns(network.peer('b'), [
        ['ab', 0],
        ['cdef', 2],
      ])
      applyRuns(network.peer('c'), [
        ['abc', 0],
        ['def', 8],
      ])

      const d = network.peer('d')
      d.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      results.push(JSON.stringify(projectEditor(d.editor)))
      network.dispose()
    }

    const [first, ...rest] = results
    for (const result of rest) expect(result).toBe(first)
  })

  it('commutes when one update DELETES what another update edits', () => {
    // The nastiest ordering case: whether the delete or the edit lands first
    // changes what the inbound side finds when it resolves the container.
    const orders = permutations([0, 1, 2])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c', 'd'])
      edit(network.a, () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode().append($createTextNode('head')))
        root.append($createQuoteNode().append($createTextNode('body')))
        root.append($createParagraphNode().append($createTextNode('tail')))
      })
      network.settle()

      // a edits inside the quote; b deletes the quote; c edits after it.
      edit(network.peer('a'), () => {
        const quote = $getRoot().getChildAtIndex<ElementNode>(1)
        const text = quote?.getFirstChild()
        if (text != null && $isTextNode(text)) text.setTextContent('body-edited')
      })
      edit(network.peer('b'), () => {
        $getRoot().getChildAtIndex(1)?.remove()
      })
      appendText(network.peer('c'), 2, '-C')

      const d = network.peer('d')
      d.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      expectAllWellFormed(network)
      results.push(JSON.stringify(projectEditor(d.editor)))
      network.dispose()
    }

    const [first, ...rest] = results
    for (const [index, result] of rest.entries()) {
      expect(result, `ordering ${JSON.stringify(orders[index + 1])} diverged`).toBe(first)
    }
  })

  it('commutes for four concurrent updates across all 24 orderings', () => {
    const orders = permutations([0, 1, 2, 3])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c', 'd', 'e'])
      setParagraphs(network.a, ['w', 'x', 'y', 'z'])
      network.settle()

      appendText(network.peer('a'), 0, '1')
      appendText(network.peer('b'), 1, '2')
      edit(network.peer('c'), () => {
        $getRoot().getChildAtIndex(2)?.remove()
      })
      edit(network.peer('d'), () => {
        $getRoot()
          .getFirstChildOrThrow()
          .insertBefore($createParagraphNode().append($createTextNode('new')))
      })

      const e = network.peer('e')
      expect(e.inbox.length).toBe(4)
      e.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      results.push(JSON.stringify(projectEditor(e.editor)))
      network.dispose()
    }

    const [first, ...rest] = results
    for (const [index, result] of rest.entries()) {
      expect(result, `ordering ${JSON.stringify(orders[index + 1])} diverged`).toBe(first)
    }
  })
})

describe('convergence — volume and mapping drift', () => {
  it('survives a 150-operation interleaved burst across three peers', () => {
    // Long enough to churn the ContainerID ↔ NodeKey registry hard: every
    // insert mints a mapping, every delete must retire one, and a stale entry
    // shows up as a write landing in the wrong container — which diverges.
    //
    // Excludes MOVE, but the ORIGINAL reason is obsolete and should not be
    // repeated: the loro-crdt 1.13.7 WASM panic pinned by
    // `test/loro-upstream.test.ts` is specific to `LoroMovableList`, and
    // children no longer live in one. A move is now an ordinary `pos` register
    // write with nothing upstream to trip over.
    //
    // This burst keeps its no-move shape so it stays a clean isolation of the
    // create/delete registry churn it was written for. Move IS fuzzed, at higher
    // volume and against concurrent deletes, in `test/harden.test.ts`
    // ('a 200-operation randomized burst INCLUDING MOVES').
    let seed = 0xc0ffee
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2'])
    network.settle()

    for (let op = 0; op < 150; op++) {
      const peer = network.peers[Math.floor(random() * network.peers.length)]!
      const action = Math.floor(random() * 3)
      edit(peer, () => {
        const root = $getRoot()
        const size = root.getChildrenSize()
        if (size === 0) {
          root.append($createParagraphNode().append($createTextNode('re')))
          return
        }
        const index = Math.floor(random() * size)
        const block = root.getChildAtIndex<ElementNode>(index)
        if (block === null) return
        if (action === 0) {
          const text = block.getFirstChild()
          if (text != null && $isTextNode(text)) {
            text.setTextContent(text.getTextContent() + op.toString(36))
          } else block.append($createTextNode(op.toString(36)))
        } else if (action === 1) {
          block.insertAfter($createParagraphNode().append($createTextNode(`n${op}`)))
        } else if (size > 1) {
          block.remove()
        }
      })
      // Deliver to a random subset so peers routinely edit from stale state.
      for (const other of network.peers) if (random() < 0.5) other.flushInbox()
    }

    network.settle()
    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })

  it('survives a 120-operation burst of pure text churn in one block', () => {
    // Isolates the text path: no structural ops at all, so any divergence is a
    // run-diff / mark bug rather than a list-reconciliation one.
    let seed = 0xbeef
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['seed'])
    network.settle()

    for (let op = 0; op < 120; op++) {
      const peer = network.peers[Math.floor(random() * network.peers.length)]!
      edit(peer, () => {
        const block = $getRoot().getFirstChildOrThrow<ElementNode>()
        const text = block.getFirstChild()
        if (text == null || !$isTextNode(text)) {
          block.append($createTextNode('x'))
          return
        }
        const content = text.getTextContent()
        if (random() < 0.35 && content.length > 2) {
          const cut = Math.floor(random() * (content.length - 1))
          text.setTextContent(content.slice(0, cut) + content.slice(cut + 1))
        } else {
          const at = Math.floor(random() * (content.length + 1))
          text.setTextContent(content.slice(0, at) + op.toString(36) + content.slice(at))
        }
        if (random() < 0.2) text.setFormat(Math.floor(random() * 4))
      })
      for (const other of network.peers) if (random() < 0.5) other.flushInbox()
    }

    network.settle()
    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })

  it('survives repeated create/delete of the SAME position (registry recycling)', () => {
    // Churns mappings in the narrowest possible way: the same index is filled
    // and emptied 60 times. A registry that fails to retire a deleted
    // ContainerID would resurrect a stale NodeKey here.
    const network = collabNetwork()
    setParagraphs(network.a, ['anchor'])
    network.settle()

    for (let round = 0; round < 60; round++) {
      edit(network.a, () => {
        $getRoot()
          .getFirstChildOrThrow()
          .insertAfter($createParagraphNode().append($createTextNode(`tmp${round}`)))
      })
      if (round % 3 === 0) network.settle()
      edit(network.b, () => {
        const root = $getRoot()
        if (root.getChildrenSize() > 1) root.getLastChildOrThrow().remove()
      })
      if (round % 2 === 0) network.settle()
    }

    network.settle()
    expectConverged(network)
    expectAllWellFormed(network)
    expect(blocks(network.a)).toContain('anchor')
    network.dispose()
  })
})
