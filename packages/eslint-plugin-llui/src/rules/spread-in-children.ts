import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule'

const ELEMENT_HELPERS = new Set([
  'div',
  'span',
  'button',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'nav',
  'main',
  'section',
  'article',
  'header',
  'footer',
  'form',
  'fieldset',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'label',
  'details',
  'summary',
])

const STRUCTURAL = new Set([
  'each',
  'show',
  'branch',
  'virtualEach',
  'onMount',
  'provide',
  'provideValue',
  'pageSlot',
])

export default createRule({
  name: 'spread-in-children',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow spreading arrays directly into element children',
    },
    schema: [],
    messages: {
      noSpreadInChildren:
        "Spread in children of '{{name}}()' prevents template-clone optimization. Use each() for lists.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          ELEMENT_HELPERS.has(node.callee.name)
        ) {
          for (const arg of node.arguments) {
            if (arg.type !== AST_NODE_TYPES.ArrayExpression) continue

            for (const el of arg.elements) {
              if (el?.type !== AST_NODE_TYPES.SpreadElement) continue

              const inner = el.argument
              if (
                inner.type === AST_NODE_TYPES.CallExpression &&
                inner.callee.type === AST_NODE_TYPES.Identifier
              ) {
                if (STRUCTURAL.has(inner.callee.name)) continue
              }

              context.report({
                node: el,
                messageId: 'noSpreadInChildren',
                data: {
                  name: node.callee.name,
                },
              })
            }
          }
        }
      },
    }
  },
})
