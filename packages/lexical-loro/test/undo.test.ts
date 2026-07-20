/**
 * CRDT-aware undo: `LoroCollab.externalUndo` over Loro's `UndoManager`.
 *
 * The question this file exists to answer is the one snapshot-based history
 * cannot pass (see the contrast tests in `harden.test.ts`, which pin what
 * `@lexical/history` does instead): does undo revert THIS peer's last change and
 * ONLY this peer's, leaving a concurrent remote edit standing, while every peer
 * still converges?
 *
 * Every test drives the REAL binding through the two-peer network in
 * `network.ts`, dispatching Lexical's `UNDO_COMMAND` exactly as a toolbar or a
 * keystroke would — never `manager.undo()` directly — so the command wiring is
 * under test alongside the algorithm.
 *
 * `mergeInterval: 0` throughout: Loro's default 1000 ms window would fold every
 * edit a synchronous test makes into ONE undo step, and a test that cannot say
 * "undo exactly the last thing" is not testing undo.
 */

import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  REDO_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type LexicalEditor,
} from 'lexical'
import { $createHeadingNode, HeadingNode, QuoteNode } from '@lexical/rich-text'

import { loroCollab, LORO_UNDO_ORIGIN, UNDO_ORIGINS } from '../src/index.js'
import { expectConverged, Network, type Peer } from './network.js'

const NODES = [HeadingNode, QuoteNode]

/** A network whose peers run the real binding AND its undo owner. */
function undoNetwork(names?: readonly string[]): Network {
  return new Network({
    ...(names ? { names } : {}),
    nodes: NODES,
    bind: (editor, doc) => {
      const collab = loroCollab({ doc, shouldBootstrap: false, undo: { mergeInterval: 0 } })
      const disposeSync = collab.register(editor)
      // Registration order mirrors `lexicalForeign`: `register` (which
      // bootstraps) first, then `externalUndo` — so the seed is never on the
      // undo stack.
      const disposeUndo = collab.externalUndo(editor)
      return {
        dispose: () => {
          disposeUndo()
          disposeSync()
        },
      }
    },
  })
}

function edit(peer: Peer, fn: () => void): void {
  peer.editor.update(fn, { discrete: true })
}

function setParagraphs(peer: Peer, texts: readonly string[]): void {
  edit(peer, () => {
    const root = $getRoot()
    root.clear()
    for (const text of texts) root.append($createParagraphNode().append($createTextNode(text)))
  })
}

/** The text of every top-level block, in rendered order. */
function blocks(peer: Peer): string[] {
  const out: string[] = []
  peer.editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) out.push(child.getTextContent())
  })
  return out
}

/** The Lexical type of every top-level block, in rendered order. */
function blockTypes(peer: Peer): string[] {
  const out: string[] = []
  peer.editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) out.push(child.getType())
  })
  return out
}

/** The format bitmask of the first TextNode in the Nth block. */
function formatAt(peer: Peer, blockIndex: number): number {
  let format = -1
  peer.editor.getEditorState().read(() => {
    const block = $getRoot().getChildAtIndex<ElementNode>(blockIndex)
    const text = block?.getFirstChild()
    if (text != null && $isTextNode(text)) format = text.getFormat()
  })
  return format
}

/** Append `suffix` to the first TextNode of the Nth block. */
function appendText(peer: Peer, blockIndex: number, suffix: string): void {
  edit(peer, () => {
    const block = $getRoot().getChildAtIndex<ElementNode>(blockIndex)
    const text = block?.getFirstChild()
    if (text == null || !$isTextNode(text)) throw new Error(`no text in block ${blockIndex}`)
    text.setTextContent(text.getTextContent() + suffix)
  })
}

/**
 * Move the top-level block at `from` to rendered index `to` via `insertBefore` /
 * `insertAfter` on an ATTACHED node, so the NodeKey — and the mapped
 * ContainerID — survive. That is what makes this ONE `pos` register write in
 * Loro rather than a delete plus an insert; see `order.ts`.
 */
function moveBlock(peer: Peer, from: number, to: number): void {
  edit(peer, () => {
    const root = $getRoot()
    const node = root.getChildAtIndex(from)
    if (node === null) throw new Error(`no block at ${from}`)
    const others = root.getChildren().filter((child) => !child.is(node))
    const anchor = others[Math.max(0, Math.min(to, others.length - 1))]
    if (anchor === undefined || anchor.is(node)) return
    if (to <= 0) anchor.insertBefore(node)
    else anchor.insertAfter(node)
  })
}

