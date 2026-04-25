import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

const VIEW_BAG_NAMES = new Set(['text', 'each', 'show', 'branch', 'memo', 'selector'])

export default createRule({
  name: 'view-bag-import',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow importing view bag primitives directly when defining a component',
    },
    schema: [],
    messages: {
      noViewBagImport:
        "Do not import '{{name}}' from '@llui/dom'. Use the view bag instead: view: ({ {{name}}, ... }) => [...]. The view bag version is typed to your component's State.",
    },
  },
  defaultOptions: [],
  create(context) {
    // Only applies to files that define a component.
    let definesComponent = false

    return {
      CallExpression(node) {
        if (
          node.callee.type === AST_NODE_TYPES.Identifier &&
          node.callee.name === 'component' &&
          node.arguments.length > 0 &&
          node.arguments[0] &&
          node.arguments[0].type === AST_NODE_TYPES.ObjectExpression
        ) {
          for (const prop of node.arguments[0].properties) {
            if (
              prop.type === AST_NODE_TYPES.Property &&
              prop.key.type === AST_NODE_TYPES.Identifier &&
              prop.key.name === 'view'
            ) {
              definesComponent = true
            }
          }
        }
      },
      'Program:exit'() {
        if (!definesComponent) return

        const sourceCode = context.sourceCode
        const ast = sourceCode.ast

        for (const stmt of ast.body) {
          if (stmt.type === AST_NODE_TYPES.ImportDeclaration && stmt.source.value === '@llui/dom') {
            for (const specifier of stmt.specifiers) {
              if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
                const importedName =
                  specifier.imported.type === AST_NODE_TYPES.Identifier
                    ? specifier.imported.name
                    : specifier.imported.value
                if (typeof importedName === 'string' && VIEW_BAG_NAMES.has(importedName)) {
                  context.report({
                    node: specifier,
                    messageId: 'noViewBagImport',
                    data: {
                      name: importedName,
                    },
                  })
                }
              }
            }
          }
        }
      },
    }
  },
})
