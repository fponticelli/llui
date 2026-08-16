/**
 * Hardening: the three questions the ordering spikes could NOT answer, plus the
 * attacks that only become expressible once `pos` is a register write.
 *
 * The spikes proved the ORDERING MODEL converges. They ran below the editor, so
 * three things stayed open, and each is load-bearing for a real user:
 *
 *  a. UNDO. These tests attach Lexical's LOCAL `@lexical/history` explicitly
 *     (`withHistory`) — NOT the binding's own undo. That is deliberate: they ask
 *     what snapshot-based history does over this schema (history restores a
 *     previous EDITOR STATE, which the outbound sync reconciles into `pos`
 *     writes), and the last one pins WHY it is not collaboration-safe — the exact
 *     failure the real, CRDT-aware owner in `undo.ts` (tested in `undo.test.ts`)
 *     exists to avoid. The binding's shipped undo does NOT use this path.
 *  b. SELECTION. Keeping `ContainerID`s — and therefore `NodeKey`s — stable
 *     across a remote reorder is the WHOLE REASON this schema exists. If the
 *     caret still dies when a peer moves the block it is sitting in, the
 *     architecture bought nothing.
 *  c. COST AT SCALE. The spike measured the SORT. It never measured what a
 *     `pos` string costs on the wire after a long editing life, nor what a
 *     `LoroMap` of thousands of carriers costs to import and project.
 *
 * Where a concurrent conflict has no single right answer, these tests assert
 * the property that must hold regardless: every peer agrees, the tree is
 * well-formed, and no peer-local state leaked into the projection.
 */

import { describe, expect, it } from 'vitest'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
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
  type LexicalNode,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from '@lexical/list'
import { LLuiDecoratorNode } from '@llui/lexical'

import { LoroDoc, type VersionVector } from 'loro-crdt'

import {
  allocateAt,
  createElementChild,
  elementChildren,
  initDoc,
  LORO_TEXT_FORMATS,
  loroCollab,
  newUuid,
  orderedChildren,
  type ChildrenContainer,
  type ElementContainer,
} from '../src/index.js'
import { appendElement, appendText, moveChild } from './children.js'
import { expectConverged, Network, projectEditor, type Peer } from './network.js'

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

/** The text of every top-level block, in rendered order. */
function blocks(peer: Peer): string[] {
  const out: string[] = []
  peer.editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) out.push(child.getTextContent())
  })
  return out
}

/**
 * Move the top-level block at `from` to rendered index `to`, the way a real
 * drag-reorder does: `insertAfter`/`insertBefore` on an ALREADY-ATTACHED node
 * relocates it, so the `NodeKey` — and therefore the mapped `ContainerID` — is
 * preserved. Removing and re-appending would mint a new key and quietly test
 * something else entirely.
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

/** Attach Lexical's local history to a peer, as a host with undo would. */
function withHistory(peer: Peer): () => void {
  return registerHistory(peer.editor, createEmptyHistoryState(), 0)
}

/**
 * Undo/redo on a peer, then FLUSH.
 *
 * The flush is not ceremony. `@lexical/history` applies an undo with
 * `editor.setEditorState(...)`, which does NOT commit synchronously on a
 * headless editor — immediately after `dispatchCommand` the editor still reads
 * as its pre-undo state, and therefore so does our outbound sync. Verified
 * against plain Lexical 0.48 with no binding attached, so it is upstream
 * behaviour, not something this package introduces.
 *
 * A discrete no-op update forces the pending commit through. Without it, every
 * assertion below would silently observe the state BEFORE the undo and a broken
 * binding would look perfectly healthy.
 */
function flush(peer: Peer): void {
  peer.editor.update(() => {}, { discrete: true })
}

function undo(peer: Peer): void {
  peer.editor.dispatchCommand(UNDO_COMMAND, undefined)
  flush(peer)
}

function redo(peer: Peer): void {
  peer.editor.dispatchCommand(REDO_COMMAND, undefined)
  flush(peer)
}

