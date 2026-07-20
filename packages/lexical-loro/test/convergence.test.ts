/**
 * End-to-end convergence: the real `loroCollab` binding, both directions live,
 * driven through the in-memory network in `test/network.ts`.
 *
 * These are the tests that actually answer "does this work". Everything else in
 * the suite pins a mechanism; this pins the property the mechanisms exist for:
 * whatever the peers do, and in whatever order their updates arrive, they end
 * up holding the same document.
 */

import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  type ElementNode,
  type LexicalEditor,
} from 'lexical'
import { $createHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text'
import { LLuiDecoratorNode, $createLLuiDecoratorNode } from '@llui/lexical'

import { loroCollab } from '../src/index.js'
import { expectConverged, Network, type Peer } from './network.js'

/** A network whose peers are wired with the real binding. */
function collabNetwork(names?: readonly string[]): Network {
  return new Network({
    ...(names ? { names } : {}),
    nodes: [HeadingNode, QuoteNode, LLuiDecoratorNode],
    bind: (editor, doc) => {
      const collab = loroCollab({ doc, shouldBootstrap: false })
      const dispose = collab.register(editor)
      return { dispose }
    },
  })
}

/** Run a discrete update on a peer's editor. */
function edit(peer: Peer, fn: (editor: LexicalEditor) => void): void {
  peer.editor.update(() => fn(peer.editor), { discrete: true })
}

/** Replace the whole document on a peer (used to establish a shared baseline). */
function setParagraphs(peer: Peer, texts: readonly string[]): void {
  edit(peer, () => {
    const root = $getRoot()
    root.clear()
    for (const text of texts) root.append($createParagraphNode().append($createTextNode(text)))
  })
}

/** Append text to the Nth paragraph. */
function appendText(peer: Peer, index: number, suffix: string): void {
  edit(peer, () => {
    const paragraph = $getRoot().getChildAtIndex<ElementNode>(index)
    const text = paragraph?.getFirstChild()
    if (text !== null && text !== undefined && $isTextNode(text)) {
      text.setTextContent(text.getTextContent() + suffix)
    }
  })
}

/** The plain text of each top-level block. */
function blocks(peer: Peer): string[] {
  const out: string[] = []
  peer.editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) out.push(child.getTextContent())
  })
  return out
}

