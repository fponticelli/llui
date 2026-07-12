// The link plugin — a stateful, UI-bearing feature built entirely as a plugin
// (no core editor changes). It owns its dialog state, its view (the modal), and
// its effects (save/restore selection + toggle the link). This is the proof that
// the plugin-UI extension makes such features pluggable rather than built-in.

import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type LexicalEditor,
} from 'lexical'
import { $findMatchingParent } from '@lexical/utils'
import { $isLinkNode, $toggleLink } from '@lexical/link'
import type { DialogMsg, DialogState } from '@llui/components/dialog'
import { linkDialog } from '../surfaces/link-dialog.js'
import { sanitizeLinkUrl } from '../security.js'
import { definePluginUI } from './ui.js'
import type { CommandItem, MarkdownPlugin } from './types.js'

const PLUGIN = 'link'

interface LinkState {
  dialog: DialogState
  url: string
}

type LinkMsg =
  | { type: 'open' }
  | { type: 'show'; url: string }
  | { type: 'setUrl'; url: string }
  | { type: 'submit' }
  | { type: 'dialog'; msg: DialogMsg }

type LinkEffect = { type: 'begin' } | { type: 'commit'; url: string }

/** Read the URL of the link wrapping the current selection (empty if none). */
function readLinkUrl(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return ''
    const link = $findMatchingParent(selection.anchor.getNode(), (node) => $isLinkNode(node))
    return $isLinkNode(link) ? link.getURL() : ''
  })
}

function dialogOpen(msg: DialogMsg, current: boolean): boolean {
  switch (msg.type) {
    case 'open':
      return true
    case 'close':
      return false
    case 'toggle':
      return !current
    case 'setOpen':
      return msg.open
    case 'animationEnd':
    case 'transitionEnd':
      return current
  }
}

export interface LinkPluginOptions {
  /** Default URL pre-filled when there's no existing link (default ''). */
  defaultUrl?: string
}

export function linkPlugin(opts: LinkPluginOptions = {}): MarkdownPlugin {
  // Selection saved when the dialog opens (the modal steals focus/selection),
  // restored on commit. Keyed by the per-mount editor so two mounts of the same
  // plugin instance never cross-wire their saved selection.
  const savedSelection = new WeakMap<LexicalEditor, BaseSelection | null>()

  const item: CommandItem = {
    id: 'link',
    label: 'Link',
    icon: 'link',
    group: 'inline',
    keywords: ['url', 'href'],
    run: (_editor, ctx) => ctx.send({ type: 'plugin', name: PLUGIN, msg: { type: 'open' } }),
    isActive: (f) => f.link,
    surfaces: ['toolbar', 'floating', 'context'],
  }

  return {
    name: PLUGIN,
    items: [item],
    ui: definePluginUI<LinkState, LinkMsg, LinkEffect>({
      init: () => ({ dialog: { open: false }, url: opts.defaultUrl ?? '' }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'open':
            return [state, [{ type: 'begin' }]]
          case 'show':
            return { dialog: { open: true }, url: msg.url }
          case 'setUrl':
            return { ...state, url: msg.url }
          case 'submit':
            return [{ ...state, dialog: { open: false } }, [{ type: 'commit', url: state.url }]]
          case 'dialog': {
            const open = dialogOpen(msg.msg, state.dialog.open)
            return open === state.dialog.open ? state : { ...state, dialog: { open } }
          }
        }
      },
      view: ({ state, send }) => [
        linkDialog({
          dialog: state.at('dialog'),
          url: state.at('url'),
          onInput: (url) => send({ type: 'setUrl', url }),
          onSubmit: () => send({ type: 'submit' }),
          onDialog: (msg) => send({ type: 'dialog', msg }),
        }),
      ],
      onEffect: (effect, ctx) => {
        const editor = ctx.editor()
        if (!editor) return
        if (effect.type === 'begin') {
          savedSelection.set(
            editor,
            editor.getEditorState().read(() => {
              const selection = $getSelection()
              return selection ? selection.clone() : null
            }),
          )
          ctx.send({ type: 'show', url: readLinkUrl(editor) })
          return
        }
        // Enforce the URL-scheme allowlist at commit: a `javascript:`/`data:`
        // href sanitizes to null → no link is created (unlink). The global
        // LinkNode transform is the backstop, but blocking here avoids ever
        // materializing the unsafe link.
        const safe = sanitizeLinkUrl(effect.url.trim())
        const saved = savedSelection.get(editor) ?? null
        editor.update(() => {
          if (saved) $setSelection(saved.clone())
          $toggleLink(safe === null || safe === '' ? null : safe)
        })
        savedSelection.delete(editor)
      },
    }),
  }
}
