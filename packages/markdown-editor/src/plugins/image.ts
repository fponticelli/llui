// Image plugin — a block image rendered via the decorator bridge, round-tripping
// to `![alt](src "title")` markdown, inserted through a plugin-UI dialog (URL +
// alt, with optional file upload). Exercises decorator rendering + a transformer
// + the plugin-UI extension all at once.
//
// The markdown⇄node half lives in `../transformers/image.js` (CommonMark-correct
// parsing); this module owns the UI and the RENDERING — including `resolveSrc`,
// the seam that maps a stored `src` to the URL the `<img>` actually loads.

import { $getSelection, $setSelection, type BaseSelection, type LexicalEditor } from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import {
  $createLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
  type DecoratorBridge,
} from '@llui/lexical'
import { button, div, img, input, text, type Signal } from '@llui/dom'
import {
  connect as connectDialog,
  overlay as overlayDialog,
  type DialogMsg,
} from '@llui/components/dialog'
import { sanitizeImageUrl } from '../security.js'
import { IMAGE_BRIDGE_TYPE, IMAGE_TRANSFORMER, type ImageData } from '../transformers/image.js'
import { definePluginUI } from './ui.js'
import type { MarkdownPlugin } from './types.js'

/**
 * Build the image's decorator sub-view for one plugin instance.
 *
 * ## Sanitize the stored value, THEN resolve
 *
 * The stored `src` reaches this node from ingresses that sanitize (the markdown
 * transformer, the insert dialog) AND from ones that cannot: `importJSON` /
 * `updateFromJSON` write node data raw, which is the collab path, undo, an
 * editor-state swap, and a pasted decorator node. So the render path sanitizes
 * for itself rather than trusting its input — and an unsafe value renders an
 * `<img>` with NO `src` attribute (its alt text shows, and no request is made)
 * marked `data-blocked` for the host to style.
 *
 * `resolveSrc` then runs on the SANITIZED value, and its result is deliberately
 * NOT re-checked: it is host code, and returning a URL the allowlist would refuse
 * — an app-private `asset:`/`tauri:` scheme — is the entire point of the seam.
 * Running the allowlist afterwards would silently drop exactly the URLs it exists
 * to produce.
 */
function imageBridge(resolveSrc: (src: string) => string): DecoratorBridge {
  return decoratorBridge<ImageData>(IMAGE_BRIDGE_TYPE, (data) => {
    const safe = (data.at('src') as Signal<string>).map(sanitizeImageUrl)
    return [
      div({ 'data-scope': 'md-image', 'data-part': 'root', contenteditable: 'false' }, [
        img({
          src: safe.map((url) => (url === null ? null : resolveSrc(url))),
          'data-blocked': safe.map((url) => (url === null ? 'true' : null)),
          alt: data.at('alt') as Signal<string>,
          title: (data.at('title') as Signal<string | undefined>).map((t) =>
            t === undefined || t === '' ? null : t,
          ),
        }),
      ]),
    ]
  })
}

interface ImageState {
  dialog: { open: boolean }
  src: string
  alt: string
}

type ImageMsg =
  | { type: 'open' }
  | { type: 'setSrc'; src: string }
  | { type: 'setAlt'; alt: string }
  | { type: 'submit' }
  | { type: 'dialog'; msg: DialogMsg }

type ImageEffect = { type: 'begin' } | { type: 'insert'; src: string; alt: string }

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

export interface ImagePluginOptions {
  /** Upload a chosen file and resolve to its URL. When omitted, the file picker
   * is hidden and only URL entry is offered. */
  upload?: (file: File) => Promise<string>
  /**
   * Map the stored `src` to the URL the `<img>` should load. RENDER-TIME ONLY:
   * the node's data, the serialized markdown, and the URL the insert dialog shows
   * are all unchanged, so a document that stores a portable relative path
   * (`attachments/a.png`) keeps storing it while the editor displays whatever the
   * host can actually load (`asset://localhost/…/attachments/a.png`).
   *
   * The argument is the stored value after the image-src allowlist has run, so it
   * is never a `javascript:` URL; an unsafe src never reaches the resolver at all
   * (the image renders blocked instead). The RESULT is not re-checked — returning
   * an app-private scheme is the point — so treat it as the trusted boundary it
   * is, and return `src` unchanged for anything the host does not own.
   *
   * Called during rendering, so it must be a pure function of `src` for the
   * lifetime of the mount: it re-runs when the node's `src` changes, not when
   * something the closure captured does. If the mapping itself changes (the host
   * opens a different vault), remount the editor.
   *
   * The read-only renderer's counterpart is `@llui/markdown`'s `transformLink`,
   * which sees links and images with their mdast node; one host function can back
   * both. Defaults to identity.
   */
  resolveSrc?: (src: string) => string
}

