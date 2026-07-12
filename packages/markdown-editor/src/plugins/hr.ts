// Horizontal-rule plugin — a thematic break rendered as an `<hr>` via the
// decorator bridge, round-tripping to `---` markdown.

import { type ElementNode, type LexicalNode } from 'lexical'
import { $insertNodeToNearestRoot } from '@lexical/utils'
import type { ElementTransformer } from '@lexical/markdown'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { hr } from '@llui/dom'
import type { MarkdownPlugin } from './types.js'

const BRIDGE_TYPE = 'hr'

const hrBridge = decoratorBridge<Record<string, never>>(BRIDGE_TYPE, () => [
  hr({ 'data-md-hr': '', contenteditable: 'false' }),
])

const HR_TRANSFORMER: ElementTransformer = {
  dependencies: [LLuiDecoratorNode],
  export: (node: LexicalNode): string | null =>
    $isLLuiDecoratorNode(node) && node.getBridgeType() === BRIDGE_TYPE ? '---' : null,
  regExp: /^(---|\*\*\*|___)\s*$/,
  replace: (parentNode: ElementNode): void => {
    parentNode.replace($createLLuiDecoratorNode(BRIDGE_TYPE, {}))
  },
  type: 'element',
}

/** Insert a horizontal rule at the current selection. */
export function $insertHorizontalRule(): void {
  $insertNodeToNearestRoot($createLLuiDecoratorNode(BRIDGE_TYPE, {}))
}

export function hrPlugin(): MarkdownPlugin {
  return {
    name: 'hr',
    nodes: [LLuiDecoratorNode],
    decorators: [hrBridge],
    transformers: [HR_TRANSFORMER],
    items: [
      {
        id: 'horizontalRule',
        label: 'Divider',
        icon: 'hr',
        group: 'insert',
        keywords: ['rule', 'divider', 'separator', 'hr'],
        run: (editor) => editor.update(() => $insertHorizontalRule()),
        surfaces: ['toolbar', 'slash', 'context'],
      },
    ],
  }
}
