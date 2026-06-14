// Math plugin — a block math node ($$…$$) rendered via the decorator bridge. The
// TeX source is editable inline (persists on blur); an optional `render` callback
// (e.g. KaTeX) turns it into a typeset preview. Round-trips to `$$tex$$`.

import { type ElementNode, type LexicalNode } from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import type { ElementTransformer } from '@lexical/markdown'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { component, div, span, text, type Mountable, type Signal } from '@llui/dom'
import type { MarkdownPlugin } from './types.js'
import { renderedPreview, type PreviewRender } from './_preview.js'

const BRIDGE_TYPE = 'math'

interface MathData {
  tex: string
}

function isMathData(value: unknown): value is MathData {
  return typeof value === 'object' && value !== null && typeof (value as MathData).tex === 'string'
}

type MathMsg = { type: 'commit'; tex: string }

const stop = (e: Event): void => e.stopPropagation()

export interface MathPluginOptions {
  /** Typeset TeX to an HTML string (e.g. via KaTeX). When omitted, the raw TeX is
   * shown in a styled box. */
  /** Render the TeX source to a preview. Return a DOM `Node` (mounted
   * directly, no sanitization) or a **trusted HTML string** (injected as-is
   * — sanitize it yourself, e.g. via DOMPurify, since it carries document
   * content). See `renderedPreview`. */
  render?: PreviewRender
}

export function mathPlugin(opts: MathPluginOptions = {}): MarkdownPlugin {
  const bridge = decoratorBridge<MathData, MathData, MathMsg, never>(BRIDGE_TYPE, (data, api) =>
    component<MathData, MathMsg, never>({
      name: 'Math',
      init: () => ({ tex: data.tex }),
      update: (state, msg) => {
        if (msg.type === 'commit') {
          if (msg.tex === state.tex) return state
          api.update({ tex: msg.tex })
          return { tex: msg.tex }
        }
        return state
      },
      view: ({ state, send }) => {
        const children: Mountable[] = [
          span(
            {
              'data-part': 'source',
              contenteditable: 'true',
              role: 'textbox',
              'aria-label': 'TeX source',
              onKeyDown: stop,
              onBeforeInput: stop,
              onPaste: stop,
              onBlur: (e: FocusEvent) =>
                send({ type: 'commit', tex: (e.target as HTMLElement).textContent ?? '' }),
            },
            [text(state.at('tex') as Signal<string>)],
          ),
        ]
        if (opts.render) {
          children.push(renderedPreview(state.at('tex') as Signal<string>, opts.render, 'span'))
        }
        return [
          div({ 'data-scope': 'md-math', 'data-part': 'root', contenteditable: 'false' }, children),
        ]
      },
    }),
  )

  const transformer: ElementTransformer = {
    dependencies: [LLuiDecoratorNode],
    export: (node: LexicalNode): string | null => {
      if (!$isLLuiDecoratorNode(node) || node.getBridgeType() !== BRIDGE_TYPE) return null
      const data = node.getData()
      return isMathData(data) ? `$$${data.tex}$$` : null
    },
    regExp: /^\$\$(.+)\$\$$/,
    replace: (parentNode: ElementNode, _children, match): void => {
      parentNode.replace($createLLuiDecoratorNode(BRIDGE_TYPE, { tex: match[1] ?? '' }))
    },
    type: 'element',
  }

  return {
    name: 'math',
    nodes: [LLuiDecoratorNode],
    decorators: [bridge],
    transformers: [transformer],
    items: [
      {
        id: 'math',
        label: 'Math block',
        icon: 'math',
        group: 'insert',
        keywords: ['latex', 'tex', 'equation', 'formula'],
        run: (editor) =>
          editor.update(() =>
            $insertNodeToNearestRoot($createLLuiDecoratorNode(BRIDGE_TYPE, { tex: 'e = mc^2' })),
          ),
        surfaces: ['slash', 'context'],
      },
    ],
  }
}