function expectWellFormed(peer: Peer): void {
  peer.editor.getEditorState().read(() => {
    const visit = (node: LexicalNode, depth: number): void => {
      if (depth > 50) throw new Error(`${peer.name}: tree deeper than 50 — probable cycle`)
      if (!$isElementNode(node)) return
      for (const [index, child] of node.getChildren().entries()) {
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

/**
 * Put the caret in the first TextNode of the Nth top-level block, at `offset`.
 *
 * Written as an explicit `RangeSelection` rather than via `node.select()` so the
 * test states exactly which node and offset it means, and so a later assertion
 * comparing NodeKeys is comparing against something the test chose.
 */
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
  /** The NodeKey the caret sits in — the thing that must stay stable. */
  readonly key: string
  readonly offset: number
  /** The text of the node the caret is in, so a stable-but-wrong key is caught. */
  readonly text: string
  /** The rendered index of the top-level block containing the caret. */
  readonly blockIndex: number
}

/** Read the caret back, or `null` if the selection was lost entirely. */
function readCaret(peer: Peer): Caret | null {
  let caret: Caret | null = null
  peer.editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const node = selection.anchor.getNode()
    const top = node.getTopLevelElement()
    caret = {
      key: node.getKey(),
      offset: selection.anchor.offset,
      text: node.getTextContent(),
      blockIndex: top === null ? -1 : top.getIndexWithinParent(),
    }
  })
  return caret
}

// ---------------------------------------------------------------------------
// (a) Undo / redo against `pos` register writes
// ---------------------------------------------------------------------------

describe('hardening — undo and redo of a move', () => {
  it('undoing a local move restores the previous order on EVERY peer', () => {
    // The core question. Lexical's history restores a previous editor state; the
    // outbound sync sees a reordered child list and must translate it back into
    // `pos` writes. Nothing guarantees that a priori — history replays STATE, and
    // the binding has to re-derive the ops.
    const network = collabNetwork()
    const dispose = withHistory(network.a)
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    moveBlock(network.a, 0, 2)
    network.settle()
    expect(blocks(network.a)).toEqual(['two', 'three', 'one'])
    expect(blocks(network.b)).toEqual(['two', 'three', 'one'])

    undo(network.a)
    network.settle()

    expect(blocks(network.a)).toEqual(['one', 'two', 'three'])
    expect(blocks(network.b)).toEqual(['one', 'two', 'three'])
    expectConverged(network)
    dispose()
    network.dispose()
  })

  it('redo re-applies the move on every peer', () => {
    const network = collabNetwork()
    const dispose = withHistory(network.a)
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    moveBlock(network.a, 0, 2)
    network.settle()
    undo(network.a)
    network.settle()
    redo(network.a)
    network.settle()

    expect(blocks(network.a)).toEqual(['two', 'three', 'one'])
    expect(blocks(network.b)).toEqual(['two', 'three', 'one'])
    expectConverged(network)
    dispose()
    network.dispose()
  })

  it('a REMOTE move is not undoable locally — undo only owns local intent', () => {
    // The property that keeps collaborative undo sane: peer B pressing undo must
    // not revert peer A's move. Lexical's history records local editor states,
    // and our inbound writeback carries COLLABORATION_TAG, so B's history must
    // have nothing to pop. If this ever fails, undo has become a cross-peer
    // weapon — one user silently reverting another's work.
    const network = collabNetwork()
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()
    // Registered AFTER the seed so B's history starts empty and clean.
    const dispose = withHistory(network.b)

    moveBlock(network.a, 0, 2)
    network.settle()
    expect(blocks(network.b)).toEqual(['two', 'three', 'one'])

    undo(network.b)
    network.settle()

    expect(blocks(network.b)).toEqual(['two', 'three', 'one'])
    expectConverged(network)
    dispose()
    network.dispose()
  })

  it('undoing a move CONCURRENT with a remote move converges on all peers', () => {
    // Undo is just another `pos` write, so it races a remote `pos` write on the
    // same carrier and last-writer-wins picks one. There is no single correct
    // order here — the assertion is that all peers agree and nothing is lost or
    // duplicated, which is the only property that can hold.
    const network = collabNetwork()
    const dispose = withHistory(network.a)
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    moveBlock(network.a, 0, 2)
    network.settle()

    // Both peers act from the same state, neither seeing the other.
    undo(network.a)
    moveBlock(network.b, 0, 1)
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    // Whatever order won, every block survives exactly once: a `pos` race
    // reorders, it never deletes or duplicates.
    expect([...blocks(network.a)].sort()).toEqual(['one', 'three', 'two'])
    dispose()
    network.dispose()
  })

  it('undoing a block DELETE restores the block and its position', () => {
    // Delete+undo is the harshest case for the carrier schema: the undone block
    // is RECREATED with a fresh uuid (its carrier is gone for good), so this
    // exercises allocation against the surviving neighbours rather than a
    // register write. It must land back in the middle, not at an end.
    const network = collabNetwork()
    const dispose = withHistory(network.a)
    setParagraphs(network.a, ['one', 'two', 'three'])
    network.settle()

    edit(network.a, () => {
      $getRoot().getChildAtIndex(1)?.remove()
    })
    network.settle()
    expect(blocks(network.b)).toEqual(['one', 'three'])

    undo(network.a)
    network.settle()

    expect(blocks(network.a)).toEqual(['one', 'two', 'three'])
    expect(blocks(network.b)).toEqual(['one', 'two', 'three'])
    expectConverged(network)
    dispose()
    network.dispose()
  })

  it('WHY snapshot history is not used: @lexical/history undo rewinds a remote edit', () => {
    // ── The contrast test — this is NOT the binding's shipped undo ───────────
    //
    // The binding OWNS undo via `LoroCollab.externalUndo` (a CRDT-aware Loro
    // `UndoManager`, tested in `undo.test.ts`). This test attaches Lexical's
    // LOCAL `@lexical/history` INSTEAD, to pin why that owner had to exist —
    // i.e. what a host would get wrong by re-enabling the built-in stack.
    //
    // `@lexical/history` is SNAPSHOT-based: each entry is a whole `EditorState`,
    // and `undo` re-applies one with `editor.setEditorState`. It has NO notion of
    // COLLABORATION_TAG — verified by reading its 0.48 source, which never
    // mentions it — so our inbound writeback arrives with dirty nodes, is
    // classified HISTORY_PUSH, and is recorded as if the local user had made it.
    //
    // The consequence, pinned below: undoing after a remote edit rewinds to a
    // snapshot that PREDATES that edit, so the remote block disappears from the
    // undoing peer — and, because the outbound sync faithfully replays that
    // snapshot, it is then deleted for EVERYONE. The peer's own local append
    // survives, which is precisely backwards from user intent.
    //
    // Tagging the writeback HISTORY_MERGE_TAG does NOT fix it: the defect is
    // snapshot-vs-operation, not tagging, so no tag choice can resolve it — which
    // is exactly why the operation-based Loro `UndoManager` is the shipped owner.
    // `undo.test.ts` proves the same scenario keeps the remote edit under it.
    //
    // What this test defends is that even the WRONG choice stays CONVERGENT and
    // well-formed: every peer agrees on the (regrettable) outcome, no block is
    // duplicated, nothing is corrupted. Divergence would be a far worse bug.
    const network = collabNetwork()
    const dispose = withHistory(network.a)
    setParagraphs(network.a, ['one', 'two'])
    network.settle()

    edit(network.a, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('a-local')))
    })
    network.settle()

    edit(network.b, () => {
      $getRoot().append($createParagraphNode().append($createTextNode('b-remote')))
    })
    network.settle()
    expect(blocks(network.a)).toEqual(['one', 'two', 'a-local', 'b-remote'])

    undo(network.a)
    network.settle()

    // The ACTUAL behaviour, asserted so a future undo manager has a red test to
    // turn green: the remote block is what got rewound. The desirable outcome is
    // ['one', 'two', 'b-remote'].
    expect(blocks(network.a)).toEqual(['one', 'two', 'a-local'])
    // …but it converged, which is the property that must hold either way.
    expect(blocks(network.b)).toEqual(['one', 'two', 'a-local'])
    expectConverged(network)
    expectAllWellFormed(network)
    dispose()
    network.dispose()
  })

  it('reports undo/redo availability through the normal Lexical commands', () => {
    // Guards the host-facing contract: a toolbar's enabled/disabled state comes
    // from these commands, and a binding that bypassed the editor's update cycle
    // would leave them silently stuck.
    const network = collabNetwork()
    const dispose = withHistory(network.a)
    let canUndo = false
    let canRedo = false
    const offUndo = network.a.editor.registerCommand(
      CAN_UNDO_COMMAND,
      (payload: boolean) => {
        canUndo = payload
        return false
      },
      COMMAND_PRIORITY_LOW,
    )
    const offRedo = network.a.editor.registerCommand(
      CAN_REDO_COMMAND,
      (payload: boolean) => {
        canRedo = payload
        return false
      },
      COMMAND_PRIORITY_LOW,
    )

    setParagraphs(network.a, ['one', 'two'])
    network.settle()
    moveBlock(network.a, 0, 1)
    network.settle()
    expect(canUndo).toBe(true)

    undo(network.a)
    network.settle()
    expect(canRedo).toBe(true)

    offUndo()
    offRedo()
    dispose()
    network.dispose()
  })
})

