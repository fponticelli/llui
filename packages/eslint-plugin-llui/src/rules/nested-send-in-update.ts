import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

function isDirectlyInsideUpdate(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent

  while (current) {
    if (
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionDeclaration
    ) {
      const parent = current.parent
      if (
        parent &&
        parent.type === AST_NODE_TYPES.Property &&
        parent.key.type === AST_NODE_TYPES.Identifier &&
        parent.key.name === 'update'
      ) {
        return true
      }
      return false // Stop at the first function boundary
    }
    current = current.parent
  }
  return false
}

function isInsideComponentCall(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (
      current.type === AST_NODE_TYPES.CallExpression &&
      current.callee.type === AST_NODE_TYPES.Identifier &&
      current.callee.name === 'component'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

export default createRule({
  name: 'nested-send-in-update',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow calling send() inside update()',
    },
    schema: [],
    messages: {
      nestedSend:
        'Calling send() inside update() causes recursive dispatch. Return effects instead: return [newState, [myEffect]].',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'send') {
          if (isDirectlyInsideUpdate(node) && isInsideComponentCall(node)) {
            context.report({
              node,
              messageId: 'nestedSend',
            })
          }
        }
      },
    }
  },
})