export function imagePlugin(opts: ImagePluginOptions = {}): MarkdownPlugin {
  // Keyed by the per-mount editor so two mounts never cross-wire the selection
  // saved while the insert dialog is open.
  const savedSelection = new WeakMap<LexicalEditor, BaseSelection | null>()
  // Built per plugin instance: the bridge closes over this instance's resolver,
  // and bridges are registered per editor, so two editors with different
  // resolvers never cross-wire.
  const bridge = imageBridge(opts.resolveSrc ?? ((src) => src))

  return {
    name: 'image',
    nodes: [LLuiDecoratorNode],
    decorators: [bridge],
    transformers: [IMAGE_TRANSFORMER],
    items: [
      {
        id: 'image',
        label: 'Image',
        icon: 'image',
        group: 'insert',
        keywords: ['img', 'picture', 'photo'],
        run: (_editor, ctx) => ctx.send({ type: 'plugin', name: 'image', msg: { type: 'open' } }),
        surfaces: ['toolbar', 'slash', 'context'],
      },
    ],
    ui: definePluginUI<ImageState, ImageMsg, ImageEffect>({
      init: () => ({ dialog: { open: false }, src: '', alt: '' }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'open':
            return [{ dialog: { open: true }, src: '', alt: '' }, [{ type: 'begin' }]]
          case 'setSrc':
            return { ...state, src: msg.src }
          case 'setAlt':
            return { ...state, alt: msg.alt }
          case 'submit':
            return [
              { ...state, dialog: { open: false } },
              [{ type: 'insert', src: state.src, alt: state.alt }],
            ]
          case 'dialog': {
            const open = dialogOpen(msg.msg, state.dialog.open)
            return open === state.dialog.open ? state : { ...state, dialog: { open } }
          }
        }
      },
      view: ({ state, send }) => {
        const dialogSend = (msg: DialogMsg): void => send({ type: 'dialog', msg })
        const parts = connectDialog(state.at('dialog'), dialogSend, {
          id: 'md-image-dialog',
          closeLabel: 'Cancel',
        })
        return [
          overlayDialog({
            state: state.at('dialog'),
            send: dialogSend,
            parts,
            content: () => [
              div({ ...parts.content, 'data-md-link': 'box' }, [
                div({ ...parts.title, 'data-md-link': 'title' }, [text('Insert image')]),
                input({
                  'data-md-link': 'input',
                  type: 'url',
                  placeholder: 'https://example.com/image.png',
                  value: state.at('src') as Signal<string>,
                  onInput: (e: Event) =>
                    send({ type: 'setSrc', src: (e.target as HTMLInputElement).value }),
                }),
                input({
                  'data-md-link': 'input',
                  'data-md-image': 'alt',
                  type: 'text',
                  placeholder: 'Alt text (description)',
                  value: state.at('alt') as Signal<string>,
                  onInput: (e: Event) =>
                    send({ type: 'setAlt', alt: (e.target as HTMLInputElement).value }),
                }),
                ...(opts.upload
                  ? [
                      input({
                        'data-md-image': 'file',
                        type: 'file',
                        accept: 'image/*',
                        onChange: (e: Event) => {
                          const file = (e.target as HTMLInputElement).files?.[0]
                          if (file && opts.upload) {
                            void opts.upload(file).then((src) => send({ type: 'setSrc', src }))
                          }
                        },
                      }),
                    ]
                  : []),
                div({ 'data-md-link': 'actions' }, [
                  button({ ...parts.closeTrigger, 'data-md-link': 'cancel' }, [text('Cancel')]),
                  button(
                    {
                      type: 'button',
                      'data-md-link': 'apply',
                      onClick: () => send({ type: 'submit' }),
                    },
                    [text('Insert')],
                  ),
                ]),
              ]),
            ],
          }),
        ]
      },
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
          return
        }
        // Enforce the image-src allowlist at insert: a disallowed scheme drops
        // the insertion rather than binding the decorator to an unsafe src.
        // `resolveSrc` is deliberately NOT consulted here — it maps a stored
        // value for display and must never be able to launder an unsafe one
        // into the document.
        const src = sanitizeImageUrl(effect.src.trim())
        if (src === null) return
        const saved = savedSelection.get(editor) ?? null
        const data: ImageData = { src, alt: effect.alt }
        editor.update(() => {
          if (saved) $setSelection(saved.clone())
          $insertNodeToNearestRoot($createLLuiDecoratorNode(IMAGE_BRIDGE_TYPE, data))
        })
        savedSelection.delete(editor)
      },
    }),
  }
}
