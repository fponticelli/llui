// Mermaid plugin — a fenced ```mermaid block rendered via the decorator bridge.
// The diagram source is editable (persists on blur); an optional `render` callback
// (e.g. the mermaid library) produces the diagram. Round-trips to a ```mermaid
// fence.
//
// NOTE: place `mermaidPlugin()` BEFORE `corePlugin()` in the plugins array so its
// multiline transformer matches ```mermaid before the generic code-block one.

import { type LexicalNode } from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import type { MultilineElementTransformer } from '@lexical/markdown'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { component, div, text, unsafeHtml, type Mountable, type Signal } from '@llui/dom'
import type { MarkdownPlugin } from './types.js'

const BRIDGE_TYPE = 'mermaid'

interface MermaidData {
  code: string
}

function isMermaidData(value: unknown): value is MermaidData {
  return (
    typeof value === 'object' && value !== null && typeof (value as MermaidData).code === 'string'
  )
}

type MermaidMsg = { type: 'commit'; code: string }

const stop = (e: Event): void => e.stopPropagation()

export interface MermaidPluginOptions {
  /** Render the diagram source to an HTML string (e.g. mermaid). When omitted,
   * the raw source is shown in a styled box. */
  render?: (code: string) => string
}

export function mermaidPlugin(opts: MermaidPluginOptions = {}): MarkdownPlugin {
  const bridge = decoratorBridge<MermaidData, MermaidData, MermaidMsg, never>(
    BRIDGE_TYPE,
    (data, api) =>
      component<MermaidData, MermaidMsg, never>({
        name: 'Mermaid',
        init: () => ({ code: data.code }),
        update: (state, msg) => {
          if (msg.type === 'commit') {
            if (msg.code === state.code) return state
            api.update({ code: msg.code })
            return { code: msg.code }
          }
          return state
        },
        view: ({ state, send }) => {
          const children: Mountable[] = [
            div(
              {
                'data-part': 'source',
                contenteditable: 'true',
                role: 'textbox',
                'aria-label': 'Mermaid source',
                onKeyDown: stop,
                onBeforeInput: stop,
                onPaste: stop,
                onBlur: (e: FocusEvent) =>
                  send({ type: 'commit', code: (e.target as HTMLElement).textContent ?? '' }),
              },
              [text(state.at('code') as Signal<string>)],
            ),
          ]
          if (opts.render) {
            children.push(
              div({ 'data-part': 'preview', contenteditable: 'false' }, [
                unsafeHtml(state.at('code').map((code) => opts.render!(code)) as Signal<string>),
              ]),
            )
          }
          return [
            div(
              { 'data-scope': 'md-mermaid', 'data-part': 'root', contenteditable: 'false' },
              children,
            ),
          ]
        },
      }),
  )

  const transformer: MultilineElementTransformer = {
    dependencies: [LLuiDecoratorNode],
    export: (node: LexicalNode): string | null => {
      if (!$isLLuiDecoratorNode(node) || node.getBridgeType() !== BRIDGE_TYPE) return null
      const data = node.getData()
      return isMermaidData(data) ? '```mermaid\n' + data.code + '\n```' : null
    },
    regExpStart: /^```mermaid$/,
    regExpEnd: /^```$/,
    replace: (rootNode, _children, _startMatch, _endMatch, linesInBetween): boolean => {
      const lines = [...(linesInBetween ?? [])]
      while (lines.length > 0 && lines[0] === '') lines.shift()
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      rootNode.append($createLLuiDecoratorNode(BRIDGE_TYPE, { code: lines.join('\n') }))
      return true
    },
    type: 'multiline-element',
  }

  return {
    name: 'mermaid',
    nodes: [LLuiDecoratorNode],
    decorators: [bridge],
    transformers: [transformer],
    items: [
      {
        id: 'mermaid',
        label: 'Diagram',
        icon: 'mermaid',
        group: 'insert',
        keywords: ['mermaid', 'diagram', 'flowchart', 'graph'],
        run: (editor) =>
          editor.update(() =>
            $insertNodeToNearestRoot(
              $createLLuiDecoratorNode(BRIDGE_TYPE, { code: 'graph TD\n  A --> B' }),
            ),
          ),
        surfaces: ['slash', 'context'],
      },
    ],
  }
}
