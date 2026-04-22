import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule'

export default createRule({
  name: 'async-update',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow async operations in update()',
    },
    schema: [],
    messages: {
      asyncUpdate: 'update() must be synchronous and pure. Move async operations to effects.',
    },
  },
  defaultOptions: [],
  create(context) {
    let updateFunctionNode: TSESTree.Node | null = null

    return {
      Property(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'update') {
          const fn = node.value
          if (
            fn.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            fn.type === AST_NODE_TYPES.FunctionExpression
          ) {
            updateFunctionNode = fn

            if (fn.async) {
              context.report({
                node: fn,
                messageId: 'asyncUpdate',
              })
            }
          }
        }
      },
      'Property:exit'(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'update') {
          updateFunctionNode = null
        }
      },
      AwaitExpression(node) {
        if (!updateFunctionNode) return

        // Check if the closest enclosing function is the update function.
        let current: TSESTree.Node | undefined = node.parent
        while (current) {
          if (
            current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            current.type === AST_NODE_TYPES.FunctionExpression ||
            current.type === AST_NODE_TYPES.FunctionDeclaration
          ) {
            if (current === updateFunctionNode) {
              context.report({
                node,
                messageId: 'asyncUpdate',
              })
            }
            return // Stop checking at the first function boundary
          }
          current = current.parent
        }
      },
    }
  },
})
