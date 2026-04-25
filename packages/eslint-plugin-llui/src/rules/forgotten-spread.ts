import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

const structuralNames = new Set(['show', 'branch', 'each'])

export default createRule({
  name: 'forgotten-spread',
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure structural helpers are spread within array literals',
    },
    schema: [],
    messages: {
      forgottenSpread:
        "{{name}}() returns Node[] — spread it: [...{{name}}({...})]. Without spread, the array is nested and won't render correctly.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ArrayExpression(node) {
        for (const element of node.elements) {
          if (
            element?.type === AST_NODE_TYPES.CallExpression &&
            element.callee.type === AST_NODE_TYPES.Identifier &&
            structuralNames.has(element.callee.name)
          ) {
            context.report({
              node: element,
              messageId: 'forgottenSpread',
              data: {
                name: element.callee.name,
              },
            })
          }
        }
      },
    }
  },
})
