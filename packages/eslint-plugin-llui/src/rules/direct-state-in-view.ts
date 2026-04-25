import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

function isInsideViewFunction(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (
      current.type === AST_NODE_TYPES.Property &&
      current.key.type === AST_NODE_TYPES.Identifier &&
      current.key.name === 'view'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function isInsideEventHandler(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionExpression
    ) {
      const parent = current.parent
      if (
        parent &&
        parent.type === AST_NODE_TYPES.Property &&
        parent.key.type === AST_NODE_TYPES.Identifier &&
        /^on[A-Z]/.test(parent.key.name)
      ) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

function isInsideAccessor(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionExpression
    ) {
      const parent = current.parent
      if (parent) {
        if (
          parent.type === AST_NODE_TYPES.Property &&
          parent.key.type === AST_NODE_TYPES.Identifier &&
          parent.key.name === 'view'
        ) {
          return false // The view function itself is not an accessor
        }

        if (
          parent.type === AST_NODE_TYPES.CallExpression &&
          parent.callee.type === AST_NODE_TYPES.Identifier &&
          parent.callee.name === 'text'
        ) {
          return true
        }
        if (
          parent.type === AST_NODE_TYPES.Property &&
          parent.key.type === AST_NODE_TYPES.Identifier &&
          !/^on[A-Z]/.test(parent.key.name)
        ) {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}

export default createRule({
  name: 'direct-state-in-view',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct state capture in event handlers',
    },
    schema: [],
    messages: {
      directState:
        'Possible stale state capture in event handler. Use an accessor (s => s.field) for reactive reads, or item.field() for imperative reads inside each().',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      MemberExpression(node) {
        if (node.object.type === AST_NODE_TYPES.Identifier && node.object.name === 'state') {
          if (isInsideViewFunction(node) && isInsideEventHandler(node) && !isInsideAccessor(node)) {
            context.report({
              node,
              messageId: 'directState',
            })
          }
        }
      },
    }
  },
})
