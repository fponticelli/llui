// The core plugin: the GFM superset of nodes, transformers, command items, and
// shortcuts. This is the default plugin when none are supplied, so the minimal
// `markdownEditor()` one-liner still has full keyboard formatting.

import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical'
import { $setBlocksType } from '@lexical/selection'
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text'
import { $createCodeNode } from '@lexical/code-core'
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  registerList,
} from '@lexical/list'
import { TOGGLE_LINK_COMMAND } from '@lexical/link'
import type { CommandItem, MarkdownPlugin } from './types.js'
import { GFM_NODES, GFM_TRANSFORMERS } from '../transformers/gfm.js'

function inline(format: TextFormatType): (editor: LexicalEditor) => void {
  return (editor) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)
}

/** Wrap a node-factory into an editor action that converts the selected blocks. */
function block(create: () => ElementNode): (editor: LexicalEditor) => void {
  return (editor) =>
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) $setBlocksType(selection, create)
    })
}

function heading(tag: HeadingTagType): (editor: LexicalEditor) => void {
  return block(() => $createHeadingNode(tag))
}

export interface CorePluginOptions {
  /** Default href inserted by the `link` command (the link editor refines it). */
  defaultLinkHref?: string
}

export function corePlugin(opts: CorePluginOptions = {}): MarkdownPlugin {
  const defaultHref = opts.defaultLinkHref ?? 'https://'

  const items: CommandItem[] = [
    {
      id: 'bold',
      label: 'Bold',
      icon: 'bold',
      group: 'inline',
      keywords: ['strong'],
      run: inline('bold'),
      isActive: (f) => f.bold,
    },
    {
      id: 'italic',
      label: 'Italic',
      icon: 'italic',
      group: 'inline',
      keywords: ['emphasis'],
      run: inline('italic'),
      isActive: (f) => f.italic,
    },
    {
      id: 'strikethrough',
      label: 'Strikethrough',
      icon: 'strikethrough',
      group: 'inline',
      keywords: ['strike', 'del'],
      run: inline('strikethrough'),
      isActive: (f) => f.strikethrough,
    },
    {
      id: 'code',
      label: 'Inline code',
      icon: 'code',
      group: 'inline',
      keywords: ['mono'],
      run: inline('code'),
      isActive: (f) => f.code,
    },
    {
      id: 'paragraph',
      label: 'Text',
      icon: 'paragraph',
      group: 'block',
      keywords: ['body', 'normal'],
      run: block(() => $createParagraphNode()),
      isActive: (f) => f.blockType === 'paragraph',
    },
    {
      id: 'h1',
      label: 'Heading 1',
      icon: 'h1',
      group: 'block',
      keywords: ['title'],
      run: heading('h1'),
      isActive: (f) => f.blockType === 'h1',
    },
    {
      id: 'h2',
      label: 'Heading 2',
      icon: 'h2',
      group: 'block',
      run: heading('h2'),
      isActive: (f) => f.blockType === 'h2',
    },
    {
      id: 'h3',
      label: 'Heading 3',
      icon: 'h3',
      group: 'block',
      run: heading('h3'),
      isActive: (f) => f.blockType === 'h3',
    },
    {
      id: 'quote',
      label: 'Quote',
      icon: 'quote',
      group: 'block',
      keywords: ['blockquote'],
      run: block(() => $createQuoteNode()),
      isActive: (f) => f.blockType === 'quote',
    },
    {
      id: 'codeBlock',
      label: 'Code block',
      icon: 'code-block',
      group: 'block',
      keywords: ['fence', 'pre'],
      run: block(() => $createCodeNode()),
      isActive: (f) => f.blockType === 'code',
    },
    {
      id: 'bulletList',
      label: 'Bulleted list',
      icon: 'list-bullet',
      group: 'list',
      keywords: ['unordered', 'ul'],
      run: (e) => e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
      isActive: (f) => f.blockType === 'bullet',
    },
    {
      id: 'numberList',
      label: 'Numbered list',
      icon: 'list-number',
      group: 'list',
      keywords: ['ordered', 'ol'],
      run: (e) => e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
      isActive: (f) => f.blockType === 'number',
    },
    {
      id: 'checkList',
      label: 'Task list',
      icon: 'list-check',
      group: 'list',
      keywords: ['todo', 'checkbox'],
      run: (e) => e.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
      isActive: (f) => f.blockType === 'check',
    },
    {
      id: 'link',
      label: 'Link',
      icon: 'link',
      group: 'inline',
      keywords: ['url', 'href'],
      run: (e) => e.dispatchCommand(TOGGLE_LINK_COMMAND, defaultHref),
      isActive: (f) => f.link,
      surfaces: ['toolbar', 'floating', 'context'],
    },
    {
      id: 'undo',
      label: 'Undo',
      icon: 'undo',
      group: 'history',
      run: (e) => e.dispatchCommand(UNDO_COMMAND, undefined),
      isDisabled: (f) => !f.canUndo,
      surfaces: ['toolbar', 'context'],
    },
    {
      id: 'redo',
      label: 'Redo',
      icon: 'redo',
      group: 'history',
      run: (e) => e.dispatchCommand(REDO_COMMAND, undefined),
      isDisabled: (f) => !f.canRedo,
      surfaces: ['toolbar', 'context'],
    },
  ]

  const byId = new Map(items.map((i) => [i.id, i]))
  const shortcut =
    (id: string) =>
    (editor: LexicalEditor): boolean => {
      const item = byId.get(id)
      if (!item) return false
      item.run(editor)
      return true
    }

  return {
    name: 'core',
    nodes: GFM_NODES,
    transformers: GFM_TRANSFORMERS,
    items,
    register: (editor) => registerList(editor),
    shortcuts: [
      { combo: 'Mod-Alt-1', run: shortcut('h1') },
      { combo: 'Mod-Alt-2', run: shortcut('h2') },
      { combo: 'Mod-Alt-3', run: shortcut('h3') },
      { combo: 'Mod-Shift-7', run: shortcut('numberList') },
      { combo: 'Mod-Shift-8', run: shortcut('bulletList') },
      { combo: 'Mod-Shift-9', run: shortcut('quote') },
    ],
  }
}