function undo(peer: Peer): void {
  peer.editor.dispatchCommand(UNDO_COMMAND, undefined)
}

function redo(peer: Peer): void {
  peer.editor.dispatchCommand(REDO_COMMAND, undefined)
}

/** Put the caret in the first TextNode of the Nth block, at `offset`. */
function setCaret(peer: Peer, blockIndex: number, offset: number): void {
  edit(peer, () => {
    const block = $getRoot().getChildAtIndex<ElementNode>(blockIndex)
    const text = block?.getFirstChild()
    if (text == null || !$isTextNode(text)) throw new Error(`no text in block ${blockIndex}`)
    const selection = $createRangeSelection()
    selection.anchor.set(text.getKey(), offset, 'text')
    selection.focus.set(text.getKey(), offset, 'text')
    $setSelection(selection)
  })
}

interface Caret {
  readonly key: string
  readonly offset: number
  readonly text: string
  /** Whether the node the caret addresses is still in the tree. */
  readonly attached: boolean
}

function readCaret(peer: Peer): Caret | null {
  let caret: Caret | null = null
  peer.editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const node = selection.anchor.getNode()
    caret = {
      key: node.getKey(),
      offset: selection.anchor.offset,
      text: node.getTextContent(),
      attached: node.isAttached(),
    }
  })
  return caret
}

/** Record every CAN_UNDO / CAN_REDO the binding publishes. */
function watchStack(editor: LexicalEditor): {
  canUndo: boolean
  canRedo: boolean
  dispose(): void
} {
  const state = { canUndo: false, canRedo: false, dispose: (): void => {} }
  const undoOff = editor.registerCommand(
    CAN_UNDO_COMMAND,
    (payload: boolean) => {
      state.canUndo = payload
      return false
    },
    COMMAND_PRIORITY_LOW,
  )
  const redoOff = editor.registerCommand(
    CAN_REDO_COMMAND,
    (payload: boolean) => {
      state.canRedo = payload
      return false
    },
    COMMAND_PRIORITY_LOW,
  )
  state.dispose = () => {
    redoOff()
    undoOff()
  }
  return state
}

// ---------------------------------------------------------------------------
// The five operation kinds
// ---------------------------------------------------------------------------

describe('undo — the operation kinds', () => {
  it('undoes and redoes a TEXT EDIT, on every peer', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['alpha', 'beta'])
    network.settle()

    appendText(network.a, 0, '!!')
    network.settle()
    expect(blocks(network.a)).toEqual(['alpha!!', 'beta'])
    expect(blocks(network.b)).toEqual(['alpha!!', 'beta'])

    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['alpha', 'beta'])
    expect(blocks(network.b)).toEqual(['alpha', 'beta'])
    expectConverged(network)

    redo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['alpha!!', 'beta'])
    expect(blocks(network.b)).toEqual(['alpha!!', 'beta'])
    expectConverged(network)

    network.dispose()
  })

  it('undoes a BLOCK MOVE — one `pos` write — restoring the previous order', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    moveBlock(network.a, 2, 0)
    network.settle()
    expect(blocks(network.a)).toEqual(['three', 'one', 'two'])
    expect(blocks(network.b)).toEqual(['three', 'one', 'two'])

    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['one', 'two', 'three'])
    expect(blocks(network.b)).toEqual(['one', 'two', 'three'])
    expectConverged(network)

    redo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['three', 'one', 'two'])
    expectConverged(network)

    network.dispose()
  })

  it('undoes a BLOCK INSERT, removing it everywhere', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['one', 'two'])
    network.settle()

    edit(network.a, () => {
      $getRoot().append($createHeadingNode('h2').append($createTextNode('added')))
    })
    network.settle()
    expect(blocks(network.a)).toEqual(['one', 'two', 'added'])
    expect(blockTypes(network.b)).toEqual(['paragraph', 'paragraph', 'heading'])

    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['one', 'two'])
    expect(blocks(network.b)).toEqual(['one', 'two'])
    expectConverged(network)

    network.dispose()
  })

  it('undoes a BLOCK DELETE, restoring the block, its text and its position', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    network.settle()
    expect(blocks(network.a)).toEqual(['one', 'three'])

    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['one', 'two', 'three'])
    expect(blocks(network.b)).toEqual(['one', 'two', 'three'])
    expectConverged(network)

    network.dispose()
  })

  it('undoes a FORMAT CHANGE without disturbing the text', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['styled'])
    network.settle()
    expect(formatAt(network.a, 0)).toBe(0)

    // Applied on the node directly: the raw network editor has no rich-text, so
    // FORMAT_TEXT_COMMAND has no handler. What matters for undo is the resulting
    // `format` write, however it was produced.
    edit(network.a, () => {
      const block = $getRoot().getChildAtIndex<ElementNode>(0)
      const text = block?.getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('no text')
      text.toggleFormat('bold')
    })
    network.settle()
    const bold = formatAt(network.a, 0)
    expect(bold).not.toBe(0)
    expect(formatAt(network.b, 0)).toBe(bold)

    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['styled'])
    expect(formatAt(network.a, 0)).toBe(0)
    expect(formatAt(network.b, 0)).toBe(0)
    expectConverged(network)

    network.dispose()
  })
})

