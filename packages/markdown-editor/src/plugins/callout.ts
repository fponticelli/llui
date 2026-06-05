// Callout (admonition) plugin — the custom-rendering showcase. A callout is a
// block decorator: it stores `{ kind, text }`, renders an LLui sub-view (its own
// TEA loop) with a clickable kind badge, and round-trips to `:::kind text`
// markdown via a contributed element transformer.

import { type ElementNode, type LexicalEditor, type LexicalNode } from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import type { ElementTransformer } from '@lexical/markdown'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { button, component, div, span, text, type Signal } from '@llui/dom'
import type { MarkdownPlugin } from './types.js'

export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'

export interface CalloutData {
  kind: CalloutKind
  text: string
}

const KIND_CYCLE: readonly CalloutKind[] = ['note', 'tip', 'warning', 'danger']
const KIND_LABEL: Readonly<Record<CalloutKind, string>> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
}

const BRIDGE_TYPE = 'callout'

function nextKind(kind: CalloutKind): CalloutKind {
  const idx = KIND_CYCLE.indexOf(kind)
  return KIND_CYCLE[(idx + 1) % KIND_CYCLE.length]!
}

function isCalloutData(value: unknown): value is CalloutData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CalloutData).kind === 'string' &&
    typeof (value as CalloutData).text === 'string'
  )
}

type CalloutMsg = { type: 'cycle' } | { type: 'commitText'; text: string }

// Keep keyboard/input/paste events from bubbling to the outer Lexical editor so
// the nested editable text island edits natively without Lexical intercepting.
const stop = (e: Event): void => e.stopPropagation()

/** The LLui sub-view rendered inside a callout DecoratorNode. The badge cycles
 * the kind; the text is an editable island that persists into the Lexical node
 * on blur (both round-trip to markdown). */
const calloutBridge = decoratorBridge<CalloutData, CalloutData, CalloutMsg, never>(
  BRIDGE_TYPE,
  (data, api) =>
    component<CalloutData, CalloutMsg, never>({
      name: 'Callout',
      init: () => ({ kind: data.kind, text: data.text }),
      update: (state, msg) => {
        if (msg.type === 'cycle') {
          const kind = nextKind(state.kind)
          api.update({ kind, text: state.text })
          return { ...state, kind }
        }
        if (msg.type === 'commitText') {
          if (msg.text === state.text) return state
          api.update({ kind: state.kind, text: msg.text })
          return { ...state, text: msg.text }
        }
        return state
      },
      view: ({ state, send }) => [
        div(
          {
            'data-scope': 'md-callout',
            'data-part': 'root',
            'data-kind': state.at('kind') as Signal<string>,
            contenteditable: 'false',
            onKeyDown: stop,
            onBeforeInput: stop,
            onPaste: stop,
          },
          [
            button(
              {
                type: 'button',
                'data-part': 'badge',
                'aria-label': 'Change callout kind',
                onClick: () => send({ type: 'cycle' }),
              },
              [text(state.at('kind').map((k) => KIND_LABEL[k]))],
            ),
            span(
              {
                'data-part': 'text',
                contenteditable: 'true',
                role: 'textbox',
                'aria-label': 'Callout text',
                onBlur: (e: FocusEvent) =>
                  send({ type: 'commitText', text: (e.target as HTMLElement).textContent ?? '' }),
              },
              [text(state.at('text') as Signal<string>)],
            ),
          ],
        ),
      ],
    }),
)

/** `:::kind text` element transformer (single-line admonition). */
const CALLOUT_TRANSFORMER: ElementTransformer = {
  dependencies: [LLuiDecoratorNode],
  export: (node: LexicalNode): string | null => {
    if (!$isLLuiDecoratorNode(node) || node.getBridgeType() !== BRIDGE_TYPE) return null
    const data = node.getData()
    if (!isCalloutData(data)) return null
    return `:::${data.kind} ${data.text}`
  },
  regExp: /^:::(note|tip|warning|danger)[ \t]+(.+)$/,
  replace: (parentNode: ElementNode, _children, match): void => {
    const kind = match[1] as CalloutKind
    const callout = $createLLuiDecoratorNode(BRIDGE_TYPE, { kind, text: match[2] ?? '' })
    parentNode.replace(callout)
  },
  type: 'element',
}

/** Insert a fresh callout at the current selection; returns the created node. */
export function $insertCallout(
  kind: CalloutKind = 'note',
  textValue = 'New callout',
): LLuiDecoratorNode {
  return $insertNodeToNearestRoot($createLLuiDecoratorNode(BRIDGE_TYPE, { kind, text: textValue }))
}

/** Move focus into a callout's editable text island once it has decorated, and
 * select its placeholder text so the next keystroke replaces it. */
function focusCalloutText(editor: LexicalEditor, key: string, attempt = 0): void {
  if (typeof requestAnimationFrame !== 'function') return
  requestAnimationFrame(() => {
    const span = editor.getElementByKey(key)?.querySelector('[data-part="text"]')
    if (span instanceof HTMLElement) {
      span.focus()
      try {
        const range = document.createRange()
        range.selectNodeContents(span)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      } catch {
        /* selection API unavailable */
      }
    } else if (attempt < 3) {
      focusCalloutText(editor, key, attempt + 1)
    }
  })
}

export interface CalloutPluginOptions {
  /** Default kind for the toolbar/slash insert action. */
  defaultKind?: CalloutKind
}

export function calloutPlugin(opts: CalloutPluginOptions = {}): MarkdownPlugin {
  const defaultKind = opts.defaultKind ?? 'note'
  return {
    name: 'callout',
    nodes: [LLuiDecoratorNode],
    decorators: [calloutBridge],
    transformers: [CALLOUT_TRANSFORMER],
    items: [
      {
        id: 'callout',
        label: 'Callout',
        icon: 'callout',
        group: 'insert',
        keywords: ['note', 'admonition', 'aside', 'tip', 'warning'],
        run: (editor) => {
          let key = ''
          editor.update(() => {
            key = $insertCallout(defaultKind).getKey()
          })
          // Land the caret inside the new callout's text, not after the block.
          focusCalloutText(editor, key)
        },
        surfaces: ['toolbar', 'slash', 'context'],
      },
    ],
  }
}
