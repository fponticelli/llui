// The task-marker typing shortcut — `- [ ] ` / `- [x] ` typed inside a bullet
// list item.
//
// ## Why this exists at all (issue #99)
//
// `@lexical/markdown`'s typing loop refuses to run ANY element transformer
// unless the block's grandparent is the root:
//
//   function runElementTransformers(parentNode, anchorNode, …) {
//     const grandParentNode = parentNode.getParent()
//     if (!$isRootOrShadowRoot(grandParentNode) || …) return false
//
// Typing `- ` converts the paragraph to a `ListItemNode` inside a `ListNode`
// straight away, so by the time `[ ] ` is typed the grandparent is a `ListNode`
// and `CHECK_LIST` is never even tested. `- [ ] ` — the spelling everybody who
// knows GFM reaches for — is therefore unreachable by typing, by construction;
// only a bare `[ ] ` from a plain paragraph works. Transformer ORDER is not the
// problem (`CHECK_LIST` already precedes the plain list transformers) and
// neither is its regex (it already makes the bullet prefix optional).
//
// The honest fix is upstream: relax that guard, or let a transformer opt out of
// it. Until then this listener does the same job from a place the guard does not
// reach. If Lexical ever lets `CHECK_LIST` run inside a list item, DELETE this
// module rather than leaving it to double-fire.
//
// ## Why an update listener rather than a node transform
//
// A `ListItemNode` transform would also fire on import, on HTML paste and on
// remote collab edits, silently rewriting a bullet item that legitimately reads
// `[ ] …` (a document can spell one with escapes). This is a TYPING affordance,
// so it hooks the same place `registerMarkdownShortcuts` does and RESTATES its
// guards: not collaboration, not undo/redo, not mid-composition, an
// IME-committed marker (`COMPOSITION_END_TAG`) still allowed through, no
// code-formatted text (`canContainTransformableMarkdown`), and only when the
// caret just moved over the character that completed the marker.
//
// "Restates", not "inherits": none of these reach an element transformer for
// free. Each guard below is here because it was written out, and one that is
// deleted is simply gone.

import {
  $addUpdateTag,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  COMPOSITION_END_TAG,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
} from 'lexical'
import { $createListNode, $isListItemNode, $isListNode, type ListItemNode } from '@lexical/list'
import { isCheckedMarker } from './transformers/list.js'

/**
 * A GFM task marker at the very start of a list item's text: `[ ] `, `[x] `,
 * `[X] `, and the `[] ` upstream's `CHECK_LIST_REGEX` also accepts.
 *
 * The trailing space is load-bearing — it is the whole of what separates a task
 * marker from a list item that merely opens with a bracket (`- [note] see
 * below`, `- []x`), both of which must survive as literal text.
 */
const TASK_MARKER = /^\[([\sxX]?)\]\s/

/**
 * Move `item` out of its bullet list into a check list of its own, leaving the
 * items before and after it in bullet lists on either side.
 *
 * A check list is a LIST-level type in Lexical (`ListNode.getListType()`), so a
 * single item cannot be ticked while its siblings stay bullets — converting one
 * item necessarily splits the list. The three resulting lists alternate types,
 * which is also why `@lexical/list`'s adjacent-same-type merge cannot glue them
 * back together.
 */
function $splitOutAsCheckItem(item: ListItemNode, checked: boolean): void {
  const list = item.getParent()
  if (!$isListNode(list)) return

  const following = item.getNextSiblings()
  const checkList = $createListNode('check')
  list.insertAfter(checkList)
  checkList.append(item)

  if (following.length > 0) {
    const tail = $createListNode(list.getListType(), list.getStart())
    checkList.insertAfter(tail)
    for (const node of following) tail.append(node)
  }
  // Everything ahead of the converted item stays put; an empty leftover is the
  // common case (converting the only item, or the first one).
  if (list.getChildrenSize() === 0) list.remove()

  item.setChecked(checked)
}

/**
 * Turn a task marker typed at the start of a BULLET list item into a real check
 * item. Registered by `corePlugin` — the plugin that contributes `CHECK_LIST` —
 * so an editor assembled without check lists does not get the shortcut.
 */
export function registerTaskMarkerShortcut(editor: LexicalEditor): () => void {
  return editor.registerUpdateListener(({ tags, dirtyLeaves, editorState, prevEditorState }) => {
    // Changes already accounted for elsewhere: a remote peer typed this, or
    // history is replaying it. Re-running the shortcut would fight both.
    if (tags.has(COLLABORATION_TAG) || tags.has(HISTORIC_TAG)) return
    if (editor.isComposing()) return

    // An IME commit lands the whole marker in ONE update and leaves the
    // selection where it already was, so upstream lets a `COMPOSITION_END_TAG`
    // update through the "the caret moved" test rather than bailing on it.
    const isCompositionEnd = tags.has(COMPOSITION_END_TAG)

    const selection = editorState.read($getSelection)
    const prevSelection = prevEditorState.read($getSelection)
    // Only as the user types: a collapsed caret that actually moved (or an IME
    // that just committed), sitting in a text node this update changed.
    if (
      !$isRangeSelection(selection) ||
      !$isRangeSelection(prevSelection) ||
      !selection.isCollapsed() ||
      (selection.is(prevSelection) && !isCompositionEnd)
    ) {
      return
    }

    const anchorKey = selection.anchor.key
    const anchorOffset = selection.anchor.offset
    if (!dirtyLeaves.has(anchorKey)) return

    editor.update(() => {
      const anchorNode = $getNodeByKey(anchorKey)
      // `canContainTransformableMarkdown` (`importTextTransformers.ts:29`): a
      // code-formatted run is literal text, so a `[ ] ` inside one is not a
      // marker. Upstream applies this to every text transformer; nothing
      // inherits it for an element one, so it is stated here.
      if (!$isTextNode(anchorNode) || anchorNode.hasFormat('code')) return

      const item = anchorNode.getParent()
      // The marker has to open the item, so the caret's text node must be its
      // first child — not, say, the text after a nested list or a link.
      if (!$isListItemNode(item) || item.getFirstChild() !== anchorNode) return

      const list = item.getParent()
      // Only plain bullets convert. An ordered list has no GFM task spelling,
      // and a check list is already what we would be producing.
      if (!$isListNode(list) || list.getListType() !== 'bullet') return

      const match = TASK_MARKER.exec(anchorNode.getTextContent())
      // `match[0].length === anchorOffset` is what makes this a TYPING trigger:
      // the character just typed is the one that completed the marker, and the
      // caret sits immediately after it.
      if (match === null || match[0].length !== anchorOffset) return

      // Drop the marker text the same way upstream's typing loop does: split at
      // the caret and remove the leading half, so any text after it survives
      // untouched in its own node.
      const [leading] = anchorNode.splitText(anchorOffset)
      leading?.remove()

      $splitOutAsCheckItem(item, isCheckedMarker(match[1]))
      item.select(0, 0)
      $addUpdateTag(HISTORY_PUSH_TAG)
    })
  })
}
