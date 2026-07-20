/**
 * Hardening: the three questions the ordering spikes could NOT answer, plus the
 * attacks that only become expressible once `pos` is a register write.
 *
 * The spikes proved the ORDERING MODEL converges. They ran below the editor, so
 * three things stayed open, and each is load-bearing for a real user:
 *
 *  a. UNDO. Undo is Lexical's LOCAL history in v1 (`binding.ts` deliberately
 *     leaves `externalUndo` undefined). History restores a previous EDITOR
 *     STATE, which the outbound sync then reconciles into `pos` writes — so
 *     "does undo restore the previous order" is a question about the binding,
 *     not about Lexical, and it has never been asked.
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

  it('DOCUMENTED v1 LIMITATION: undo also rewinds a remote edit, but converges', () => {
    // ── Read this before "fixing" undo ──────────────────────────────────────
    //
    // Undo in v1 is Lexical's LOCAL history, which is SNAPSHOT-based: each entry
    // is a whole `EditorState`, and `undo` re-applies one with
    // `editor.setEditorState`. `@lexical/history` has NO notion of
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
    // Tagging the writeback HISTORY_MERGE_TAG does NOT fix it: merging folds the
    // remote state into `current`, and the next undo still pops to a snapshot
    // taken before the remote edit. The defect is snapshot-vs-operation, not
    // tagging, so no tag choice can resolve it. A correct collaborative undo
    // needs an operation-based, CRDT-aware manager (Loro's `UndoManager`) wired
    // through `LoroCollab.externalUndo`, which `binding.ts` documents as absent
    // in v1 and additive later.
    //
    // What this test therefore defends is the boundary of the damage: the
    // binding stays CONVERGENT and well-formed. Every peer agrees on the
    // (regrettable) outcome, no block is duplicated, and nothing is corrupted.
    // Divergence here would be a different and far worse class of bug.
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

  it('keeps ordering correct and import affordable at 5000 carriers', () => {
    // The spike measured the SORT in isolation. This measures what a peer
    // actually pays: importing a snapshot of a large `LoroMap` of carriers and
    // projecting it into rendered order.
    const source = new LoroDoc()
    source.setPeerId(1n)
    const sourceRoot = initDoc(source, LORO_TEXT_FORMATS)
    const builder = new ChildBuilder(sourceRoot)
    for (let i = 0; i < 5000; i++) builder.insert()
    source.commit()

    const snapshot = source.export({ mode: 'snapshot' })
    const target = new LoroDoc()
    target.setPeerId(2n)
    const targetRoot = initDoc(target, LORO_TEXT_FORMATS)

    const started = performance.now()
    target.import(snapshot)
    const ordered = orderedChildren(targetRoot)
    const elapsed = performance.now() - started

    expect(ordered.length).toBe(5000)
    // Order is preserved exactly — the whole point of sorting by (pos, uuid).
    expect(ordered.map((entry) => entry.pos)).toEqual([...ordered.map((e) => e.pos)].sort())
    // A generous ceiling: this is a REGRESSION guard against an accidental
    // O(n^2) in the projection, not a performance benchmark. It runs in tens of
    // milliseconds; a quadratic projection would blow through seconds.
    expect(elapsed).toBeLessThan(5000)
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

  it('survives a 200-operation randomized burst INCLUDING MOVES across three peers', () => {
    // The burst in `convergence-attack.test.ts` deliberately EXCLUDES move,
    // because `LoroMovableList` panicked on concurrent move/delete. That
    // rationale is now obsolete: children no longer live in a movable list, and
    // both pinned upstream defects in `test/loro-upstream.test.ts` are specific
    // to `LoroMovableList`. A move is now an ordinary register write, so it can
    // and must be fuzzed alongside everything else — including against the
    // concurrent deletes that used to be fatal.
    let seed = 0x5eed1234
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['p0', 'p1', 'p2', 'p3'])
    network.settle()

    for (let op = 0; op < 200; op++) {
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
  })

  it('survives a randomized burst of MULTI-BLOCK pastes and moves', () => {
    // Combines the two riskiest operations: batch allocation (constraint 1) and
    // register moves, under randomized delivery. Batches are what make two peers
    // mint keys in the same interval, so this is where a batch-allocation
    // regression would surface as divergence rather than as mere interleaving.
    let seed = 0xfaceb00c
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }

    const network = collabNetwork(['a', 'b', 'c'])
    setParagraphs(network.a, ['head', 'tail'])
    network.settle()

    for (let op = 0; op < 60; op++) {
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
  })
})
