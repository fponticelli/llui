import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

function isEmptyFunctionBody(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): boolean {
  if (fn.body.type === AST_NODE_TYPES.BlockStatement) {
    return fn.body.body.length === 0
  }
  // expression body (e.g. () => undefined) is intentionally not empty
  return false
}

export default createRule({
  name: 'exhaustive-effect-handling',
  meta: {
    type: 'problem',
    docs: {
      description: 'Require exhaustive effect handling',
    },
    schema: [],
    messages: {
      emptyElse:
        'Empty .else() handler silently drops unhandled effects. Add a console.warn for unrecognized effect types, or handle them explicitly.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          node.callee.property.name === 'else'
        ) {
          const arg = node.arguments[0]
          if (
            arg &&
            (arg.type === AST_NODE_TYPES.ArrowFunctionExpression ||
              arg.type === AST_NODE_TYPES.FunctionExpression)
          ) {
            if (isEmptyFunctionBody(arg)) {
              context.report({
                node,
                messageId: 'emptyElse',
              })
            }
          }
        }
      },
    }
  },
})
