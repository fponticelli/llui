// The link plugin — a stateful, UI-bearing feature built entirely as a plugin
// (no core editor changes). It owns its dialog state, its view (the modal), and
// its effects (save/restore selection + toggle the link). This is the proof that
// the plugin-UI extension makes such features pluggable rather than built-in.

import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  type BaseSelection,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
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
  /**
   * NodeKey of the link being edited via a click, or `null` for the
   * toolbar/create path (which works off the live selection). When set, submit
   * repoints THAT link by key instead of running `$toggleLink` on the selection.
   */
  editKey: NodeKey | null
}

type LinkMsg =
  | { type: 'open' }
  | { type: 'show'; url: string }
  | { type: 'editKey'; key: NodeKey; url: string }
  | { type: 'setUrl'; url: string }
  | { type: 'submit' }
  | { type: 'dialog'; msg: DialogMsg }
  | { type: 'follow'; url: string }

type LinkEffect =
  | { type: 'begin' }
  | { type: 'commit'; url: string }
  | { type: 'updateByKey'; key: NodeKey; url: string }
  | { type: 'follow'; url: string }

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
  /**
   * Follow (open) a link's URL on ⌘/Ctrl-click. The host owns how a URL opens —
   * a plain browser wants a new tab, a Tauri/Electron shell wants the external
   * browser — so this is a seam. When omitted, a browser default opens the URL in
   * a new tab; off-browser (no `window`) it is a no-op.
   */
  onFollow?: (url: string) => void
}

/** Browser default when the host provides no {@link LinkPluginOptions.onFollow}. */
function defaultFollow(url: string): void {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
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
    // ⌘/Ctrl-click follows a link (plain click keeps placing the caret, so the
    // link text stays editable). The URL to edit is reached the usual way — put
    // the caret in the link and hit the toolbar's link button (the dialog
    // pre-fills the current URL).
    register: (editor, ctx) => {
      return editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          // The command callback already runs inside an editor context, so the
          // `$`-helpers work directly — wrapping them in a bare `.read()` would
          // strip the active editor and break `$getNearestNodeFromDOMNode`.
          const dom = event.target
          if (!(dom instanceof Node)) return false
          const node = $getNearestNodeFromDOMNode(dom)
          const link = node ? $findMatchingParent(node, $isLinkNode) : null
          if (!$isLinkNode(link)) return false
          if (event.metaKey || event.ctrlKey) {
            // ⌘/Ctrl-click → follow (the host opens the URL — external browser
            // in a shell app, a new tab in a plain browser).
            const url = link.getURL()
            if (url === '') return false
            event.preventDefault()
            ctx.emit({ type: 'plugin', name: PLUGIN, msg: { type: 'follow', url } })
            return true
          }
          // Plain click → edit (parity with the document-link click-to-edit).
          // Hand the link's key + current URL to the dialog directly — no
          // selection round-trip, so it can't race this command's own update.
          // Submit repoints THIS link by key.
          event.preventDefault()
          ctx.emit({
            type: 'plugin',
            name: PLUGIN,
            msg: { type: 'editKey', key: link.getKey(), url: link.getURL() },
          })
          return true
        },
        COMMAND_PRIORITY_LOW,
      )
    },
    ui: definePluginUI<LinkState, LinkMsg, LinkEffect>({
      init: () => ({ dialog: { open: false }, url: opts.defaultUrl ?? '', editKey: null }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'open':
            // Toolbar / create path: the selection is the source of truth.
            return [{ ...state, editKey: null }, [{ type: 'begin' }]]
          case 'show':
            return { ...state, dialog: { open: true }, url: msg.url }
          case 'editKey':
            // Click-to-edit: dialog opens straight away, remembering the link.
            return { ...state, dialog: { open: true }, url: msg.url, editKey: msg.key }
          case 'setUrl':
            return { ...state, url: msg.url }
          case 'submit':
            return [
              { ...state, dialog: { open: false }, editKey: null },
              [
                state.editKey !== null
                  ? { type: 'updateByKey', key: state.editKey, url: state.url }
                  : { type: 'commit', url: state.url },
              ],
            ]
          case 'dialog': {
            const open = dialogOpen(msg.msg, state.dialog.open)
            if (open === state.dialog.open) return state
            return { ...state, dialog: { open }, editKey: open ? state.editKey : null }
          }
          case 'follow':
            return [state, [{ type: 'follow', url: msg.url }]]
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
        if (effect.type === 'follow') {
          ;(opts.onFollow ?? defaultFollow)(effect.url)
          return
        }
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
        // Enforce the URL-scheme allowlist on commit: a `javascript:`/`data:` href
        // sanitizes to null → unlink. The global LinkNode transform is the
        // backstop, but blocking here avoids ever materializing the unsafe link.
        const safe = sanitizeLinkUrl(effect.url.trim())
        if (effect.type === 'updateByKey') {
          // Click-to-edit: repoint THIS link by key (no selection round-trip).
          editor.update(() => {
            const node = $getNodeByKey(effect.key)
            if (!$isLinkNode(node)) return
            if (safe === null || safe === '') {
              // Cleared URL → unlink: lift the link's children out, drop the link.
              let anchor: LexicalNode = node
              for (const child of node.getChildren()) {
                anchor.insertAfter(child)
                anchor = child
              }
              node.remove()
            } else {
              node.setURL(safe)
            }
          })
          return
        }
        // commit (toolbar / create): `$toggleLink` over the saved selection.
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