// ---------------------------------------------------------------------------
// (b) Caret / selection stability across a REMOTE move
// ---------------------------------------------------------------------------

describe('hardening — selection survives a remote reorder', () => {
  it('keeps the caret in the SAME NodeKey when a remote peer moves that block', () => {
    // This is the architecture's reason for existing, stated as a test.
    //
    // A move is one `pos` register write, so the moved carrier and its LoroText
    // keep their ContainerIDs; `mapping.ts` therefore resolves them to the SAME
    // NodeKeys, and the inbound walk reorders the existing nodes instead of
    // rebuilding them. If the binding ever regressed to delete+recreate, the
    // NodeKey would change, the caret would be pointing at a removed node, and
    // this assertion is what would catch it — `blocks()` alone would not, since
    // the TEXT would look perfectly correct either way.
    const network = collabNetwork()
    setParagraphs(network.a, ['alpha', 'bravo', 'charlie'])
    network.settle()

    setCaret(network.a, 1, 3)
    const before = readCaret(network.a)
    expect(before).not.toBeNull()
    expect(before?.text).toBe('bravo')
    expect(before?.blockIndex).toBe(1)

    // B moves the block A's caret is inside, from index 1 to the end.
    moveBlock(network.b, 1, 2)
    network.settle()

    expect(blocks(network.a)).toEqual(['alpha', 'charlie', 'bravo'])
    const after = readCaret(network.a)
    expect(after).not.toBeNull()
    // Same node, same offset — the caret rode along with the block.
    expect(after?.key).toBe(before?.key)
    expect(after?.offset).toBe(3)
    expect(after?.text).toBe('bravo')
    // …and it followed the block to its new rendered position.
    expect(after?.blockIndex).toBe(2)
    expectConverged(network)
    network.dispose()
  })

  it('leaves the caret untouched when a remote peer moves a DIFFERENT block', () => {
    // The cheap case, and the one a naive implementation breaks: reordering
    // siblings must not disturb a caret in an unrelated block. A binding that
    // rebuilt the whole child list on any structural event would fail here.
    const network = collabNetwork()
    setParagraphs(network.a, ['alpha', 'bravo', 'charlie'])
    network.settle()

    setCaret(network.a, 0, 2)
    const before = readCaret(network.a)

    moveBlock(network.b, 1, 2)
    network.settle()

    const after = readCaret(network.a)
    expect(after?.key).toBe(before?.key)
    expect(after?.offset).toBe(2)
    expect(after?.text).toBe('alpha')
    expect(after?.blockIndex).toBe(0)
    expectConverged(network)
    network.dispose()
  })

  it('survives a remote move of a block nested inside a list', () => {
    // Depth matters: the inbound walk marks the whole root→container path dirty,
    // so a nested move touches more of the tree than a top-level one and has
    // more opportunity to rebuild something it should have reused.
    const network = collabNetwork()
    edit(network.a, () => {
      const root = $getRoot()
      root.clear()
      const list = $createListNode('bullet')
      for (const label of ['first', 'second', 'third']) {
        list.append($createListItemNode().append($createTextNode(label)))
      }
      root.append(list)
    })
    network.settle()

    // Caret into the second list item.
    edit(network.a, () => {
      const list = $getRoot().getFirstChildOrThrow<ElementNode>()
      const item = list.getChildAtIndex<ElementNode>(1)
      const text = item?.getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('no text in list item')
      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 2, 'text')
      selection.focus.set(text.getKey(), 2, 'text')
      $setSelection(selection)
    })
    const before = readCaret(network.a)
    expect(before?.text).toBe('second')

    // B moves that list item to the front.
    edit(network.b, () => {
      const list = $getRoot().getFirstChildOrThrow<ElementNode>()
      const item = list.getChildAtIndex(1)
      const first = list.getChildAtIndex(0)
      if (item === null || first === null) throw new Error('missing list items')
      first.insertBefore(item)
    })
    network.settle()

    const after = readCaret(network.a)
    expect(after?.key).toBe(before?.key)
    expect(after?.offset).toBe(2)
    expect(after?.text).toBe('second')
    expectConverged(network)
    network.dispose()
  })

  it('shifts the caret correctly when a remote insert lands BEFORE it in the same run', () => {
    // The one case the schema cannot solve by stability alone: the remote edit is
    // inside the very run holding the caret, so the offset itself has to be
    // transformed. Documented in `to-lexical.ts` as the single-region diff.
    const network = collabNetwork()
    setParagraphs(network.a, ['abcdef'])
    network.settle()

    setCaret(network.a, 0, 4)
    const before = readCaret(network.a)

    // B inserts 'XY' at offset 1, ahead of A's caret.
    edit(network.b, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('no text')
      text.setTextContent('aXYbcdef')
    })
    network.settle()

    const after = readCaret(network.a)
    expect(after?.text).toBe('aXYbcdef')
    // Two characters were inserted before the caret, so it moved from 4 to 6 —
    // the caret stays between the same two CHARACTERS, which is what the user
    // perceives as "it did not move".
    expect(after?.offset).toBe(6)
    expect(after?.key).toBe(before?.key)
    expectConverged(network)
    network.dispose()
  })

  it('keeps the caret put when a remote insert lands AFTER it in the same run', () => {
    const network = collabNetwork()
    setParagraphs(network.a, ['abcdef'])
    network.settle()

    setCaret(network.a, 0, 2)

    edit(network.b, () => {
      const text = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('no text')
      text.setTextContent('abcdefZZ')
    })
    network.settle()

    const after = readCaret(network.a)
    expect(after?.text).toBe('abcdefZZ')
    // Nothing changed ahead of the caret, so its offset is unchanged.
    expect(after?.offset).toBe(2)
    network.dispose()
  })

  it('holds the caret through a BURST of remote reorders', () => {
    // One move is easy to get right by accident. Ten consecutive remote moves of
    // the caret's own block, with deliveries in between, is where a slow leak in
    // NodeKey stability shows up.
    const network = collabNetwork()
    setParagraphs(network.a, ['alpha', 'bravo', 'charlie', 'delta'])
    network.settle()

    setCaret(network.a, 1, 3)
    const before = readCaret(network.a)

    for (let round = 0; round < 10; round++) {
      const from = blocks(network.b).indexOf('bravo')
      moveBlock(network.b, from, (from + 2) % 4)
      network.settle()
      const now = readCaret(network.a)
      expect(now?.key, `caret lost on round ${round}`).toBe(before?.key)
      expect(now?.text).toBe('bravo')
      expect(now?.offset).toBe(3)
    }

    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  })
})

