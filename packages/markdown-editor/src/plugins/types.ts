// The markdown plugin contract: extends the engine-level LexicalPlugin with
// markdown transformers and UI command items (toolbar / slash / context).

import type { LexicalEditor } from 'lexical'
import type { Transformer } from '@lexical/markdown'
import type { LexicalPlugin } from '@llui/lexical'
import type { EditorOutMsg, FormatState } from '../state.js'

/** Which surfaces a command item appears in (default: all). */
export type ItemSurface = 'toolbar' | 'floating' | 'slash' | 'context'

/** A user-invokable editor command surfaced to the chrome. Its reactive
 * active/disabled state is read from {@link FormatState}; `run` mutates the
 * live editor. */
export interface CommandItem {
  /** Stable id (also the `runCommand` payload). */
  id: string
  label: string
  /** Optional icon hint (class / svg id); rendering is the consumer's CSS. */
  icon?: string
  /** Grouping key for menu sectioning. */
  group?: string
  /** Keyword aliases for slash/command-palette filtering. */
  keywords?: readonly string[]
  isActive?: (format: FormatState) => boolean
  isDisabled?: (format: FormatState) => boolean
  run: (editor: LexicalEditor) => void
  surfaces?: readonly ItemSurface[]
}

/** A markdown editor plugin: engine wiring + transformers + UI items. */
export interface MarkdownPlugin extends LexicalPlugin<EditorOutMsg> {
  /** Markdown ↔ node transformers contributed to the registry. */
  transformers?: readonly Transformer[]
  /** Command items surfaced to the toolbar / slash / context menus. */
  items?: readonly CommandItem[]
}
