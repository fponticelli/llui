import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

export const mapOnStateArrayRule = createRule({
  name: 'map-on-state-array',
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow using .map() on state arrays in view. Use each() for reactive lists.',
    },
    schema: [],
    messages: {
      useEach: 'Array .map() on state-derived value in view(). Use each() for reactive lists.',
    },
  },
  defaultOptions: [],
  create(context) {
    let inViewFunction = false

    function referencesStateParam(node: TSESTree.Node): boolean {
      if (node.type === AST_NODE_TYPES.MemberExpression) {
        return referencesStateParam(node.object)
      }
      if (node.type === AST_NODE_TYPES.Identifier) {
        const name = node.name
        return name === 'state' || name === 's' || name === '_state'
      }
      return false
    }

    return {
      Property(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'view') {
          inViewFunction = true
        }
      },
      'Property:exit'(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'view') {
          inViewFunction = false
        }
      },

      CallExpression(node) {
        if (!inViewFunction) return

        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return
        if (node.callee.property.type !== AST_NODE_TYPES.Identifier) return
        if (node.callee.property.name !== 'map') return

        if (referencesStateParam(node.callee.object)) {
          context.report({
            node,
            messageId: 'useEach',
          })
        }
      },
    }
  },
})