// ---------------------------------------------------------------------------
// (c) Cost: `pos` growth on the wire, and `LoroMap` scale
// ---------------------------------------------------------------------------

/**
 * Bytes a document would send for everything committed since `from`.
 *
 * This is the real wire cost of an operation, not a proxy for it: it is exactly
 * what `subscribeLocalUpdates` hands a transport.
 */
function updateBytesSince(doc: LoroDoc, from: VersionVector): number {
  doc.commit()
  return doc.export({ mode: 'update', from }).length
}

/**
 * A bulk child builder that tracks positions in a local array.
 *
 * `test/children.ts`'s `appendElement` re-reads and re-SORTS the sibling list on
 * every call, which is fine for a three-block fixture and quadratic for a
 * five-thousand-block one — the fixture, not the binding, becomes the bottleneck
 * and the test appears to hang. Production never does this either: the
 * reconciler allocates a whole desired list in one pass (`placeChildren`).
 *
 * Keeping the ascending positions in an array reproduces exactly what
 * `allocateAt` would see, at O(1) per append, so this still exercises the REAL
 * allocator rather than fabricating keys.
 */
class ChildBuilder {
  readonly #children: ChildrenContainer
  readonly #positions: string[] = []

  constructor(element: ElementContainer) {
    this.#children = elementChildren(element)
  }

