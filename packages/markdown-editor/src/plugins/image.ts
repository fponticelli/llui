// Image plugin — a block image rendered via the decorator bridge, round-tripping
// to `![alt](src)` markdown, inserted through a plugin-UI dialog (URL + alt, with
// optional file upload). Exercises decorator rendering + a transformer + the
// plugin-UI extension all at once.

import {
  $getSelection,
  $setSelection,
  type BaseSelection,
  type ElementNode,
  type LexicalNode,
} from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import type { ElementTransformer } from '@lexical/markdown'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { button, component, div, img, input, text, type Signal } from '@llui/dom'
import {
  connect as connectDialog,
  overlay as overlayDialog,
  type DialogMsg,
} from '@llui/components/dialog'
import { definePluginUI } from './ui.js'
import type { MarkdownPlugin } from './types.js'

const BRIDGE_TYPE = 'image'

interface ImageData {
  src: string
  alt: string
}

function isImageData(value: unknown): value is ImageData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ImageData).src === 'string' &&
    typeof (value as ImageData).alt === 'string'
  )
}

const imageBridge = decoratorBridge<ImageData, ImageData, { type: 'noop' }, never>(
  BRIDGE_TYPE,
  (data) =>
    component<ImageData, { type: 'noop' }, never>({
      name: 'Image',
      init: () => ({ src: data.src, alt: data.alt }),
      update: (state) => state,
      view: ({ state }) => [
        div({ 'data-scope': 'md-image', 'data-part': 'root', contenteditable: 'false' }, [
          img({ src: state.at('src') as Signal<string>, alt: state.at('alt') as Signal<string> }),
        ]),
      ],
    }),
)

const IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [LLuiDecoratorNode],
  export: (node: LexicalNode): string | null => {
    if (!$isLLuiDecoratorNode(node) || node.getBridgeType() !== BRIDGE_TYPE) return null
    const data = node.getData()
    return isImageData(data) ? `![${data.alt}](${data.src})` : null
  },
  regExp: /^!\[([^\]]*)\]\(([^)]+)\)$/,
  replace: (parentNode: ElementNode, _children, match): void => {
    parentNode.replace(
      $createLLuiDecoratorNode(BRIDGE_TYPE, { alt: match[1] ?? '', src: match[2] ?? '' }),
    )
  },
  type: 'element',
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
}

export function imagePlugin(opts: ImagePluginOptions = {}): MarkdownPlugin {
  let savedSelection: BaseSelection | null = null

  return {
    name: 'image',
    nodes: [LLuiDecoratorNode],
    decorators: [imageBridge],
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
          savedSelection = editor.getEditorState().read(() => {
            const selection = $getSelection()
            return selection ? selection.clone() : null
          })
          return
        }
        if (effect.src.trim() === '') return
        editor.update(() => {
          if (savedSelection) $setSelection(savedSelection.clone())
          $insertNodeToNearestRoot(
            $createLLuiDecoratorNode(BRIDGE_TYPE, { src: effect.src.trim(), alt: effect.alt }),
          )
        })
        savedSelection = null
      },
    }),
  }
}