// ---------------------------------------------------------------------------
// The property snapshot history cannot hold
// ---------------------------------------------------------------------------

describe('undo — local scope', () => {
  it("undoing does NOT revert a peer's concurrent edit", () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['alpha', 'beta'])
    network.settle()

    // A edits block 0; B edits block 1. Both land everywhere.
    appendText(network.a, 0, '-A')
    network.settle()
    appendText(network.b, 1, '-B')
    network.settle()
    expect(blocks(network.a)).toEqual(['alpha-A', 'beta-B'])

    // A undoes. Only A's own edit may disappear.
    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['alpha', 'beta-B'])
    expect(blocks(network.b)).toEqual(['alpha', 'beta-B'])
    expectConverged(network)

    network.dispose()
  })

  it('undoing after a remote edit to the SAME block keeps the remote text', () => {
    // The hardest local-scope case: both peers wrote into one run, so an
    // operation-based undo must remove exactly A's characters and leave B's.
    const network = undoNetwork()
    setParagraphs(network.a, ['base'])
    network.settle()

    appendText(network.a, 0, 'AAA')
    network.settle()
    appendText(network.b, 0, 'BBB')
    network.settle()
    expect(blocks(network.a)).toEqual(['baseAAABBB'])

    undo(network.a)
    network.settle()
    expect(blocks(network.a)).toEqual(['baseBBB'])
    expect(blocks(network.b)).toEqual(['baseBBB'])
    expectConverged(network)

    network.dispose()
  })

  it('a peer that made no local change has NOTHING to undo', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['only A wrote this'])
    network.settle()

    const stack = watchStack(network.b.editor)
    // B's manager saw only imported changes, so its stack is empty and pressing
    // undo is inert — it must not rewind A's work.
    expect(stack.canUndo).toBe(false)
    undo(network.b)
    network.settle()
    expect(blocks(network.b)).toEqual(['only A wrote this'])
    expect(blocks(network.a)).toEqual(['only A wrote this'])
    expectConverged(network)

    stack.dispose()
    network.dispose()
  })

  it('undoing a move CONCURRENT with a remote move still converges', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    moveBlock(network.a, 0, 2)
    network.settle()

    network.disconnect('b')
    undo(network.a)
    moveBlock(network.b, 2, 0)
    network.reconnect('b')
    network.settle()

    expectConverged(network)
    expect(blocks(network.a).slice().sort()).toEqual(['one', 'three', 'two'])

    network.dispose()
  })
})

// ---------------------------------------------------------------------------
// Toolbar enablement
// ---------------------------------------------------------------------------

