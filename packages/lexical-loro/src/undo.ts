/**
 * CRDT-aware undo/redo: Loro's `UndoManager` wired to Lexical's undo commands.
 *
 * ── Why not `@lexical/history` ─────────────────────────────────────────────
 *
 * Lexical's built-in history is SNAPSHOT-based and knows nothing about who made
 * a change. Under collaboration it records our inbound writeback as though the
 * local user had typed it, so undoing after a peer's edit re-applies a snapshot
 * taken BEFORE that edit — reverting the REMOTE change, and (because the
 * outbound sync replays the snapshot faithfully) removing it for every peer.
 * No update tag avoids that; it is a property of snapshot undo.
 *
 * Loro's `UndoManager` is operation-based and bound to a PeerID: it records the
 * commits made by this peer and ignores everything imported from others. Undo
 * therefore reverts exactly the local user's own last change, wherever it now
 * sits in a document other peers have moved on from — including a same-parent
 * block move, which is a single LWW write to a carrier's `pos` and so undoes to
 * the previous fractional index rather than to a whole-document snapshot.
 *
 * ── The echo seam ──────────────────────────────────────────────────────────
 *
 * `manager.undo()` mutates the shared document from THIS peer, so Loro reports
 * the result as a `by: 'local'` batch — which echo layer (a) in `to-lexical.ts`
 * drops as "our own outbound write coming back round". It is not: nothing wrote
 * it to the editor, and dropping it leaves the editor permanently behind the
 * document it mirrors. Loro stamps those batches with the origin
 * {@link LORO_UNDO_ORIGIN} (both undo AND redo use it), and the binding passes
 * {@link UNDO_ORIGINS} as `InboundTarget.undoOrigins` so exactly those local
 * batches are applied. The editor update the writeback performs carries
 * `COLLABORATION_TAG`, so echo layer (b) keeps it from bouncing back out.
 *
 * That is also why {@link UNDO_ORIGINS} is passed UNCONDITIONALLY by the
 * binding, whether or not this module was registered: only an `UndoManager`
 * produces that origin, so allowing it costs nothing when there is none, and
 * makes the inbound path independent of registration order.
 *
 * ── Selection ──────────────────────────────────────────────────────────────
 *
 * The inbound mirror mutates nodes in place and keeps NodeKeys stable, so a
 * caret outside the undone region needs no help and one inside the undone text
 * run is transformed by the same diff that rewrites the run. The remaining case
 * is a caret in a node the undo DELETES (undoing an insert): Lexical is left
 * with a selection pointing at a detached node. So the selection is snapshotted
 * before the pop and restored — clamped, and only when the recorded points still
 * resolve — if the post-undo selection is gone or dangling. Restoring is a
 * selection-only update: it dirties no node, so the outbound listener commits
 * nothing.
 */

import {
  $createRangeSelection,
  $getNodeByKey,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COLLABORATION_TAG,
  COMMAND_PRIORITY_EDITOR,
  REDO_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
  UNDO_COMMAND,
  type LexicalEditor,
  type NodeKey,
} from 'lexical'
import { UndoManager, type LoroDoc } from 'loro-crdt'

/**
 * The commit origin Loro stamps on the batches produced by `UndoManager#undo`
 * and `#redo`. Both use `'undo'`; there is no separate redo origin.
 */
export const LORO_UNDO_ORIGIN = 'undo'

/** Local commit origins the inbound path must apply rather than treat as echo. */
export const UNDO_ORIGINS: readonly string[] = [LORO_UNDO_ORIGIN]

/**
 * Milliseconds within which consecutive local commits merge into ONE undo step.
 * Matches `@lexical/history`'s delay, so typing undoes in the chunks a user of
 * the non-collaborative editor already expects. `0` disables merging.
 */
export const DEFAULT_MERGE_INTERVAL = 1000

/** Undo steps retained before the oldest is dropped. Loro's own default. */
export const DEFAULT_MAX_UNDO_STEPS = 100

/** Tuning for {@link registerLoroUndo}. */
export interface LoroUndoOptions {
  /** The shared document. */
  readonly doc: LoroDoc
  /** See {@link DEFAULT_MERGE_INTERVAL}. */
  readonly mergeInterval?: number
  /** See {@link DEFAULT_MAX_UNDO_STEPS}. */
  readonly maxUndoSteps?: number
  /**
   * Local commit origins EXCLUDED from the undo stack, by prefix. Use this for
   * machine-generated writes a user should never be able to undo into.
   */
  readonly excludeOriginPrefixes?: readonly string[]
}

/** Compose teardown functions into one disposer (last-registered first). */
function mergeDisposers(disposers: ReadonlyArray<() => void>): () => void {
  return () => {
    for (let index = disposers.length - 1; index >= 0; index--) disposers[index]!()
  }
}

/** A serializable point: NodeKey plus offset. Keys are stable for the session. */
interface PointSnapshot {
  readonly key: NodeKey
  readonly offset: number
  readonly type: 'text' | 'element'
}

