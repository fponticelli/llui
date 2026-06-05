// The built-in GFM superset: node classes + the explicit transformer set that
// maps exactly to those nodes (no surprise nodes — HR/tables are opt-in plugins).

import type { Klass, LexicalNode } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
// `@lexical/code-core` (not `@lexical/code`) keeps Prism out of the bundle — we
// never register syntax highlighting, so plain CodeNode is all we need.
import { CodeNode, CodeHighlightNode } from '@lexical/code-core'
import {
  type Transformer,
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  HIGHLIGHT,
  LINK,
} from '@lexical/markdown'

/** Node classes required to render the GFM superset. */
export const GFM_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
]

/** Markdown ↔ node transformers for the GFM superset. */
export const GFM_TRANSFORMERS: readonly Transformer[] = [
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  CODE,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  HIGHLIGHT,
  LINK,
]
