import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule'

const imperativeMethods = new Set([
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'getElementsByClassName',
  'getElementsByTagName',
])

function isInsideOnMountCall(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (
      current.type === AST_NODE_TYPES.CallExpression &&
      current.callee.type === AST_NODE_TYPES.Identifier &&
      current.callee.name === 'onMount'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function isInsideImperativeCallback(node: TSESTree.Node): boolean {
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
          /^on[A-Z]/.test(parent.key.name)
        ) {
          return true
        }
        if (parent.type === AST_NODE_TYPES.CallExpression) {
          const callee = parent.callee
          if (callee.type === AST_NODE_TYPES.Identifier) {
            if (
              [
                'setTimeout',
                'setInterval',
                'queueMicrotask',
                'requestAnimationFrame',
                'requestIdleCallback',
              ].includes(callee.name)
            ) {
              return true
            }
          }
          if (
            callee.type === AST_NODE_TYPES.MemberExpression &&
            callee.property.type === AST_NODE_TYPES.Identifier
          ) {
            if (['addEventListener', 'then', 'catch', 'finally'].includes(callee.property.name)) {
              return true
            }
          }
        }
      }
    }
    current = current.parent
  }
  return false
}

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

export default createRule({
  name: 'imperative-dom-in-view',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow imperative DOM access in view()',
    },
    schema: [],
    messages: {
      imperativeDom:
        "Imperative DOM access in view() won't be reactive. Use LLui primitives (text, show, branch, each) for reactive rendering. Use onMount() for imperative DOM that runs once.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === AST_NODE_TYPES.Identifier &&
          node.object.name === 'document' &&
          node.property.type === AST_NODE_TYPES.Identifier &&
          imperativeMethods.has(node.property.name)
        ) {
          if (
            isInsideViewFunction(node) &&
            !isInsideOnMountCall(node) &&
            !isInsideImperativeCallback(node)
          ) {
            context.report({
              node,
              messageId: 'imperativeDom',
            })
          }
        }
      },
    }
  },
})
