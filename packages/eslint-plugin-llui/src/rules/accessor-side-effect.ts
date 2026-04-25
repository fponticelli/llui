import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

const sideEffectNames = new Set(['fetch', 'alert'])
const consoleMethods = new Set(['log', 'warn', 'error'])

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

function isAccessorArrow(node: TSESTree.ArrowFunctionExpression): boolean {
  const parent = node.parent
  if (!parent) return false

  // First arg to text()
  if (
    parent.type === AST_NODE_TYPES.CallExpression &&
    parent.callee.type === AST_NODE_TYPES.Identifier &&
    parent.callee.name === 'text' &&
    parent.arguments[0] === node
  ) {
    return true
  }

  // Prop value in a property assignment (e.g. class: s => ...)
  // But NOT an event handler!
  if (parent.type === AST_NODE_TYPES.Property) {
    if (parent.key.type === AST_NODE_TYPES.Identifier) {
      if (/^on[A-Z]/.test(parent.key.name)) {
        return false // Event handlers are not accessors
      }
      return true
    }
  }
  return false
}

function isDirectlyInsideAccessor(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (current.type === AST_NODE_TYPES.ArrowFunctionExpression) {
      return isAccessorArrow(current)
    }
    current = current.parent
  }
  return false
}

export default createRule({
  name: 'accessor-side-effect',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow side effects in accessor functions',
    },
    schema: [],
    messages: {
      accessorSideEffect:
        'Side effect in accessor function. Accessors run on every state change — move side effects to update() or onEffect.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (!isInsideViewFunction(node) || !isDirectlyInsideAccessor(node)) {
          return
        }

        // Check for console.*
        if (node.callee.type === AST_NODE_TYPES.MemberExpression) {
          if (
            node.callee.object.type === AST_NODE_TYPES.Identifier &&
            node.callee.object.name === 'console' &&
            node.callee.property.type === AST_NODE_TYPES.Identifier &&
            consoleMethods.has(node.callee.property.name)
          ) {
            context.report({
              node,
              messageId: 'accessorSideEffect',
            })
          }
        }

        // Check for fetch, alert
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          sideEffectNames.has(node.callee.name)
        ) {
          context.report({
            node,
            messageId: 'accessorSideEffect',
          })
        }
      },
    }
  },
})
