import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

export const stateMutationRule = createRule({
  name: 'state-mutation',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow mutating state directly in update() functions.',
    },
    schema: [],
    messages: {
      assignment:
        'Direct mutation of state via assignment in update(). Use spread: { ...{{stateName}}, field: newValue }',
      compound: 'Compound assignment on state in update(). State is immutable.',
      increment: 'Increment/decrement on state in update(). State is immutable.',
      method:
        'Mutating method .{{methodName}}() called on state property in update(). Use immutable alternatives.',
    },
  },
  defaultOptions: [],
  create(context) {
    let currentUpdateStateName: string | null = null
    let updateFnBody: TSESTree.Node | null = null

    function isStatePropertyAccess(node: TSESTree.Node, stateName: string): boolean {
      if (node.type === AST_NODE_TYPES.MemberExpression) {
        if (node.object.type === AST_NODE_TYPES.Identifier && node.object.name === stateName) {
          return true
        }
        return isStatePropertyAccess(node.object, stateName)
      }
      return false
    }

    return {
      Property(node) {
        if (
          node.key.type === AST_NODE_TYPES.Identifier &&
          node.key.name === 'update' &&
          (node.value.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            node.value.type === AST_NODE_TYPES.FunctionExpression)
        ) {
          const fn = node.value
          const stateParam = fn.params[0]
          if (stateParam && stateParam.type === AST_NODE_TYPES.Identifier) {
            currentUpdateStateName = stateParam.name
            updateFnBody = fn.body
          }
        }
      },
      'Property:exit'(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'update') {
          currentUpdateStateName = null
          updateFnBody = null
        }
      },

      AssignmentExpression(node) {
        if (!currentUpdateStateName || !updateFnBody) return

        if (node.operator === '=') {
          if (isStatePropertyAccess(node.left, currentUpdateStateName)) {
            context.report({
              node,
              messageId: 'assignment',
              data: { stateName: currentUpdateStateName },
            })
          }
        } else {
          // Compound assignment
          if (isStatePropertyAccess(node.left, currentUpdateStateName)) {
            context.report({
              node,
              messageId: 'compound',
            })
          }
        }
      },

      UpdateExpression(node) {
        if (!currentUpdateStateName || !updateFnBody) return

        if (isStatePropertyAccess(node.argument, currentUpdateStateName)) {
          context.report({
            node,
            messageId: 'increment',
          })
        }
      },

      CallExpression(node) {
        if (!currentUpdateStateName || !updateFnBody) return

        if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier
        ) {
          const methodName = node.callee.property.name
          if (
            ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill'].includes(
              methodName,
            )
          ) {
            if (isStatePropertyAccess(node.callee.object, currentUpdateStateName)) {
              context.report({
                node,
                messageId: 'method',
                data: { methodName },
              })
            }
          }
        }
      },
    }
  },
})
