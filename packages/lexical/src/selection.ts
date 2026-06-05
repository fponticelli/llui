// Generic (rich-text level) selection → format reader. `@llui/markdown-editor`
// composes this with list/code detection to build its full toolbar FormatState.

import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  type ElementFormatType,
  type LexicalEditor,
} from 'lexical'
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text'

/** Block kinds resolvable without list/code packages. Anything else → 'other',
 * which the markdown layer refines (list, code, …). */
export type BaseBlockType =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'other'

export type Alignment = 'left' | 'center' | 'right' | 'justify' | 'start' | 'end' | null

/** The generic format surface at the current selection. */
export interface BaseFormat {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
  code: boolean
  blockType: BaseBlockType
  alignment: Alignment
  /** The resolved top-level block element key (lets the markdown layer refine). */
  blockKey: string | null
  hasSelection: boolean
  isCollapsed: boolean
}

const EMPTY: BaseFormat = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  blockType: 'paragraph',
  alignment: null,
  blockKey: null,
  hasSelection: false,
  isCollapsed: true,
}

function mapAlignment(format: ElementFormatType): Alignment {
  switch (format) {
    case 'left':
      return 'left'
    case 'center':
      return 'center'
    case 'right':
      return 'right'
    case 'justify':
      return 'justify'
    case 'start':
      return 'start'
    case 'end':
      return 'end'
    default:
      return null
  }
}

/** Read the base format at the current selection. Must run inside a Lexical
 * read/update context (it calls `$`-prefixed APIs). */
export function $readBaseFormat(): BaseFormat {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return EMPTY

  const anchorNode = selection.anchor.getNode()
  let blockElement = anchorNode
  if (!$isRootOrShadowRoot(anchorNode)) {
    const top = anchorNode.getTopLevelElement()
    if (top !== null) blockElement = top
  }

  let blockType: BaseBlockType = 'other'
  if ($isHeadingNode(blockElement)) blockType = blockElement.getTag()
  else if ($isQuoteNode(blockElement)) blockType = 'quote'
  else if (blockElement.getType() === 'paragraph') blockType = 'paragraph'

  const alignment = $isElementNode(blockElement) ? mapAlignment(blockElement.getFormatType()) : null

  return {
    bold: selection.hasFormat('bold'),
    italic: selection.hasFormat('italic'),
    strikethrough: selection.hasFormat('strikethrough'),
    underline: selection.hasFormat('underline'),
    code: selection.hasFormat('code'),
    blockType,
    alignment,
    blockKey: blockElement.getKey(),
    hasSelection: true,
    isCollapsed: selection.isCollapsed(),
  }
}

/** Convenience wrapper that opens a read context on `editor`. */
export function readBaseFormat(editor: LexicalEditor): BaseFormat {
  return editor.getEditorState().read(() => $readBaseFormat())
}
