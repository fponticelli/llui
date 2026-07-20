/**
 * Tests for the convergence harness itself.
 *
 * The harness is the instrument every later sync test depends on, so it needs
 * its own calibration: a broken delay/reorder knob would make a real divergence
 * look like convergence. Document-level assertions run against raw Loro edits
 * (no binding attached yet — see `network.ts`).
 */
import { describe, expect, it } from 'vitest'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import type { LexicalEditor } from 'lexical'

import { ROOT_CONTAINER, type ElementContainer } from '../src/index.js'
import { appendElement, childTypes } from './children.js'
import {
  editorMarkdown,
  expectDocsConverged,
  expectEditorsConverged,
  isElementProjection,
  Network,
  projectEditor,
  type Peer,
} from './network.js'

/** The root element container of a peer's doc. */
const root = (peer: Peer): ElementContainer => peer.doc.getMap(ROOT_CONTAINER) as ElementContainer

/** Append a block of a given type and commit — one atomic local edit. */
const addBlock = (peer: Peer, type: string): void => {
  appendElement(root(peer), type)
  peer.doc.commit()
}

const blockTypes = (peer: Peer): string[] => childTypes(root(peer))

/** Seed an editor with paragraphs of plain text. */
const seedEditor = (editor: LexicalEditor, paragraphs: readonly string[]): void => {
  editor.update(
    () => {
      const rootNode = $getRoot().clear()
      for (const line of paragraphs) {
        rootNode.append($createParagraphNode().append($createTextNode(line)))
      }
    },
    { discrete: true },
  )
}

describe('delivery control', () => {
  it('does not apply updates until asked — edits stay local', () => {
    const network = new Network()
    addBlock(network.a, 'paragraph')

    expect(blockTypes(network.a)).toEqual(['paragraph'])
    expect(blockTypes(network.b)).toEqual([])
    expect(network.b.inbox).toHaveLength(1)

    network.settle()
    expect(blockTypes(network.b)).toEqual(['paragraph'])
    expectDocsConverged(network)
    network.dispose()
  })

  it('DELAYS delivery while the other peer keeps editing', () => {
    const network = new Network()
    addBlock(network.a, 'paragraph')
    // b never flushes, and edits on top of its stale state.
    addBlock(network.b, 'heading')
    addBlock(network.b, 'quote')
    expect(blockTypes(network.b)).toEqual(['heading', 'quote'])

    network.settle()
    expectDocsConverged(network)
    expect([...blockTypes(network.a)].sort()).toEqual(['heading', 'paragraph', 'quote'])
    network.dispose()
  })

  it('REORDERS delivery and still converges', () => {
    const network = new Network()
    addBlock(network.a, 'paragraph')
    addBlock(network.a, 'heading')
    addBlock(network.a, 'quote')
    expect(network.b.inbox).toHaveLength(3)

    network.b.flushInboxInOrder([2, 0, 1])
    expect(network.b.inbox).toHaveLength(0)
    expectDocsConverged(network)
    network.dispose()
  })

  it('supports PARTIAL delivery: omitted updates stay buffered', () => {
    const network = new Network()
    addBlock(network.a, 'paragraph')
    addBlock(network.a, 'heading')
    addBlock(network.a, 'quote')

    network.b.flushInboxInOrder([0])
    expect(network.b.inbox).toHaveLength(2)
    network.settle()
    expectDocsConverged(network)
    network.dispose()
  })

  it('rejects an invalid or duplicated delivery order', () => {
    const network = new Network()
    addBlock(network.a, 'paragraph')
    expect(() => network.b.flushInboxInOrder([5])).toThrow(/no inbox entry at index 5/)
    expect(() => network.b.flushInboxInOrder([0, 0])).toThrow(/delivered twice/)
    network.dispose()
  })
})

describe('offline and reconnect', () => {
  it('a disconnected peer receives nothing, then catches up on reconnect', () => {
    const network = new Network()
    network.disconnect('b')
    addBlock(network.a, 'paragraph')
    addBlock(network.a, 'heading')
    expect(network.b.inbox).toHaveLength(0)
    expect(blockTypes(network.b)).toEqual([])

    // b edits offline too — the classic split-brain.
    addBlock(network.b, 'quote')

    network.reconnect('b')
    network.settle()
    expectDocsConverged(network)
    expect([...blockTypes(network.a)].sort()).toEqual(['heading', 'paragraph', 'quote'])
    network.dispose()
  })
})

