// Compute the full toolbar FormatState from a Lexical selection — the base
// rich-text format (from @llui/lexical) refined with list/code/link detection
// (which needs the list/code/link packages this layer depends on).

import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'
import { $findMatchingParent, $getNearestNodeOfType } from '@lexical/utils'
import { ListNode, $isListItemNode } from '@lexical/list'
import { $isCodeNode } from '@lexical/code-core'
import { $isLinkNode } from '@lexical/link'
import { $readBaseFormat } from '@llui/lexical'
import type { SelectionContext } from '@llui/lexical'
import { EMPTY_FORMAT, type BlockType, type FormatState } from './state.js'

/** Read the full format surface at the current selection (opens a read ctx). */
export function computeFormatState(
  editor: LexicalEditor,
  history: Pick<SelectionContext, 'canUndo' | 'canRedo'>,
): FormatState {
  return editor.getEditorState().read(() => {
    const base = $readBaseFormat()
    if (!base.hasSelection) {
      return { ...EMPTY_FORMAT, canUndo: history.canUndo, canRedo: history.canRedo }
    }

    let blockType: BlockType = base.blockType
    let link = false

    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
      const anchorNode = selection.anchor.getNode()
      link = $findMatchingParent(anchorNode, (node) => $isLinkNode(node)) !== null

      if (base.blockType === 'other') {
        const listItem = $findMatchingParent(anchorNode, (node) => $isListItemNode(node))
        if (listItem) {
          const list = $getNearestNodeOfType(anchorNode, ListNode)
          if (list) blockType = list.getListType()
        } else {
          const top = anchorNode.getKey() === 'root' ? null : anchorNode.getTopLevelElement()
          if (top && $isCodeNode(top)) blockType = 'code'
        }
      }
    }

    return {
      bold: base.bold,
      italic: base.italic,
      strikethrough: base.strikethrough,
      code: base.code,
      link,
      blockType,
      alignment: base.alignment,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }
  })
}
