// The markdown plugin contract: extends the engine-level LexicalPlugin with
// markdown transformers and UI command items (toolbar / slash / context).

import type { LexicalEditor } from 'lexical'
import type { Transformer } from '@lexical/markdown'
import type { LexicalPlugin } from '@llui/lexical'
import type { EditorMsg, EditorOutMsg, FormatState } from '../state.js'
import type { PluginUI } from './ui.js'

/** Which surfaces a command item appears in (default: all). */
export type ItemSurface = 'toolbar' | 'floating' | 'slash' | 'context'

/** Handed to a command item's `run` so it can talk back to the host (e.g. open
 * the link dialog) instead of only mutating the editor. */
export interface CommandContext {
  send: (msg: EditorMsg) => void
}

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
  run: (editor: LexicalEditor, ctx: CommandContext) => void
  surfaces?: readonly ItemSurface[]
}

/** A markdown editor plugin: engine wiring + transformers + UI items + an
 * optional stateful UI extension (its own state slice, reducer, view, effects). */
export interface MarkdownPlugin extends LexicalPlugin<EditorOutMsg> {
  /** Markdown ↔ node transformers contributed to the registry. */
  transformers?: readonly Transformer[]
  /** Command items surfaced to the toolbar / slash / context menus. */
  items?: readonly CommandItem[]
  /** A stateful UI extension keyed by this plugin's `name` (see {@link definePluginUI}). */
  ui?: PluginUI
  /** Receive the merged command items from all plugins (e.g. a slash menu lists
   * every plugin's items). Called once at editor construction. */
  onItems?: (items: readonly CommandItem[]) => void
}