  /** Insert an element child at rendered `index`, defaulting to the end. */
  insert(index = this.#positions.length, type = 'paragraph'): void {
    const [pos] = allocateAt(this.#positions, index, 1, null)
    createElementChild(this.#children, newUuid(), pos!, type)
    this.#positions.splice(index, 0, pos!)
  }

  /** The longest `pos` string minted so far — the growth measurement. */
  get longestPosition(): number {
    return Math.max(...this.#positions.map((pos) => pos.length))
  }
}

describe('hardening — cost of the ordering model', () => {
  it('a MOVE costs the same on the wire whether the subtree is tiny or huge', () => {
    // The headline claim of the whole schema, measured rather than asserted in
    // prose: a same-parent move is ONE register write, so its cost is O(1) in the
    // size of what moved. The rejected plain-list design was delete+recreate,
    // where this ratio would grow without bound — a 200-child block would ship
    // its entire subtree again.
    const build = (childrenPerBlock: number): { doc: LoroDoc; root: ElementContainer } => {
      const doc = new LoroDoc()
      doc.setPeerId(1n)
      const root = initDoc(doc, LORO_TEXT_FORMATS)
      for (let block = 0; block < 3; block++) {
        const element = appendElement(root, 'paragraph')
        for (let child = 0; child < childrenPerBlock; child++) {
          appendText(element).insert(0, `child ${child} of block ${block}`)
        }
      }
      doc.commit()
      return { doc, root }
    }

    const small = build(2)
    const large = build(200)

    const smallFrom = small.doc.version()
    moveChild(small.root, 0, 2)
    const smallBytes = updateBytesSince(small.doc, smallFrom)

    const largeFrom = large.doc.version()
    moveChild(large.root, 0, 2)
    const largeBytes = updateBytesSince(large.doc, largeFrom)

    // A hundredfold difference in subtree size, and the move costs the same.
    expect(largeBytes).toBeLessThan(smallBytes * 2)
    // Both are a single small register write, not a subtree.
    expect(smallBytes).toBeLessThan(400)
    expect(largeBytes).toBeLessThan(400)
  })

  it('keeps `pos` growth LINEAR and bounded under 2000 adversarial same-spot inserts', () => {
    // The pathological allocation pattern: always insert at the same slot, so
    // every new key must subdivide the previous interval. This is the case
    // constraint 3 in `order.ts` refuses to "fix" by rebalancing, so the bound
    // has to hold on its own merits.
    const doc = new LoroDoc()
    doc.setPeerId(1n)
    const root = initDoc(doc, LORO_TEXT_FORMATS)

    const builder = new ChildBuilder(root)
    builder.insert()
    builder.insert()
    // Always index 1: squeeze between the same two neighbours every time.
    for (let i = 0; i < 2000; i++) builder.insert(1)
    doc.commit()

    const longest = builder.longestPosition
    // Linear and gentle: base-62 buys ~5.9 subdivisions per character, so 2000
    // worst-case inserts stay in the hundreds of characters, not the thousands.
    // Generous ceiling — this asserts the GROWTH REGIME, not an exact constant.
    expect(longest).toBeGreaterThan(50)
    expect(longest).toBeLessThan(600)

    // And the point of caring: even that worst-case key keeps a MOVE small.
    const from = doc.version()
    moveChild(root, 0, 500)
    expect(updateBytesSince(doc, from)).toBeLessThan(1024)
  })

  it('keeps ordering correct and import/projection cost sub-quadratic at 5000 carriers', () => {
    // The spike measured the SORT in isolation. This measures what a peer
    // actually pays: importing a snapshot of a large `LoroMap` of carriers and
    // projecting it into rendered order.
    const snapshotWith = (count: number): Uint8Array => {
      const source = new LoroDoc()
      source.setPeerId(1n)
      const sourceRoot = initDoc(source, LORO_TEXT_FORMATS)
      const builder = new ChildBuilder(sourceRoot)
      for (let i = 0; i < count; i++) builder.insert()
      source.commit()
      return source.export({ mode: 'snapshot' })
    }

    const measureBatch = (
      snapshot: Uint8Array,
      repetitions: number,
    ): { elapsed: number; ordered: ReturnType<typeof orderedChildren> } => {
      let elapsed = 0
      let ordered: ReturnType<typeof orderedChildren> = []
      for (let repetition = 0; repetition < repetitions; repetition++) {
        const target = new LoroDoc()
        target.setPeerId(2n)
        const targetRoot = initDoc(target, LORO_TEXT_FORMATS)
        const started = performance.now()
        target.import(snapshot)
        ordered = orderedChildren(targetRoot)
        elapsed += performance.now() - started
      }
      return { elapsed, ordered }
    }

    const smallCount = 500
    const largeCount = 5000
    const smallSnapshot = snapshotWith(smallCount)
    const largeSnapshot = snapshotWith(largeCount)

    // Each small batch and the large sample project the same TOTAL number of
    // carriers. Bracketing the large sample makes a transient change in machine
    // load affect at least one of its baselines instead of whichever sample ran
    // second. Linearithmic work stays near parity after normalization; an O(n²)
    // projection makes the large sample approach 10x either small batch.
    const smallBefore = measureBatch(smallSnapshot, largeCount / smallCount)
    const large = measureBatch(largeSnapshot, 1)
    const smallAfter = measureBatch(smallSnapshot, largeCount / smallCount)
    const smallBaseline = (smallBefore.elapsed + smallAfter.elapsed) / 2
    const growthRatio = large.elapsed / smallBaseline

    expect(large.ordered.length).toBe(5000)
    // Order is preserved exactly — the whole point of sorting by (pos, uuid).
    expect(large.ordered.map((entry) => entry.pos)).toEqual(
      [...large.ordered.map((entry) => entry.pos)].sort(),
    )
    // This is a complexity guard, not a wall-clock budget. The 4x ceiling leaves
    // broad headroom over the expected O(n log n) ratio while rejecting the ~10x
    // work-normalized ratio of a quadratic projection.
    expect(growthRatio).toBeLessThan(4)
  })

  it('pays a bounded SNAPSHOT cost for `pos` growth under 2000 appends', () => {
    // ── A correction worth recording, because it is the intuitive wrong answer ──
    //
    // Appending is NOT the cheap direction. It is tempting to assume a new key at
    // the end extends an unbounded interval for free, but `between(last, null)`
    // takes the MIDPOINT between `last` and the top of the alphabet, so it
    // converges on 'zzz…' and must extend by a character roughly every six
    // appends — the same ~0.17 char/insert regime as an adversarial mid-list
    // insert. `test/order.test.ts` already pins the figure exactly
    // (`rightward(2000) === 334`); this test exists to answer what that COSTS,
    // which is the question the spike left open.
    //
    // It is deliberately not "fixed" by making append increment instead of
    // subdivide: the growth is linear and, as measured below, small next to the
    // document it annotates. Constraint 3 in `order.ts` applies in spirit —
    // the ordering rule is not the place for an unmeasured optimization.
    const doc = new LoroDoc()
    doc.setPeerId(1n)
    const root = initDoc(doc, LORO_TEXT_FORMATS)
    const builder = new ChildBuilder(root)
    for (let i = 0; i < 2000; i++) builder.insert()
    doc.commit()

    // The same regime as the adversarial direction, not a flat one.
    expect(builder.longestPosition).toBeGreaterThan(100)
    expect(builder.longestPosition).toBeLessThan(600)

    // What it actually costs: keys average well under half the worst case, so
    // the whole ordering overhead stays a few hundred KB for a 2000-block
    // document — and, unlike a list encoding, it is paid once rather than
    // re-sent whenever a block moves.
    const snapshotBytes = doc.export({ mode: 'snapshot' }).length
    expect(snapshotBytes).toBeLessThan(1_500_000)

    // The property that makes the growth tolerable: a MOVE still ships one key,
    // so reordering a 2000-block document is a sub-kilobyte update.
    const from = doc.version()
    moveChild(root, 0, 1000)
    expect(updateBytesSince(doc, from)).toBeLessThan(1024)
  })
})

// ---------------------------------------------------------------------------
// (3) Attacks specific to `pos` being a register write
// ---------------------------------------------------------------------------

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]]
  const out: T[][] = []
  for (let i = 0; i < values.length; i++) {
    const rest = [...values.slice(0, i), ...values.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([values[i]!, ...tail])
  }
  return out
}

/** Append a suffix to the first TextNode of the Nth top-level block. */
function appendTo(peer: Peer, index: number, suffix: string): void {
  edit(peer, () => {
    const block = $getRoot().getChildAtIndex<ElementNode>(index)
    const text = block?.getFirstChild()
    if (text != null && $isTextNode(text)) text.setTextContent(text.getTextContent() + suffix)
  })
}

/** Insert `count` paragraphs immediately after the block at `afterIndex`. */
function pasteAfter(peer: Peer, afterIndex: number, labels: readonly string[]): void {
  edit(peer, () => {
    const anchor = $getRoot().getChildAtIndex(afterIndex)
    if (anchor === null) throw new Error(`no block at ${afterIndex}`)
    // Insert in reverse so each lands directly after the anchor, preserving
    // label order — the same shape a real multi-block paste produces.
    for (const label of [...labels].reverse()) {
      anchor.insertAfter($createParagraphNode().append($createTextNode(label)))
    }
  })
}

describe('attack — move racing other operations', () => {
  it('commutes for a MOVE concurrent with a text edit INSIDE the moved block', () => {
    // The property the whole schema was chosen for, pushed through every delivery
    // order. A move is a `pos` write and the edit is a `LoroText` insert into a
    // container the move never touches, so the two are genuinely independent and
    // BOTH must survive in every permutation. Under the rejected plain-list
    // design the move was delete+recreate and this edit was silently lost.
    const orders = permutations([0, 1, 2])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c', 'd'])
      setParagraphs(network.a, ['p0', 'p1', 'p2'])
      network.settle()

      // a moves p1 to the end; b types into p1; c edits an unrelated block.
      moveBlock(network.peer('a'), 1, 2)
      appendTo(network.peer('b'), 1, '-EDITED')
      appendTo(network.peer('c'), 0, '-C')

      const d = network.peer('d')
      expect(d.inbox.length).toBe(3)
      d.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      expectAllWellFormed(network)
      // The concurrent edit into the moved block SURVIVED the move.
      expect(blocks(d).join('|')).toContain('p1-EDITED')
      results.push(JSON.stringify(projectEditor(d.editor)))
      network.dispose()
    }

    const [first, ...rest] = results
    for (const [index, result] of rest.entries()) {
      expect(result, `ordering ${JSON.stringify(orders[index + 1])} diverged`).toBe(first)
    }
  })

  it('commutes for a MOVE concurrent with a DELETE of the moved block', () => {
    // Constraint 7: delete beats move, deliberately. The block vanishes in BOTH
    // delivery orders — the value here is that the outcome is the same either
    // way, since an order-dependent winner would be a divergence bug.
    const orders = permutations([0, 1, 2])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c', 'd'])
      setParagraphs(network.a, ['p0', 'p1', 'p2'])
      network.settle()

      moveBlock(network.peer('a'), 1, 2)
      edit(network.peer('b'), () => {
        $getRoot().getChildAtIndex(1)?.remove()
      })
      appendTo(network.peer('c'), 0, '-C')

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

  it('commutes when two peers move the SAME block to different places', () => {
    // Two `pos` writes to one register: last-writer-wins picks one, and which one
    // is not ours to choose. What must hold is that every peer picks the SAME
    // winner regardless of delivery order, and that the block exists exactly once.
    const orders = permutations([0, 1])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c'])
      setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
      network.settle()

      moveBlock(network.peer('a'), 0, 3)
      moveBlock(network.peer('b'), 0, 1)

      const c = network.peer('c')
      c.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      expectAllWellFormed(network)
      // Exactly one copy of every block: a `pos` race reorders, never duplicates.
      expect([...blocks(c)].sort()).toEqual(['p0', 'p1', 'p2', 'p3'])
      results.push(JSON.stringify(projectEditor(c.editor)))
      network.dispose()
    }

    expect(results[1]).toBe(results[0])
  })

  it('survives a FORMAT that splits a run while a peer moves the parent block', () => {
    // Finding D1 from the round-3 Lexical gate, as a concurrency test: bolding a
    // sub-range splits one TextNode into THREE locally, but the runs coalesce
    // back to ONE carrier, so the LoroText ContainerID is unchanged and the
    // format lands as a mark inside it. That must stay true while the block's
    // parent is concurrently reordered by someone else — if the format were
    // instead modelled as new carriers, the move and the split would fight.
    const network = collabNetwork()
    setParagraphs(network.a, ['alpha', 'bravo bold here', 'charlie'])
    network.settle()

    // A bolds a middle sub-range of block 1 — the three-way local split.
    edit(network.a, () => {
      const block = $getRoot().getChildAtIndex<ElementNode>(1)
      const text = block?.getFirstChild()
      if (text == null || !$isTextNode(text)) throw new Error('no text')
      const selection = $createRangeSelection()
      selection.anchor.set(text.getKey(), 6, 'text')
      selection.focus.set(text.getKey(), 10, 'text')
      $setSelection(selection)
      selection.formatText('bold')
    })
    // B concurrently moves that very block to the front.
    moveBlock(network.b, 1, 0)
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)
    // Both intents survived: the block moved AND the text is still intact.
    expect(blocks(network.a)[0]).toBe('bravo bold here')

    // The format survived as a mark, on exactly the intended range.
    let bolded = ''
    network.a.editor.getEditorState().read(() => {
      const block = $getRoot().getChildAtIndex<ElementNode>(0)
      for (const child of block?.getChildren() ?? []) {
        if ($isTextNode(child) && child.hasFormat('bold')) bolded += child.getTextContent()
      }
    })
    expect(bolded).toBe('bold')
    network.dispose()
  })

  it('commutes for a move concurrent with a move of a DIFFERENT block', () => {
    const orders = permutations([0, 1])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c'])
      setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
      network.settle()

      moveBlock(network.peer('a'), 0, 3)
      moveBlock(network.peer('b'), 3, 0)

      const c = network.peer('c')
      c.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      expect([...blocks(c)].sort()).toEqual(['p0', 'p1', 'p2', 'p3'])
      results.push(JSON.stringify(projectEditor(c.editor)))
      network.dispose()
    }

    expect(results[1]).toBe(results[0])
  })
})

