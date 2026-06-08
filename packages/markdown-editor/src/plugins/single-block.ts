// The single-block plugin: constrains the editor to exactly ONE paragraph that
// holds only inline content (bold / italic / strikethrough / code, optionally
// links). No headings, lists, quotes, code blocks, or multiple paragraphs.
//
// It enforces the invariant two ways, so it holds no matter how content arrives
// (typing, the markdown seed, or a paste):
//   1. The transformer set contributes ONLY inline text-format transformers, so
//      block markdown (`# `, `- `, `> `, fenced code) is never parsed into block
//      nodes — `registerMarkdownShortcuts` and `$convertFromMarkdownString` both
//      read from this set.
//   2. A RootNode transform coalesces the document back to a single paragraph of
//      inline leaves whenever anything slips through (a multi-paragraph paste, a
//      multi-line seed). Enter is intercepted so it never splits the paragraph.
//
// `singleBlockPlugin()` REPLACES the default plugin set — pass it instead of
// `corePlugin()`. A dev-only guard warns when block-contributing plugins are
// composed alongside it (since a plugin is additive and can't un-register them).

import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  RootNode,
  type ElementNode,
  type LexicalNode,
  type ParagraphNode,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import { LinkNode } from '@lexical/link'
import { LINK, type Transformer } from '@lexical/markdown'
import type { CommandItem, MarkdownPlugin } from './types.js'
import { inlineItems, type InlineFormat } from './inline.js'
import { INLINE_TEXT_TRANSFORMERS } from '../transformers/gfm.js'

export type { InlineFormat }

// `import.meta.env.DEV` is substituted by Vite/Rollup at build time; raw tsc /
// vitest see it as undefined, so the dev guard stays off there unless the
// bundler sets it. (Augmented locally so the package carries no build-tool dep.)
declare global {
  interface ImportMeta {
    env?: { DEV?: boolean; MODE?: string }
  }
}

export interface SingleBlockPluginOptions {
  /** Inline formats surfaced as toolbar items.
   * Default `['bold', 'italic', 'strikethrough', 'code']`. NOTE: this limits the
   * toolbar buttons only — markdown syntax (`*x*`) and Ctrl/⌘ shortcuts still
   * apply every inline format, and all inline markdown round-trips regardless. */
  formats?: readonly InlineFormat[]
  /** Allow soft line breaks within the single paragraph. When `false` (default)
   * Enter is inert and pasted/seeded line breaks collapse to spaces — a strict
   * single-line field. When `true`, Enter inserts a `\n` and merged lines are
   * joined with a line break instead of a space. A new paragraph is never made. */
  allowLineBreaks?: boolean
  /** Register `LinkNode` + the markdown link transformer so inline links
   * round-trip. Default `false`. Compose with `linkPlugin()` for the toolbar
   * button + insert dialog. */
  link?: boolean
}

/** Is this node an inline leaf that belongs directly inside a paragraph? */
function isInlineLeaf(node: LexicalNode): boolean {
  return $isTextNode(node) || $isLineBreakNode(node) || ($isElementNode(node) && node.isInline())
}

/** Decompose a block element into "lines" — each line is the inline content of
 * one leaf block (paragraph, heading, list item, …). Recurses through nested
 * block containers (a list → its items) so every leaf block becomes its own
 * line; this is what lets adjacent list items be separator-joined rather than
 * mashed together. */
function blockLines(node: ElementNode): LexicalNode[][] {
  const children = node.getChildren()
  const hasBlockChildren = children.some((c) => $isElementNode(c) && !c.isInline())
  if (!hasBlockChildren) {
    return [children.filter(isInlineLeaf)]
  }
  const lines: LexicalNode[][] = []
  for (const child of children) {
    if ($isElementNode(child) && !child.isInline()) lines.push(...blockLines(child))
    else if (isInlineLeaf(child)) lines.push([child])
  }
  return lines
}

/** Collapse every line break in a paragraph to a single space (single-line
 * mode) so adjacent lines don't mash into one word. */
function collapseLineBreaks(para: ParagraphNode): void {
  for (const child of para.getChildren()) {
    if ($isLineBreakNode(child)) child.replace($createTextNode(' '))
  }
}

/** Coalesce the document to exactly one paragraph of inline content. Returns the
 * `RootNode` transform the plugin registers. */
function makeEnforce(allowLineBreaks: boolean): (root: RootNode) => void {
  return (root) => {
    const children = root.getChildren()

    // Fast path: already a single paragraph — only fix stray line breaks.
    if (children.length === 1 && $isParagraphNode(children[0])) {
      if (!allowLineBreaks) collapseLineBreaks(children[0])
      return
    }

    // Gather the inline content of every leaf block as a separate line.
    const lines: LexicalNode[][] = []
    for (const child of children) {
      if ($isElementNode(child)) {
        if (child.isInline()) lines.push([child])
        else lines.push(...blockLines(child))
      } else if (isInlineLeaf(child)) {
        lines.push([child])
      }
    }

    const para = $createParagraphNode()
    let first = true
    for (const line of lines) {
      if (line.length === 0) continue
      if (!first) para.append(allowLineBreaks ? $createLineBreakNode() : $createTextNode(' '))
      for (const node of line) para.append(node)
      first = false
    }
    if (!allowLineBreaks) collapseLineBreaks(para)
    root.clear()
    root.append(para)
  }
}

export function singleBlockPlugin(opts: SingleBlockPluginOptions = {}): MarkdownPlugin {
  const allowLineBreaks = opts.allowLineBreaks ?? false
  const linkEnabled = opts.link ?? false

  const items: CommandItem[] = inlineItems(opts.formats)

  const transformers: Transformer[] = [...INLINE_TEXT_TRANSFORMERS]
  if (linkEnabled) transformers.push(LINK)

  const enforce = makeEnforce(allowLineBreaks)

  const onEnter = (event: KeyboardEvent | null): boolean => {
    if (!allowLineBreaks) {
      // Inert: never split the paragraph, never insert a break.
      event?.preventDefault()
      return true
    }
    // Convert a plain Enter (which would split the paragraph) into a soft line
    // break; let Shift+Enter fall through to the default soft-break handler.
    if (event && event.shiftKey) return false
    event?.preventDefault()
    const selection = $getSelection()
    if ($isRangeSelection(selection)) selection.insertLineBreak()
    return true
  }

  return {
    name: 'single-block',
    ...(linkEnabled ? { nodes: [LinkNode] } : {}),
    transformers,
    items,
    // Dev guard: single-block REPLACES the default plugin set, but a plugin is
    // additive and can't un-register a sibling's block contributions. If another
    // plugin's command items introduce block/structural content, warn loudly so
    // the silently-broken `[corePlugin(), singleBlockPlugin()]` combo is caught.
    onItems: (all) => {
      if (import.meta.env?.DEV !== true) return
      const structural = all.filter((i) => i.group && i.group !== 'inline' && i.group !== 'history')
      if (structural.length === 0) return
      const ids = structural.map((i) => i.id).join(', ')
      console.warn(
        `[llui] singleBlockPlugin: other plugins contribute block/structural commands (${ids}). ` +
          `single-block REPLACES the default plugin set — pass it INSTEAD OF corePlugin (and any ` +
          `block/insert plugins). Block content may otherwise reappear and the single-paragraph ` +
          `constraint won't hold.`,
      )
    },
    register: (editor) =>
      mergeRegister(
        editor.registerNodeTransform(RootNode, enforce),
        editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_HIGH),
      ),
  }
}
