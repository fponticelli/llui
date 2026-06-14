// Markdown-on-paste: when the user pastes plain text into the editor, parse it
// as Markdown and insert the resulting rich nodes at the caret instead of the
// literal source. Rich pastes (clipboards carrying `text/html`) are left to
// Lexical's own HTML import so copy-from-the-web keeps its formatting. Disabled
// per-editor via the `pasteMarkdown: false` config option.

import {
  $createParagraphNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  isDOMNode,
  isSelectionCapturedInDecoratorInput,
  type LexicalEditor,
} from 'lexical'
import { $convertFromMarkdownString, type Transformer } from '@lexical/markdown'

/**
 * Parse `markdown` with `transformers` and insert the produced nodes at the
 * current range selection. The document is parsed into a detached scratch
 * container (so the live root is never cleared) and the selection captured
 * before the import — which moves the caret into the scratch node — is restored
 * before the nodes are spliced in. Returns `true` only when nodes were actually
 * inserted; `false` (a no-op) when there is no range selection to insert into or
 * the markdown parsed to nothing — letting the caller fall back to the default
 * paste behaviour instead of silently swallowing the event.
 */
export function $insertMarkdownAtSelection(
  markdown: string,
  transformers: Array<Transformer>,
): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  const saved = selection.clone()

  // Import into a detached element so `$convertFromMarkdownString`'s `root.clear()`
  // touches the scratch node, not the live document.
  const scratch = $createParagraphNode()
  $convertFromMarkdownString(markdown, transformers, scratch)
  const nodes = scratch.getChildren()
  if (nodes.length === 0) return false

  // The import re-homes the selection to the scratch node's start; restore the
  // real caret, then splice the parsed nodes in (splitting blocks as needed).
  $setSelection(saved)
  $insertNodes(nodes)
  return true
}

/**
 * Register the markdown-on-paste handler on `editor`. Returns a disposer.
 *
 * Plain-text pastes are converted as Markdown. Pastes that also carry
 * `text/html` are ignored so Lexical's richer HTML import handles them.
 */
export function registerMarkdownPaste(
  editor: LexicalEditor,
  transformers: Array<Transformer>,
): () => void {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event: ClipboardEvent) => {
      // Let native inputs inside a DecoratorNode paste themselves (mirrors
      // Lexical's own rich-text paste guard).
      if (isDOMNode(event.target) && isSelectionCapturedInDecoratorInput(event.target)) return false
      const clipboard = event.clipboardData
      if (!clipboard) return false
      // Defer to Lexical's HTML import when the source provides rich content.
      if (clipboard.types.includes('text/html')) return false
      const text = clipboard.getData('text/plain')
      if (!text) return false

      // Command listeners run inside a read context, so we can inspect the
      // selection synchronously. Only claim the event when there is a range
      // selection to insert into; otherwise fall through to Lexical's default
      // paste handler (e.g. a selected decorator/NodeSelection) rather than
      // swallowing the paste.
      if (!$isRangeSelection($getSelection())) return false

      event.preventDefault()
      editor.update(() => {
        $insertMarkdownAtSelection(text, transformers)
      })
      return true
    },
    COMMAND_PRIORITY_HIGH,
  )
}