describe('attack — constraint 1: concurrent multi-block pastes at one anchor', () => {
  it('does NOT interleave two 5-block pastes at the same anchor', () => {
    // CONSTRAINT 1, as an end-to-end test rather than an allocator unit test.
    //
    // This is the measured defect batch allocation exists to prevent: with naive
    // per-block allocation both peers mint the SAME five keys in the same gap,
    // the uuid tiebreak alternates them, and the user sees A1 B1 A2 B2 … — a
    // convergent ten-paragraph shuffle of two documents nobody wrote.
    //
    // The assertion is therefore not "some order" but specifically that each
    // peer's five blocks stay CONTIGUOUS and in their authored order.
    const network = collabNetwork()
    setParagraphs(network.a, ['head', 'tail'])
    network.settle()

    const fromA = ['A1', 'A2', 'A3', 'A4', 'A5']
    const fromB = ['B1', 'B2', 'B3', 'B4', 'B5']
    pasteAfter(network.a, 0, fromA)
    pasteAfter(network.b, 0, fromB)
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)

    const result = blocks(network.a)
    expect(result[0]).toBe('head')
    expect(result[result.length - 1]).toBe('tail')
    expect(result).toHaveLength(12)

    // Each peer's run is contiguous: the indices it occupies form an unbroken
    // span, which is exactly what interleaving would destroy.
    for (const labels of [fromA, fromB]) {
      const indices = labels.map((label) => result.indexOf(label))
      expect(
        indices.every((index) => index >= 0),
        `${labels[0]} run lost a block`,
      ).toBe(true)
      const span = Math.max(...indices) - Math.min(...indices)
      expect(span, `${labels[0]} run was interleaved: ${result.join(',')}`).toBe(labels.length - 1)
      // …and in the order the author typed them.
      expect(indices, `${labels[0]} run was reordered`).toEqual([...indices].sort((x, y) => x - y))
    }
    network.dispose()
  })

  it('keeps three concurrent pastes at one anchor contiguous', () => {
    // Three peers raises the odds that two jitter digits collide, which degrades
    // that PAIR to un-jittered behaviour without breaking the others. The test
    // demands contiguity for every run that is still separable.
    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['head', 'tail'])
    network.settle()

    const runs = [
      ['A1', 'A2', 'A3'],
      ['B1', 'B2', 'B3'],
      ['C1', 'C2', 'C3'],
    ]
    for (const [index, labels] of runs.entries()) {
      pasteAfter(network.peers[index]!, 0, labels)
    }
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)

    const result = blocks(network.a)
    expect(result).toHaveLength(11)
    for (const labels of runs) {
      const indices = labels.map((label) => result.indexOf(label))
      expect(indices.every((index) => index >= 0)).toBe(true)
      expect(indices).toEqual([...indices].sort((x, y) => x - y))
    }
    network.dispose()
  })

  it('keeps a paste contiguous when it races a MOVE of the anchor itself', () => {
    // The batch is allocated against an interval whose left edge is being
    // repositioned concurrently. The run must still land together, wherever the
    // anchor ends up.
    const network = collabNetwork()
    setParagraphs(network.a, ['head', 'middle', 'tail'])
    network.settle()

    pasteAfter(network.a, 0, ['A1', 'A2', 'A3'])
    moveBlock(network.b, 0, 2)
    network.settle()

    expectConverged(network)
    expectAllWellFormed(network)

    const result = blocks(network.a)
    const indices = ['A1', 'A2', 'A3'].map((label) => result.indexOf(label))
    expect(indices.every((index) => index >= 0)).toBe(true)
    expect(Math.max(...indices) - Math.min(...indices)).toBe(2)
    expect(indices).toEqual([...indices].sort((x, y) => x - y))
    network.dispose()
  })
})