describe('undo — CAN_UNDO / CAN_REDO', () => {
  it('publishes the stack state at registration and after every transition', () => {
    const network = undoNetwork()
    const stack = watchStack(network.a.editor)

    // Registration published `false` for both; a fresh watcher has to ask for it
    // again, which the first local commit does.
    setParagraphs(network.a, ['alpha'])
    network.settle()
    expect(stack.canUndo).toBe(true)
    expect(stack.canRedo).toBe(false)

    undo(network.a)
    network.settle()
    expect(stack.canRedo).toBe(true)

    redo(network.a)
    network.settle()
    expect(stack.canRedo).toBe(false)
    expect(stack.canUndo).toBe(true)

    stack.dispose()
    network.dispose()
  })

  it('publishes `false`/`false` at registration, before any edit', () => {
    const doc = new Network({ names: ['solo'], nodes: NODES }).peers[0]!
    const collab = loroCollab({ doc: doc.doc, shouldBootstrap: false, undo: { mergeInterval: 0 } })
    const disposeSync = collab.register(doc.editor)
    const stack = watchStack(doc.editor)
    const disposeUndo = collab.externalUndo(doc.editor)

    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)

    stack.dispose()
    disposeUndo()
    disposeSync()
  })
})

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('undo — selection', () => {
  it('leaves the caret in a LIVE node after undoing a text edit', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['alpha', 'beta'])
    network.settle()

    setCaret(network.a, 0, 5)
    appendText(network.a, 0, 'XYZ')
    setCaret(network.a, 0, 8)

    undo(network.a)
    network.settle()

    const caret = readCaret(network.a)
    expect(caret).not.toBeNull()
    expect(caret?.attached).toBe(true)
    expect(caret?.text).toBe('alpha')
    // Clamped into the shortened run rather than left past its end.
    expect(caret?.offset).toBeLessThanOrEqual(5)

    network.dispose()
  })

  it('leaves a LIVE caret after undoing an insert that removes the caret node', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['keep'])
    network.settle()

    edit(network.a, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('doomed')))
    })
    setCaret(network.a, 1, 3)

    undo(network.a)
    network.settle()

    expect(blocks(network.a)).toEqual(['keep'])
    const caret = readCaret(network.a)
    // Either the selection was dropped outright or it points somewhere live —
    // never at a detached node, which is what makes the next keystroke throw.
    if (caret !== null) expect(caret.attached).toBe(true)

    network.dispose()
  })

  it('does not disturb the caret of a peer that did not undo', () => {
    const network = undoNetwork()
    setParagraphs(network.a, ['alpha', 'beta'])
    network.settle()

    setCaret(network.b, 1, 2)
    const before = readCaret(network.b)

    appendText(network.a, 0, '!')
    network.settle()
    undo(network.a)
    network.settle()

    const after = readCaret(network.b)
    expect(after?.key).toBe(before?.key)
    expect(after?.offset).toBe(before?.offset)

    network.dispose()
  })
})

// ---------------------------------------------------------------------------
// The echo seam
// ---------------------------------------------------------------------------

describe('undo — the echo seam', () => {
  it('undo batches carry the origin the inbound path is told to apply', () => {
    // Pins the coupling `undo.ts` documents: if Loro ever renamed the origin it
    // stamps on undo commits, echo layer (a) would silently swallow every undo
    // and the editor would drift behind its own document.
    expect(UNDO_ORIGINS).toContain(LORO_UNDO_ORIGIN)

    const network = undoNetwork()
    setParagraphs(network.a, ['alpha'])
    network.settle()

    const origins: (string | undefined)[] = []
    network.a.doc.subscribe((batch) => {
      if (batch.by === 'local') origins.push(batch.origin)
    })

    appendText(network.a, 0, '!')
    undo(network.a)
    network.settle()

    expect(origins).toContain(LORO_UNDO_ORIGIN)
    expect(blocks(network.a)).toEqual(['alpha'])

    network.dispose()
  })

  it('an undo does not re-enter the outbound sync (the network settles)', () => {
    // `settle()` throws if updates keep echoing, so this is the loop guard: the
    // inbound writeback carries COLLABORATION_TAG and produces no new commit.
    const network = undoNetwork()
    setParagraphs(network.a, ['alpha'])
    network.settle()
    appendText(network.a, 0, '!')
    undo(network.a)
    redo(network.a)
    undo(network.a)
    expect(() => network.settle()).not.toThrow()
    expectConverged(network)

    network.dispose()
  })
})

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

describe('undo — bootstrap', () => {
  it('the boot-time seed is NOT on the undo stack', () => {
    // `lexicalForeign` registers `register` (which bootstraps) before
    // `externalUndo`; the manager is constructed at that second call, so the
    // seed's commit is behind it. A first undo that emptied a freshly seeded
    // document would be the most visible possible bug.
    const network = new Network({
      nodes: NODES,
      bind: (editor, doc) => {
        const collab = loroCollab({
          doc,
          shouldBootstrap: true,
          undo: { mergeInterval: 0 },
          seed: () => {
            $getRoot()
              .clear()
              .append($createParagraphNode().append($createTextNode('seeded')))
          },
        })
        const disposeSync = collab.register(editor)
        const disposeUndo = collab.externalUndo(editor)
        return {
          dispose: () => {
            disposeUndo()
            disposeSync()
          },
        }
      },
    })

    expect(blocks(network.a)).toEqual(['seeded'])
    undo(network.a)
    expect(blocks(network.a)).toEqual(['seeded'])

    network.dispose()
  })
})