describe('convergence', () => {
  it('a document created on one peer appears on the other', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['hello', 'world'])
    network.settle()
    expectConverged(network)
    expect(blocks(network.b)).toEqual(['hello', 'world'])
    network.dispose()
  })

  it('interleaved concurrent edits from both peers converge', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    for (let round = 0; round < 5; round++) {
      appendText(network.a, 0, `a${round}`)
      appendText(network.b, 2, `b${round}`)
      network.settle()
    }

    expectConverged(network)
    expect(blocks(network.a)[0]).toBe('onea0a1a2a3a4')
    expect(blocks(network.a)[2]).toBe('threeb0b1b2b3b4')
    network.dispose()
  })

  it('concurrent edits to the SAME text run converge to a merged result', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['base'])
    network.settle()

    // Neither peer has seen the other's edit when it makes its own.
    edit(network.a, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('Abase')
    })
    edit(network.b, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()
      if ($isTextNode(text)) text.setTextContent('baseB')
    })
    network.settle()

    expectConverged(network)
    expect(blocks(network.a)[0]).toBe('AbaseB')
    network.dispose()
  })

  it('concurrent FORMATTING of overlapping ranges converges to the union', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['abcdef'])
    network.settle()

    edit(network.a, () => {
      const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>()
      paragraph.clear()
      const bold = $createTextNode('abcd')
      bold.setFormat(1)
      paragraph.append(bold)
      paragraph.append($createTextNode('ef'))
    })
    edit(network.b, () => {
      const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>()
      paragraph.clear()
      paragraph.append($createTextNode('ab'))
      const italic = $createTextNode('cdef')
      italic.setFormat(2)
      paragraph.append(italic)
    })
    network.settle()

    expectConverged(network)
    const formats: number[] = []
    network.a.editor.getEditorState().read(() => {
      for (const child of $getRoot().getFirstChildOrThrow<ElementNode>().getChildren()) {
        if ($isTextNode(child)) formats.push(child.getFormat())
      }
    })
    // bold over [0,4), italic over [2,6) → the middle carries BOTH.
    expect(formats).toEqual([1, 3, 2])
    network.dispose()
  })

  it('delayed, REORDERED delivery converges', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['x'])
    network.settle()

    appendText(network.a, 0, '1')
    appendText(network.a, 0, '2')
    appendText(network.a, 0, '3')
    // b holds three updates and applies them back-to-front. Loro's causal
    // delivery buffers the out-of-order ones until their dependencies land.
    expect(network.b.inbox.length).toBe(3)
    network.b.flushInboxInOrder([2, 1, 0])
    network.settle()

    expectConverged(network)
    expect(blocks(network.b)[0]).toBe('x123')
    network.dispose()
  })

  it('a peer that goes offline, keeps editing, and reconnects converges', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['shared'])
    network.settle()

    network.disconnect('b')
    appendText(network.a, 0, '-A')
    edit(network.b, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('offline-b')))
    })
    network.reconnect('b')
    network.settle()

    expectConverged(network)
    expect(blocks(network.a)).toContain('offline-b')
    expect(blocks(network.a)[0]).toBe('shared-A')
    network.dispose()
  })

  it('a peer JOINING an existing document adopts it without clobbering', () => {
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['established'])
    network.settle()
    // `c` was present from the start but empty; it must have adopted, not seeded.
    expectConverged(network)
    expect(blocks(network.peer('c'))).toEqual(['established'])
    network.dispose()
  })

  it('a block REORDER on one peer and a text edit INSIDE the moved block converge', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['first', 'second', 'third'])
    network.settle()

    // a drags 'third' to the front…
    edit(network.a, () => {
      const root = $getRoot()
      root.getFirstChildOrThrow().insertBefore(root.getLastChildOrThrow())
    })
    // …while b, not yet knowing, types inside 'third'.
    appendText(network.b, 2, '!!')
    network.settle()

    expectConverged(network)
    expect(blocks(network.a)).toEqual(['third!!', 'first', 'second'])
    network.dispose()
  })

  it('a moved subtree keeps its decorator node through the remote move', () => {
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode().append($createTextNode('lead')))
      root.append($createParagraphNode().append($createLLuiDecoratorNode('chart', { n: 1 })))
    })
    network.settle()

    let decoratorKeyBefore = ''
    network.b.editor.getEditorState().read(() => {
      const block = $getRoot().getChildAtIndex<ElementNode>(1)
      decoratorKeyBefore = block?.getFirstChildOrThrow().getKey() ?? ''
    })
    expect(decoratorKeyBefore).not.toBe('')

    edit(network.a, () => {
      const root = $getRoot()
      root.getFirstChildOrThrow().insertBefore(root.getLastChildOrThrow())
    })
    network.settle()

    let decoratorKeyAfter = ''
    network.b.editor.getEditorState().read(() => {
      const block = $getRoot().getChildAtIndex<ElementNode>(0)
      decoratorKeyAfter = block?.getFirstChildOrThrow().getKey() ?? ''
    })
    // Same NodeKey on the RECEIVING peer ⇒ its mounted sub-app was never
    // disposed. This is the property the whole movable-list schema buys.
    expect(decoratorKeyAfter).toBe(decoratorKeyBefore)
    expectConverged(network)
    network.dispose()
  })

  it('concurrent block insertions at the same position converge', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['head', 'tail'])
    network.settle()

    edit(network.a, () => {
      $getRoot().getFirstChildOrThrow().insertAfter($createHeadingNode('h2'))
    })
    edit(network.b, () => {
      $getRoot()
        .getFirstChildOrThrow()
        .insertAfter($createParagraphNode().append($createTextNode('from b')))
    })
    network.settle()

    expectConverged(network)
    expect(blocks(network.a).length).toBe(4)
    network.dispose()
  })

  it('a long interleaved burst of edits across three peers converges', () => {
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2'])
    network.settle()

    for (let round = 0; round < 8; round++) {
      appendText(network.peer('a'), 0, `a${round}`)
      appendText(network.peer('b'), 1, `b${round}`)
      appendText(network.peer('c'), 2, `c${round}`)
      // Deliver in a different order each round.
      if (round % 2 === 0) network.settle()
    }
    network.settle()

    expectConverged(network)
    network.dispose()
  })

  it('does not echo: a settled network absorbs an edit in one delivery round', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['once'])
    network.settle()

    // From a quiescent network, ONE edit must take exactly one round to land:
    // `settle(2)` flushes once and then requires every inbox to be empty. A
    // binding that echoed a remote change back to its sender would still have
    // traffic in flight here and this would throw.
    appendText(network.a, 0, '!')
    network.settle(2)
    expectConverged(network)
    expect(blocks(network.b)).toEqual(['once!'])
    network.dispose()
  })

  it('converges under randomized concurrent editing (property test)', () => {
    // Hand-written cases test the shapes an author thought of. This one tests
    // the ones they did not: it drives three peers through 40 rounds of random
    // typing, block insertion, block deletion and block reordering, with random
    // delivery, and asserts only the property that must always hold. A seeded
    // PRNG keeps a failure reproducible.
    //
    // Raising ROUNDS is how you hunt for new bugs — it found several real ones
    // (see `to-loro.ts` `containerMatches`/`isTombstone`/`syncElement`'s `fresh`
    // flag, and `to-lexical.ts` `collectDirtyElements`/`liveChildren`).
    //
    // BEFORE YOU BLAME THIS PACKAGE for a divergence found that way, rule out
    // the two upstream `LoroMovableList` defects pinned in
    // `test/loro-upstream.test.ts` — a WASM panic AND a silent failure to
    // converge. Both need block MOVES. The triage that separates them: force a
    // full bidirectional snapshot exchange between the peers and compare
    // `doc.toJSON()`. If the DOCUMENTS still differ, the CRDT itself did not
    // converge and no binding-level change can fix it; only if the documents
    // agree while the EDITORS differ is the bug ours.
    //
    // ROUNDS is capped here because past ~100 rounds both upstream defects fire
    // routinely, which makes the test a flaky detector of somebody else's bug.
    // The deterministic, upstream-free regressions live in
    // `convergence-attack.test.ts`.
    const ROUNDS = 40
    let seed = 0x5eed
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
    network.settle()

    for (let round = 0; round < ROUNDS; round++) {
      const peer = pick(network.peers)
      const action = Math.floor(random() * 4)
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
          if ($isTextNode(text)) text.setTextContent(text.getTextContent() + round.toString(36))
          else block.append($createTextNode(round.toString(36)))
        } else if (action === 1) {
          block.insertAfter($createParagraphNode().append($createTextNode(`n${round}`)))
        } else if (action === 2 && size > 1) {
          block.remove()
        } else if (size > 1) {
          const other = root.getChildAtIndex(Math.floor(random() * size))
          if (other !== null && !other.is(block)) other.insertBefore(block)
        }
      })
      // Deliver to a random subset, so peers routinely edit from stale state.
      for (const other of network.peers) {
        if (random() < 0.5) other.flushInbox()
      }
    }

    network.settle()
    expectConverged(network)
    for (const peer of network.peers) peer.dispose()
  })

  it('disposing a binding stops it syncing', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['before dispose'])
    network.settle()
    network.b.dispose()
    appendText(network.a, 0, ' more')
    network.settle()
    expect(blocks(network.b)).toEqual(['before dispose'])
    network.dispose()
  })
})
