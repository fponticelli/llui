import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

export const unnecessaryChildRule = createRule({
  name: 'unnecessary-child',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn when child() is used for components with very few state accesses and no receives. Suggest using a view function (Level 1 composition) instead.',
    },
    schema: [],
    messages: {
      unnecessary:
        "child() used for component '{{compName}}' which has fewer than 10 state access paths and no receives. Consider using a view function (Level 1 composition) instead.",
    },
  },
  defaultOptions: [],
  create(context) {
    const componentInfo = new Map<string, { stateAccessCount: number; hasReceives: boolean }>()

    function countStateAccesses(node: TSESTree.Node, accesses: Set<string>): void {
      if (
        node.type === AST_NODE_TYPES.MemberExpression &&
        node.object.type === AST_NODE_TYPES.Identifier
      ) {
        const name = node.object.name
        if (name === 'state' || name === 's' || name === '_state') {
          if (node.property.type === AST_NODE_TYPES.Identifier) {
            accesses.add(node.property.name)
          }
        }
      }

      // Simple traversal for state accesses
      for (const key in node) {
        if (key === 'parent') continue
        const child = (node as any)[key]
        if (Array.isArray(child)) {
          for (const c of child) {
            if (c && typeof c.type === 'string') {
              countStateAccesses(c, accesses)
            }
          }
        } else if (child && typeof child.type === 'string') {
          countStateAccesses(child, accesses)
        }
      }
    }

    return {
      VariableDeclarator(node) {
        if (
          node.id.type === AST_NODE_TYPES.Identifier &&
          node.init &&
          node.init.type === AST_NODE_TYPES.CallExpression &&
          node.init.callee.type === AST_NODE_TYPES.Identifier &&
          node.init.callee.name === 'component'
        ) {
          const arg = node.init.arguments[0]
          if (arg && arg.type === AST_NODE_TYPES.ObjectExpression) {
            let hasReceives = false
            let stateAccessCount = 0

            for (const prop of arg.properties) {
              if (
                prop.type === AST_NODE_TYPES.Property &&
                prop.key.type === AST_NODE_TYPES.Identifier
              ) {
                if (prop.key.name === 'receives') {
                  hasReceives = true
                }
                if (prop.key.name === 'view' || prop.key.name === 'update') {
                  const accesses = new Set<string>()
                  countStateAccesses(prop.value, accesses)
                  stateAccessCount += accesses.size
                }
              }
            }

            componentInfo.set(node.id.name, {
              stateAccessCount,
              hasReceives,
            })
          }
        }
      },

      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'child') {
          const arg = node.arguments[0]
          if (arg && arg.type === AST_NODE_TYPES.ObjectExpression) {
            for (const prop of arg.properties) {
              if (
                prop.type === AST_NODE_TYPES.Property &&
                prop.key.type === AST_NODE_TYPES.Identifier &&
                prop.key.name === 'component'
              ) {
                if (prop.value.type === AST_NODE_TYPES.Identifier) {
                  const compName = prop.value.name
                  const info = componentInfo.get(compName)
                  if (info && info.stateAccessCount < 10 && !info.hasReceives) {
                    context.report({
                      node,
                      messageId: 'unnecessary',
                      data: { compName },
                    })
                  }
                }
              }
            }
          }
        }
      },
    }
  },
})