describe('convergence across more than two peers', () => {
  it('settles a three-peer network with interleaved edits', () => {
    const network = new Network({ names: ['a', 'b', 'c'] })
    addBlock(network.peer('a'), 'paragraph')
    addBlock(network.peer('b'), 'heading')
    addBlock(network.peer('c'), 'quote')
    addBlock(network.peer('a'), 'code')

    network.settle()
    expectDocsConverged(network)
    expect(blockTypes(network.peer('a'))).toHaveLength(4)
    network.dispose()
  })
})

describe('divergence reporting', () => {
  it('reports a document divergence with both peers spelled out', () => {
    const network = new Network()
    addBlock(network.a, 'paragraph')
    // Never deliver — the peers genuinely differ.
    expect(() => expectDocsConverged(network)).toThrow(
      /Loro documents diverged between 'a' and 'b'/,
    )
    network.dispose()
  })

  it('reports an editor divergence with MARKDOWN, so the failure is readable', () => {
    const network = new Network()
    seedEditor(network.a.editor, ['hello world'])
    seedEditor(network.b.editor, ['goodbye world'])

    let message = ''
    try {
      expectEditorsConverged(network)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/Editors diverged between 'a' and 'b'/)
    expect(message).toContain('hello world')
    expect(message).toContain('goodbye world')
    expect(message).toContain('(markdown)')
    expect(message).toContain('(projection)')
    network.dispose()
  })
})

describe('editor projection', () => {
  it('ignores NodeKeys, so identical content from separate editors compares equal', () => {
    // Two editors built independently hold completely different NodeKeys. If
    // the projection leaked them, every convergence assertion would fail.
    const network = new Network()
    seedEditor(network.a.editor, ['one', 'two'])
    seedEditor(network.b.editor, ['one', 'two'])
    expectEditorsConverged(network)
    network.dispose()
  })

  it('collapses adjacent TextNodes into one run child, matching the Loro schema', () => {
    const network = new Network()
    network.a.editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createTextNode('bo').setFormat(1),
              $createTextNode('ld').setFormat(1),
              $createTextNode(' plain'),
            ),
          )
      },
      { discrete: true },
    )

    const projection = projectEditor(network.a.editor)
    const paragraph = projection.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph === undefined || !isElementProjection(paragraph)) {
      throw new Error('expected an element projection')
    }
    // Three TextNodes, but only ONE text child — two runs inside it.
    expect(paragraph.children).toHaveLength(1)
    expect(paragraph.children[0]).toEqual({
      type: '#text',
      runs: [
        { text: 'bold', format: 1 },
        { text: ' plain', format: 0 },
      ],
    })
    network.dispose()
  })

  it('distinguishes content that really differs', () => {
    const network = new Network()
    seedEditor(network.a.editor, ['one'])
    seedEditor(network.b.editor, ['two'])
    expect(() => expectEditorsConverged(network)).toThrow(/Editors diverged/)
    network.dispose()
  })

  it('distinguishes differing FORMAT on identical text', () => {
    const network = new Network()
    const build = (editor: LexicalEditor, format: number): void => {
      editor.update(
        () => {
          $getRoot()
            .clear()
            .append($createParagraphNode().append($createTextNode('same').setFormat(format)))
        },
        { discrete: true },
      )
    }
    build(network.a.editor, 0)
    build(network.b.editor, 1)
    expect(() => expectEditorsConverged(network)).toThrow(/Editors diverged/)
    network.dispose()
  })

  it('renders markdown for the report', () => {
    const network = new Network()
    seedEditor(network.a.editor, ['alpha', 'beta'])
    expect(editorMarkdown(network.a.editor)).toBe('alpha\n\nbeta')
    network.dispose()
  })
})

describe('settle', () => {
  it('is a no-op when nothing is pending', () => {
    const network = new Network()
    expect(() => network.settle()).not.toThrow()
    network.dispose()
  })

  it('fails loudly if updates never stop echoing', () => {
    // Guards the failure mode where a future binding re-broadcasts what it
    // receives: without this the test suite would hang instead of failing.
    // Simulated at the seam where it would really occur — applying an inbound
    // update produces a fresh local update, forever.
    const network = new Network()
    const peer = network.b
    const applyInbound = peer.flushInbox.bind(peer)
    peer.flushInbox = (): void => {
      applyInbound()
      addBlock(peer, 'paragraph')
    }
    addBlock(network.a, 'paragraph')
    expect(() => network.settle(5)).toThrow(/did not settle within 5 rounds/)
    network.dispose()
  })
})