describe('attack — nested structure and randomized volume', () => {
  it('commutes for concurrent moves inside a DEEPLY nested list', () => {
    // Depth is where the inbound dirty-path walk has the most to get wrong: a
    // move three levels down marks every ancestor, and a reconciler that rebuilt
    // a marked element instead of reordering it would lose the sibling subtree.
    const orders = permutations([0, 1])
    const results: string[] = []

    for (const order of orders) {
      const network = collabNetwork(['a', 'b', 'c'])
      edit(network.a, () => {
        const root = $getRoot()
        root.clear()
        const outer = $createListNode('bullet')
        for (const group of ['g0', 'g1']) {
          const item = $createListItemNode().append($createTextNode(group))
          const inner = $createListNode('bullet')
          for (const leaf of ['x', 'y', 'z']) {
            inner.append($createListItemNode().append($createTextNode(`${group}-${leaf}`)))
          }
          const holder = $createListItemNode()
          holder.append(inner)
          outer.append(item, holder)
        }
        root.append(outer)
      })
      network.settle()

      // Reorder the leaves of the two inner lists, on two different peers.
      const reorderInner = (peer: Peer, groupIndex: number): void => {
        edit(peer, () => {
          const outer = $getRoot().getFirstChildOrThrow<ElementNode>()
          const holder = outer.getChildAtIndex<ElementNode>(groupIndex * 2 + 1)
          const inner = holder?.getFirstChild()
          if (inner == null || !$isElementNode(inner)) throw new Error('no inner list')
          const first = inner.getChildAtIndex(0)
          const last = inner.getChildAtIndex(2)
          if (first === null || last === null) throw new Error('missing leaves')
          last.insertAfter(first)
        })
      }
      reorderInner(network.peer('a'), 0)
      reorderInner(network.peer('b'), 1)

      const c = network.peer('c')
      c.flushInboxInOrder(order)
      network.settle()

      expectConverged(network)
      expectAllWellFormed(network)
      results.push(JSON.stringify(projectEditor(c.editor)))
      network.dispose()
    }

    expect(results[1]).toBe(results[0])
  })

  /**
   * WHY THESE BURSTS ARE MANY SHORT RUNS AND NOT ONE LONG ONE (#197).
   *
   * A burst's cost is QUADRATIC in its own length, and that is a property of the
   * CRDT, not of the document. Measured on the mixed burst below, with the
   * DOCUMENT pinned at 1–7 blocks and ~10–47 characters throughout:
   *
   *   ops   total    of which inbound (`flushInbox`)
   *    40     62 ms    31 ms
   *   200    639 ms   607 ms      ← 5x the ops, 20x the inbound cost
   *
   * The per-remote-update cost rises ~7x across a single 200-op run (0.5 ms →
   * 3.5 ms per event batch) while the projected document does not grow at all.
   * What DOES grow is history — the snapshot goes 9 KB → 26 KB over those 200
   * ops — so each import resolves containers against a longer op log. A raw
   * `LoroDoc.import` of primitive map writes is FLAT at ~0.01 ms/op, so this is
   * the container-resolving inbound path, not `import` itself. (Whether that is
   * reducible is a question for the binding, not for this file.)
   *
   * The consequence for test design is the whole point: op count buys SAMPLES of
   * concurrent interleaving, and staleness depth is set by the flush cadence
   * (p = 0.5 per peer per op — a peer is ~2 ops stale regardless of run length),
   * NOT by how long the run is. So N independent runs of L ops sample strictly
   * more interleavings than one run of N x L ops, assert convergence N times
   * instead of once, and cost ~N times LESS. Each seed is a fixed constant, so a
   * failure names the exact run to replay. Measured, near idle:
   *
   *   mixed  1 x 200  638 ms   ← what this was
   *   mixed  6 x  40  158 ms   ← 240 operations, 6 trials, 4.0x cheaper
   *   paste  1 x  60  254 ms   ← what the sibling was
   *   paste  6 x  15  107 ms   ←  90 operations, 6 trials, 2.4x cheaper
   *
   * DO NOT chase this further by shortening the runs again. At a FIXED total op
   * count the curve is already flat — 6x40, 8x30, 10x24, 12x20, 16x15 and 20x12
   * all land within 125–158 ms — because per-run setup (three headless editors,
   * three Loro docs, a settle) replaces exactly what the quadratic gives back.
   * The paste shape is past its optimum in that direction: 10x10 (138 ms) and
   * 12x8 (171 ms) are WORSE than 6x15 for the same work. Anything materially
   * cheaper from here costs real operations, not just arrangement.
   *
   * WHAT IS GIVEN UP, and it is a real loss — do not read the paragraph above
   * as saying otherwise (#223). CONVERGENCE AND WELL-FORMEDNESS UNDER
   * RANDOMIZED CONCURRENT INTERLEAVING **WITH MOVES** NOW GOES NO DEEPER THAN
   * 40 ACCUMULATED OPERATIONS, down from 200, and the paste trials build a
   * ~26-block document rather than a ~107-block one.
   *
   * The three tests in 'hardening — cost of the ordering model' do NOT cover
   * that, and an earlier version of this comment wrongly said they did. They are
   * single-doc, single-peer, non-concurrent, built straight from carriers: they
   * never construct a `collabNetwork`, never interleave peers, and never call
   * `expectConverged` or `expectAllWellFormed`. What they genuinely pin is the
   * narrower claim two paragraphs up — `pos` growth and import cost over long
   * lives (2000 adversarial inserts, 2000 appends, 5000 carriers) — and nothing
   * about convergence.
   *
   * The real partial backfill is `convergence-attack.test.ts`'s 150-operation
   * three-peer burst, which is genuinely concurrent and genuinely deeper than
   * these — but it deliberately EXCLUDES move. So the specific combination of
   * depth AND moves is what no test now reaches.
   *
   * That is not a shortcut taken for speed: the depth is UNAFFORDABLE, and #222
   * is why. Cost grows as (trials x length^2), so one 120-op trial costs ~9x a
   * 40-op one — 37–53 s at load ~900, past the 30 s budget — and even 60 ops
   * reaches ~21 s at the top of the measured band. Restoring the depth requires
   * making a long history cheap to accumulate through the binding, which is
   * exactly #222. Until then the trials, the total operations and the
   * assertions all went UP, and the depth did not come back.
   */
  const BURST_SEEDS = [
    0x5eed1234, 0x1234abcd, 0x0badc0de, 0x13572468, 0x0ff1ce55, 0x2468ace0,
  ] as const

  /** One randomized mixed-operation burst across three peers, from `seedValue`. */
  const runMixedBurst = (seedValue: number, ops: number): void => {
    let seed = seedValue
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
    network.settle()

    for (let op = 0; op < ops; op++) {
      const peer = network.peers[Math.floor(random() * network.peers.length)]!
      const action = Math.floor(random() * 4)
      const size = blocks(peer).length
      if (size === 0) {
        edit(peer, () => {
          $getRoot().append($createParagraphNode().append($createTextNode('re')))
        })
      } else if (action === 0) {
        appendTo(peer, Math.floor(random() * size), op.toString(36))
      } else if (action === 1) {
        edit(peer, () => {
          const at = Math.floor(random() * size)
          $getRoot()
            .getChildAtIndex(at)
            ?.insertAfter($createParagraphNode().append($createTextNode(`n${op}`)))
        })
      } else if (action === 2 && size > 1) {
        // The formerly-excluded operation.
        moveBlock(peer, Math.floor(random() * size), Math.floor(random() * size))
      } else if (size > 1) {
        edit(peer, () => {
          $getRoot()
            .getChildAtIndex(Math.floor(random() * size))
            ?.remove()
        })
      }
      // Randomized partial delivery, so peers routinely act on stale state.
      for (const other of network.peers) if (random() < 0.5) other.flushInbox()
    }

    network.settle()
    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  }

  /** One randomized multi-block-paste + move burst across three peers. */
  const runPasteBurst = (seedValue: number, ops: number): void => {
    let seed = seedValue
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['head', 'tail'])
    network.settle()

    for (let op = 0; op < ops; op++) {
      const peer = network.peers[Math.floor(random() * network.peers.length)]!
      const size = blocks(peer).length
      if (random() < 0.5) {
        const count = 2 + Math.floor(random() * 4)
        const labels = Array.from({ length: count }, (_, i) => `${op}-${i}`)
        pasteAfter(peer, Math.floor(random() * size), labels)
      } else if (size > 1) {
        moveBlock(peer, Math.floor(random() * size), Math.floor(random() * size))
      }
      for (const other of network.peers) if (random() < 0.5) other.flushInbox()
    }

    network.settle()
    expectConverged(network)
    expectAllWellFormed(network)
    network.dispose()
  }

  // ONE TEST PER SEED, not one test looping over the seeds. `testTimeout` is a
  // PER-TEST budget, so a trial is the right unit to give it to: six trials in
  // one `it` re-creates the very thing #197 is about (a single test whose
  // duration is the sum of independent work), while six `it`s do the same total
  // work with each one an order of magnitude clear of the budget. It also makes
  // a failure name the seed to replay instead of "one of six".
  // A plain loop rather than `it.each`: `$var` interpolation renders a string
  // case QUOTED (`seed 0x'5eed1234'`), and the seed is the one thing a reader
  // has to be able to copy out of a failure verbatim.
  for (const seed of BURST_SEEDS) {
    const hex = `0x${seed.toString(16)}`

    // The burst in `convergence-attack.test.ts` deliberately EXCLUDES move,
    // because `LoroMovableList` panicked on concurrent move/delete. That
    // rationale is now obsolete: children no longer live in a movable list, and
    // both pinned upstream defects in `test/loro-upstream.test.ts` are specific
    // to `LoroMovableList`. A move is now an ordinary register write, so it can
    // and must be fuzzed alongside everything else — including against the
    // concurrent deletes that used to be fatal.
    it(`survives a randomized burst INCLUDING MOVES across three peers (seed ${hex})`, () => {
      runMixedBurst(seed, 40)
    })

    // Combines the two riskiest operations: batch allocation (constraint 1) and
    // register moves, under randomized delivery. Batches are what make two peers
    // mint keys in the same interval, so this is where a batch-allocation
    // regression would surface as divergence rather than as mere interleaving.
    it(`survives a randomized burst of MULTI-BLOCK pastes and moves (seed ${hex})`, () => {
      runPasteBurst(seed, 15)
    })
  }
})