interface SelectionSnapshot {
  readonly anchor: PointSnapshot
  readonly focus: PointSnapshot
}

/** Snapshot the current range selection, or `null` if there isn't one. */
function $snapshotSelection(): SelectionSnapshot | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null
  return {
    anchor: {
      key: selection.anchor.key,
      offset: selection.anchor.offset,
      type: selection.anchor.type,
    },
    focus: { key: selection.focus.key, offset: selection.focus.offset, type: selection.focus.type },
  }
}

/** The largest offset a point may hold in the node it addresses, or `null` if
 * the node is gone or no longer of the recorded kind. */
function $pointCeiling(point: PointSnapshot): number | null {
  const node = $getNodeByKey(point.key)
  if (node === null) return null
  if (point.type === 'text') return $isTextNode(node) ? node.getTextContentSize() : null
  return $isElementNode(node) ? node.getChildrenSize() : null
}

/** Whether the editor's CURRENT selection still addresses live nodes. */
function $selectionIsLive(): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  for (const point of [selection.anchor, selection.focus]) {
    const node = $getNodeByKey(point.key)
    if (node === null || !node.isAttached()) return false
  }
  return true
}

/**
 * Re-apply a snapshotted selection, clamped to the nodes as they now are.
 * Returns whether it could be applied — a snapshot whose nodes the undo removed
 * is dropped rather than forced.
 */
function $restoreSelection(snapshot: SelectionSnapshot): boolean {
  const anchorCeiling = $pointCeiling(snapshot.anchor)
  const focusCeiling = $pointCeiling(snapshot.focus)
  if (anchorCeiling === null || focusCeiling === null) return false
  const selection = $createRangeSelection()
  selection.anchor.set(
    snapshot.anchor.key,
    Math.min(snapshot.anchor.offset, anchorCeiling),
    snapshot.anchor.type,
  )
  selection.focus.set(
    snapshot.focus.key,
    Math.min(snapshot.focus.offset, focusCeiling),
    snapshot.focus.type,
  )
  $setSelection(selection)
  return true
}

/**
 * Register Loro-backed undo/redo on an editor.
 *
 * Hand this to `lexicalForeign({ externalUndo })` — which forces the built-in
 * `@lexical/history` stack off, so the two can never both be live. The returned
 * disposer unregisters the commands and frees the manager.
 *
 * The manager is constructed HERE rather than at `loroCollab()` time on purpose:
 * `lexicalForeign` calls `register` (which bootstraps the document) before
 * `externalUndo`, so the boot-time seed is already committed and is NOT on the
 * undo stack. A user's first undo can therefore never empty a freshly seeded
 * document.
 */
export function registerLoroUndo(options: LoroUndoOptions, editor: LexicalEditor): () => void {
  const manager = new UndoManager(options.doc, {
    mergeInterval: options.mergeInterval ?? DEFAULT_MERGE_INTERVAL,
    maxUndoSteps: options.maxUndoSteps ?? DEFAULT_MAX_UNDO_STEPS,
    excludeOriginPrefixes: [...(options.excludeOriginPrefixes ?? [])],
  })

  const pushStackState = (): void => {
    editor.dispatchCommand(CAN_UNDO_COMMAND, manager.canUndo())
    editor.dispatchCommand(CAN_REDO_COMMAND, manager.canRedo())
  }

  // Every batch — local commit, remote import, or our own undo — can change what
  // is undoable, so the stack state is re-published on all of them rather than
  // only on the paths this module drives.
  const unsubscribe = options.doc.subscribe(() => {
    pushStackState()
  })

  /** Pop one step, then repair the selection if the writeback orphaned it. */
  const pop = (step: () => boolean): void => {
    let snapshot: SelectionSnapshot | null = null
    editor.getEditorState().read(() => {
      snapshot = $snapshotSelection()
    })
    // The writeback into the editor happens synchronously, inside the document
    // subscription this call triggers.
    const applied = step()
    pushStackState()
    if (!applied || snapshot === null) return
    const recorded: SelectionSnapshot = snapshot
    let needsRepair = false
    editor.getEditorState().read(() => {
      needsRepair = !$selectionIsLive()
    })
    if (!needsRepair) return
    editor.update(
      () => {
        $restoreSelection(recorded)
      },
      // Selection-only: tagged so the outbound listener skips it outright rather
      // than relying on it happening to dirty no node.
      { tag: [COLLABORATION_TAG, SKIP_SCROLL_INTO_VIEW_TAG] },
    )
  }

  const disposeCommands = mergeDisposers([
    editor.registerCommand(
      UNDO_COMMAND,
      () => {
        pop(() => manager.undo())
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    ),
    editor.registerCommand(
      REDO_COMMAND,
      () => {
        pop(() => manager.redo())
        return true
      },
      COMMAND_PRIORITY_EDITOR,
    ),
  ])

  // Publish the initial (empty) stack state so a toolbar rendered before the
  // first edit shows undo/redo disabled rather than in whatever state it
  // defaulted to.
  pushStackState()

  return () => {
    disposeCommands()
    unsubscribe()
    manager.free()
  }
}
