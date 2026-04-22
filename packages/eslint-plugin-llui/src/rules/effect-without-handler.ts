import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule'

function bodyReturnsEffects(node: TSESTree.Node): boolean {
  let found = false

  function visit(n: TSESTree.Node) {
    if (found) return

    if (n.type === AST_NODE_TYPES.ArrayExpression && n.elements.length === 2) {
      const second = n.elements[1]
      if (second && second.type === AST_NODE_TYPES.ArrayExpression && second.elements.length > 0) {
        found = true
        return
      }
    }

    for (const key in n) {
      if (key === 'parent') continue // IMPORTANT: avoid infinite loops
      if (Object.prototype.hasOwnProperty.call(n, key)) {
        const child = (n as unknown as Record<string, unknown>)[key]
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof (c as any).type === 'string') visit(c as TSESTree.Node)
          }
        } else if (child && typeof (child as any).type === 'string') {
          visit(child as TSESTree.Node)
        }
      }
    }
  }

  visit(node)
  return found
}

export default createRule({
  name: 'effect-without-handler',
  meta: {
    type: 'problem',
    docs: {
      description: 'Require onEffect if update() returns effects',
    },
    schema: [],
    messages: {
      missingHandler:
        'Component returns effects from update() but has no onEffect handler. Effects will be silently dropped (only built-in delay/log are handled automatically).',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'component') {
          const arg = node.arguments[0]
          if (arg && arg.type === AST_NODE_TYPES.ObjectExpression) {
            let hasOnEffect = false
            let hasEffectsInUpdate = false
            let updateNode: TSESTree.Property | undefined

            for (const prop of arg.properties) {
              if (
                prop.type !== AST_NODE_TYPES.Property ||
                prop.key.type !== AST_NODE_TYPES.Identifier
              )
                continue

              if (prop.key.name === 'onEffect') {
                hasOnEffect = true
              }

              if (prop.key.name === 'update') {
                updateNode = prop
                const fn = prop.value
                if (
                  fn.type === AST_NODE_TYPES.ArrowFunctionExpression ||
                  fn.type === AST_NODE_TYPES.FunctionExpression
                ) {
                  hasEffectsInUpdate = bodyReturnsEffects(fn.body)
                }
              }
            }

            if (hasEffectsInUpdate && !hasOnEffect && updateNode) {
              context.report({
                node: updateNode.key,
                messageId: 'missingHandler',
              })
            }
          }
        }
      },
    }
  },
})
