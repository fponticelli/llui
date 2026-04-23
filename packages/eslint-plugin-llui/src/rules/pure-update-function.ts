import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

function isInsideUpdateFunction(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node.parent
  while (current) {
    if (
      current.type === AST_NODE_TYPES.Property &&
      current.key.type === AST_NODE_TYPES.Identifier &&
      current.key.name === 'update'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

export const pureUpdateFunctionRule = createRule({
  name: 'pure-update-function',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow side-effects (e.g., fetch, setTimeout, Date.now) inside the update function.',
    },
    schema: [],
    messages: {
      impureCall:
        "The update function must be a pure reducer. '{{name}}' is a side-effect. Return an Effect instead.",
    },
  },
  defaultOptions: [],
  create(context) {
    const BANNED_GLOBAL_CALLS = new Set([
      'fetch',
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ])

    return {
      CallExpression(node) {
        if (!isInsideUpdateFunction(node)) return

        // Direct calls like fetch()
        if (node.callee.type === AST_NODE_TYPES.Identifier) {
          if (BANNED_GLOBAL_CALLS.has(node.callee.name)) {
            context.report({
              node,
              messageId: 'impureCall',
              data: { name: node.callee.name },
            })
          }
        }

        // Member calls like window.fetch(), Math.random(), Date.now()
        if (node.callee.type === AST_NODE_TYPES.MemberExpression) {
          const member = node.callee
          if (member.property.type === AST_NODE_TYPES.Identifier) {
            const propName = member.property.name
            let objName = ''

            if (member.object.type === AST_NODE_TYPES.Identifier) {
              objName = member.object.name
            }

            if (
              (objName === 'window' && BANNED_GLOBAL_CALLS.has(propName)) ||
              (objName === 'Math' && propName === 'random') ||
              (objName === 'Date' && propName === 'now') ||
              objName === 'document' ||
              objName === 'localStorage' ||
              objName === 'sessionStorage'
            ) {
              context.report({
                node,
                messageId: 'impureCall',
                data: { name: `${objName}.${propName}` },
              })
            }
          }
        }
      },

      // Also flag direct property accesses to window.* or document.* if they are used to read state
      MemberExpression(node) {
        if (!isInsideUpdateFunction(node)) return

        // We only care about the top-level object
        if (node.object.type === AST_NODE_TYPES.Identifier) {
          const objName = node.object.name
          if (
            objName === 'document' ||
            objName === 'window' ||
            objName === 'localStorage' ||
            objName === 'sessionStorage'
          ) {
            // Ignore if it's the callee of a CallExpression since we handle it above
            if (
              node.parent?.type === AST_NODE_TYPES.CallExpression &&
              node.parent.callee === node
            ) {
              return
            }
            context.report({
              node,
              messageId: 'impureCall',
              data: { name: objName },
            })
          }
        }
      },

      NewExpression(node) {
        if (!isInsideUpdateFunction(node)) return
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'Date') {
          context.report({
            node,
            messageId: 'impureCall',
            data: { name: 'new Date()' },
          })
        }
      },
    }
  },
})
