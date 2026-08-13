// The built-in GFM superset: node classes + the explicit transformer set that
// maps exactly to those nodes (no surprise nodes — HR/tables are opt-in plugins).

import type { LexicalNodeConfig } from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
// `@lexical/code-core` (not `@lexical/code`) keeps Prism out of the bundle — we
// never register syntax highlighting, so plain CodeNode is all we need.
import { CodeNode, CodeHighlightNode } from '@lexical/code-core'
import {
  type Transformer,
  HEADING,
  QUOTE,
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
import {
  CHECK_LIST_TRANSFORMER,
  ORDERED_LIST_TRANSFORMER,
  UNORDERED_LIST_TRANSFORMER,
} from './list.js'
import { MARKDOWN_LIST_NODES } from '../nodes/list.js'

/** Node classes required to render the GFM superset.
 *
 * `LexicalNodeConfig`, not `Klass<LexicalNode>`: lists are registered as a
 * `{ replace, with, withKlass }` redirect onto `MarkdownListNode`, which is the
 * only way to take a node's own `$config` transform out of play. See
 * `nodes/list.ts` — without it two adjacent lists with different markers cannot
 * exist in the tree at all, whoever built them. */
export const GFM_NODES: ReadonlyArray<LexicalNodeConfig> = [
  HeadingNode,
  QuoteNode,
  ...MARKDOWN_LIST_NODES,
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
  // The check-list transformer must precede the plain list transformers:
  // `- [ ]`/`- [x]` also match `- `, so UNORDERED_LIST would otherwise swallow
  // it as bullet text.
  //
  // NOT `@lexical/markdown`'s list transformers: those decide whether to join a
  // neighbouring list on `listType` alone, so a CommonMark marker change
  // (`- a` then `* b`) collapsed two lists into one; and they read the task tick
  // case-sensitively, so `- [X] done` imported UNCHECKED. See
  // `transformers/list.ts` and `nodes/list.ts`.
  CHECK_LIST_TRANSFORMER,
  UNORDERED_LIST_TRANSFORMER,
  ORDERED_LIST_TRANSFORMER,
  // NOT `@lexical/markdown`'s `CODE`: that one captures the info string as a
  // single `[\w-]+` token and pushes the remainder of the fence line into the
  // code body, silently corrupting ```c++ and ```lance table. See
  // `transformers/code.ts`.
  CODE_INFO_TRANSFORMER,
  ...INLINE_TEXT_TRANSFORMERS,
  LINK,
]
