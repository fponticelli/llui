// Shared inline text-formatting building blocks: the bold / italic /
// strikethrough / code command items and the `FORMAT_TEXT_COMMAND` dispatcher.
// Both `corePlugin` (the full GFM superset) and `singleBlockPlugin` (inline-only)
// derive their inline surface from here, so the canonical inline-format set and
// its labels/icons/keywords live in exactly one place.

import { FORMAT_TEXT_COMMAND, type LexicalEditor, type TextFormatType } from 'lexical'
import type { FormatState } from '../state.js'
import type { CommandItem } from './types.js'

/** An inline text-format surfaced as a toolbar command item. */
export type InlineFormat = 'bold' | 'italic' | 'strikethrough' | 'code'

/** The full inline-format set, in toolbar order. */
export const INLINE_FORMATS: readonly InlineFormat[] = ['bold', 'italic', 'strikethrough', 'code']

interface InlineFormatDef {
  label: string
  icon: string
  keywords: readonly string[]
  format: TextFormatType
  isActive: (f: FormatState) => boolean
}

const DEFS: Record<InlineFormat, InlineFormatDef> = {
  bold: {
    label: 'Bold',
    icon: 'bold',
    keywords: ['strong'],
    format: 'bold',
    isActive: (f) => f.bold,
  },
  italic: {
    label: 'Italic',
    icon: 'italic',
    keywords: ['emphasis'],
    format: 'italic',
    isActive: (f) => f.italic,
  },
  strikethrough: {
    label: 'Strikethrough',
    icon: 'strikethrough',
    keywords: ['strike', 'del'],
    format: 'strikethrough',
    isActive: (f) => f.strikethrough,
  },
  code: {
    label: 'Inline code',
    icon: 'code',
    keywords: ['mono'],
    format: 'code',
    isActive: (f) => f.code,
  },
}

/** Dispatch a text-format toggle on the live editor. */
export function inlineFormatCommand(format: TextFormatType): (editor: LexicalEditor) => void {
  return (editor) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
}

/** Build the inline `CommandItem`s for `formats` (default: all four), grouped
 * under `'inline'`. Surfaces are left unset (item appears in every surface). */
export function inlineItems(formats: readonly InlineFormat[] = INLINE_FORMATS): CommandItem[] {
  return formats.map((id) => {
    const def = DEFS[id]
    return {
      id,
      label: def.label,
      icon: def.icon,
      group: 'inline',
      keywords: def.keywords,
      run: inlineFormatCommand(def.format),
      isActive: def.isActive,
    }
  })
}
