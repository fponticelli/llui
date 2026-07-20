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
import { CODE_INFO_TRANSFORMER } from './code.js'

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

/** The `==highlight==` transformer. NOT part of the default GFM set: `==..==` is
 * not GFM, so exporting it produces non-standard markdown other renderers won't
 * understand. Offered as an opt-in a consumer can add to a plugin's transformers. */
export const HIGHLIGHT_TRANSFORMER: Transformer = HIGHLIGHT

/** Inline text-format transformers (no block nodes, no node registration). These
 * are the only transformers a single-block / inline-only editor needs; `LINK` is
 * kept separate since it requires `LinkNode` to be registered.
 *
 * `HIGHLIGHT` is deliberately excluded: it round-trips as the non-GFM `==..==`
 * syntax, so it would silently emit markdown outside the editor's stated dialect.
 * Opt in with {@link HIGHLIGHT_TRANSFORMER}. */
export const INLINE_TEXT_TRANSFORMERS: readonly Transformer[] = [
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
]

/** Markdown ↔ node transformers for the GFM superset. */
export const GFM_TRANSFORMERS: readonly Transformer[] = [
  HEADING,
  QUOTE,
  // CHECK_LIST must precede the plain list transformers: `- [ ]`/`- [x]` also
  // match `- `, so UNORDERED_LIST would otherwise swallow it as bullet text.
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  // NOT `@lexical/markdown`'s `CODE`: that one captures the info string as a
  // single `[\w-]+` token and pushes the remainder of the fence line into the
  // code body, silently corrupting ```c++ and ```lance table. See
  // `transformers/code.ts`.
  CODE_INFO_TRANSFORMER,
  ...INLINE_TEXT_TRANSFORMERS,
  LINK,
]
